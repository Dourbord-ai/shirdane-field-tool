import { useEffect, useMemo, useState } from "react";
import { toastFinanceError } from "@/lib/financeErrors";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MoneyCell, JalaliDateCell, FinanceStatusBadge } from "@/components/finance/atoms";
import { BankSelector } from "@/components/finance/selectors";
import { parseMoney, recalculateBankUnassignedBalances } from "@/lib/finance";
// Manual auto-processing orchestrator. Decoupled from the Excel upload flow:
// upload only inserts rows; this helper is invoked by the toolbar button
// "تشخیص و ثبت اتوماتیک تراکنش‌های تخصیص‌نشده" and walks every still-unassigned
// transaction through the 3 deterministic classifier paths (bank fee /
// inter-bank transfer / known-beneficiary deposit).
import { autoProcessUnassigned, emptyProgress, type AutoProcessProgress } from "@/lib/autoProcessUnassigned";
// Dedicated "شناسایی کارمزد" pipeline — withdraws under FEE_THRESHOLD_IRR
// get a payment-request + auto-approval + Sepidar voucher in one click.
import { processBankFees, emptyFeesProgress, type BankFeesProgress } from "@/lib/processBankFees";
// "شناسایی واریزها" — n8n-AI-assisted deposit identification orchestrator.
// Reuses the canonical manual receive-identification + approval helpers; it
// only adds the n8n webhook trigger and the ai_verify_status state machine.
import {
  processDepositAI,
  emptyDepositAIProgress,
  type DepositAIProgress,
} from "@/lib/processDepositAI";
// Auto-identify summary type is still consumed by the import-dialog UI for
// historical compatibility (it now renders null after the upload-flow split).
import { type AutoIdentifySummary } from "@/lib/autoIdentify";
import { legacyBankLabel } from "@/lib/legacyBanks";
import { NewReceiveIdDialog } from "@/components/finance/tabs/ReceiveIdentificationTab";
import { Plus, Upload, Download, X, Trash2, FileText, AlertTriangle, ArrowDownToLine, ArrowUpFromLine, ArrowLeftRight, Link2 } from "lucide-react";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
// Bulk "Attach to Payment Request" — pure frontend orchestrator. See the
// dialog file's header doc for why concurrency is serialized and why we
// never split a transaction across items. The backend stays unchanged: we
// reuse `createPaymentAllocation` per row.
import BulkAttachPaymentRequestDialog, {
  type BulkAttachTx,
} from "@/components/finance/BulkAttachPaymentRequestDialog";
// Unified Jalali UI / Gregorian-ISO value date picker — see src/components/DatePicker.tsx
import DatePicker from "@/components/DatePicker";

interface Tx {
  id: string;
  bank_id: string | null;
  transaction_datetime: string | null;
  transaction_type: string | null;
  deposit_amount: number | null;
  withdraw_amount: number | null;
  amount: number | null;
  balance_after: number | null;
  description: string | null;
  document_number: string | null;
  reference_number: string | null;
  tracking_number: string | null;
  card_number: string | null;
  source_type: string | null;
  assignment_status: string | null;
  assigned_operation_type: string | null;
  assigned_operation_id: string | null;
  raw_data: unknown;
  // Path inside the `finance-imports` Storage bucket where the original
  // Excel/CSV file was archived at import-time. Null for manual rows or
  // legacy rows imported before archival was wired up.
  imported_file_path: string | null;
  original_file_name: string | null;
  imported_file_name: string | null;
}

interface BankRef { id: string; title: string | null; bank_name: string | null }

// Per-transaction identifier extracted from the description during import.
// Used to render the "card / IBAN / account" + verified-owner chips on each row.
interface IdentRow {
  match_type: number;            // 1=account, 2=card, 3=IBAN (per bankpartyaccountinfos convention)
  raw_value: string | null;
  normalized_value: string | null;
  verified_owner_name: string | null;
  verified_bank_name: string | null;
}

// Light-weight projection of the receive identification linked to a tx —
// only the fields we need to drive badges & the auto-state filter.
interface ReceiveMeta {
  id: string;
  party_id: string | null;
  status: string | null;
  auto_identified: boolean | null;
  identification_source: string | null;
  sepidar_sync_status: string | null;
  voucher_id: string | null;
}

// Auto-identification state derived for filter chips & badge rendering.
type AutoState = "auto_identified" | "manual" | "needs_review" | "no_identifier" | "sepidar_failed";

// Pure helper so the table row, the mobile card, and the chip filter all
// agree on the per-transaction state.
function deriveAutoState(t: Tx, idents: IdentRow[] | undefined, ri: ReceiveMeta | undefined): AutoState {
  // Sepidar failure trumps everything else — operator needs to see it first.
  if (ri?.sepidar_sync_status === "failed") return "sepidar_failed";
  if (ri) return ri.auto_identified ? "auto_identified" : "manual";
  if (idents && idents.length > 0) return "needs_review";
  return "no_identifier";
}

const MATCH_TYPE_LABEL: Record<number, string> = { 1: "حساب", 2: "کارت", 3: "شبا" };

