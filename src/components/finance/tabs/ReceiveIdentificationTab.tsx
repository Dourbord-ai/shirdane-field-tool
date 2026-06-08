import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toastFinanceError } from "@/lib/financeErrors";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { TransactionSelector, PartySelector } from "@/components/finance/selectors";
import { MoneyCell, JalaliDateCell } from "@/components/finance/atoms";
import { cn } from "@/lib/utils";
import {
  createReceiveIdentification,
  approveReceiveIdentification,
  rejectReceiveIdentification,
  cancelReceiveIdentification,
  partyName,
  receiveIdStatusLabel,
} from "@/lib/finance";
import { toast } from "sonner";
import { CheckCircle2, X, Plus, XCircle, Send } from "lucide-react";
// Phase 4 — generic rollback dialog gated by admin/super_admin role.
import { RollbackButton } from "@/components/finance/RollbackConfirmDialog";
// Phase 5 — advanced server-side filter bar (date / party / amount / banks).
import ReceiveIdFilters, {
  EMPTY_RECEIVE_ID_FILTERS,
  countActiveFilters,
  type ReceiveIdFilterState,
} from "@/components/finance/ReceiveIdFilters";
import { toGregorianForDb } from "@/lib/toGregorianForDb";
// Read-only detail panel reused for the bank-transactions → receive-id
// deep-link flow. We pass `hideNavButton` so the dialog doesn't render a
// circular "go to related tab" button pointing back at this same tab.
import AssignmentDetailsDialog from "@/components/finance/AssignmentDetailsDialog";
import type { JalaliDate } from "@/lib/jalali";

// Render a status badge using ONLY the receive-identification label map so
// that imported rows with status="draft" surface as «در انتظار تایید» rather
// than the generic «پیش‌نویس» from the payment-request label map.
function ReceiveIdStatusBadge({ status }: { status: string | null | undefined }) {
  const key = status || "pending_approval";
  // Visual tone mirrors FinanceStatusBadge but is kept local so the receive
  // identifications tab is fully self-consistent.
  const tone: Record<string, string> = {
    draft: "bg-amber-100 text-amber-800",
    pending_approval: "bg-amber-100 text-amber-800",
    approved: "bg-emerald-100 text-emerald-800",
    sync_failed: "bg-red-100 text-red-800",
    rejected: "bg-red-100 text-red-800",
    cancelled: "bg-muted text-muted-foreground",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold",
        tone[key] || "bg-muted text-muted-foreground",
      )}
    >
      {receiveIdStatusLabel(key)}
    </span>
  );
}

interface RI {
  id: string;
  title: string | null;
  description: string | null;
  status: string | null;
  amount: number | null;
  transaction_datetime: string | null;
  bank_id: string | null;
  party_id: string | null;
  bank_transaction_id: string | null;
  voucher_id: string | null;
  rejection_reason: string | null;
  sepidar_error_message: string | null;
  sepidar_sync_attempts: number | null;
}

interface PartyRef {
  id: string; first_name: string | null; last_name: string | null;
  company_name: string | null; ownership_type: string | null;
}
interface BankRef { id: string; title: string | null; bank_name: string | null }

const FILTERS: Array<{ key: string; label: string }> = [
  { key: "", label: "همه" },
  { key: "pending_approval", label: "در انتظار تایید" },
  { key: "approved", label: "تایید شده" },
  { key: "sync_failed", label: "خطای سپیدار" },
  { key: "rejected", label: "رد شده" },
  { key: "cancelled", label: "لغو شده" },
];

