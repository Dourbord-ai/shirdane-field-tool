import { useEffect, useMemo, useState } from "react";
import { X, Link2, Loader2, CheckCircle2, AlertTriangle, SkipForward } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import {
  createPaymentAllocation,
  formatMoney,
  PAYMENT_REQUEST_STATUS_LABEL,
} from "@/lib/finance";
import { toastFinanceError } from "@/lib/financeErrors";

// ---------------------------------------------------------------------------
// Bulk Attach to Payment Request — frontend-only orchestrator.
//
// IMPORTANT (architecture):
//  - The backend stays 100% unchanged. There is NO bulk endpoint.
//  - For every selected bank transaction we call the SAME single-row mutation
//    used by the per-item dialog: `createPaymentAllocation(...)`.
//  - The DB trigger `fn_finance_payment_allocations_guard` and the lib-side
//    invariants in `createPaymentAllocation` (status check, payable cap,
//    party/Sepidar validation, `assignment_status='unassigned'` lock) all
//    still run for each call — so race conditions and bypass attempts are
//    rejected exactly as in the manual flow.
//
// IMPORTANT (concurrency):
//  - We deliberately serialize (concurrency = 1) instead of fanning out 2–3
//    parallel requests, because each allocation MUTATES shared state on the
//    server: the selected payment-request item's `paid_amount` increases
//    (via the DB trigger). Two concurrent calls reading the same `remaining`
//    could both pass the lib-side guard and then either over-allocate or
//    cause one of them to fail at the DB-trigger layer with a confusing
//    "over the remaining payable" error. Serializing keeps the UX
//    predictable and the failure messages meaningful, while still being far
//    faster than the operator clicking through the per-row dialog N times.
//
// IMPORTANT (item targeting):
//  - The user picks ONE payment request. We then walk its items in order
//    and, for each selected transaction, pick the first item whose current
//    remaining is >= the transaction's withdraw amount. We do NOT split a
//    transaction across multiple items, because once an allocation is
//    written the tx flips to `assignment_status='assigning'/'assigned'`
//    and can't be reused. If no item has enough remaining for a given tx
//    we mark it SKIPPED with a clear reason and keep going.
// ---------------------------------------------------------------------------

// Light projection of a payment-request header, just enough to render the
// picker and to know if the request can still receive allocations.
interface PRHeader {
  id: string;
  title: string | null;
  status: string | null;
  payment_status: string | null;
  confirmed_amount: number | null;
  total_paid_amount: number | null;
  legacy_id: number | null;
}

// Per-item state we maintain locally during processing. We refresh it from
// the DB right before we start so the picker decisions are based on the
// freshest paid_amount values.
interface PRItemLite {
  id: string;
  party_id: string | null;
  amount: number | null;
  confirmed_amount: number | null;
  paid_amount: number | null;
  status: string | null;
  // Live remaining used by the picker. Mutates as we allocate.
  remaining: number;
}

// Selected bank transaction projection — only the fields the dialog needs.
export interface BulkAttachTx {
  id: string;
  withdraw_amount: number | null;
  description: string | null;
  document_number: string | null;
  transaction_jalali_date?: string | null;
  // We re-check `assignment_status` right before calling the mutation so
  // a tx attached via another tab in the meantime is skipped, not failed.
  assignment_status?: string | null;
}

// One row in the per-transaction progress list.
interface ProgressRow {
  txId: string;
  amount: number;
  state: "pending" | "running" | "success" | "skipped" | "failed";
  message?: string;
}

interface Props {
  transactions: BulkAttachTx[];
  onClose: () => void;
  // Called after the run finishes (even on partial failure) so the parent
  // can refresh the list and clear selection.
  onDone: () => void;
}