export default function BankTransactionsTab({ initialBankId }: { initialBankId?: string }) {
  const [txs, setTxs] = useState<Tx[]>([]);
  const [banks, setBanks] = useState<Record<string, BankRef>>({});
  const [filterBank, setFilterBank] = useState<string | null>(initialBankId || null);
  const [filterType, setFilterType] = useState<string>("");
  const [filterAssign, setFilterAssign] = useState<string>("");
  const [filterDescr, setFilterDescr] = useState("");
  // Transaction-date range (Gregorian ISO from the Jalali DatePicker).
  // These filter on `transaction_datetime` (the real banking date),
  // NOT on `created_at` (when the row was inserted into our DB).
  const [filterFromDate, setFilterFromDate] = useState<string | null>(null);
  const [filterToDate, setFilterToDate] = useState<string | null>(null);
  // Amount range filters — server-side via PostgREST `.or()` so a single
  // range covers whichever direction (deposit OR withdraw) is populated.
  const [filterMinAmount, setFilterMinAmount] = useState("");
  const [filterMaxAmount, setFilterMaxAmount] = useState("");
  // ---- Debounced mirrors of the text/amount inputs ---------------------
  // Typing should NOT fire a Supabase round-trip per keystroke. 300ms is a
  // common UX sweet-spot — fast enough to feel live, slow enough to coalesce
  // a typed word/number into a single query.
  const [debouncedDescr, setDebouncedDescr] = useState("");
  const [debouncedMin, setDebouncedMin] = useState("");
  const [debouncedMax, setDebouncedMax] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedDescr(filterDescr.trim()), 300);
    return () => clearTimeout(t);
  }, [filterDescr]);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedMin(filterMinAmount.trim()), 300);
    return () => clearTimeout(t);
  }, [filterMinAmount]);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedMax(filterMaxAmount.trim()), 300);
    return () => clearTimeout(t);
  }, [filterMaxAmount]);

  const [openManual, setOpenManual] = useState(false);
  const [openExcel, setOpenExcel] = useState(false);
  const [openRaw, setOpenRaw] = useState<Tx | null>(null);
  const [openReceiveId, setOpenReceiveId] = useState<Tx | null>(null);
  // ---- Bulk-attach selection state ---------------------------------------
  // Only rows that pass `isBulkAttachEligible` (withdraw + unassigned) can be
  // added; the table guards each addition so ineligible rows never end up in
  // the set even if data shifts between renders.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [openBulkAttach, setOpenBulkAttach] = useState(false);
  const [loading, setLoading] = useState(true);

  // ---- Server-side pagination + counts -----------------------------------
  // page is 1-indexed for UX; converted to a 0-indexed `.range()` below.
  // `totalCount`    = grand total in finance_bank_transactions (no filters)
  // `filteredCount` = total matching the currently applied server filters,
  //                   used both for the "نتیجه فیلتر فعلی" label AND for
  //                   computing the last page number.
  const PAGE_SIZE = 50;
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [filteredCount, setFilteredCount] = useState<number | null>(null);

  // Manual auto-processing state. `running` drives the dialog visibility and
  // disables the trigger button so a second click can't double-fire the
  // orchestrator while one is already in-flight.
  const [autoRunning, setAutoRunning] = useState(false);
  const [autoProgress, setAutoProgress] = useState<AutoProcessProgress>(emptyProgress());

  // Separate state for the "شناسایی کارمزد" sweep so its progress panel
  // and counters don't collide with the generic auto-process run above.
  const [feesRunning, setFeesRunning] = useState(false);
  const [feesProgress, setFeesProgress] = useState<BankFeesProgress>(emptyFeesProgress());

  // "شناسایی واریزها" state — independent of the two sweeps above so its
  // progress panel can render in parallel without overwriting their counters.
  const [depositAIRunning, setDepositAIRunning] = useState(false);
  const [depositAIProgress, setDepositAIProgress] = useState<DepositAIProgress>(
    emptyDepositAIProgress(),
  );

  async function runAutoProcess() {
    if (autoRunning) return;
    setAutoRunning(true);
    setAutoProgress(emptyProgress());
    try {
      // The orchestrator already swallows per-row crashes internally; this
      // top-level catch only handles unexpected transport failures.
      const final = await autoProcessUnassigned((p) => setAutoProgress(p));
      toast.success(
        `پردازش پایان یافت — بررسی‌شده: ${final.processed}/${final.total} · کاندید کارمزد: ${final.bank_fees_classified} · درخواست پرداخت ایجادشده: ${final.payment_requests_created} · ارسال به سپیدار: ${final.sepidar_posted} · ناموفق: ${final.failed}`,
      );
      void load();
    } catch (e) {
      toastFinanceError(toast, e);
    } finally {
      setAutoRunning(false);
    }
  }

  // Bank-fee-only sweep — dedicated button. Uses the standalone
  // processBankFees() orchestrator which classifies, creates PRs,
  // auto-approves, and posts to Sepidar in one pass.
  async function runFeeIdentification() {
    if (feesRunning) return;
    setFeesRunning(true);
    setFeesProgress(emptyFeesProgress());
    try {
      const final = await processBankFees((p) => setFeesProgress(p));
      toast.success(
        `شناسایی کارمزد — کل بررسی‌شده: ${final.checked}/${final.total} · کاندید کارمزد: ${final.fee_candidates} · درخواست‌های پرداخت ایجادشده: ${final.payment_requests_created} · ارسال به سپیدار: ${final.sepidar_posted} · ناموفق: ${final.failed}`,
      );
      void load();
    } catch (e) {
      toastFinanceError(toast, e);
    } finally {
      setFeesRunning(false);
    }
  }

  // "شناسایی واریزها" — single-click orchestrator: fires the n8n webhook,
  // then processes whatever n8n parsed by reusing the canonical manual
  // receive-identification + approval helpers.
  async function runDepositAI() {
    if (depositAIRunning) return;
    setDepositAIRunning(true);
    setDepositAIProgress(emptyDepositAIProgress());
    const loadingToastId = toast.loading(
      "هوشیار در حال بررسی شرح واریزی‌ها\nلطفا کمی صبر کنید",
    );
    try {
      const final = await processDepositAI((p) => setDepositAIProgress(p));
      toast.dismiss(loadingToastId);
      toast.success(
        `شناسایی واریزها — تعداد بررسی‌شده: ${final.total} · شناسایی‌شده توسط هوشیار: ${final.identified_by_ai} · تایید حساب موفق: ${final.verify_success} · طرف حساب پیدا نشد: ${final.party_not_found} · ثبت موفق: ${final.posted} · خطادار: ${final.failed}`,
      );
      void load();
    } catch (e) {
      toast.dismiss(loadingToastId);
      toastFinanceError(toast, e);
    } finally {
      setDepositAIRunning(false);
    }
  }

  useEffect(() => {
    // Bank lookup map for row labels.
    supabase.from("finance_banks").select("id,title,bank_name").then(({ data }) => {
      const m: Record<string, BankRef> = {};
      (data as BankRef[] || []).forEach((b) => (m[b.id] = b));
      setBanks(m);
    });
    // Grand total — independent of any filter — fetched once for the
    // "کل تراکنش‌ها" label. Cheap HEAD count query, no rows returned.
    void (async () => {
      const { count } = await supabase
        .from("finance_bank_transactions")
        .select("id", { count: "exact", head: true })
        .eq("is_deleted", false);
      setTotalCount(count ?? 0);
    })();
  }, []);

  // Per-row enrichment maps populated alongside `txs` so badges & chip
  // filters can render without N+1 queries inside the render loop.
  const [identByTx, setIdentByTx] = useState<Record<string, IdentRow[]>>({});
  const [receiveByTx, setReceiveByTx] = useState<Record<string, ReceiveMeta>>({});
  const [partyNames, setPartyNames] = useState<Record<string, string>>({});
  // Chip filter — empty string = "show all"; otherwise narrows to a single
  // auto-identification state. Applied CLIENT-side over the current page
  // only because the state is derived from a join across three tables; the
  // chip counts therefore reflect the current page, not the whole DB.
  const [filterAutoState, setFilterAutoState] = useState<"" | AutoState>("");

  // Whenever a server-side filter changes, snap back to page 1 so the user
  // doesn't end up on a now-out-of-range page (e.g. page 7 of a 3-page set).
  useEffect(() => {
    setPage(1);
  }, [filterBank, filterType, filterAssign, filterFromDate, filterToDate, debouncedDescr, debouncedMin, debouncedMax]);

  // Re-fetch on any server filter OR page change.
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [filterBank, filterType, filterAssign, filterFromDate, filterToDate, debouncedDescr, debouncedMin, debouncedMax, page]);

  // Clear bulk-attach selection on filter/page change so we never carry over
  // selections that the user can no longer see in the table.
  useEffect(() => {
    setSelectedIds(new Set());
  }, [filterBank, filterType, filterAssign, filterFromDate, filterToDate, debouncedDescr, debouncedMin, debouncedMax, page]);


  async function load() {
    setLoading(true);
    // -----------------------------------------------------------------------
    // SERVER-SIDE FILTERING + PAGINATION.
    //
    // Every filter the user can express in the toolbar is translated into a
    // Supabase query parameter so Postgres does the work — we never pull a
    // huge result set into the browser only to trim it.
    //
    // Flow (per spec):
    //   1. Build base query (`is_deleted = false`).
    //   2. Apply every filter.
    //   3. Apply sort.
    //   4. Get total filtered count (via `count: 'exact'` on the same query).
    //   5. Apply `.range(from, to)` for the visible page only.
    // -----------------------------------------------------------------------
    let q = supabase
      .from("finance_bank_transactions")
      .select("*", { count: "exact" })
      .eq("is_deleted", false);

    if (filterBank) q = q.eq("bank_id", filterBank);
    if (filterType) q = q.eq("transaction_type", filterType);
    if (filterAssign) q = q.eq("assignment_status", filterAssign);
    if (filterFromDate) q = q.gte("transaction_datetime", filterFromDate);
    if (filterToDate) q = q.lte("transaction_datetime", filterToDate);

    // Description search — PostgREST ILIKE is case-insensitive substring.
    if (debouncedDescr) {
      // Escape `%` and `,` characters so they're treated as literals; they
      // would otherwise be interpreted as PostgREST wildcards/delimiters.
      const safe = debouncedDescr.replace(/[%,]/g, " ");
      q = q.ilike("description", `%${safe}%`);
    }

    // Amount range — server-side via `.or()`. A row matches if either
    // deposit_amount OR withdraw_amount falls inside the [min, max] range.
    // This mirrors the previous client-side `Math.abs(deposit||withdraw)`
    // semantics without pulling rows for filtering.
    const min = debouncedMin ? parseMoney(debouncedMin) : null;
    const max = debouncedMax ? parseMoney(debouncedMax) : null;
    if (min !== null && max !== null) {
      q = q.or(
        `and(deposit_amount.gte.${min},deposit_amount.lte.${max}),and(withdraw_amount.gte.${min},withdraw_amount.lte.${max})`,
      );
    } else if (min !== null) {
      q = q.or(`deposit_amount.gte.${min},withdraw_amount.gte.${min}`);
    } else if (max !== null) {
      q = q.or(`deposit_amount.lte.${max},withdraw_amount.lte.${max}`);
    }

    q = q.order("transaction_datetime", { ascending: false });

    // Pagination — .range() is INCLUSIVE on both ends.
    const from = (page - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    q = q.range(from, to);

    const { data, count } = await q;
    const rows = (data as Tx[]) || [];
    setTxs(rows);
    setFilteredCount(count ?? 0);

    // -----------------------------------------------------------------------
    // Side-load the per-tx enrichment used by badges & chip filters. Only
    // for the current page's rows — at PAGE_SIZE=50 the IN-list stays well
    // under PostgREST's URI limit, so a single round-trip per table is fine.
    // -----------------------------------------------------------------------
    const ids = rows.map((r) => r.id);
    if (ids.length === 0) {
      setIdentByTx({}); setReceiveByTx({}); setPartyNames({});
    } else {
      const [identsRes, receivesRes] = await Promise.all([
        supabase
          .from("finance_bank_tx_identifiers")
          .select("bank_transaction_id, match_type, raw_value, normalized_value, verified_owner_name, verified_bank_name")
          .in("bank_transaction_id", ids),
        supabase
          .from("finance_receive_identifications")
          .select("id, bank_transaction_id, party_id, status, auto_identified, identification_source, sepidar_sync_status, voucher_id")
          .in("bank_transaction_id", ids)
          .eq("is_deleted", false),
      ]);
      const identsData = identsRes.data || [];
      const receivesData = receivesRes.data || [];

      const im: Record<string, IdentRow[]> = {};
      for (const r of identsData as Array<IdentRow & { bank_transaction_id: string }>) {
        (im[r.bank_transaction_id] ||= []).push(r);
      }
      setIdentByTx(im);
      const rm: Record<string, ReceiveMeta> = {};
      const partyIds = new Set<string>();
      for (const r of receivesData as Array<ReceiveMeta & { bank_transaction_id: string }>) {
        if (!rm[r.bank_transaction_id]) rm[r.bank_transaction_id] = r;
        if (r.party_id) partyIds.add(r.party_id);
      }
      setReceiveByTx(rm);
      if (partyIds.size > 0) {
        const { data: pdata } = await supabase
          .from("finance_parties")
          .select("id, company_name, sepidar_full_name, first_name, last_name")
          .in("id", Array.from(partyIds));
        const pm: Record<string, string> = {};
        for (const p of (pdata || []) as Array<{ id: string; company_name: string | null; sepidar_full_name: string | null; first_name: string | null; last_name: string | null }>) {
          pm[p.id] =
            p.sepidar_full_name ||
            p.company_name ||
            [p.first_name, p.last_name].filter(Boolean).join(" ").trim() ||
            "—";
        }
        setPartyNames(pm);
      } else {
        setPartyNames({});
      }
    }
    setLoading(false);
  }

  // The auto-state chip filter still runs CLIENT-side because the derived
  // state requires joining 3 tables. It narrows the current page only —
  // chip counts therefore reflect the page, not the full DB. The base server
  // filters above already do the heavy lifting against the real dataset.
  const filtered = useMemo(() => {
    if (!filterAutoState) return txs;
    return txs.filter(
      (t) => deriveAutoState(t, identByTx[t.id], receiveByTx[t.id]) === filterAutoState,
    );
  }, [txs, filterAutoState, identByTx, receiveByTx]);

  // Live counts for the chip bar — driven by the current page (txs) so the
  // user can see how many rows on the visible page belong to each state.
  const autoCounts = useMemo(() => {
    const c: Record<AutoState, number> = {
      auto_identified: 0, manual: 0, needs_review: 0, no_identifier: 0, sepidar_failed: 0,
    };
    for (const t of txs) c[deriveAutoState(t, identByTx[t.id], receiveByTx[t.id])]++;
    return c;
  }, [txs, identByTx, receiveByTx]);

  // Pagination math — derived from server-provided `filteredCount`.
  const pageCount = Math.max(1, Math.ceil((filteredCount ?? 0) / PAGE_SIZE));
  const rangeFrom = filteredCount === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeTo = Math.min((filteredCount ?? 0), page * PAGE_SIZE);




  async function softDelete(t: Tx) {
    if (!confirm("حذف این تراکنش؟")) return;
    const { error } = await supabase
      .from("finance_bank_transactions")
      .update({ is_deleted: true, deleted_at: new Date().toISOString() })
      .eq("id", t.id);
    if (error) return toastFinanceError(toast, error);
    if (t.bank_id) await recalculateBankUnassignedBalances(t.bank_id);
    toast.success("حذف شد");
    void load();
  }

  // --------------------------------------------------------------------
  // Bulk-attach selection helpers.
  //
  // A tx is eligible for bulk-attach only when it's an UNASSIGNED WITHDRAW.
  // Deposits go through receive-identification, not payment-allocation, and
  // already-assigned rows would be rejected by the lib + DB guard anyway.
  // We mirror that filter here so the UI never lets the operator queue a
  // doomed call.
  // --------------------------------------------------------------------
  function isBulkAttachEligible(t: Tx): boolean {
    return t.transaction_type === "withdraw" && t.assignment_status === "unassigned";
  }
  function toggleSelect(id: string, eligible: boolean) {
    if (!eligible) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function clearSelection() {
    setSelectedIds(new Set());
  }
  // NOTE: the previous `useEffect([txs])` that pruned stale selections is no
  // longer needed — we already reset `selectedIds` on every filter/page
  // change above, which is the only way `txs` can change. Keeping that hook
  // would double-clear and fight with manual toggles.



  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-bold">تراکنش‌های بانکی</h2>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" onClick={() => setOpenExcel(true)}><Upload className="w-4 h-4 ml-1" /> آپلود اکسل</Button>
          <Button variant="outline" onClick={() => toast.info("دریافت از API هنوز پیاده‌سازی نشده — placeholder")}>
            <Download className="w-4 h-4 ml-1" /> دریافت از API
          </Button>
          {/* Manual trigger for the auto-processing pipeline. Disabled while a
              run is in-flight to prevent double execution. */}
          <Button variant="secondary" onClick={runAutoProcess} disabled={autoRunning}>
            <Link2 className="w-4 h-4 ml-1" />
            {autoRunning ? "در حال پردازش…" : "تشخیص و ثبت اتوماتیک تراکنش‌های تخصیص‌نشده"}
          </Button>
          {/* Dedicated "شناسایی کارمزد" trigger — coloured with the primary
              token so it stands out from the neutral toolbar buttons. */}
          <Button
            onClick={runFeeIdentification}
            disabled={feesRunning}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <ArrowUpFromLine className="w-4 h-4 ml-1" />
            {feesRunning ? "در حال شناسایی کارمزد…" : "شناسایی کارمزد"}
          </Button>
          {/* "شناسایی واریزها" — distinctive emerald tone so it visually
              separates from the primary "شناسایی کارمزد" button. Uses inline
              brand colours (bg-emerald-600) intentionally so this NEW action
              is immediately distinguishable in the toolbar; the rest of the
              design system remains untouched. */}
          <Button
            onClick={runDepositAI}
            disabled={depositAIRunning}
            className="bg-emerald-600 text-white hover:bg-emerald-700"
          >
            <ArrowDownToLine className="w-4 h-4 ml-1" />
            {depositAIRunning ? "هوشیار در حال بررسی…" : "شناسایی واریزها"}
          </Button>
          <Button onClick={() => setOpenManual(true)}><Plus className="w-4 h-4 ml-1" /> ثبت دستی</Button>
        </div>
      </div>

      {/* Live progress panel for the "شناسایی واریزها" sweep. Mirrors the
          structure of the bank-fee panel so operators get a consistent
          experience across automation buttons. */}
      {(depositAIRunning || depositAIProgress.total > 0 || depositAIProgress.failures.length > 0) && (
        <div className="rounded-lg border bg-card p-3 space-y-3 text-xs">
          <div className="flex items-center justify-between">
            <span className="font-bold">گزارش شناسایی واریزها (هوشیار)</span>
            <span className="text-muted-foreground">
              {depositAIProgress.processed} از {depositAIProgress.total}
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            <div className="rounded-md border border-border bg-background/60 p-2">
              <div className="text-[10px] text-muted-foreground">تعداد بررسی‌شده</div>
              <div className="text-base font-bold">{depositAIProgress.total}</div>
            </div>
            <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-2">
              <div className="text-[10px] text-emerald-700">شناسایی‌شده توسط هوشیار</div>
              <div className="text-base font-bold text-emerald-700">{depositAIProgress.identified_by_ai}</div>
            </div>
            <div className="rounded-md border border-blue-500/40 bg-blue-500/10 p-2">
              <div className="text-[10px] text-blue-700">تایید حساب موفق</div>
              <div className="text-base font-bold text-blue-700">{depositAIProgress.verify_success}</div>
            </div>
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2">
              <div className="text-[10px] text-amber-700">طرف حساب پیدا نشد</div>
              <div className="text-base font-bold text-amber-700">{depositAIProgress.party_not_found}</div>
            </div>
            <div className="rounded-md border border-primary/40 bg-primary/10 p-2">
              <div className="text-[10px] text-primary">ثبت موفق</div>
              <div className="text-base font-bold text-primary">{depositAIProgress.posted}</div>
            </div>
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2">
              <div className="text-[10px] text-destructive">خطادار</div>
              <div className="text-base font-bold text-destructive">{depositAIProgress.failed}</div>
            </div>
          </div>
          {depositAIProgress.lastMessage && (
            <div className="text-[11px] text-muted-foreground truncate">{depositAIProgress.lastMessage}</div>
          )}
          {depositAIProgress.failures.length > 0 && (
            <details className="rounded-md border border-destructive/30 bg-destructive/5 p-2">
              <summary className="cursor-pointer text-[11px] font-bold text-destructive">
                خطاها ({depositAIProgress.failures.length})
              </summary>
              <ul className="mt-2 max-h-40 overflow-auto space-y-1 text-[11px]">
                {depositAIProgress.failures.slice(-30).map((f, idx) => (
                  <li key={idx} className="truncate"><code>{f.txId.slice(0, 8)}</code> — {f.step}: {f.message}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {/* Dedicated summary panel for the bank-fee sweep — shows the five
          headline counters requested by the spec. */}
      {(feesRunning || feesProgress.total > 0 || feesProgress.failures.length > 0) && (
        <div className="rounded-lg border bg-card p-3 space-y-3 text-xs">
          <div className="flex items-center justify-between">
            <span className="font-bold">گزارش شناسایی کارمزد</span>
            <span className="text-muted-foreground">
              {feesProgress.checked} از {feesProgress.total} (باقیمانده: {feesProgress.remaining})
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
            <div className="rounded-md border border-border bg-background/60 p-2">
              <div className="text-[10px] text-muted-foreground">کل بررسی‌شده</div>
              <div className="text-base font-bold">{feesProgress.checked}<span className="text-muted-foreground text-xs"> / {feesProgress.total}</span></div>
            </div>
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2">
              <div className="text-[10px] text-amber-700">کاندیدهای کارمزد</div>
              <div className="text-base font-bold text-amber-700">{feesProgress.fee_candidates}</div>
            </div>
            <div className="rounded-md border border-blue-500/40 bg-blue-500/10 p-2">
              <div className="text-[10px] text-blue-700">درخواست‌های پرداخت ایجادشده</div>
              <div className="text-base font-bold text-blue-700">{feesProgress.payment_requests_created}</div>
            </div>
            <div className="rounded-md border border-primary/40 bg-primary/10 p-2">
              <div className="text-[10px] text-primary">ارسال به سپیدار</div>
              <div className="text-base font-bold text-primary">{feesProgress.sepidar_posted}</div>
            </div>
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2">
              <div className="text-[10px] text-destructive">ناموفق</div>
              <div className="text-base font-bold text-destructive">{feesProgress.failed}</div>
            </div>
          </div>
          {feesProgress.lastMessage && (
            <div className="text-[11px] text-muted-foreground truncate">{feesProgress.lastMessage}</div>
          )}
          {feesProgress.failures.length > 0 && (
            <details className="rounded-md border border-destructive/30 bg-destructive/5 p-2">
              <summary className="cursor-pointer text-[11px] font-bold text-destructive">
                خطاها ({feesProgress.failures.length})
              </summary>
              <ul className="mt-2 max-h-40 overflow-auto space-y-1 text-[11px]">
                {feesProgress.failures.slice(-30).map((f, idx) => (
                  <li key={idx} className="truncate"><code>{f.txId.slice(0, 8)}</code> — {f.step}: {f.message}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}


      {/* Live progress panel for the manual auto-processing run. Shown while
          a run is active AND for a moment after completion so the operator
          can read the final counts. Hidden when no run has been started. */}
      {(autoRunning || autoProgress.total > 0) && (
        <div className="rounded-lg border bg-card p-3 space-y-3 text-xs">
          <div className="flex items-center justify-between">
            <span className="font-bold">پیشرفت شناسایی خودکار</span>
            <span className="text-muted-foreground">
              {autoProgress.processed} از {autoProgress.total} (باقیمانده: {autoProgress.remaining})
            </span>
          </div>

          {/* Headline summary requested by the operator: the five numbers
              that matter most after a run completes. Rendered as bold
              KPI tiles so they're scannable at a glance. */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
            <div className="rounded-md border border-border bg-background/60 p-2">
              <div className="text-[10px] text-muted-foreground">کل بررسی‌شده</div>
              <div className="text-base font-bold">{autoProgress.processed}<span className="text-muted-foreground text-xs"> / {autoProgress.total}</span></div>
            </div>
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2">
              <div className="text-[10px] text-amber-700">کاندیدهای کارمزد</div>
              <div className="text-base font-bold text-amber-700">{autoProgress.bank_fees_classified}</div>
            </div>
            <div className="rounded-md border border-blue-500/40 bg-blue-500/10 p-2">
              <div className="text-[10px] text-blue-700">درخواست‌های پرداخت ایجادشده</div>
              <div className="text-base font-bold text-blue-700">{autoProgress.payment_requests_created}</div>
            </div>
            <div className="rounded-md border border-primary/40 bg-primary/10 p-2">
              <div className="text-[10px] text-primary">ارسال به سپیدار</div>
              <div className="text-base font-bold text-primary">{autoProgress.sepidar_posted}</div>
            </div>
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2">
              <div className="text-[10px] text-destructive">ناموفق</div>
              <div className="text-base font-bold text-destructive">{autoProgress.failed}</div>
            </div>
          </div>

          {/* Secondary breakdown — kept for context but visually de-emphasized. */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 text-emerald-700 px-2 py-0.5">
              واریز شناسایی‌شده: {autoProgress.beneficiary_identified}
            </span>
            <span className="rounded-full border border-blue-500/40 bg-blue-500/10 text-blue-700 px-2 py-0.5">
              انتقال بین‌بانکی: {autoProgress.bank_transfers_matched}
            </span>
            <span className="rounded-full border border-muted bg-muted/30 text-muted-foreground px-2 py-0.5">
              رد شده: {autoProgress.skipped}
            </span>
          </div>

          {autoProgress.lastMessage && (
            <div className="text-[11px] text-muted-foreground truncate">
              آخرین وضعیت: {autoProgress.lastMessage}
            </div>
          )}
          {/* --------------------------------------------------------------
              Collapsible diagnostic panel — surfaces the same data printed
              to the console by financeAutoProcessDebug.ts. Always rendered
              (debug flag only controls console verbosity); the panel just
              shows whatever the orchestrator reported in `autoProgress`.
              Use window.enableFinanceAutoProcessDebug() in DevTools for
              the full console trace.
          -------------------------------------------------------------- */}
          <details className="mt-2 rounded-md border border-border bg-background/50 p-2">
            <summary className="cursor-pointer text-[11px] font-bold text-muted-foreground">
              جزئیات تشخیصی (debug) — برای لاگ کامل کنسول:
              <code className="mx-1 rounded bg-muted px-1">window.enableFinanceAutoProcessDebug()</code>
            </summary>
            <div className="mt-2 space-y-1 text-[11px]">
              <div>آخرین تراکنش پردازش‌شده: <code>{autoProgress.lastTxId ?? "—"}</code></div>
              <div>آخرین خطا: <span className="text-destructive">{autoProgress.lastError ?? "—"}</span></div>
              <div>آخرین دلیل رد شدن: {autoProgress.lastSkipReason ?? "—"}</div>
              <div>ناموفق ({autoProgress.failedTransactions.length}):</div>
              {autoProgress.failedTransactions.length > 0 && (
                <ul className="max-h-32 overflow-auto rounded border border-destructive/30 bg-destructive/5 p-1">
                  {autoProgress.failedTransactions.slice(-20).map((f) => (
                    <li key={f.id} className="truncate">
                      <code>{f.id}</code> — {f.step}: {f.errorMessage ?? f.reason}
                    </li>
                  ))}
                </ul>
              )}
              <div>رد شده ({autoProgress.skippedTransactions.length}):</div>
              {autoProgress.skippedTransactions.length > 0 && (
                <ul className="max-h-32 overflow-auto rounded border border-amber-500/30 bg-amber-500/5 p-1">
                  {autoProgress.skippedTransactions.slice(-20).map((s) => (
                    <li key={s.id} className="truncate">
                      <code>{s.id}</code> — {s.reason}
                    </li>
                  ))}
                </ul>
              )}
              <div>تطبیق داده‌شده ({autoProgress.matchedTransactions.length}):</div>
              {autoProgress.matchedTransactions.length > 0 && (
                <ul className="max-h-32 overflow-auto rounded border border-emerald-500/30 bg-emerald-500/5 p-1">
                  {autoProgress.matchedTransactions.slice(-20).map((m) => (
                    <li key={m.id} className="truncate">
                      <code>{m.id}</code> — {m.path}
                      {m.party_id ? ` · party=${m.party_id.slice(0, 8)}…` : ""}
                      {m.paired_tx_id ? ` · paired=${m.paired_tx_id.slice(0, 8)}…` : ""}
                      {m.voucher_id ? ` · voucher=${m.voucher_id.slice(0, 8)}…` : ""}
                    </li>
                  ))}
                </ul>
              )}
              {autoProgress.durationMs != null && (
                <div className="pt-1 text-muted-foreground">
                  مدت اجرا: {autoProgress.durationMs} ms
                </div>
              )}
            </div>
          </details>
        </div>
      )}


      {/* Filters — first row: bank / type / assignment / description search */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <BankSelector value={filterBank} onChange={setFilterBank} placeholder="همه بانک‌ها" />
        <select value={filterType} onChange={(e) => setFilterType(e.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
          <option value="">نوع تراکنش</option>
          <option value="deposit">واریز</option>
          <option value="withdraw">برداشت</option>
        </select>
        <select value={filterAssign} onChange={(e) => setFilterAssign(e.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
          <option value="">وضعیت تخصیص</option>
          <option value="unassigned">تخصیص نشده</option>
          <option value="assigning">در حال تخصیص</option>
          {/* New status surfaced by the auto-processing pipeline. Bank-fee
              candidates land here so the operator can filter them quickly
              and complete the manual approve→post flow. */}
          <option value="needs_review">نیازمند بازبینی (کارمزد و سایر)</option>
          <option value="assigned">تخصیص شده</option>
          <option value="rejected">رد شده</option>
          <option value="cancelled">لغو شده</option>
        </select>
        <Input placeholder="شرح..." value={filterDescr} onChange={(e) => setFilterDescr(e.target.value)} />
      </div>

      {/* Filters — second row: real transaction date range + amount range.
          Date filters hit `transaction_datetime` (not `created_at`).
          Amount range matches abs(deposit OR withdraw) so a single range
          covers both directions. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div>
          <Label className="text-xs text-muted-foreground mb-1 block">از تاریخ تراکنش</Label>
          <DatePicker value={filterFromDate} onChange={setFilterFromDate} />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground mb-1 block">تا تاریخ تراکنش</Label>
          <DatePicker value={filterToDate} onChange={setFilterToDate} />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground mb-1 block">حداقل مبلغ</Label>
          <Input inputMode="numeric" placeholder="0" value={filterMinAmount} onChange={(e) => setFilterMinAmount(e.target.value)} />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground mb-1 block">حداکثر مبلغ</Label>
          <Input inputMode="numeric" placeholder="—" value={filterMaxAmount} onChange={(e) => setFilterMaxAmount(e.target.value)} />
        </div>
      </div>

      {(filterFromDate || filterToDate || filterMinAmount || filterMaxAmount) && (
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => { setFilterFromDate(null); setFilterToDate(null); setFilterMinAmount(""); setFilterMaxAmount(""); }}
          >
            پاک کردن فیلترهای تاریخ و مبلغ
          </Button>
        </div>
      )}

      {/* ---- Count summary ---------------------------------------------
          Three numbers, exactly as required by the spec:
            • کل تراکنش‌ها     = grand total in the DB (no filters)
            • نتیجه فیلتر فعلی  = total matching current server filters
            • نمایش             = visible row range on this page
          Numbers come straight from the server-side count queries, so they
          stay correct regardless of how many pages of data exist. ----- */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>کل تراکنش‌ها: <span className="font-bold text-foreground tabular-nums">{(totalCount ?? 0).toLocaleString("fa-IR")}</span></span>
        <span>نتیجه فیلتر فعلی: <span className="font-bold text-foreground tabular-nums">{(filteredCount ?? 0).toLocaleString("fa-IR")}</span></span>
        <span>نمایش: <span className="font-bold text-foreground tabular-nums">{rangeFrom.toLocaleString("fa-IR")} تا {rangeTo.toLocaleString("fa-IR")}</span></span>
      </div>

      {/* Auto-identification chip filters — applied client-side over the
          current page only. The "همه" count shows the filtered server total
          so it always matches the count summary above. */}
      <div className="flex flex-wrap gap-1.5">
        {(
          [
            ["", "همه", filteredCount ?? 0],
            ["auto_identified", "شناسایی خودکار", autoCounts.auto_identified],
            ["manual", "شناسایی دستی", autoCounts.manual],
            ["needs_review", "نیازمند بازبینی", autoCounts.needs_review],
            ["no_identifier", "بدون شناسه", autoCounts.no_identifier],
            ["sepidar_failed", "خطای سپیدار", autoCounts.sepidar_failed],
          ] as Array<[string, string, number]>
        ).map(([key, label, count]) => (
          <button
            key={key || "all"}
            onClick={() => setFilterAutoState(key as "" | AutoState)}

            className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
              filterAutoState === key
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-card hover:bg-muted/50"
            }`}
          >
            {label} <span className="opacity-70">({count})</span>
          </button>
        ))}
      </div>


      {/* ---- Bulk-attach action bar ------------------------------------
          Appears only when at least one row is selected. Mirrors common
          spreadsheet/email UX: shows the selection count, total amount,
          a primary "اتصال به درخواست پرداخت" CTA, and a clear-selection
          escape hatch. Sticky-positioned on mobile so it stays in reach
          even after the operator scrolls the long tx list. --------- */}
      {selectedIds.size > 0 && (
        <div className="sticky top-2 z-30 rounded-xl border bg-primary/10 backdrop-blur p-3 flex flex-wrap items-center gap-2 justify-between">
          <div className="text-sm font-bold">
            {selectedIds.size} تراکنش انتخاب شده
            <span className="mr-2 text-xs text-muted-foreground font-normal">
              (جمع: {(() => {
                // Sum the selected txs' withdraw amounts. Done inline rather
                // than memoised because selectedIds.size is small (UI only).
                const sum = txs
                  .filter((t) => selectedIds.has(t.id))
                  .reduce((s, t) => s + Number(t.withdraw_amount || 0), 0);
                return sum.toLocaleString("fa-IR");
              })()} ریال)
            </span>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => setOpenBulkAttach(true)}>
              <Link2 className="w-4 h-4 ml-1" />
              اتصال به درخواست پرداخت
            </Button>
            <Button size="sm" variant="ghost" onClick={clearSelection}>
              <X className="w-4 h-4 ml-1" /> پاک کردن انتخاب
            </Button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">در حال بارگذاری…</p>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto rounded-xl border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr className="text-right">
                  {/* Header checkbox — "select all eligible visible rows".
                      Indeterminate visual is skipped (shadcn Checkbox doesn't
                      expose it cleanly); a simple checked/unchecked toggle
                      matches the rest of the toolbar. */}
                  <th className="p-2 w-8">
                    {(() => {
                      const eligible = filtered.filter(isBulkAttachEligible);
                      const allSelected =
                        eligible.length > 0 && eligible.every((t) => selectedIds.has(t.id));
                      return (
                        <Checkbox
                          checked={allSelected}
                          disabled={eligible.length === 0}
                          onCheckedChange={(v) => {
                            // When toggled ON: union currently-eligible
                            // visible rows into the selection set. When OFF:
                            // remove only those visible rows (keep
                            // selections from other filter views intact).
                            setSelectedIds((prev) => {
                              const next = new Set(prev);
                              if (v) eligible.forEach((t) => next.add(t.id));
                              else eligible.forEach((t) => next.delete(t.id));
                              return next;
                            });
                          }}
                          aria-label="انتخاب همه"
                        />
                      );
                    })()}
                  </th>
                  <th className="p-2 font-bold">بانک</th>
                  <th className="p-2 font-bold">تاریخ</th>
                  <th className="p-2 font-bold">نوع</th>
                  <th className="p-2 font-bold">واریز</th>
                  <th className="p-2 font-bold">برداشت</th>
                  <th className="p-2 font-bold">مانده</th>
                  <th className="p-2 font-bold">شرح</th>
                  <th className="p-2 font-bold">مرجع</th>
                  <th className="p-2 font-bold">منبع</th>
                  <th className="p-2 font-bold">وضعیت</th>
                  <th className="p-2"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((t) => {
                  const eligible = isBulkAttachEligible(t);
                  const checked = selectedIds.has(t.id);
                  return (
                  <tr key={t.id} className={`border-t hover:bg-secondary/30 ${checked ? "bg-primary/5" : ""}`}>
                    {/* Per-row checkbox. Rendered (but disabled) for
                        ineligible rows too so the column stays aligned and
                        the operator can see WHY they can't select certain
                        rows (greyed out). */}
                    <td className="p-2 align-middle">
                      <Checkbox
                        checked={checked}
                        disabled={!eligible}
                        onCheckedChange={() => toggleSelect(t.id, eligible)}
                        aria-label="انتخاب تراکنش"
                      />
                    </td>
                    <td className="p-2">{banks[t.bank_id || ""]?.title || banks[t.bank_id || ""]?.bank_name || "—"}</td>
                    <td className="p-2"><JalaliDateCell value={t.transaction_datetime} withTime /></td>
                    <td className="p-2">{t.transaction_type === "deposit" ? "واریز" : "برداشت"}</td>
                    <td className="p-2"><MoneyCell value={t.deposit_amount} positive /></td>
                    <td className="p-2"><MoneyCell value={t.withdraw_amount} negative /></td>
                    <td className="p-2"><MoneyCell value={t.balance_after} /></td>
                    <td className="p-2 max-w-[260px] align-top">
                      {/* Full description on hover via native tooltip; click to expand inline.
                          Keeps the row compact by default but never hides text from the user. */}
                      <ExpandableDescription text={t.description} />
                      <RowBadges
                        idents={identByTx[t.id]}
                        ri={receiveByTx[t.id]}
                        partyName={receiveByTx[t.id]?.party_id ? partyNames[receiveByTx[t.id]!.party_id!] || null : null}
                        autoState={deriveAutoState(t, identByTx[t.id], receiveByTx[t.id])}
                      />
                    </td>

                    <td className="p-2 font-mono text-xs">{t.reference_number || t.tracking_number || "—"}</td>
                    <td className="p-2 text-xs">{t.source_type || "—"}</td>
                    <td className="p-2"><FinanceStatusBadge status={t.assignment_status} /></td>
                    <td className="p-2">
                      <div className="flex gap-1 flex-wrap items-center">
                        {t.assignment_status === "unassigned" && t.transaction_type === "deposit" && (
                          <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setOpenReceiveId(t)}>
                            <ArrowDownToLine className="w-3 h-3 ml-1" /> شناسایی دریافت
                          </Button>
                        )}
                        {/* Show "ثبت پرداخت" for unassigned withdraws AND for
                            bank-fee candidates flagged as needs_review, so the
                            operator can complete the manual payment-request
                            flow from this row without leaving the screen. */}
                        {((t.assignment_status === "unassigned" && t.transaction_type === "withdraw") ||
                          (t.assignment_status === "needs_review" && t.assigned_operation_type === "bank_fee_candidate")) && (
                          <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => toast.info("ثبت پرداخت از تب درخواست‌های پرداخت")}>
                            <ArrowUpFromLine className="w-3 h-3 ml-1" /> ثبت پرداخت
                          </Button>
                        )}
                        {t.assignment_status === "unassigned" && (
                          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => toast.info("اتصال به انتقال بین بانکی از تب مربوطه")}>
                            <ArrowLeftRight className="w-3 h-3 ml-1" /> انتقال بانکی
                          </Button>
                        )}
                        {t.assignment_status === "assigning" && (
                          <span className="text-[11px] text-amber-700 inline-flex items-center gap-1">
                            <Link2 className="w-3 h-3" /> در انتظار تایید مدیر
                          </span>
                        )}
                        {t.assignment_status === "assigned" && t.assigned_operation_type === "receive_identification" && (
                          <span className="text-[11px] text-emerald-700">شناسایی شده</span>
                        )}
                        {/* Bank-fee candidate badge — surfaced by the
                            auto-processing pipeline. Operator clicks "ثبت پرداخت"
                            (already wired for withdraws) to complete the
                            manual approve→post flow. We intentionally do NOT
                            render an auto-post button here yet — that path
                            belongs in the dedicated bank-fee helper that
                            mirrors PaymentRequestsTab. */}
                        {t.assignment_status === "needs_review" && t.assigned_operation_type === "bank_fee_candidate" && (
                          <span className="text-[11px] inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 text-amber-700 px-2 py-0.5">
                            <AlertTriangle className="w-3 h-3" /> کارمزد بانکی — بازبینی دستی
                          </span>
                        )}
                        <Button size="icon" variant="ghost" title="جزئیات خام" onClick={() => setOpenRaw(t)}><FileText className="w-3.5 h-3.5" /></Button>
                        {t.assignment_status === "unassigned" && (
                          <Button size="icon" variant="ghost" title="حذف نرم" onClick={() => softDelete(t)}><Trash2 className="w-3.5 h-3.5" /></Button>
                        )}
                      </div>
                    </td>
                  </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr><td colSpan={12} className="p-8 text-center text-muted-foreground">تراکنشی یافت نشد</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-2">
            {filtered.map((t) => {
              const eligible = isBulkAttachEligible(t);
              const checked = selectedIds.has(t.id);
              return (
              <div key={t.id} className={`rounded-xl border bg-card p-3 ${checked ? "ring-2 ring-primary" : ""}`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {/* Mobile selection checkbox — only renders for eligible
                        rows to avoid cluttering deposits / assigned rows. */}
                    {eligible && (
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => toggleSelect(t.id, eligible)}
                        aria-label="انتخاب تراکنش"
                      />
                    )}
                    <span className="font-bold text-sm truncate">{banks[t.bank_id || ""]?.title || "—"}</span>
                  </div>
                  <FinanceStatusBadge status={t.assignment_status} />
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <JalaliDateCell value={t.transaction_datetime} withTime />
                  {t.transaction_type === "deposit"
                    ? <MoneyCell value={t.deposit_amount} positive />
                    : <MoneyCell value={t.withdraw_amount} negative />}
                </div>
                {t.description && (
                  <div className="mt-2"><ExpandableDescription text={t.description} /></div>
                )}
                <RowBadges
                  idents={identByTx[t.id]}
                  ri={receiveByTx[t.id]}
                  partyName={receiveByTx[t.id]?.party_id ? partyNames[receiveByTx[t.id]!.party_id!] || null : null}
                  autoState={deriveAutoState(t, identByTx[t.id], receiveByTx[t.id])}
                />


                <div className="mt-2 flex gap-1 flex-wrap">
                  {t.assignment_status === "unassigned" && t.transaction_type === "deposit" && (
                    <Button size="sm" variant="outline" onClick={() => setOpenReceiveId(t)}>
                      <ArrowDownToLine className="w-3 h-3 ml-1" /> شناسایی دریافت
                    </Button>
                  )}
                  {t.assignment_status === "assigning" && (
                    <span className="text-[11px] text-amber-700">در انتظار تایید مدیر</span>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => setOpenRaw(t)}><FileText className="w-3 h-3 ml-1" /> جزئیات</Button>
                  {t.assignment_status === "unassigned" && (
                    <Button size="sm" variant="ghost" onClick={() => softDelete(t)}><Trash2 className="w-3 h-3 ml-1" /> حذف</Button>
                  )}
                </div>
              </div>
              );
            })}
            {filtered.length === 0 && (
              <p className="text-center text-muted-foreground py-8">تراکنشی یافت نشد</p>
            )}
          </div>

          {/* ---- Pagination ----------------------------------------------
              Server-driven. `pageCount` comes from the filtered total so
              clicks never overshoot the real last page. Buttons are
              disabled at the edges and during loading. ----------------- */}
          {(filteredCount ?? 0) > 0 && (
            <div className="flex items-center justify-between gap-2 flex-wrap pt-2">
              <span className="text-xs text-muted-foreground tabular-nums">
                صفحه {page.toLocaleString("fa-IR")} از {pageCount.toLocaleString("fa-IR")}
              </span>
              <div className="flex items-center gap-1">
                <Button size="sm" variant="outline" disabled={page <= 1 || loading} onClick={() => setPage(1)}>
                  ابتدا
                </Button>
                <Button size="sm" variant="outline" disabled={page <= 1 || loading} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                  قبلی
                </Button>
                <Button size="sm" variant="outline" disabled={page >= pageCount || loading} onClick={() => setPage((p) => Math.min(pageCount, p + 1))}>
                  بعدی
                </Button>
                <Button size="sm" variant="outline" disabled={page >= pageCount || loading} onClick={() => setPage(pageCount)}>
                  انتها
                </Button>
              </div>
            </div>
          )}
        </>
      )}


      {/* Bulk-attach dialog — projects the selected tx rows down to the
          minimal shape the dialog needs. We re-fetch fresh data inside the
          dialog before each call so this snapshot is just the starting
          set; it can't go stale during the run. */}
      {openBulkAttach && (
        <BulkAttachPaymentRequestDialog
          transactions={
            txs
              .filter((t) => selectedIds.has(t.id))
              .map<BulkAttachTx>((t) => ({
                id: t.id,
                withdraw_amount: t.withdraw_amount,
                description: t.description,
                document_number: t.document_number,
                assignment_status: t.assignment_status,
              }))
          }
          onClose={() => setOpenBulkAttach(false)}
          onDone={() => {
            // Reload the transactions list and drop the selection so
            // attached rows disappear from the unassigned view and the
            // user starts from a clean slate.
            setOpenBulkAttach(false);
            clearSelection();
            void load();
          }}
        />
      )}

      {openManual && <ManualTxDialog onClose={() => setOpenManual(false)} onDone={() => { setOpenManual(false); void load(); }} />}
      {openExcel && <ExcelImportDialog onClose={() => setOpenExcel(false)} onDone={() => { setOpenExcel(false); void load(); }} />}
      {openReceiveId && (
        <NewReceiveIdDialog
          presetTxId={openReceiveId.id}
          onClose={() => setOpenReceiveId(null)}
          onDone={() => { setOpenReceiveId(null); void load(); }}
        />
      )}
      {openRaw && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setOpenRaw(null)}>
          <div className="bg-card rounded-xl border shadow-lg w-full max-w-lg max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b flex items-center justify-between">
              <h3 className="font-bold">جزئیات خام</h3>
              <Button size="sm" variant="ghost" onClick={() => setOpenRaw(null)}><X className="w-4 h-4" /></Button>
            </div>
            {/* Original file download — only shown when the row was
                created by an Excel/CSV import that archived its source
                file into the `finance-imports` bucket. */}
            {openRaw.imported_file_path && (
              <div className="p-4 border-b flex items-center justify-between gap-2 flex-wrap">
                <div className="text-xs">
                  <div className="font-bold">فایل اصلی</div>
                  <div className="text-muted-foreground truncate max-w-[280px]">
                    {openRaw.original_file_name || openRaw.imported_file_name || openRaw.imported_file_path}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    // Bucket is private → mint a short-lived signed URL on click.
                    const { data, error } = await supabase.storage
                      .from("finance-imports")
                      .createSignedUrl(openRaw.imported_file_path!, 60);
                    if (error || !data?.signedUrl) {
                      toast.error("دریافت فایل اصلی ناموفق بود");
                      return;
                    }
                    window.open(data.signedUrl, "_blank", "noopener");
                  }}
                >
                  <Download className="w-4 h-4 ml-1" /> دانلود فایل اصلی
                </Button>
              </div>
            )}
            <pre dir="ltr" className="p-4 text-xs overflow-x-auto whitespace-pre-wrap">{JSON.stringify(openRaw.raw_data ?? openRaw, null, 2)}</pre>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * ExpandableDescription
 * Renders a bank transaction description with three affordances so the user
 * never loses access to the full text:
 *   1. Native browser tooltip (title=) on hover — instant preview.
 *   2. Two-line clamp by default so rows stay compact.
 *   3. Inline "نمایش کامل شرح" / "بستن" toggle when the text exceeds the clamp,
 *      revealing the full description in-place without a modal.
 */
/**
 * RowBadges
 * Compact, RTL-friendly badge cluster that summarises every signal the
 * auto-identification pipeline produced for a single bank transaction:
 *   • One chip per extracted identifier (card / IBAN / account).
 *   • Verified owner name (from bankpartyaccountinfos / verify-account).
 *   • Matched party (from the linked receive identification, if any).
 *   • Auto-identification state (auto / manual / needs review / no id).
 *   • Sepidar posting status when a voucher exists.
 * Kept deliberately minimal — uses semantic tokens only, no hard-coded colors.
 */
function RowBadges({
  idents, ri, partyName, autoState,
}: {
  idents: IdentRow[] | undefined;
  ri: ReceiveMeta | undefined;
  partyName: string | null;
  autoState: AutoState;
}) {
  const chip = "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-bold";
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {idents?.map((ident, i) => (
        <span key={i} className={`${chip} bg-muted/50 text-foreground`} title={ident.raw_value || ""}>
          {MATCH_TYPE_LABEL[ident.match_type] || "شناسه"}: {ident.normalized_value?.slice(-6) || "—"}
          {ident.verified_owner_name && (
            <span className="opacity-70">· {ident.verified_owner_name}</span>
          )}
        </span>
      ))}
      {partyName && (
        <span className={`${chip} border-primary/40 text-primary`}>ذینفع: {partyName}</span>
      )}
      {autoState === "auto_identified" && (
        <span className={`${chip} border-emerald-500/40 text-emerald-600 dark:text-emerald-400`}>شناسایی خودکار</span>
      )}
      {autoState === "manual" && ri && (
        <span className={`${chip} border-sky-500/40 text-sky-600 dark:text-sky-400`}>شناسایی دستی</span>
      )}
      {autoState === "needs_review" && (
        <span className={`${chip} border-amber-500/40 text-amber-600 dark:text-amber-400`}>نیازمند بازبینی</span>
      )}
      {autoState === "no_identifier" && (
        <span className={`${chip} border-muted text-muted-foreground`}>بدون شناسه</span>
      )}
      {ri?.sepidar_sync_status === "synced" && (
        <span className={`${chip} border-emerald-500/40 text-emerald-600 dark:text-emerald-400`}>سپیدار: ثبت‌شده</span>
      )}
      {ri?.sepidar_sync_status === "failed" && (
        <span className={`${chip} border-destructive/40 text-destructive`}>سپیدار: خطا</span>
      )}
      {ri?.sepidar_sync_status === "pending" && ri && (
        <span className={`${chip} border-muted text-muted-foreground`}>سپیدار: در انتظار</span>
      )}
    </div>
  );
}

function ExpandableDescription({ text }: { text: string | null }) {
  const [expanded, setExpanded] = useState(false);
  if (!text) return <span className="text-muted-foreground">—</span>;
  // Heuristic threshold: anything beyond ~80 chars likely needs the toggle.
  const isLong = text.length > 80;
  return (
    <div className="text-xs leading-relaxed">
      <p
        title={text}
        className={expanded ? "whitespace-pre-wrap break-words" : "line-clamp-2 break-words"}
      >
        {text}
      </p>
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-[11px] font-bold text-primary hover:underline"
        >
          {expanded ? "بستن" : "نمایش کامل شرح"}
        </button>
      )}
    </div>
  );
}

function ManualTxDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [bankId, setBankId] = useState<string | null>(null);
  const [type, setType] = useState<"deposit" | "withdraw">("deposit");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [reference, setReference] = useState("");
  // Hold the picked moment as a Gregorian ISO timestamp (Tehran-anchored).
  // The DatePicker shows a Jalali calendar but emits Gregorian, matching the
  // shape Postgres expects for `transaction_datetime` (timestamptz).
  const [date, setDate] = useState<string | null>(new Date().toISOString());
  const [saving, setSaving] = useState(false);

  async function save() {
    if (saving) return;
    if (!bankId) return toast.error("بانک را انتخاب کنید");
    const amt = parseMoney(amount);
    if (amt <= 0) return toast.error("مبلغ نامعتبر");
    setSaving(true);
    const payload = {
      bank_id: bankId,
      // `date` is already a valid Gregorian ISO timestamp from the picker.
      transaction_datetime: date ?? new Date().toISOString(),
      transaction_type: type,
      deposit_amount: type === "deposit" ? amt : 0,
      withdraw_amount: type === "withdraw" ? amt : 0,
      amount: amt,
      description,
      reference_number: reference || null,
      source_type: "manual" as const,
      assignment_status: "unassigned",
    };
    const { error } = await supabase.from("finance_bank_transactions").insert(payload);
    setSaving(false);
    if (error) {
      if (error.code === "23505") return toast.error("تراکنش تکراری");
      return toastFinanceError(toast, error);
    }
    await recalculateBankUnassignedBalances(bankId);
    toast.success("ثبت شد");
    onDone();
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-card rounded-t-2xl sm:rounded-2xl border shadow-lg w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b flex items-center justify-between">
          <h3 className="font-bold">ثبت دستی تراکنش</h3>
          <Button size="sm" variant="ghost" onClick={onClose}><X className="w-4 h-4" /></Button>
        </div>
        <div className="p-4 space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">بانک</Label>
            <BankSelector value={bankId} onChange={setBankId} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label className="text-xs">نوع</Label>
              <select value={type} onChange={(e) => setType(e.target.value as "deposit" | "withdraw")} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                <option value="deposit">واریز</option>
                <option value="withdraw">برداشت</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">تاریخ و ساعت</Label>
              {/* Jalali calendar UI; value flows as Gregorian ISO so the
                  existing insert payload doesn't need any other changes. */}
              <DatePicker mode="datetime" value={date} onChange={setDate} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">مبلغ (ریال)</Label>
            <Input dir="ltr" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">شماره مرجع / پیگیری</Label>
            <Input dir="ltr" value={reference} onChange={(e) => setReference(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">شرح</Label>
            <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
        </div>
        <div className="p-4 border-t flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>انصراف</Button>
          <Button onClick={save} disabled={saving}>ذخیره</Button>
        </div>
      </div>
    </div>
  );
}

function ExcelImportDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [bankId, setBankId] = useState<string | null>(null);
  const [bankInfo, setBankInfo] = useState<{ title: string | null; bank_name: string | null; import_template_id: string | null; legacy_bank_name_code: number | null } | null>(null);
  const [templates, setTemplates] = useState<import("@/lib/bankImport").BankImportTemplate[]>([]);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<import("@/lib/bankImport").ParsedRow[]>([]);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  // `alreadyInDb` = rows that the upload-time re-check found already inserted
  // in `finance_bank_transactions` (independent from the preview's
  // in-Excel/in-DB duplicate marker). `failed` = rows whose INSERT actually
  // failed at the DB level, with a Persian-friendly reason kept for the
  // post-import recap. Both are needed so the user can reconcile a partial
  // import against the source spreadsheet.
  const [summary, setSummary] = useState<{
    total: number;
    valid: number;
    duplicate: number;
    invalid: number;
    inserted: number;
    alreadyInDb: number;
    failed: { index: number; reason: string }[];
  } | null>(null);
  // Phase 6: counters returned by the auto-identify pipeline so the
  // import dialog can display per-state chips after the final save step.
  const [autoSummary, setAutoSummary] = useState<AutoIdentifySummary | null>(null);

  useEffect(() => {
    void supabase
      .from("finance_bank_import_templates")
      .select("*")
      .order("bank_name_code", { ascending: true })
      .then(({ data }) => setTemplates((data as unknown as import("@/lib/bankImport").BankImportTemplate[]) || []));
  }, []);

  useEffect(() => {
    setTemplateId(null);
    setParsed([]);
    setSummary(null);
    if (!bankId) { setBankInfo(null); return; }
    void supabase
      .from("finance_banks")
      .select("title,bank_name,import_template_id,legacy_bank_name_code")
      .eq("id", bankId)
      .maybeSingle()
      .then(({ data }) => {
        const info = data as { title: string | null; bank_name: string | null; import_template_id: string | null; legacy_bank_name_code: number | null } | null;
        setBankInfo(info);
      });
  }, [bankId]);

  // Auto-select template based on bank: explicit mapping first, then legacy code
  useEffect(() => {
    if (!bankInfo || templates.length === 0) return;
    if (bankInfo.import_template_id) {
      setTemplateId(bankInfo.import_template_id);
      return;
    }
    if (bankInfo.legacy_bank_name_code != null) {
      const m = templates.find((t) => t.bank_name_code === bankInfo.legacy_bank_name_code);
      if (m) setTemplateId(m.id);
    }
  }, [bankInfo, templates]);

  const selectedTemplate = useMemo(() => templates.find((t) => t.id === templateId) || null, [templates, templateId]);
  const templateActive = !!selectedTemplate?.is_active;
  const noActiveTemplate = !!bankId && !!bankInfo && !templateActive;

  async function preview() {
    setSummary(null);
    if (!bankId) return toast.error("اطلاعات ضروری تکمیل نشده است");
    if (!title.trim() || !description.trim()) return toast.error("اطلاعات ضروری تکمیل نشده است");
    if (!file) return toast.error("اطلاعات ضروری تکمیل نشده است");
    if (!selectedTemplate) return toast.error("قالب خواندن فایل را انتخاب کنید");
    if (!selectedTemplate.is_active) return toast.error("برای این بانک هنوز قالب خواندن فایل تعریف نشده است");

    const ext = file.name.split(".").pop()?.toLowerCase() || "";
    if (!["xls", "xlsx", "csv"].includes(ext)) return toast.error("فرمت فایل مجاز نیست");

    setPreviewing(true);
    try {
      const { readFileRows, parseRowsWithTemplate } = await import("@/lib/bankImport");
      const rows = await readFileRows(file, selectedTemplate);
      const list = parseRowsWithTemplate(rows, selectedTemplate);
      if (list.length === 0) {
        toast.error("اطلاعات قابل ثبت در فایل پیدا نشد");
        setParsed([]);
        return;
      }
      // ──────────────────────────────────────────────────────────────────
      // DB duplicate check — must mirror the partial unique index
      // `uq_finance_bank_tx_dedupe` which keys on:
      //   (bank_id, transaction_datetime,
      //    COALESCE(amount,0),
      //    COALESCE(reference_number,''),
      //    COALESCE(tracking_number,''),
      //    COALESCE(document_number,''))   WHERE is_deleted = false
      //
      // We chunk the `.in('transaction_datetime', …)` at 50 entries to stay
      // under Nginx's ~8KB URL cap (each ISO timestamp encodes to ~30 chars),
      // then compare locally using the FULL key — never just by datetime,
      // otherwise legitimate same-second transactions get marked duplicate.
      // ──────────────────────────────────────────────────────────────────
      const validList = list.filter((r) => r.status === "valid");
      if (validList.length > 0) {
        // Canonical key builder used both for DB rows and for parsed rows.
        // ParsedRow has no reference_number/tracking_number fields today so
        // we pass empty strings — that still matches the DB COALESCE.
        const keyOf = (k: {
          transaction_datetime: string | null;
          amount: number | null;
          reference_number?: string | null;
          tracking_number?: string | null;
          document_number?: string | null;
        }) =>
          `${k.transaction_datetime}|${Number(k.amount ?? 0)}|${k.reference_number || ""}|${k.tracking_number || ""}|${k.document_number || ""}`;

        const datetimes = Array.from(
          new Set(validList.map((r) => r.transaction_datetime!).filter(Boolean)),
        );
        const existingKeys = new Set<string>();
        const CHUNK = 50;
        const chunkCount = Math.ceil(datetimes.length / CHUNK);
        console.log("[previewDuplicateCheck]", {
          operationName: "previewDuplicateCheck",
          totalRows: list.length,
          uniqueTransactionDatetimes: datetimes.length,
          chunkCount,
          chunkSize: CHUNK,
        });
        for (let i = 0; i < datetimes.length; i += CHUNK) {
          const slice = datetimes.slice(i, i + CHUNK);
          const chunkIndex = Math.floor(i / CHUNK);
          console.log("[previewDuplicateCheck chunk]", { chunkIndex, chunkSize: slice.length });
          const { data: existing, error: dupErr } = await supabase
            .from("finance_bank_transactions")
            .select("transaction_datetime,amount,reference_number,tracking_number,document_number")
            // Match the index predicate — soft-deleted rows must NOT count
            // as duplicates (otherwise resurrecting an import is impossible).
            .eq("is_deleted", false)
            .eq("bank_id", bankId)
            .in("transaction_datetime", slice);
          if (dupErr) throw dupErr;
          for (const e of (existing as Array<{
            transaction_datetime: string | null;
            amount: number | null;
            reference_number: string | null;
            tracking_number: string | null;
            document_number: string | null;
          }>) || []) {
            existingKeys.add(keyOf(e));
          }
        }
        for (const r of validList) {
          // ParsedRow has no ref/track numbers → pass empty strings so the
          // key shape lines up with the DB-side COALESCE(...) above.
          const key = keyOf({
            transaction_datetime: r.transaction_datetime,
            amount: r.amount,
            reference_number: "",
            tracking_number: "",
            document_number: r.document_number,
          });
          if (existingKeys.has(key)) { r.status = "duplicate"; r.status_reason = "تکراری"; }
        }
      }

      setParsed(list);
      toast.success(`${list.length} ردیف خوانده شد`);
    } catch (e) {
      toastFinanceError(toast, e);
    } finally {
      setPreviewing(false);
    }
  }

  async function importAll() {
    if (!bankId || !file) return;
    const validRows = parsed.filter((r) => r.status === "valid");
    if (validRows.length === 0) return toast.error("ردیف معتبری برای ثبت نیست");
    setSaving(true);

    // ──────────────────────────────────────────────────────────────────
    // STEP 1 — Archive the original Excel/CSV file to Supabase Storage
    // BEFORE inserting any rows. We do this first so every inserted row
    // can reference the same archived path; if the upload fails we abort
    // the whole import (Persian error) and no transactions are created.
    // Bucket: finance-imports (private, see migration).
    // Path shape: {bank_id}/{yyyy-mm-dd}/{uuid}-{original-name}
    // ──────────────────────────────────────────────────────────────────
    const safeName = file.name.replace(/[^\w.\-]+/g, "_");
    const today = new Date().toISOString().slice(0, 10);
    const storagePath = `${bankId}/${today}/${crypto.randomUUID()}-${safeName}`;
    const { error: upErr } = await supabase.storage
      .from("finance-imports")
      .upload(storagePath, file, {
        upsert: false,
        contentType: file.type || "application/octet-stream",
      });
    if (upErr) {
      setSaving(false);
      // Persian error per spec — stop the import on upload failure.
      toast.error(`بارگذاری فایل اصلی در فضای ذخیره‌سازی ناموفق بود: ${upErr.message}`);
      return;
    }

    // ──────────────────────────────────────────────────────────────────
    // STEP 2 — Pre-filter against existing DB rows using the FULL dedupe
    // key that mirrors the partial unique index `uq_finance_bank_tx_dedupe`:
    //   (bank_id, transaction_datetime,
    //    COALESCE(amount,0),
    //    COALESCE(reference_number,''),
    //    COALESCE(tracking_number,''),
    //    COALESCE(document_number,''))   WHERE is_deleted = false
    //
    // We do this so:
    //   (a) we get an honest skipped-count even if the preview missed rows,
    //   (b) we don't waste a batch INSERT on rows we know will conflict.
    // The RPC in STEP 3 is still the source of truth — this is just a
    // best-effort pre-filter to keep counts and UX accurate.
    // ──────────────────────────────────────────────────────────────────
    const keyOf = (r: {
      transaction_datetime: string | null;
      amount: number | null;
      reference_number?: string | null;
      tracking_number?: string | null;
      document_number?: string | null;
    }) =>
      `${r.transaction_datetime}|${Number(r.amount ?? 0)}|${r.reference_number || ""}|${r.tracking_number || ""}|${r.document_number || ""}`;

    const datetimes = Array.from(
      new Set(validRows.map((r) => r.transaction_datetime!).filter(Boolean)),
    );
    const existingKeys = new Set<string>();
    // Same 50-timestamp cap as the preview check — keeps the GET URL well
    // under Nginx's request-line limit so the import never 502s here.
    const CHUNK = 50;
    try {
      const totalChunks = Math.ceil(datetimes.length / CHUNK);
      console.log("[bank-import] dedupe pre-check", {
        uniqueDatetimes: datetimes.length,
        chunkCount: totalChunks,
        chunkSize: CHUNK,
      });
      for (let i = 0; i < datetimes.length; i += CHUNK) {
        const slice = datetimes.slice(i, i + CHUNK);
        const { data: existing, error: dupErr } = await supabase
          .from("finance_bank_transactions")
          .select("transaction_datetime,amount,reference_number,tracking_number,document_number")
          // Must match the partial index predicate — soft-deleted rows are
          // NOT part of the unique constraint, so we must ignore them here
          // too, otherwise we'd over-report duplicates.
          .eq("is_deleted", false)
          .eq("bank_id", bankId)
          .in("transaction_datetime", slice);
        if (dupErr) throw dupErr;
        for (const e of (existing as Array<{
          transaction_datetime: string | null;
          amount: number | null;
          reference_number: string | null;
          tracking_number: string | null;
          document_number: string | null;
        }>) || []) {
          existingKeys.add(keyOf(e));
        }
      }
    } catch (e) {
      setSaving(false);
      toastFinanceError(toast, e);
      return;
    }

    // Split valid rows into two buckets. We keep the original ParsedRow
    // reference so the auto-identify pipeline can read `identifiers` later
    // without re-parsing the spreadsheet.
    const newRowsToInsert: typeof validRows = [];
    let alreadyInDb = 0;
    for (const r of validRows) {
      const k = keyOf({
        transaction_datetime: r.transaction_datetime,
        amount: r.amount,
        reference_number: "",
        tracking_number: "",
        document_number: r.document_number,
      });
      if (existingKeys.has(k)) {
        alreadyInDb++;
        r.status = "duplicate";
        r.status_reason = "موجود در پایگاه داده";
      } else {
        newRowsToInsert.push(r);
      }
    }

    // ──────────────────────────────────────────────────────────────────
    // STEP 3 — Bulk insert via the `finance_bank_tx_bulk_insert` RPC.
    //
    // Why an RPC instead of a plain `.insert()`?
    // The dedupe unique index is a PARTIAL EXPRESSION index
    // (`WHERE is_deleted=false` + `COALESCE(...)` columns). PostgREST's
    // upsert/onConflict can't target expression indexes reliably, and a
    // plain `.insert()` would abort the entire batch on the first
    // conflict. The RPC uses `INSERT ... ON CONFLICT (...) WHERE ... DO
    // NOTHING RETURNING id`, mapping each returned id back to its input
    // ordinal so the client can pair rows with new database ids. Rows
    // omitted from the RETURNING set are conflict-skipped, NOT failed.
    //
    // Batch size stays at 100 so a single payload is small enough to keep
    // Nginx/Cloudflare timeouts happy even on slow networks.
    // ──────────────────────────────────────────────────────────────────
    const BATCH_SIZE = 100;
    const chunkCount = Math.ceil(newRowsToInsert.length / BATCH_SIZE);
    let inserted = 0;
    // Rows the RPC accepted no id for — these are runtime conflicts the
    // pre-check missed (e.g. another user inserted them between STEP 2 and
    // STEP 3). They count as "alreadyInDb", NOT "failed".
    let conflictSkipped = 0;
    const failed: { index: number; reason: string }[] = [];
    // No post-insert pipeline state — auto-processing is a separate, manual flow now.

    console.log("[bank-import] starting batched insert via RPC", {
      totalRows: parsed.length,
      validRows: validRows.length,
      existingInDb: alreadyInDb,
      newRowsToInsert: newRowsToInsert.length,
      chunkCount,
      batchSize: BATCH_SIZE,
    });

    for (let bi = 0; bi < newRowsToInsert.length; bi += BATCH_SIZE) {
      const batchIndex = bi / BATCH_SIZE;
      const batch = newRowsToInsert.slice(bi, bi + BATCH_SIZE);
      const payloads = batch.map((r) => ({
        bank_id: bankId,
        transaction_datetime: r.transaction_datetime,
        transaction_type: r.transaction_type,
        deposit_amount: r.deposit,
        withdraw_amount: r.withdraw,
        amount: r.amount,
        description: r.description || description,
        document_number: r.document_number || null,
        // reference_number / tracking_number aren't extracted from the
        // spreadsheet today, but we send them as null so the dedupe key
        // matches DB-side COALESCE('') exactly.
        reference_number: null as string | null,
        tracking_number: null as string | null,
        source_type: selectedTemplate?.file_type === "csv" ? "csv" : "excel",
        assignment_status: "unassigned",
        original_file_name: file.name,
        imported_file_name: title,
        imported_file_path: storagePath,
        raw_data: r.raw as unknown as Record<string, unknown>,
      }));
      try {
        // RPC returns one row per input ordinal: { ord, id }. `id` is null
        // when that input was conflict-skipped by ON CONFLICT DO NOTHING.
        const { data, error } = await supabase.rpc("finance_bank_tx_bulk_insert", {
          payloads: payloads as unknown as Json,
        });
        if (error) {
          // Whole batch failed at the RPC level — record every row as
          // failed and continue with the next batch.
          console.error("[bank-import] batch RPC failed", {
            batchIndex,
            batchStart: bi,
            batchSize: batch.length,
            error: error.message,
          });
          for (const r of batch) failed.push({ index: r.index, reason: error.message });
          continue;
        }
        const rows = (data || []) as Array<{ ord: number; id: string | null }>;
        // Build an ord→id map so we don't rely on Postgres returning rows
        // in any particular order.
        const byOrd = new Map<number, string | null>();
        for (const row of rows) byOrd.set(row.ord, row.id);
        for (let k = 0; k < batch.length; k++) {
          const source = batch[k];
          // ord is 1-based (Postgres WITH ORDINALITY).
          const id = byOrd.get(k + 1) ?? null;
          if (!id) {
            // Conflict-skipped — NOT a failure. Mark the parsed row so the
            // preview table shows it as duplicate and the summary counter
            // increments correctly.
            conflictSkipped++;
            source.status = "duplicate";
            source.status_reason = "موجود در پایگاه داده";
            continue;
          }
          inserted++;
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[bank-import] batch threw", { batchIndex, error: msg });
        for (const r of batch) failed.push({ index: r.index, reason: msg });
      }
    }

    // Roll RPC-side conflict skips into the same bucket as the pre-check
    // skips so the summary/toast reflect the true "already in DB" count.
    alreadyInDb += conflictSkipped;


    console.log("[bank-import] insert phase complete", {
      inserted,
      failed: failed.length,
      alreadyInDb,
    });

    // ──────────────────────────────────────────────────────────────────
    // ARCHITECTURE: Excel upload is now PURE — parse, dedupe, insert.
    // Auto-identification, inter-bank matching, fee classification and
    // Sepidar posting are explicitly NOT run here anymore. The operator
    // triggers them via the "تشخیص و ثبت اتوماتیک تراکنش‌های تخصیص‌نشده"
    // button on the main bank-transactions screen.
    //
    // Rationale: Upload success must never depend on slow / failure-prone
    // downstream pipelines (verify-account API, Sepidar SOAP). Separating
    // the flows lets the operator re-run auto-processing as often as
    // needed without re-importing the file.
    // ──────────────────────────────────────────────────────────────────

    if (bankId) await recalculateBankUnassignedBalances(bankId);
    setSaving(false);
    const total = parsed.length;
    const valid = parsed.filter((r) => r.status === "valid").length;
    const dup = parsed.filter((r) => r.status === "duplicate").length;
    const inv = parsed.filter((r) => r.status === "invalid").length;
    setSummary({ total, valid, duplicate: dup, invalid: inv, inserted, alreadyInDb, failed });
    setAutoSummary(null);
    setParsed([...parsed]);
    const skipSegment = alreadyInDb > 0 ? ` · موجود در پایگاه: ${alreadyInDb}` : "";
    const failSegment = failed.length > 0 ? ` · ناموفق: ${failed.length}` : "";
    toast.success(
      `${inserted} ردیف جدید ثبت شد${skipSegment}${failSegment} — برای شناسایی خودکار از دکمه «تشخیص و ثبت اتوماتیک تراکنش‌های تخصیص‌نشده» استفاده کنید.`,
    );
    onDone();
  }


  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-card rounded-t-2xl sm:rounded-2xl border shadow-lg w-full max-w-3xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b flex items-center justify-between sticky top-0 bg-card z-10">
          <h3 className="font-bold">آپلود فایل تراکنش‌ها</h3>
          <Button size="sm" variant="ghost" onClick={onClose}><X className="w-4 h-4" /></Button>
        </div>
        <div className="p-4 space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">بانک *</Label>
              <BankSelector value={bankId} onChange={setBankId} />
              {bankInfo && (
                <p className="text-[11px] text-muted-foreground">
                  {bankInfo.title || bankInfo.bank_name || "—"}
                  {bankInfo.legacy_bank_name_code != null && <> · کد قدیمی: {legacyBankLabel(bankInfo.legacy_bank_name_code)}</>}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">قالب خواندن فایل *</Label>
              <select
                value={templateId || ""}
                onChange={(e) => setTemplateId(e.target.value || null)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">— انتخاب کنید —</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title} ({legacyBankLabel(t.bank_name_code)}){!t.is_active ? " — غیرفعال" : ""}
                  </option>
                ))}
              </select>
              {selectedTemplate && (
                <p className="text-[11px] text-muted-foreground">
                  {selectedTemplate.title} · {selectedTemplate.file_type.toUpperCase()}
                  {!selectedTemplate.is_active && <span className="text-amber-700"> · غیرفعال</span>}
                </p>
              )}
            </div>
          </div>

          {noActiveTemplate && (
            <div className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md p-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                {selectedTemplate?.description || "برای این بانک هنوز قالب خواندن فایل تعریف نشده است"}
              </span>
            </div>
          )}
          <div className="space-y-1.5">
            <Label className="text-xs">عنوان *</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="مثلاً: گردش بانک ملت اردیبهشت" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">توضیحات *</Label>
            <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">فایل تراکنش‌ها * (xls / xlsx / csv)</Label>
            <Input type="file" accept=".xls,.xlsx,.csv" onChange={(e) => { setFile(e.target.files?.[0] || null); setParsed([]); setSummary(null); }} />
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={preview} disabled={previewing || !file || !templateActive}>
              {previewing ? "در حال پردازش…" : "پیش‌نمایش"}
            </Button>
          </div>

          {parsed.length > 0 && (
            <>
              <div className="rounded-lg border overflow-x-auto max-h-80">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40 sticky top-0">
                    <tr className="text-right">
                      <th className="p-2">ردیف</th>
                      <th className="p-2">تاریخ</th>
                      <th className="p-2">ساعت</th>
                      <th className="p-2">واریز</th>
                      <th className="p-2">برداشت</th>
                      <th className="p-2">شماره سند</th>
                      <th className="p-2">توضیحات</th>
                      <th className="p-2">وضعیت</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.map((r) => (
                      <tr key={r.index} className={
                        r.status === "valid" ? "border-t" :
                        r.status === "duplicate" ? "border-t bg-amber-500/10" :
                        "border-t bg-destructive/10"
                      }>
                        <td className="p-2">{r.index}</td>
                        <td className="p-2 font-mono">{r.date}</td>
                        <td className="p-2 font-mono">{r.time}</td>
                        <td className="p-2 font-mono text-emerald-700">{r.deposit ? r.deposit.toLocaleString() : "—"}</td>
                        <td className="p-2 font-mono text-rose-700">{r.withdraw ? r.withdraw.toLocaleString() : "—"}</td>
                        <td className="p-2 font-mono">{r.document_number || "—"}</td>
                        <td className="p-2 max-w-[260px] truncate">{r.description || "—"}</td>
                        <td className="p-2">
                          {r.status === "valid" && <span className="text-emerald-700">معتبر</span>}
                          {r.status === "duplicate" && <span className="text-amber-700">تکراری</span>}
                          {r.status === "invalid" && <span className="text-rose-700">{r.status_reason || "نامعتبر"}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap gap-3 text-xs">
                <span>کل: {parsed.length}</span>
                <span className="text-emerald-700">معتبر: {parsed.filter((r) => r.status === "valid").length}</span>
                <span className="text-amber-700">تکراری: {parsed.filter((r) => r.status === "duplicate").length}</span>
                <span className="text-rose-700">خطادار: {parsed.filter((r) => r.status === "invalid").length}</span>
                {summary && <span className="font-bold">ثبت‌شده جدید: {summary.inserted}</span>}
                {summary && summary.alreadyInDb > 0 && (
                  <span className="text-amber-700">موجود در پایگاه: {summary.alreadyInDb}</span>
                )}
                {summary && summary.failed.length > 0 && (
                  <span className="text-rose-700">ناموفق: {summary.failed.length}</span>
                )}
              </div>
              {/* Per-row failure breakdown — only shown when at least one
                  insert actually failed at the DB layer so we don't add noise
                  to clean imports. */}
              {summary && summary.failed.length > 0 && (
                <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs space-y-1 max-h-32 overflow-auto">
                  <div className="font-bold text-destructive">ردیف‌های ناموفق:</div>
                  {summary.failed.map((f) => (
                    <div key={f.index} className="font-mono">ردیف {f.index}: {f.reason}</div>
                  ))}
                </div>
              )}
              {/* Phase 6 — auto-identification summary chips. Only rendered
                  after `importAll` finishes so the user sees them as part of
                  the post-import recap, alongside the legacy validity chips. */}
              {autoSummary && (
                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 text-emerald-700 px-2 py-0.5">
                    شناسایی خودکار: {autoSummary.auto_identified}
                  </span>
                  <span className="rounded-full border border-amber-500/40 bg-amber-500/10 text-amber-700 px-2 py-0.5">
                    نیازمند بازبینی: {autoSummary.needs_review}
                  </span>
                  <span className="rounded-full border border-muted bg-muted/30 text-muted-foreground px-2 py-0.5">
                    بدون شناسه: {autoSummary.no_identifier}
                  </span>
                  {autoSummary.sepidar_posted > 0 && (
                    <span className="rounded-full border border-primary/40 bg-primary/10 text-primary px-2 py-0.5">
                      ارسال به سپیدار: {autoSummary.sepidar_posted}
                    </span>
                  )}
                  {autoSummary.sepidar_failed > 0 && (
                    <span className="rounded-full border border-destructive/40 bg-destructive/10 text-destructive px-2 py-0.5">
                      خطای سپیدار: {autoSummary.sepidar_failed}
                    </span>
                  )}
                </div>
              )}
            </>
          )}
        </div>
        <div className="p-4 border-t flex justify-end gap-2 sticky bottom-0 bg-card">
          <Button variant="outline" onClick={onClose}>انصراف</Button>
          <Button onClick={importAll} disabled={saving || !templateActive || parsed.filter((r) => r.status === "valid").length === 0}>
            ثبت نهایی
          </Button>
        </div>
      </div>
    </div>
  );
}