export default function ReceiveIdentificationTab() {
  const [items, setItems] = useState<RI[]>([]);
  const [parties, setParties] = useState<Record<string, PartyRef>>({});
  const [banks, setBanks] = useState<Record<string, BankRef>>({});
  const [loading, setLoading] = useState(true);
  const [openNew, setOpenNew] = useState(false);
  const [openReject, setOpenReject] = useState<RI | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // -------------------------------------------------------------
  // URL-backed filter state (status pill + advanced filters)
  // -------------------------------------------------------------
  // We persist EVERY filter into the URL via useSearchParams. Two
  // benefits:
  //   1) Refresh / share-link preserves the user's view exactly.
  //   2) Future pagination can also live in the URL without us
  //      having to refactor the state model.
  const [searchParams, setSearchParams] = useSearchParams();

  // The status pill ("همه" / "در انتظار تایید" / ...). We default
  // to pending_approval because that's the operator's primary
  // working queue.
  const filter = searchParams.get("status") ?? "pending_approval";

  // Decode advanced filters from URL. useMemo so identity is stable
  // across renders unless the URL actually changed — important so
  // ReceiveIdFilters' internal useEffect doesn't fire spuriously.
  const advFilters: ReceiveIdFilterState = useMemo(
    () => ({
      fromDate: searchParams.get("from") || null,
      toDate: searchParams.get("to") || null,
      partyId: searchParams.get("party") || null,
      minAmount: searchParams.get("min") || null,
      maxAmount: searchParams.get("max") || null,
      // bank_ids stored as comma-separated UUIDs in URL.
      bankIds: (searchParams.get("banks") || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    }),
    [searchParams],
  );

  // Setter that PARTIALLY updates the URL while keeping all other
  // existing params (e.g. the status pill). React-router replaces
  // the entire searchParams object on each set, so we hand-merge.
  const setFilter = useCallback(
    (next: string) => {
      const p = new URLSearchParams(searchParams);
      if (next) p.set("status", next);
      else p.delete("status");
      setSearchParams(p, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  // Push the advanced filters into the URL — called when the user
  // clicks "اعمال فیلتر". Empty / null values are stripped so the
  // URL stays short and readable.
  const applyAdvFilters = useCallback(
    (next: ReceiveIdFilterState) => {
      const p = new URLSearchParams(searchParams);
      const setOrDel = (key: string, val: string | null) => {
        if (val) p.set(key, val);
        else p.delete(key);
      };
      setOrDel("from", next.fromDate);
      setOrDel("to", next.toDate);
      setOrDel("party", next.partyId);
      setOrDel("min", next.minAmount);
      setOrDel("max", next.maxAmount);
      setOrDel("banks", next.bankIds.length ? next.bankIds.join(",") : null);
      setSearchParams(p, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  // -----------------------------------------------------------------------
  // Deep-link consumer — `?receiveId=<uuid>` arriving from the
  // bank-transactions AssignmentDetailsDialog ("رفتن به تب مرتبط" opens this
  // tab in a NEW browser tab). We mount AssignmentDetailsDialog as a
  // read-only detail panel for the matching record. If the id can't be
  // resolved by the dialog's own fetch, the dialog itself shows the
  // built-in "رکورد ... یافت نشد" error.
  // -----------------------------------------------------------------------
  const [deepLinkReceiveId, setDeepLinkReceiveId] = useState<string | null>(null);
  useEffect(() => {
    const id = searchParams.get("receiveId");
    if (!id) return;
    setDeepLinkReceiveId(id);
    // Strip the param so refreshes / re-renders don't re-open the dialog
    // after the user closes it.
    const p = new URLSearchParams(searchParams);
    p.delete("receiveId");
    setSearchParams(p, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Clear all advanced filter keys but keep the status pill choice.
  const clearAdvFilters = useCallback(() => {
    const p = new URLSearchParams(searchParams);
    ["from", "to", "party", "min", "max", "banks"].forEach((k) => p.delete(k));
    setSearchParams(p, { replace: true });
  }, [searchParams, setSearchParams]);

  // Tiny helper: turn a Shamsi "YYYY/MM/DD" string into the exact
  // Gregorian timestamp string we want to pass into Postgres for a
  // half-open range filter. `endOfDay=true` returns 23:59 so the
  // upper bound is INCLUSIVE of the chosen day.
  const shamsiToGreg = useCallback(
    (s: string | null, endOfDay = false): string | null => {
      if (!s) return null;
      const m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
      if (!m) return null;
      const jd: JalaliDate = { year: +m[1], month: +m[2], day: +m[3] };
      return toGregorianForDb(jd, endOfDay ? "23:59" : "00:00");
    },
    [],
  );

  useEffect(() => {
    void supabase.from("finance_parties").select("id,first_name,last_name,company_name,ownership_type")
      .then(({ data }) => {
        const m: Record<string, PartyRef> = {};
        ((data as PartyRef[]) || []).forEach((p) => (m[p.id] = p));
        setParties(m);
      });
    void supabase.from("finance_banks").select("id,title,bank_name")
      .then(({ data }) => {
        const m: Record<string, BankRef> = {};
        ((data as BankRef[]) || []).forEach((b) => (m[b.id] = b));
        setBanks(m);
      });
  }, []);

  // Re-run the list query whenever EITHER the status pill OR the
  // advanced filters change. We depend on `searchParams.toString()`
  // (a primitive) rather than the object itself so React's identity
  // comparison works correctly.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [searchParams.toString()]);

  async function load() {
    setLoading(true);
    let q = supabase
      .from("finance_receive_identifications")
      .select("*")
      .eq("is_deleted", false)
      .order("created_at", { ascending: false })
      .limit(500);

    // --- Status pill ---------------------------------------------
    if (filter === "pending_approval") {
      // Legacy imported rows may carry status="draft" — in this flow it
      // means "awaiting approval", so include both keys under the single
      // user-facing filter «در انتظار تایید».
      q = q.in("status", ["pending_approval", "draft"]);
    } else if (filter) {
      q = q.eq("status", filter);
    }

    // --- Advanced: transaction date range ------------------------
    // Server-side filter on the timestamptz column. We convert the
    // Shamsi pickers to "YYYY-MM-DD HH:MM" which Postgres parses
    // directly. The upper bound is sent as 23:59 so the chosen day
    // is INCLUSIVE — matching user expectation for date ranges.
    const fromTs = shamsiToGreg(advFilters.fromDate, false);
    const toTs = shamsiToGreg(advFilters.toDate, true);
    if (fromTs) q = q.gte("transaction_datetime", fromTs);
    if (toTs) q = q.lte("transaction_datetime", toTs);

    // --- Advanced: party (single, exact match) -------------------
    if (advFilters.partyId) q = q.eq("party_id", advFilters.partyId);

    // --- Advanced: amount range (numeric, both bounds inclusive) -
    if (advFilters.minAmount) {
      const n = Number(advFilters.minAmount);
      if (Number.isFinite(n)) q = q.gte("amount", n);
    }
    if (advFilters.maxAmount) {
      const n = Number(advFilters.maxAmount);
      if (Number.isFinite(n)) q = q.lte("amount", n);
    }

    // --- Advanced: bank multi-select (.in) -----------------------
    if (advFilters.bankIds.length > 0) q = q.in("bank_id", advFilters.bankIds);

    const { data, error } = await q;
    if (error) toastFinanceError(toast, error);
    setItems((data as RI[]) || []);
    setLoading(false);
  }

  // Used by the empty-state branch to decide between "no records"
  // (DB really has nothing for this status) vs "filtered down to
  // nothing" (user has constraints active and should clear them).
  const activeAdvCount = countActiveFilters(advFilters);


  async function approveAndSync(ri: RI) {
    // Explicit confirmation per spec — this triggers Sepidar registration
    // through the existing approveReceiveIdentification helper which:
    //   1) flips status pending_approval/draft → approved
    //   2) creates/links finance_vouchers
    //   3) updates sepidar_sync_status to "synced" on success
    // Failure path stores sepidar_error_message which is displayed below.
    if (!confirm("این درخواست تایید و در سپیدار ثبت شود؟")) return;
    setBusyId(ri.id);
    try {
      const res = await approveReceiveIdentification(ri.id);
      if (res.ok) {
        toast.success("تایید و در سپیدار ثبت شد");
        // Trusted-beneficiary learning feedback: only shown when the
        // (matchtype, matchcontent) → finance_party_id mapping was actually
        // upserted into bankpartyaccountinfos so future deposits can be
        // auto-identified by "شناسایی واریزها".
        if (res.trusted_saved) toast.success("این ذینفع برای دفعات بعد ذخیره شد");
      } else toastFinanceError(toast, res.error || new Error("خطا در ثبت سپیدار"));
      void load();
    } catch (e: unknown) {
      toastFinanceError(toast, e);
    } finally {
      setBusyId(null);
    }
  }

  async function cancel(ri: RI) {
    if (!confirm("لغو این درخواست؟")) return;
    setBusyId(ri.id);
    try {
      await cancelReceiveIdentification(ri.id);
      toast.success("لغو شد");
      void load();
    } catch (e: unknown) {
      toastFinanceError(toast, e);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-bold">شناسایی دریافت‌ها</h2>
        <Button onClick={() => setOpenNew(true)}>
          <Plus className="w-4 h-4 ml-1" /> شناسایی جدید
        </Button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.key || "all"}
            onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
              filter === f.key
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-card hover:bg-muted/50"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Advanced server-side filters (date/party/amount/banks).
          State lives in the URL so refresh + pagination preserve it. */}
      <ReceiveIdFilters
        value={advFilters}
        onApply={applyAdvFilters}
        onClear={clearAdvFilters}
      />

      {loading ? (
        <p className="text-sm text-muted-foreground">در حال بارگذاری…</p>
      ) : items.length === 0 ? (
        // Distinguish "DB is empty for this status" from "the user's
        // filters narrowed the result to zero". The second case
        // surfaces a Clear shortcut so the user isn't stuck.
        <div className="text-center py-10 space-y-2">
          <p className="text-muted-foreground">
            {activeAdvCount > 0
              ? "هیچ رکوردی با فیلترهای فعلی پیدا نشد"
              : "درخواستی یافت نشد"}
          </p>
          {activeAdvCount > 0 && (
            <Button size="sm" variant="outline" onClick={clearAdvFilters}>
              حذف فیلترها
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((r) => {
            const party = r.party_id ? parties[r.party_id] : null;
            const bank = r.bank_id ? banks[r.bank_id] : null;
            // Treat draft as pending_approval for action eligibility — the
            // imported data uses both keys interchangeably.
            const isPending = r.status === "pending_approval" || r.status === "draft";
            // The Sepidar registration button is hidden once the record is
            // already attached to a voucher OR already reported as synced.
            const alreadySynced = !!r.voucher_id;
            const canApprove = (isPending || r.status === "sync_failed") && !alreadySynced;
            const canReject = isPending || r.status === "sync_failed";
            const canCancel = isPending;
            return (
              <div key={r.id} className="rounded-xl border bg-card p-3 space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="font-bold text-sm">{r.title || "شناسایی دریافت"}</div>
                  <ReceiveIdStatusBadge status={r.status} />
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs text-muted-foreground">
                  <div>
                    <div className="text-[10px]">ذینفع</div>
                    <div className="text-foreground">{party ? partyName(party) : "—"}</div>
                  </div>
                  <div>
                    <div className="text-[10px]">بانک</div>
                    <div className="text-foreground">{bank?.title || bank?.bank_name || "—"}</div>
                  </div>
                  <div>
                    <div className="text-[10px]">مبلغ</div>
                    <MoneyCell value={r.amount} positive />
                  </div>
                  <div>
                    <div className="text-[10px]">تاریخ تراکنش</div>
                    <JalaliDateCell value={r.transaction_datetime} withTime />
                  </div>
                </div>
                {r.description && <p className="text-xs text-muted-foreground">{r.description}</p>}
                {r.status === "sync_failed" && r.sepidar_error_message && (
                  <div className="text-xs bg-red-50 text-red-800 border border-red-200 rounded-md p-2">
                    خطای سپیدار: {r.sepidar_error_message}
                  </div>
                )}
                {r.status === "rejected" && r.rejection_reason && (
                  <div className="text-xs bg-amber-50 text-amber-800 border border-amber-200 rounded-md p-2">
                    دلیل رد: {r.rejection_reason}
                  </div>
                )}
                <div className="flex flex-wrap gap-1.5">
                  {canApprove && (
                    <Button size="sm" onClick={() => approveAndSync(r)} disabled={busyId === r.id}>
                      <Send className="w-3.5 h-3.5 ml-1" />
                      {r.status === "sync_failed" ? "تلاش مجدد ثبت سپیدار" : "تایید و ثبت در سپیدار"}
                    </Button>
                  )}
                  {canReject && (
                    <Button size="sm" variant="outline" onClick={() => setOpenReject(r)}>
                      <XCircle className="w-3.5 h-3.5 ml-1" /> رد درخواست
                    </Button>
                  )}
                  {canCancel && (
                    <Button size="sm" variant="ghost" onClick={() => cancel(r)} disabled={busyId === r.id}>
                      لغو
                    </Button>
                  )}
                  {alreadySynced && (
                    <span className="inline-flex items-center gap-1 text-emerald-700 text-[11px] font-bold">
                      <CheckCircle2 className="w-3.5 h-3.5" /> ثبت‌شده در سپیدار
                      {r.voucher_id && <span className="font-mono opacity-70">• {r.voucher_id.slice(0, 8)}…</span>}
                    </span>
                  )}
                  {/* Phase 4: rollback button — visible only for admin/super_admin
                      and only for rows already attached to a Sepidar voucher.
                      The orchestrator handles SP-first ordering + audit. */}
                  {alreadySynced && r.status !== "cancelled" && r.status !== "rolled_back" && (
                    <RollbackButton
                      entityType="receive_identification"
                      entityId={r.id}
                      metadata={{
                        operationLabel: "شناسایی دریافت",
                        amount: r.amount,
                        partyLabel: r.party_id && parties[r.party_id] ? partyName(parties[r.party_id]) : null,
                        bankLabel: r.bank_id && banks[r.bank_id]
                          ? (banks[r.bank_id].title || banks[r.bank_id].bank_name)
                          : null,
                        sepidarVoucherId: r.voucher_id,
                      }}
                      onSuccess={() => void load()}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {openNew && <NewReceiveIdDialog onClose={() => setOpenNew(false)} onDone={() => { setOpenNew(false); void load(); }} />}
      {openReject && (
        <RejectDialog
          ri={openReject}
          onClose={() => setOpenReject(null)}
          onDone={() => { setOpenReject(null); void load(); }}
        />
      )}
    </div>
  );
}

function NewReceiveIdDialog({ onClose, onDone, presetTxId }: { onClose: () => void; onDone: () => void; presetTxId?: string }) {
  interface SelectedTx {
    id: string; bank_id: string | null; deposit_amount: number | null;
    withdraw_amount: number | null; transaction_datetime: string | null;
  }
  const [txId, setTxId] = useState<string | null>(presetTxId || null);
  const [tx, setTx] = useState<SelectedTx | null>(null);
  const [partyId, setPartyId] = useState<string | null>(null);
  const [title, setTitle] = useState("شناسایی دریافت");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (presetTxId) {
      void supabase.from("finance_bank_transactions")
        .select("id,bank_id,deposit_amount,withdraw_amount,transaction_datetime")
        .eq("id", presetTxId).maybeSingle()
        .then(({ data }) => setTx((data as SelectedTx) || null));
    }
  }, [presetTxId]);

  const amount = tx?.deposit_amount || 0;

  async function submit() {
    if (saving) return;
    if (!tx || !txId) return toast.error("رسید را انتخاب کنید");
    if (!tx.bank_id) return toast.error("بانک رسید نامعتبر است");
    if (!partyId) return toast.error("ذینفع را انتخاب کنید");
    if (!amount || amount <= 0) return toast.error("مبلغ واریز معتبر نیست");
    setSaving(true);
    try {
      await createReceiveIdentification({
        bank_transaction_id: txId,
        bank_id: tx.bank_id,
        party_id: partyId,
        amount,
        transaction_datetime: tx.transaction_datetime,
        title,
        description,
      });
      toast.success("درخواست در انتظار تایید مدیر ثبت شد");
      onDone();
    } catch (e: unknown) {
      toastFinanceError(toast, e);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-card rounded-t-2xl sm:rounded-2xl border shadow-lg w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b flex items-center justify-between">
          <h3 className="font-bold">شناسایی دریافت جدید</h3>
          <Button size="sm" variant="ghost" onClick={onClose}><X className="w-4 h-4" /></Button>
        </div>
        <div className="p-4 space-y-3">
          {!presetTxId && (
            <div className="space-y-1.5">
              <Label className="text-xs">رسید (واریز تخصیص نشده)</Label>
              <TransactionSelector
                value={txId}
                onChange={(id, t) => { setTxId(id); setTx((t as SelectedTx) || null); }}
                filter={{ transaction_type: "deposit", assignment_status: "unassigned" }}
                placeholder="انتخاب واریز"
              />
            </div>
          )}
          {tx && (
            <div className="text-xs bg-muted/40 rounded-md p-2 space-y-1">
              <div>مبلغ واریز: <MoneyCell value={amount} positive /></div>
              <div>تاریخ: <JalaliDateCell value={tx.transaction_datetime} withTime /></div>
            </div>
          )}
          <div className="space-y-1.5">
            <Label className="text-xs">ذینفع</Label>
            <PartySelector value={partyId} onChange={setPartyId} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">عنوان</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">توضیحات</Label>
            <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
        </div>
        <div className="p-4 border-t flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>انصراف</Button>
          <Button onClick={submit} disabled={saving || !txId || !partyId}>ارسال برای تایید</Button>
        </div>
      </div>
    </div>
  );
}

function RejectDialog({ ri, onClose, onDone }: { ri: RI; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  async function submit() {
    if (saving) return;
    if (!reason.trim()) return toast.error("دلیل رد را بنویسید");
    setSaving(true);
    try {
      await rejectReceiveIdentification(ri.id, reason.trim());
      toast.success("درخواست رد شد");
      onDone();
    } catch (e: unknown) {
      toastFinanceError(toast, e);
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-card rounded-t-2xl sm:rounded-2xl border shadow-lg w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b flex items-center justify-between">
          <h3 className="font-bold">رد درخواست شناسایی</h3>
          <Button size="sm" variant="ghost" onClick={onClose}><X className="w-4 h-4" /></Button>
        </div>
        <div className="p-4 space-y-2">
          <Label className="text-xs">دلیل رد *</Label>
          <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <div className="p-4 border-t flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>انصراف</Button>
          <Button onClick={submit} disabled={saving}>ثبت رد</Button>
        </div>
      </div>
    </div>
  );
}

// Exported helper so other tabs (BankTransactionsTab) can launch the create dialog
export { NewReceiveIdDialog };