export default function BulkAttachPaymentRequestDialog({ transactions, onClose, onDone }: Props) {
  // -------------------------------------------------------------------------
  // PR picker state.
  // -------------------------------------------------------------------------
  const [prs, setPrs] = useState<PRHeader[]>([]);
  const [loadingPRs, setLoadingPRs] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedPR, setSelectedPR] = useState<PRHeader | null>(null);

  // -------------------------------------------------------------------------
  // Run state — populated once the user clicks "شروع اتصال".
  // -------------------------------------------------------------------------
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [progress, setProgress] = useState<ProgressRow[]>([]);

  // Total withdraw sum across the selected transactions. Used in the header
  // summary so the operator can sanity-check before launching.
  const totalSelectedAmount = useMemo(
    () => transactions.reduce((s, t) => s + Number(t.withdraw_amount || 0), 0),
    [transactions],
  );

  // -------------------------------------------------------------------------
  // Initial PR fetch. We only show requests that can still receive money:
  // status in (approved, partially_paid, sync_failed) AND payment_status
  // not 'fully_paid'. The lib-side guard will reject anything else anyway,
  // but pre-filtering here gives the user a clean list to choose from.
  // -------------------------------------------------------------------------
  useEffect(() => {
    void (async () => {
      setLoadingPRs(true);
      const { data, error } = await supabase
        .from("finance_payment_requests")
        .select("id, title, status, payment_status, confirmed_amount, total_paid_amount, legacy_id")
        .eq("is_deleted", false)
        .in("status", ["approved", "partially_paid", "sync_failed"])
        .neq("payment_status", "fully_paid")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) {
        toastFinanceError(toast, error);
      } else {
        setPrs((data as PRHeader[]) || []);
      }
      setLoadingPRs(false);
    })();
  }, []);

  // Client-side search across title / legacy_id / id. Cheap because the list
  // is capped at 500 rows.
  const filteredPRs = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return prs;
    return prs.filter((r) => {
      const hay = [r.title || "", r.legacy_id != null ? String(r.legacy_id) : "", r.id]
        .join(" ")
        .toLowerCase();
      return hay.includes(needle);
    });
  }, [prs, search]);

  // -------------------------------------------------------------------------
  // The actual orchestrator. Sequential, fail-soft, with live progress.
  // -------------------------------------------------------------------------
  async function run() {
    if (!selectedPR || running) return;
    setRunning(true);
    setDone(false);

    // Pull a fresh snapshot of the request's items so our local "remaining"
    // picker is accurate even if other operators allocated against this
    // request a moment ago.
    const { data: itemsData, error: itemsErr } = await supabase
      .from("finance_payment_request_items")
      .select("id, party_id, amount, confirmed_amount, paid_amount, status")
      .eq("payment_request_id", selectedPR.id)
      .eq("is_deleted", false);
    if (itemsErr) {
      toastFinanceError(toast, itemsErr);
      setRunning(false);
      return;
    }
    const items: PRItemLite[] = ((itemsData as PRItemLite[]) || [])
      .filter((i) => ["approved", "partially_paid", "sync_failed"].includes(String(i.status)))
      .map((i) => {
        // Same payable formula the lib uses (see createPaymentAllocation):
        // confirmed_amount when > 0, else amount; minus paid_amount.
        const payable = Number(i.confirmed_amount || 0) || Number(i.amount || 0);
        const remaining = Math.max(0, payable - Number(i.paid_amount || 0));
        return { ...i, remaining };
      });

    // Seed the progress list so the UI immediately shows every row.
    const seed: ProgressRow[] = transactions.map((t) => ({
      txId: t.id,
      amount: Number(t.withdraw_amount || 0),
      state: "pending",
    }));
    setProgress(seed);

    // Walk transactions one at a time. We mutate `items[].remaining` in place
    // so the next iteration's picker sees the up-to-date capacity.
    for (let i = 0; i < transactions.length; i++) {
      const tx = transactions[i];
      // Mark this row as running so the spinner appears next to it.
      setProgress((prev) => prev.map((p, idx) => (idx === i ? { ...p, state: "running" } : p)));

      const amount = Number(tx.withdraw_amount || 0);
      if (amount <= 0) {
        setProgress((prev) =>
          prev.map((p, idx) =>
            idx === i ? { ...p, state: "skipped", message: "مبلغ برداشت صفر است" } : p,
          ),
        );
        continue;
      }

      // Defensive: re-check the tx is still unassigned in the DB. A parallel
      // tab or auto-process run might have grabbed it.
      const { data: freshTx } = await supabase
        .from("finance_bank_transactions")
        .select("assignment_status")
        .eq("id", tx.id)
        .maybeSingle();
      if (freshTx && freshTx.assignment_status !== "unassigned") {
        setProgress((prev) =>
          prev.map((p, idx) =>
            idx === i
              ? { ...p, state: "skipped", message: "تراکنش قبلاً به عملیات دیگری متصل شده است" }
              : p,
          ),
        );
        continue;
      }

      // Find first item that can fully absorb this tx. We require >= amount
      // because we never split a tx across items (see header docs).
      const target = items.find((it) => it.remaining + 1e-6 >= amount);
      if (!target) {
        setProgress((prev) =>
          prev.map((p, idx) =>
            idx === i
              ? {
                  ...p,
                  state: "skipped",
                  message: "هیچ ردیفی مانده کافی برای این تراکنش ندارد",
                }
              : p,
          ),
        );
        continue;
      }

      try {
        const r = await createPaymentAllocation({
          payment_request_id: selectedPR.id,
          payment_request_item_id: target.id,
          bank_transaction_id: tx.id,
          amount,
        });
        if (r.ok) {
          // Decrement locally so the next iteration's picker is correct.
          target.remaining = Math.max(0, target.remaining - amount);
          setProgress((prev) =>
            prev.map((p, idx) => (idx === i ? { ...p, state: "success" } : p)),
          );
        } else {
          // Allocation row was created but Sepidar sync failed. We still
          // count this as a success at the "attach" level because the tx
          // is now linked to the request — the operator can retry the
          // Sepidar post from the PR detail screen, exactly like the
          // single-row flow.
          target.remaining = Math.max(0, target.remaining - amount);
          setProgress((prev) =>
            prev.map((p, idx) =>
              idx === i
                ? {
                    ...p,
                    state: "success",
                    message: r.error || "اتصال انجام شد ولی ثبت سپیدار ناموفق بود",
                  }
                : p,
            ),
          );
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "خطای نامشخص";
        setProgress((prev) =>
          prev.map((p, idx) => (idx === i ? { ...p, state: "failed", message: msg } : p)),
        );
        // We intentionally CONTINUE on failure — the spec requires processing
        // every selected row, not halting on the first error.
      }
    }

    setRunning(false);
    setDone(true);
  }

  // Aggregate counters for the live + final summary banner.
  const counts = useMemo(() => {
    const c = { success: 0, failed: 0, skipped: 0, processed: 0 };
    for (const p of progress) {
      if (p.state === "success") c.success++;
      else if (p.state === "failed") c.failed++;
      else if (p.state === "skipped") c.skipped++;
      if (p.state !== "pending" && p.state !== "running") c.processed++;
    }
    return c;
  }, [progress]);

  // Persisted final toast — fires once when the run completes so the user
  // gets a clear summary even if they close the dialog immediately.
  useEffect(() => {
    if (!done) return;
    toast.success(
      `پایان اتصال گروهی — موفق: ${counts.success} · ناموفق: ${counts.failed} · رد شده: ${counts.skipped}`,
    );
  }, [done, counts.success, counts.failed, counts.skipped]);

  function close() {
    // When the user dismisses the dialog AFTER a run we trigger onDone so
    // the parent refreshes & clears selection. Before any run we just close.
    if (done || counts.processed > 0) onDone();
    else onClose();
  }

  return (
    // RTL is inherited from the app shell (<html dir="rtl">). We still use
    // logical Tailwind classes (ml-1 / mr-1) which flip automatically.
    <div
      className="fixed inset-0 z-[70] bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={close}
    >
      <div
        className="bg-card rounded-t-2xl sm:rounded-2xl border shadow-lg w-full max-w-2xl max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Sticky header so the close button and title stay visible while
            the user scrolls through the long PR / progress lists. */}
        <div className="p-4 border-b flex items-center justify-between sticky top-0 bg-card z-10">
          <h3 className="font-bold">اتصال گروهی به درخواست پرداخت</h3>
          <Button size="icon" variant="ghost" onClick={close} disabled={running}>
            <X className="w-4 h-4" />
          </Button>
        </div>

        <div className="p-4 space-y-3">
          {/* Selection summary — always visible. */}
          <div className="rounded-lg bg-muted/40 p-3 text-xs grid grid-cols-2 sm:grid-cols-3 gap-2">
            <div>
              <span className="text-muted-foreground">تعداد تراکنش انتخاب‌شده: </span>
              <span className="font-bold">{transactions.length}</span>
            </div>
            <div>
              <span className="text-muted-foreground">جمع مبالغ: </span>
              <span className="font-bold">{formatMoney(totalSelectedAmount)}</span>
            </div>
            {selectedPR && (
              <div className="sm:text-left">
                <span className="text-muted-foreground">درخواست انتخاب‌شده: </span>
                <span className="font-bold">
                  {selectedPR.title || `#${selectedPR.legacy_id ?? selectedPR.id.slice(0, 6)}`}
                </span>
              </div>
            )}
          </div>

          {/* ----- Step 1: PR picker (hidden once a run has started). ----- */}
          {!running && !done && (
            <>
              <Input
                placeholder="جستجو در درخواست‌ها (عنوان / شناسه قدیمی)..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />

              <div className="rounded-xl border max-h-[40vh] overflow-y-auto divide-y">
                {loadingPRs && (
                  <div className="p-4 text-sm text-muted-foreground text-center">
                    در حال بارگذاری…
                  </div>
                )}
                {!loadingPRs && filteredPRs.length === 0 && (
                  <div className="p-4 text-sm text-muted-foreground text-center">
                    درخواست پرداخت قابل اتصال یافت نشد
                  </div>
                )}
                {filteredPRs.map((r) => {
                  const remaining =
                    Math.max(0, Number(r.confirmed_amount || 0) - Number(r.total_paid_amount || 0));
                  const isSelected = selectedPR?.id === r.id;
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => setSelectedPR(r)}
                      className={`w-full text-right p-3 text-sm transition-colors ${
                        isSelected ? "bg-primary/10" : "hover:bg-muted/40"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold truncate">
                          {r.title || `#${r.legacy_id ?? r.id.slice(0, 6)}`}
                        </span>
                        <span className="text-[11px] text-muted-foreground">
                          {PAYMENT_REQUEST_STATUS_LABEL[String(r.status)] || r.status}
                        </span>
                      </div>
                      <div className="mt-1 grid grid-cols-2 gap-1 text-[11px] text-muted-foreground">
                        <div>
                          تأییدشده:{" "}
                          <span className="text-foreground">
                            {formatMoney(r.confirmed_amount || 0)}
                          </span>
                        </div>
                        <div>
                          مانده قابل پرداخت:{" "}
                          <span
                            className={
                              remaining >= totalSelectedAmount
                                ? "text-emerald-700 dark:text-emerald-300 font-bold"
                                : "text-amber-700 dark:text-amber-300 font-bold"
                            }
                          >
                            {formatMoney(remaining)}
                          </span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="ghost" onClick={onClose}>
                  انصراف
                </Button>
                <Button onClick={run} disabled={!selectedPR}>
                  <Link2 className="w-4 h-4 ml-1" />
                  شروع اتصال
                </Button>
              </div>
            </>
          )}

          {/* ----- Step 2: live progress + final summary. ----- */}
          {(running || done) && (
            <>
              {/* Top-line progress banner so the operator sees X of Y at a
                  glance — meets the "3 of 12 attached" UX requirement. */}
              <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                <div className="flex items-center gap-2 font-bold">
                  {running ? (
                    <Loader2 className="w-4 h-4 animate-spin text-primary" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  )}
                  {counts.processed} از {transactions.length} پردازش شد
                </div>
                <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted-foreground">
                  <span>موفق: <span className="text-emerald-700">{counts.success}</span></span>
                  <span>ناموفق: <span className="text-red-700">{counts.failed}</span></span>
                  <span>رد شده: <span className="text-amber-700">{counts.skipped}</span></span>
                </div>
              </div>

              <div className="rounded-xl border max-h-[40vh] overflow-y-auto divide-y">
                {progress.map((p) => (
                  <div key={p.txId} className="p-2 text-xs flex items-start gap-2">
                    <span className="mt-0.5">
                      {p.state === "pending" && <span className="text-muted-foreground">⏳</span>}
                      {p.state === "running" && (
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
                      )}
                      {p.state === "success" && (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                      )}
                      {p.state === "skipped" && (
                        <SkipForward className="w-3.5 h-3.5 text-amber-600" />
                      )}
                      {p.state === "failed" && (
                        <AlertTriangle className="w-3.5 h-3.5 text-red-600" />
                      )}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono truncate">{p.txId.slice(0, 8)}…</span>
                        <span>{formatMoney(p.amount)}</span>
                      </div>
                      {p.message && (
                        <div
                          className={`mt-0.5 text-[11px] ${
                            p.state === "failed"
                              ? "text-red-700"
                              : p.state === "skipped"
                              ? "text-amber-700"
                              : "text-muted-foreground"
                          }`}
                        >
                          {p.message}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button onClick={close} disabled={running}>
                  {running ? "در حال پردازش…" : "بستن"}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
