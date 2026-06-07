import { useEffect, useMemo, useState } from "react";
import { toastFinanceError } from "@/lib/financeErrors";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MoneyCell, FinanceStatusBadge, JalaliDateCell } from "@/components/finance/atoms";
import { PartySelector } from "@/components/finance/selectors";
import { createPaymentAllocation, retryPaymentAllocationSync, cancelPaymentAllocation, approvePaymentRequest, parseMoney, partyName, formatMoney, formatJalaliDateTime, PAYMENT_REQUEST_STATUS_LABEL, PAYMENT_STATUS_LABEL } from "@/lib/finance";
import { Plus, X, CheckCircle2, Trash2, AlertTriangle, Link2, RefreshCw, XCircle, Pencil } from "lucide-react";
// Phase-N: secure RPC-backed item-amount editor. The dialog handles its own
// validation but the server-side guard inside
// `fn_finance_update_payment_request_item_amount` is the source of truth.
import EditItemAmountDialog, { canEditItemAmount } from "@/components/finance/EditItemAmountDialog";
import SearchableSelect from "@/components/SearchableSelect";
import { toast } from "sonner";
// Jalali calendar UI returns "YYYY/MM/DD" Jalali strings. We convert these
// to Gregorian timestamp boundaries (start-of-day / end-of-day in Tehran)
// before filtering, because the DB stores Gregorian `transaction_datetime`.
// The legacy `transaction_jalali_date` text column is unused (100% NULL),
// so filtering against it was effectively hiding every result.
import ShamsiDatePicker from "@/components/ShamsiDatePicker";
import { jalaliRangeToGregorianRange, jalaliToGregorianDate, gregorianDateToJalali } from "@/lib/dateUtils";
import { PAYMENT_REQUEST_TYPES, getPaymentRequestTypeLabel, getPaymentRequestTypeKey } from "@/lib/paymentRequestTypes";
import {
  PAYMENT_AMOUNT_TYPES,
  getPaymentAmountTypeLabel,
  getPaymentAmountTypeKey,
  validateCreditorBalance,
} from "@/lib/paymentAmountTypes";
import { getSepidarBeneficiaryBalance, shouldEnforceSepidarBalance } from "@/lib/sepidar";
// Phase 7: consume a settlement-draft handed off by the invoice page. The
// invoice's "ثبت درخواست تسویه" button stashes a draft (party_id + amount +
// description per row) into sessionStorage and navigates here; we read it
// once on PRDialog open so the operator can review and submit.
import { consumeSettlementDraft, type SettlementDraft } from "@/lib/finance/relatedCosts";
// Phase 4: item-level lifecycle metadata (payment method, what the item pays
// for, due date, execution status/priority). Pre-Phase-3 rows carry
// `payment_method = 'legacy'` and must be displayed as read-only — any edit
// attempt surfaces a Persian warning instead of mutating the row.
import {
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS_FA,
  SETTLEMENT_SUBJECT_TYPES,
  SETTLEMENT_SUBJECT_LABELS_FA,
  EXECUTION_PRIORITIES,
  EXECUTION_PRIORITY_LABELS_FA,
  isLegacyItem,
  labelForPaymentMethod,
  labelForSubjectType,
  labelForExecutionPriority,
  type PaymentMethod,
  type SettlementSubjectType,
  type ExecutionPriority,
} from "@/lib/finance/settlementItemTypes";
// Phase 5: method-specific details (jsonb), validation + Persian summary.
import {
  validateDetails,
  summarizeDetails,
  type SettlementItemDetails,
} from "@/lib/finance/settlementItemDetails";
import SettlementItemDetailsForm from "@/components/finance/SettlementItemDetailsForm";
// Phase 8: execution layer — request-level progress summary (with monetary
// KPIs) at the top of the detail view, and a per-item execution panel that
// routes by payment_method. Both are pure components that work off the
// already-loaded items list and reload via the existing `reload()` helper.
import SettlementRequestProgressSummary from "@/components/finance/SettlementRequestProgressSummary";
import SettlementItemExecutionPanel from "@/components/finance/SettlementItemExecutionPanel";
// Phase 4 rollback dialog — wired into PRDetail header (request rollback) and
// into each allocation row (allocation rollback).
import { RollbackButton } from "@/components/finance/RollbackConfirmDialog";

// Payment-request beneficiary picker now reads from the LOCAL finance_parties
// table (same source used by «شناسایی دریافت») so we don't silently hide
// parties that exist locally but aren't in Sepidar's beneficiary view. Rows
// without a sepidar_party_id are shown disabled with a clear warning rather
// than dropped from the list.
import { LocalPartyBeneficiarySelector, type LocalPartyBeneficiary } from "@/components/finance/LocalPartyBeneficiarySelector";


interface PR {
  id: string;
  legacy_id: number | null;
  title: string | null;
  description: string | null;
  request_type: string | null;
  legacy_request_type_code: number | null;
  // Approval lifecycle (draft / pending_approval / approved / rejected / cancelled)
  status: string | null;
  // Payment-completion lifecycle (unpaid / partial_payment / full_payment) —
  // managed by the DB trigger + `refreshPaymentRequestPaidTotals` helper.
  payment_status: string | null;
  total_amount: number | null;
  confirmed_amount: number | null;
  total_paid_amount: number | null;
  remaining_amount: number | null;
  // Invoice ↔ Settlement dependency model: authoritative back-pointer to
  // the invoice that produced this request. NULL for legacy / independent
  // requests — those keep working exactly as before.
  source_factor_id?: string | null;
  // The operator who created this settlement request. Maps to app_users.id
  // so we can filter "my requests" or audit by requester.
  requested_by: string | null;
  created_at: string;
}

interface PartyLite {
  ownership_type: string | null;
  first_name: string | null;
  last_name: string | null;
  company_name: string | null;
  balance?: number | null;
}

interface PRItem {
  id?: string;
  party_id: string | null;
  amount: number;
  amount_type_code: number; // 1=creditor, 2=prepayment, 3=on_account
  amount_type: string; // text key
  description: string;
  status?: string;
  party?: PartyLite;
  // --- Sepidar beneficiary snapshot ---
  // These are filled when the user picks a beneficiary from the
  // SepidarBeneficiarySelector and are persisted on the row so the request
  // remains meaningful even if the upstream Sepidar record changes later.
  beneficiary_id?: string | null;
  dl_ref?: string | null;
  dl_code?: string | null;
  beneficiary_name?: string | null;
  beneficiary_type?: string | null;
  beneficiary_balance_snapshot?: number | null;
  // --- Phase 4 lifecycle fields (NEW items only) -------------------------
  // The user MUST explicitly choose payment_method + subject_type for every
  // new item. due_date is also required. execution_status defaults to
  // 'pending'; execution_priority defaults to 3 (عادی) but can be changed.
  // Legacy rows (created before Phase 3) carry payment_method='legacy' and
  // are never re-written by this dialog.
  payment_method?: PaymentMethod | "";
  settlement_subject_type?: SettlementSubjectType | "";
  due_date?: string; // ISO yyyy-mm-dd in Gregorian (DB stores `date` column)
  execution_priority?: ExecutionPriority;
  // Phase 5: method-specific fields stored on the row as jsonb. Empty object
  // for items whose method does not need extra metadata; never null so the
  // server-side COALESCE stays predictable.
  details?: SettlementItemDetails;

  // Phase 7B: when this item was seeded from a factor_related_costs row,
  // we carry that row id here so the server-side RPC can (a) persist it on
  // finance_payment_request_items.source_related_cost_id and (b) back-fill
  // factor_related_costs.settlement_request_item_id atomically. This is the
  // ONLY mechanism we use to link a cost to the item it generated — we
  // never match by amount/description, which is unsafe.
  source_related_cost_id?: string | null;
}


export default function PaymentRequestsTab() {
  const [requests, setRequests] = useState<PR[]>([]);
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<PR | null>(null);

  // ---- Server-side filters (refetch on change) -------------------------
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  // ---- Payment-completion filter ---------------------------------------
  // After the lifecycle refactor the request itself owns a `payment_status`
  // column. We filter directly on that column so the UI and the DB never
  // disagree about what counts as پرداخت ناقص / کامل / نشده.
  //   ""               → no filter
  //   "unpaid"         → payment_status = 'unpaid'
  //   "partial_payment"→ payment_status = 'partial_payment'
  //   "full_payment"   → payment_status = 'full_payment'
  const [paymentFilter, setPaymentFilter] = useState<string>("");
  const [voucherFilter, setVoucherFilter] = useState<string>("");

  // ---- New server-side filters: date range + requester ------------------
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [requesterFilter, setRequesterFilter] = useState<string>("");

  // ---- Requester list (app_users) for the searchable dropdown -----------
  const [users, setUsers] = useState<{ id: string; full_name: string | null; username: string }[]>([]);
  useEffect(() => {
    void (async () => {
      const { data } = await supabase
        .from("app_users")
        .select("id, full_name, username")
        .eq("is_active", true)
        .order("full_name", { ascending: true });
      setUsers((data as typeof users) || []);
    })();
  }, []);

  // ---- Debounced search input -------------------------------------------
  // We keep two pieces of state: `searchInput` mirrors the controlled text
  // box, `searchTerm` is updated 300 ms after the user stops typing and
  // drives the actual filter so we don't refetch on every keystroke.
  const [searchInput, setSearchInput] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  useEffect(() => {
    const t = window.setTimeout(() => setSearchTerm(searchInput.trim()), 300);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  // We need per-request voucher presence (vouchers live on the *items*
  // table). We fetch a Set of request ids that have at least one item with
  // a non-null voucher_id and consult it in the client-side filter.
  const [requestsWithVoucher, setRequestsWithVoucher] = useState<Set<string>>(new Set());

  // Invoice ↔ Settlement dependency model: map of request_id → invoice link
  // (factor id + invoice number). Populated after each list load and
  // consumed by the card render to show the "وابسته به فاکتور <number>"
  // badge. Requests with no entry here are independent (legacy behaviour
  // unchanged).
  const [invoiceLinks, setInvoiceLinks] = useState<Map<string, { factorId: string; invoiceNumber: string | null }>>(new Map());

  // Auto-open a specific request when arriving via the summary card on the
  // invoice detail. We read `finance.openPaymentRequestId` written by
  // InvoiceSettlementSummaryCard.goToRequest. The effect re-runs whenever
  // the request list updates, so the consumer doesn't fire until the row
  // is actually loaded.
  const [pendingOpenId, setPendingOpenId] = useState<string | null>(null);
  useEffect(() => {
    try {
      const id = sessionStorage.getItem("finance.openPaymentRequestId");
      if (id) {
        sessionStorage.removeItem("finance.openPaymentRequestId");
        setPendingOpenId(id);
      }
    } catch { /* sessionStorage unavailable — no-op */ }
  }, []);

  // Consume pendingOpenId whenever the requests list updates. Covers the
  // case where the list loads before the pendingOpenId effect runs and
  // vice versa, without any timing assumptions.
  useEffect(() => {
    if (!pendingOpenId) return;
    const hit = requests.find((r) => r.id === pendingOpenId);
    if (hit) {
      setDetail(hit);
      setPendingOpenId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requests, pendingOpenId]);

  // Phase 7 hand-off: when the invoice page navigates here with a stashed
  // settlement draft (sessionStorage), and when the URL hash is the one we
  // route to (#payment-requests), auto-open PRDialog so the operator lands
  // straight on the editor. We DO NOT consume the storage here — PRDialog
  // is the consumer; we only peek.
  const [seedDraft, setSeedDraft] = useState<SettlementDraft | null>(null);
  useEffect(() => {
    try {
      // UAT Bug 3 guard — if we're arriving here to VIEW a specific
      // existing request (deep-link from invoice detail set
      // `finance.openPaymentRequestId`), do NOT consume any pre-existing
      // settlement draft. The draft key belongs to the "new request from
      // invoice" creation flow and a stale value would otherwise pop the
      // new-request dialog on top of the detail view.
      if (sessionStorage.getItem("finance.openPaymentRequestId")) return;
      const raw = sessionStorage.getItem("finance:pr_seed_draft_v1");
      if (!raw) return;
      // Peek (don't remove) — PRDialog calls consumeSettlementDraft() to
      // both read and clear the storage atomically when it mounts.
      setSeedDraft(JSON.parse(raw) as SettlementDraft);
      setOpen(true);
    } catch {
      // Ignore — operator can still open the dialog manually.
    }
  }, []);

  // Refetch whenever any SERVER-side filter changes. paymentFilter is now
  // server-side too (it maps to numeric column predicates), so it joins the
  // dependency list. Local-only filters (search, voucher presence) stay out.
  useEffect(() => { void load(); }, [typeFilter, statusFilter, paymentFilter, dateFrom, dateTo, requesterFilter]);

  async function load() {
    let q = supabase
      .from("finance_payment_requests")
      .select("*")
      .eq("is_deleted", false)
      .order("created_at", { ascending: false })
      // The legacy import contains ~1546 rows; the PostgREST default cap is
      // 1000. We explicitly request a wider range so the client can see and
      // filter every record. Pagination upgrade can layer on top later.
      .range(0, 4999);
    if (typeFilter) q = q.eq("legacy_request_type_code", Number(typeFilter));
    if (statusFilter) q = q.eq("status", statusFilter);

    // -------- Server-side payment-completion predicate ------------------
    // After the lifecycle refactor we filter on the dedicated
    // `payment_status` column. The DB trigger keeps it accurate, so this
    // is a single-column equality check — much simpler and faster than the
    // old numeric-derived predicates.
    if (paymentFilter) {
      q = q.eq("payment_status", paymentFilter);
    }

    // -------- Date range filter (based on created_at) -------------------
    // Convert Jalali range to Gregorian timestamp boundaries anchored in
    // Tehran timezone so Postgres timestamptz comparisons are correct.
    if (dateFrom || dateTo) {
      const { from, to } = jalaliRangeToGregorianRange(dateFrom, dateTo);
      if (from) q = q.gte("created_at", from);
      if (to) q = q.lte("created_at", to);
    }

    // -------- Requester filter (based on requested_by) ------------------
    if (requesterFilter) {
      q = q.eq("requested_by", requesterFilter);
    }

    const { data } = await q;
    const rows = (data as PR[]) || [];
    setRequests(rows);
    // Compute voucher presence in a single follow-up query — much cheaper
    // than a join because finance_payment_request_items is narrow.
    if (rows.length > 0) {
      const ids = rows.map((r) => r.id);
      const { data: items } = await supabase
        .from("finance_payment_request_items")
        .select("payment_request_id")
        .in("payment_request_id", ids)
        .not("voucher_id", "is", null);
      setRequestsWithVoucher(new Set((items || []).map((i: { payment_request_id: string }) => i.payment_request_id)));

      // Invoice ↔ Settlement dependency model: resolve invoice numbers for
      // every invoice-owned request in the page so we can render the
      // "وابسته به فاکتور" badge. Requests with source_factor_id NULL are
      // legacy/independent and stay un-badged.
      const factorIds = Array.from(
        new Set(rows.map((r) => r.source_factor_id).filter(Boolean) as string[]),
      );
      if (factorIds.length > 0) {
        const { data: facs } = await supabase
          .from("factors")
          .select("id,invoice_number")
          .in("id", factorIds);
        const facMap = new Map<string, string | null>(
          (facs || []).map((f) => [f.id as string, (f.invoice_number ?? null) as string | null]),
        );
        const linkMap = new Map<string, { factorId: string; invoiceNumber: string | null }>();
        for (const r of rows) {
          if (!r.source_factor_id) continue;
          linkMap.set(r.id, {
            factorId: r.source_factor_id,
            invoiceNumber: facMap.get(r.source_factor_id) ?? null,
          });
        }
        setInvoiceLinks(linkMap);
      } else {
        setInvoiceLinks(new Map());
      }
    } else {
      setRequestsWithVoucher(new Set());
      setInvoiceLinks(new Map());
    }

    // Consume any pending auto-open id queued by the invoice summary card.
    // Done here (rather than in a separate effect) so we can hand the row
    // directly to PRDetail without an extra render pass.
    if (pendingOpenId) {
      const hit = rows.find((r) => r.id === pendingOpenId);
      if (hit) {
        setDetail(hit);
        setPendingOpenId(null);
      }
    }
  }

  // Local-only filters: text search and voucher presence. Payment status
  // is already filtered server-side and stored as a stable column, so we
  // don't need to mirror that predicate in JS anymore.
  const filtered = useMemo(() => {
    const needle = searchTerm.toLowerCase();
    return requests.filter((r) => {
      if (needle) {
        const hay = [
          r.title || "",
          r.description || "",
          r.id,
          r.legacy_id != null ? String(r.legacy_id) : "",
        ].join(" ").toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      if (voucherFilter === "with" && !requestsWithVoucher.has(r.id)) return false;
      if (voucherFilter === "without" && requestsWithVoucher.has(r.id)) return false;
      return true;
    });
  }, [requests, searchTerm, voucherFilter, requestsWithVoucher]);

  // Reset every filter back to its default (empty / unselected) state so the
  // operator can start fresh with a single click.
  function clearFilters() {
    setSearchInput("");
    setSearchTerm("");
    setTypeFilter("");
    setStatusFilter("");
    setPaymentFilter("");
    setVoucherFilter("");
    setDateFrom("");
    setDateTo("");
    setRequesterFilter("");
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-2">
        {/*
          Phase 2 rename: the module is now framed as «درخواست تسویه».
          A single درخواست تسویه is a PARENT container that can hold multiple
          executable settlement items (bank transfer, check, cashbox, …).
          The underlying tables/routes are unchanged in this phase.
        */}
        <div>
          <h2 className="text-lg font-bold">درخواست‌های تسویه</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            هر درخواست می‌تواند شامل چندین آیتم اجرایی (انتقال بانکی، چک، صندوق و …) باشد.
          </p>
        </div>
        <Button onClick={() => setOpen(true)}><Plus className="w-4 h-4 ml-1" /> درخواست تسویه جدید</Button>
      </div>


      {/* Filter toolbar — search + type + status + voucher + payment + date range + requester.
          All filters compose: server-side ones refetch, client-side ones
          narrow the in-memory list. */}
      <div className="space-y-2">
        {/* Row 1: existing filters */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
          <Input
            placeholder="جستجو در کد / عنوان / توضیحات…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="h-10 rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="">همه موارد</option>
            {PAYMENT_REQUEST_TYPES.map((t) => (
              <option key={t.code} value={t.code}>{t.code} - {t.label}</option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-10 rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="">همه وضعیت‌ها</option>
            {/* Use a controlled subset of statuses — only the ones the
                business asked us to expose as filters. */}
            {["pending_approval", "approved", "rejected", "cancelled", "paid", "partially_paid"].map((s) => (
              <option key={s} value={s}>{PAYMENT_REQUEST_STATUS_LABEL[s] || s}</option>
            ))}
          </select>
          <select
            value={voucherFilter}
            onChange={(e) => setVoucherFilter(e.target.value)}
            className="h-10 rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="">سند: همه</option>
            <option value="with">دارای سند</option>
            <option value="without">بدون سند</option>
          </select>
          <select
            value={paymentFilter}
            onChange={(e) => setPaymentFilter(e.target.value)}
            className="h-10 rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="">پرداخت: همه</option>
            {/* Four mutually-exclusive buckets, definitions matching the
                numeric predicates in `load()` and the mirror in `filtered`. */}
            {/* Three buckets stored on `payment_status` column directly. */}
            <option value="unpaid">پرداخت نشده</option>
            <option value="partial_payment">پرداخت ناقص</option>
            <option value="full_payment">پرداخت کامل</option>
          </select>
        </div>

        {/* Row 2: date range + requester + clear */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 items-end">
          <ShamsiDatePicker
            value={dateFrom}
            onChange={setDateFrom}
            placeholder="تاریخ درخواست (از)"
          />
          <ShamsiDatePicker
            value={dateTo}
            onChange={setDateTo}
            placeholder="تاریخ درخواست (تا)"
          />
          <SearchableSelect
            options={[
              { value: "", label: "همه درخواست‌دهنده‌ها" },
              ...users.map((u) => ({
                value: u.id,
                label: u.full_name || u.username,
              })),
            ]}
            value={requesterFilter}
            onChange={setRequesterFilter}
            placeholder="درخواست‌دهنده"
          />
          <Button
            variant="outline"
            onClick={clearFilters}
            className="h-10"
          >
            <X className="w-4 h-4 ml-1" />
            پاک کردن فیلترها
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {filtered.map((r) => {
          // Approved payable amount = confirmed_amount, which the DB trigger
          // keeps as the SUM of approved items only (rejected items excluded).
          // We deliberately do NOT fall back to total_amount, otherwise
          // rejected-item value would look payable.
          const requestedAmt = Number(r.total_amount || 0);
          const approvedAmt = Number(r.confirmed_amount || 0);
          const paidAmt = Number(r.total_paid_amount || 0);
          const remainingAmt = Math.max(0, approvedAmt - paidAmt);
          return (
            <button key={r.id} onClick={() => setDetail(r)} className="text-right rounded-xl border bg-card p-4 hover:border-primary/30 hover:shadow-md transition-all">
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-bold truncate flex-1">{r.title || "—"}</h3>
                {/* Two distinct badges: request status (approval lifecycle)
                    and payment status (money flow). Never combined. */}
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <FinanceStatusBadge status={r.status} />
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-foreground/80 border">
                    {PAYMENT_STATUS_LABEL[r.payment_status || "unpaid"] || "—"}
                  </span>
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">
                {getPaymentRequestTypeLabel(r.legacy_request_type_code)}
                {r.legacy_id != null && <span className="font-mono mr-2">#{r.legacy_id}</span>}
              </p>
              {/* Invoice ↔ Settlement dependency model: surface the
                  authoritative invoice link so the operator instantly sees
                  that this request is OWNED by an invoice and must be
                  edited through the invoice (Rules 2 & 4). Requests with
                  no link render no badge — independent behaviour preserved. */}
              {invoiceLinks.has(r.id) && (
                <div className="mt-1">
                  <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/30">
                    وابسته به فاکتور {invoiceLinks.get(r.id)?.invoiceNumber || "—"}
                  </span>
                </div>
              )}
              {r.description && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{r.description}</p>}
              {/* Amounts row: requested / approved-payable / paid / remaining.
                  Requested = original total. Approved = sum of approved items
                  only (rejected items excluded). */}
              <div className="mt-3 pt-3 border-t grid grid-cols-2 gap-y-2 gap-x-2 text-[11px]">
                <div className="flex flex-col">
                  <span className="text-muted-foreground">مبلغ کل درخواستی</span>
                  <MoneyCell value={requestedAmt} className="text-[11px]" />
                </div>
                <div className="flex flex-col">
                  <span className="text-muted-foreground">تأیید شده قابل پرداخت</span>
                  <MoneyCell value={approvedAmt} className="text-[11px]" />
                </div>
                <div className="flex flex-col">
                  <span className="text-muted-foreground">پرداخت‌شده</span>
                  <MoneyCell value={paidAmt} className="text-[11px]" />
                </div>
                <div className="flex flex-col">
                  <span className="text-muted-foreground">مانده</span>
                  <MoneyCell value={remainingAmt} className="text-[11px]" />
                </div>
              </div>
              <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
                <JalaliDateCell value={r.created_at} />
              </div>
            </button>
          );
        })}

        {filtered.length === 0 && (
          <div className="col-span-full rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
            درخواستی یافت نشد
          </div>
        )}
      </div>

      {open && (
        <PRDialog
          seedDraft={seedDraft}
          onClose={() => { setOpen(false); setSeedDraft(null); }}
          onDone={() => { setOpen(false); setSeedDraft(null); void load(); }}
        />
      )}
      {detail && <PRDetail pr={detail} onClose={() => { setDetail(null); void load(); }} />}
    </div>
  );
}

function PRDialog({
  onClose,
  onDone,
  // Phase 7: optional draft handed in by the invoice page. When present we
  // pre-populate title/description and seed `items` with one row per draft
  // item. Operator still picks payment_method / due_date / details per row.
  seedDraft = null,
}: {
  onClose: () => void;
  onDone: () => void;
  seedDraft?: SettlementDraft | null;
}) {
  const [typeCode, setTypeCode] = useState<number | "">("");
  const [title, setTitle] = useState(seedDraft?.title ?? "");
  const [description, setDescription] = useState(seedDraft?.description ?? "");
  // Phase 4 defaults — see original comment block. When a draft is provided,
  // we expand it into one PRItem per draft entry, copying party_id, amount
  // and description; everything else keeps the Phase-4 safe defaults so the
  // operator is forced to pick payment_method consciously.
  const [items, setItems] = useState<PRItem[]>(() => {
    // Drain the sessionStorage seed exactly once on mount so a refresh of
    // the dialog doesn't keep re-seeding stale data.
    const consumed = seedDraft ?? consumeSettlementDraft();
    if (consumed && consumed.items.length > 0) {
      return consumed.items.map((di) => ({
        party_id: di.party_id,
        amount: di.amount,
        amount_type_code: 1,
        amount_type: "creditor",
        description: di.description,
        payment_method: "",
        settlement_subject_type: "main_invoice",
        due_date: "",
        execution_priority: 3,
        details: {},
        // Phase 7B: preserve the source related-cost id so submit() can
        // forward it to the RPC. The seller row has no related_cost_id and
        // will simply stay null (no back-fill happens for it).
        source_related_cost_id: di.source?.related_cost_id ?? null,
      }));
    }
    return [
      {
        party_id: null,
        amount: 0,
        amount_type_code: 1,
        amount_type: "creditor",
        description: "",
        payment_method: "",
        settlement_subject_type: "main_invoice",
        due_date: "",
        execution_priority: 3,
        // Phase 5: start with empty details — the per-method sub-form is only
        // rendered after the user picks a payment_method, and patches this
        // object in place via `onChange`.
        details: {},
      },
    ];
  });

  const [partyBalances, setPartyBalances] = useState<Record<string, number>>({});
  const [partySepidarIds, setPartySepidarIds] = useState<Record<string, number | null>>({});
  const [sepidarBalances, setSepidarBalances] = useState<Record<string, { loading: boolean; balance: number | null; error: string | null }>>({});
  const [saving, setSaving] = useState(false);

  const total = items.reduce((s, i) => s + (i.amount || 0), 0);

  // Fetch local balance + sepidar_party_id for selected parties
  useEffect(() => {
    const ids = Array.from(new Set(items.map((i) => i.party_id).filter((x): x is string => !!x)));
    const missing = ids.filter((id) => !(id in partyBalances));
    if (!missing.length) return;
    void supabase.from("finance_parties").select("id,balance,sepidar_party_id").in("id", missing).then(({ data }) => {
      if (!data) return;
      setPartyBalances((prev) => {
        const next = { ...prev };
        for (const r of data as { id: string; balance: number | null }[]) next[r.id] = Number(r.balance || 0);
        return next;
      });
      setPartySepidarIds((prev) => {
        const next = { ...prev };
        for (const r of data as { id: string; sepidar_party_id: number | null }[]) next[r.id] = r.sepidar_party_id ?? null;
        return next;
      });
    });
  }, [items, partyBalances]);

  // Fetch Sepidar balance for creditor rows
  useEffect(() => {
    items.forEach((it) => {
      if (!it.party_id || !shouldEnforceSepidarBalance(it.amount_type_code)) return;
      const sepId = partySepidarIds[it.party_id];
      if (!sepId) return;
      const key = `${it.party_id}`;
      if (sepidarBalances[key]) return;
      setSepidarBalances((p) => ({ ...p, [key]: { loading: true, balance: null, error: null } }));
      getSepidarBeneficiaryBalance(sepId)
        .then((r) => setSepidarBalances((p) => ({ ...p, [key]: { loading: false, balance: Number(r.balance || 0), error: null } })))
        .catch((e: unknown) => {
          const msg = e instanceof Error ? e.message : "خطا در دریافت مانده سپیدار";
          setSepidarBalances((p) => ({ ...p, [key]: { loading: false, balance: null, error: msg } }));
        });
    });
  }, [items, partySepidarIds, sepidarBalances]);

  function updateItem(idx: number, patch: Partial<PRItem>) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  async function save() {
    // Guard against double-submit (rapid taps on mobile).
    if (saving) return;
    if (!typeCode) return toast.error("نوع درخواست را انتخاب کنید");
    if (!title) return toast.error("عنوان لیست را وارد کنید");
    // Hard guard: cannot create a request with zero items. Prevents the
    // orphan-parent bug where the request row was inserted but the items
    // insert silently failed or was skipped.
    if (!items.length) return toast.error("حداقل یک ردیف باید اضافه شود");
    // The new flow REQUIRES a Sepidar beneficiary on every row.
    if (items.some((i) => !i.beneficiary_id || !i.amount))
      return toast.error("ذینفع سپیدار و مبلغ هر آیتم الزامی است");
    // Hard guard: every item must carry a resolved local finance_parties UUID
    // (party_id). Without it the RPC inserts NULL and downstream voucher /
    // Sepidar posting breaks. This usually means the picked Sepidar beneficiary
    // has no matching local party row yet (sync pending).
    const missingPartyIdx = items.findIndex((i) => !i.party_id);
    if (missingPartyIdx >= 0)
      return toast.error(
        `ردیف ${missingPartyIdx + 1}: طرف‌حساب محلی برای ذینفع سپیدار پیدا نشد. ابتدا همگام‌سازی کنید.`,
      );
    if (items.some((i) => !i.amount_type_code)) return toast.error("نوع مبلغ هر آیتم الزامی است");

    // Phase 4 hard guards: every NEW item MUST explicitly declare its
    // payment_method, settlement_subject_type, and due_date. We never let
    // the dialog silently fall back to a default for these because that
    // would defeat the whole point of separating new items from legacy
    // rows. The dialog only ever creates NEW items (never updates legacy
    // ones), so these checks are safe to enforce unconditionally.
    const missingMethod = items.findIndex((i) => !i.payment_method);
    if (missingMethod >= 0) return toast.error(`ردیف ${missingMethod + 1}: روش پرداخت را انتخاب کنید.`);
    const missingSubject = items.findIndex((i) => !i.settlement_subject_type);
    if (missingSubject >= 0) return toast.error(`ردیف ${missingSubject + 1}: موضوع تسویه را انتخاب کنید.`);
    const missingDue = items.findIndex((i) => !i.due_date);
    if (missingDue >= 0) return toast.error(`ردیف ${missingDue + 1}: تاریخ سررسید الزامی است.`);

    // Phase 5: per-method details validation. Each method has its own list of
    // required fields (defined centrally in `validateDetails`). We surface
    // the first failure with a row-number prefix so the user can locate it.
    for (let i = 0; i < items.length; i++) {
      const err = validateDetails(items[i].payment_method as string, items[i].details);
      if (err) return toast.error(`ردیف ${i + 1}: ${err}`);
    }



    // Validate creditor balance for amount_type_code = 1 using the snapshot
    // captured at selection time.
    for (let idx = 0; idx < items.length; idx++) {
      const it = items[idx];
      if (it.amount_type_code === 1) {
        const snap = it.beneficiary_balance_snapshot;
        if (snap != null) {
          const sepAvail = Math.abs(Number(snap));
          if (sepAvail + 1e-6 < it.amount)
            return toast.error(`ردیف ${idx + 1}: مبلغ درخواست از مانده بستانکاری ذینفع در سپیدار بیشتر است.`);
        }
      }
    }

    setSaving(true);
    try {
      const code = Number(typeCode);
      const typeKey = getPaymentRequestTypeKey(code);

      // Build JSONB payloads for the atomic RPC. The RPC inserts the parent
      // row AND the item rows in a single transaction — if items fail, the
      // parent is rolled back. This replaces the previous two-step client
      // insert pattern that could leave orphan requests with zero items
      // whenever the second `insert` raised silently (the original code
      // never captured the error from the items insert at all).
      const requestPayload = {
        title,
        description,
        request_type: typeKey,
        legacy_request_type_code: code,
        status: "pending_approval",
      };
      // Only fields that actually exist on finance_payment_request_items.
      // Beneficiary/snapshot columns don't exist in the table yet, so we
      // omit them from the RPC payload to avoid 42703 errors. The server
      // RPC sets paid_amount=0 and remaining_amount=amount on insert.
      // Phase 4: include the new lifecycle columns so the RPC can write them
      // on INSERT. execution_status is hard-coded to 'pending' for every
      // new item (executors flip it later). execution_priority defaults to
      // 3 (عادی) but the user can override per-row before saving.
      const itemsPayload = items.map((i) => ({
        party_id: i.party_id,
        amount: i.amount,
        amount_type_code: i.amount_type_code,
        amount_type: i.amount_type,
        description: i.description,
        status: "pending_approval",
        payment_method: i.payment_method,
        settlement_subject_type: i.settlement_subject_type,
        // due_date is collected as a Jalali "YYYY/MM/DD" string from the
        // Shamsi picker; the DB column is Gregorian `date`. We convert at
        // payload-build time so the wire format matches the column type.
        due_date: jalaliToGregorianDate(i.due_date || "") || "",

        execution_status: "pending",
        execution_priority: i.execution_priority ?? 3,
        // Phase 5: method-specific payload. Always send an object — never
        // null — so the RPC's COALESCE keeps the column non-null.
        details: i.details ?? {},
        // Phase 7B: forward the related-cost row id (if this item was seeded
        // from one) so the RPC can persist it on the new item AND back-fill
        // factor_related_costs.settlement_request_item_id in the same
        // transaction. Seller rows / manually-added rows send null.
        source_related_cost_id: i.source_related_cost_id ?? null,

      }));


      // Temporary logging to make payload inspection trivial in DevTools.
      // eslint-disable-next-line no-console
      console.log("[payment-request] submit", { requestPayload, items: itemsPayload });

      // Cast through `never` because the generated types don't yet include
      // this RPC; types will be regenerated on next sync.
      const { data: newId, error } = await supabase.rpc(
        "submit_payment_request" as never,
        { p_request: requestPayload, p_items: itemsPayload } as never,
      );
      if (error) throw error;
      if (!newId) throw new Error("ثبت درخواست ناموفق بود");

      toast.success("درخواست ثبت شد");
      onDone();
    } catch (e: unknown) {
      toastFinanceError(toast, e);
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-card rounded-t-2xl sm:rounded-2xl border shadow-lg w-full max-w-2xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b flex items-center justify-between sticky top-0 bg-card">
          <h3 className="font-bold">درخواست تسویه جدید</h3>
          <Button size="sm" variant="ghost" onClick={onClose}><X className="w-4 h-4" /></Button>
        </div>
        <div className="p-4 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label className="text-xs">نوع درخواست <span className="text-destructive">*</span></Label>
              <select
                value={typeCode === "" ? "" : String(typeCode)}
                onChange={(e) => setTypeCode(e.target.value ? Number(e.target.value) : "")}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">انتخاب کنید…</option>
                {PAYMENT_REQUEST_TYPES.map((t) => (
                  <option key={t.code} value={t.code}>{t.code} - {t.label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">عنوان لیست</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">توضیحات</Label>
            <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>

          <div className="rounded-lg border">
            <div className="p-2 border-b bg-muted/40 flex justify-between items-center">
              <span className="font-bold text-sm">آیتم‌ها</span>
              <Button size="sm" variant="ghost" onClick={() => setItems([...items, { party_id: null, amount: 0, amount_type_code: 1, amount_type: "creditor", description: "", payment_method: "", settlement_subject_type: "main_invoice", due_date: "", execution_priority: 3, details: {} }])}>
                <Plus className="w-3 h-3 ml-1" /> افزودن
              </Button>
            </div>
            <div className="p-2 space-y-2">
              {items.map((it, idx) => {
                const bal = it.party_id ? partyBalances[it.party_id] : undefined;
                const available = bal !== undefined && bal <= 0 ? Math.abs(bal) : 0;
                const isCreditor = it.amount_type_code === 1;
                const shortage = isCreditor && it.amount > 0 && it.party_id && bal !== undefined && available + 1e-6 < it.amount;
                return (
                  <div key={idx} className="rounded-lg border p-2 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">ردیف {idx + 1}</span>
                      {items.length > 1 && (
                        <Button size="icon" variant="ghost" onClick={() => setItems(items.filter((_, i) => i !== idx))}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                    {/* Local-party beneficiary picker. Searches finance_parties
                        directly (matches «شناسایی دریافت») across name,
                        company, sepidar_full_name, national code, mobile and
                        sepidar_dl_code. The selected row provides the local
                        finance_parties UUID AND the snapshotted Sepidar
                        identifiers needed by the voucher generator, so we
                        don't need a second round-trip to resolve party_id. */}
                    <LocalPartyBeneficiarySelector
                      value={it.party_id ?? null}
                      fallbackLabel={it.beneficiary_name}
                      onChange={(partyId, b?: LocalPartyBeneficiary) => {
                        if (!partyId || !b) {
                          // Clearing the selection wipes every snapshotted
                          // field so stale data from a previous pick can't
                          // leak into the RPC payload.
                          updateItem(idx, {
                            party_id: null,
                            beneficiary_id: null,
                            dl_ref: null,
                            dl_code: null,
                            beneficiary_name: null,
                            beneficiary_type: null,
                            beneficiary_balance_snapshot: null,
                          });
                          return;
                        }
                        // Snapshot ALL fields in one shot — party_id is the
                        // local UUID, beneficiary_id/dl_ref/dl_code come from
                        // the local Sepidar mirror columns so they stay
                        // consistent with the party row used by every other
                        // finance flow (شناسایی دریافت included).
                        updateItem(idx, {
                          party_id: partyId,
                          beneficiary_id: b.beneficiary_id != null ? String(b.beneficiary_id) : null,
                          dl_ref: b.dl_ref,
                          dl_code: b.dl_code,
                          beneficiary_name: b.beneficiary_name,
                          beneficiary_type: b.beneficiary_type,
                          beneficiary_balance_snapshot: b.balance,
                        });
                      }}
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-[11px] text-muted-foreground">نوع مبلغ</Label>
                        <select
                          value={String(it.amount_type_code)}
                          onChange={(e) => {
                            const code = Number(e.target.value);
                            updateItem(idx, { amount_type_code: code, amount_type: getPaymentAmountTypeKey(code) || "creditor" });
                          }}
                          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                        >
                          {PAYMENT_AMOUNT_TYPES.map((t) => (
                            <option key={t.code} value={t.code}>{t.code} - {t.label}</option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[11px] text-muted-foreground">مبلغ</Label>
                        <Input dir="ltr" inputMode="numeric" placeholder="مبلغ" value={it.amount || ""}
                          onChange={(e) => updateItem(idx, { amount: parseMoney(e.target.value) })} />
                      </div>
                    </div>
                    {/* Sepidar snapshot balance summary — uses the value captured
                        when the user picked the beneficiary, not a live query. */}
                    {it.beneficiary_id && it.beneficiary_balance_snapshot != null && (() => {
                      const snap = Number(it.beneficiary_balance_snapshot);
                      const sepAvail = Math.abs(snap);
                      const exceeds = isCreditor && it.amount > 0 && sepAvail + 1e-6 < it.amount;
                      return (
                        <>
                          <div className="grid grid-cols-2 gap-2 text-[11px]">
                            <div className="rounded bg-muted/40 px-2 py-1 flex justify-between">
                              <span className="text-muted-foreground">مانده سپیدار (لحظه انتخاب)</span>
                              <MoneyCell value={snap} className="text-[11px]" />
                            </div>
                            <div className="rounded bg-muted/40 px-2 py-1 flex justify-between">
                              <span className="text-muted-foreground">مبلغ مجاز قابل پرداخت</span>
                              <MoneyCell value={isCreditor ? sepAvail : it.amount || 0} className="text-[11px]" />
                            </div>
                          </div>
                          {!isCreditor && (
                            <div className="text-[11px] text-muted-foreground bg-muted/30 rounded px-2 py-1">
                              برای این نوع پرداخت، کنترل مانده سپیدار الزامی نیست.
                            </div>
                          )}
                          {exceeds && (
                            <div className="flex items-center gap-1.5 text-[11px] text-red-700 bg-red-50 rounded px-2 py-1">
                              <AlertTriangle className="w-3.5 h-3.5" />
                              مبلغ درخواست از مانده بستانکاری ذینفع در سپیدار بیشتر است.
                            </div>
                          )}
                        </>
                      );
                    })()}
                    {/* ----- Phase 4 item-level lifecycle selectors -----
                        Every NEW item is required to declare its payment
                        method, what it is settling, when it must be paid,
                        and (optionally) an execution priority. The
                        execution_status is implicit ('pending') and not
                        exposed in this dialog because new items always
                        start as pending — the executor flips it later. We
                        keep the markup compact (two 2-col grids) so the
                        mobile sheet stays usable. */}
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-[11px] text-muted-foreground">
                          روش پرداخت <span className="text-destructive">*</span>
                        </Label>
                        <select
                          value={it.payment_method || ""}
                          onChange={(e) => {
                            // Switching method invalidates any partially
                            // filled details from the previous method, so we
                            // reset details to {} to avoid sending mixed
                            // payloads (e.g. a check `payee_name` saved on a
                            // bank_transfer row).
                            updateItem(idx, { payment_method: e.target.value as PaymentMethod, details: {} });
                          }}

                          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                        >
                          <option value="">انتخاب کنید…</option>
                          {/* `legacy` is intentionally HIDDEN from the new-item
                              picker — it must never be chosen for a brand-new
                              item; it only labels rows imported before Phase 3. */}
                          {PAYMENT_METHODS.filter((m) => m !== "legacy").map((m) => (
                            <option key={m} value={m}>{PAYMENT_METHOD_LABELS_FA[m]}</option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[11px] text-muted-foreground">
                          موضوع تسویه <span className="text-destructive">*</span>
                        </Label>
                        <select
                          value={it.settlement_subject_type || ""}
                          onChange={(e) => updateItem(idx, { settlement_subject_type: e.target.value as SettlementSubjectType })}
                          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                        >
                          {SETTLEMENT_SUBJECT_TYPES.map((s) => (
                            <option key={s} value={s}>{SETTLEMENT_SUBJECT_LABELS_FA[s]}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-[11px] text-muted-foreground">
                          تاریخ سررسید <span className="text-destructive">*</span>
                        </Label>
                        {/* Reuse the project-wide Jalali date picker so the
                            user picks a Persian date; its onChange returns an
                            ISO yyyy-mm-dd Gregorian string ready for the
                            `date` column. */}
                        <ShamsiDatePicker
                          value={it.due_date || ""}
                          onChange={(v) => updateItem(idx, { due_date: v })}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[11px] text-muted-foreground">اولویت اجرا</Label>
                        <select
                          value={String(it.execution_priority ?? 3)}
                          onChange={(e) => updateItem(idx, { execution_priority: Number(e.target.value) as ExecutionPriority })}
                          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                        >
                          {EXECUTION_PRIORITIES.map((p) => (
                            <option key={p} value={p}>{EXECUTION_PRIORITY_LABELS_FA[p]}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    {/* Phase 5 method-specific sub-form. Conditional render
                        is handled INSIDE the component — passing an empty
                        method simply yields null, so the row stays compact
                        until the user picks a method. */}
                    {it.payment_method && (
                      <SettlementItemDetailsForm
                        paymentMethod={it.payment_method as string}
                        value={it.details || {}}
                        onChange={(next) => updateItem(idx, { details: next })}
                        // Phase 6B: scope verified-account lookup to the row's party.
                        partyId={it.party_id}
                      />
                    )}
                    <Input placeholder="توضیحات" value={it.description}
                      onChange={(e) => updateItem(idx, { description: e.target.value })} />


                  </div>
                );
              })}
            </div>
            <div className="p-2 border-t flex justify-between items-center bg-muted/30">
              <span className="text-xs text-muted-foreground">جمع کل</span>
              <MoneyCell value={total} />
            </div>
          </div>
        </div>
        <div className="p-4 border-t flex justify-end gap-2 sticky bottom-0 bg-card">
          <Button variant="outline" onClick={onClose}>انصراف</Button>
          <Button onClick={save} disabled={saving}>ذخیره پیش‌نویس</Button>
        </div>
      </div>
    </div>
  );
}

interface PRItemFull {
  id: string;
  party_id: string | null;
  amount: number;
  // Approved-payable amount kept in sync by the DB trigger. When > 0 it
  // overrides `amount` for the purpose of computing the remaining payable.
  confirmed_amount: number | null;
  paid_amount: number | null;
  remaining_amount: number | null;
  amount_type_code: number;
  amount_type: string;
  description: string | null;
  status: string | null;
  party?: PartyLite & { id?: string };
  // Phase 4 read-only metadata. These columns exist on every row (legacy
  // rows carry payment_method='legacy' and NULLs for the others); the
  // detail view renders them as a small annotation strip per item.
  payment_method?: string | null;
  settlement_subject_type?: string | null;
  due_date?: string | null;
  execution_status?: string | null;
  execution_priority?: number | null;
  // Phase 5: method-specific jsonb. Supabase returns Json | null; we accept
  // unknown and let the summarizer narrow safely.
  details?: unknown;
  // Phase 8: execution lifecycle metadata. These are optional because legacy
  // rows carry NULLs; the execution panel only renders for non-legacy rows.
  executed_at?: string | null;
  executed_by?: string | null;
  closure_reason?: string | null;
  on_hold_reason?: string | null;
  execution_note?: string | null;

}


interface AllocationRow {
  id: string;
  payment_request_item_id: string;
  bank_transaction_id: string;
  bank_id: string | null;
  amount: number;
  status: string;
  sepidar_sync_status: string;
  sepidar_error_message: string | null;
  allocation_datetime: string;
  bank?: { title: string | null; bank_name: string | null } | null;
  bank_transaction?: { transaction_jalali_date: string | null; document_number: string | null; description: string | null } | null;
}

function PRDetail({ pr, onClose }: { pr: PR; onClose: () => void }) {
  const [items, setItems] = useState<PRItemFull[]>([]);
  const [allocations, setAllocations] = useState<AllocationRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [allocItem, setAllocItem] = useState<PRItemFull | null>(null);
  // Item targeted by the "Edit amount" dialog. Separate from `allocItem` so
  // the two dialogs can never collide and the row keeps its individual state.
  const [editAmountItem, setEditAmountItem] = useState<PRItemFull | null>(null);
  const [headerRefresh, setHeaderRefresh] = useState<PR>(pr);

  async function reload() {
    const [itemsRes, allocRes, headerRes] = await Promise.all([
      supabase
        .from("finance_payment_request_items")
        .select("*, party:finance_parties(ownership_type,first_name,last_name,company_name,balance)")
        .eq("payment_request_id", pr.id),
      supabase
        .from("finance_payment_allocations")
        .select("*, bank:finance_banks(title,bank_name), bank_transaction:finance_bank_transactions(transaction_jalali_date,document_number,description)")
        .eq("payment_request_id", pr.id)
        .eq("is_deleted", false)
        .order("allocation_datetime", { ascending: false }),
      supabase.from("finance_payment_requests").select("*").eq("id", pr.id).maybeSingle(),
    ]);
    setItems((itemsRes.data as never[]) || []);
    setAllocations((allocRes.data as never[]) || []);
    if (headerRes.data) setHeaderRefresh(headerRes.data as PR);
  }
  useEffect(() => { void reload(); }, [pr.id]);

  function validateForApproval(): string | null {
    for (let idx = 0; idx < items.length; idx++) {
      const it = items[idx];
      if (it.amount_type_code === 1) {
        const v = validateCreditorBalance(it.party?.balance, Number(it.amount));
        if (!v.ok) return `ردیف ${idx + 1}: ${v.message}`;
      }
    }
    return null;
  }

  async function approve() {
    const err = validateForApproval();
    if (err) return toast.error(err);
    setBusy(true);
    try {
      await approvePaymentRequest(pr.id);
      toast.success("درخواست تایید شد");
      await reload();
    } catch (e: unknown) {
      // Invoice ↔ Settlement dependency model: the DB trigger
      // `guard_invoice_owned_settlement_approval` blocks approval when the
      // linked invoice is not yet approved. We translate that low-level
      // error code into a Persian, actionable message instead of dumping
      // raw SQL state onto the operator.
      const raw = e instanceof Error ? e.message : String(e);
      if (raw.includes("INVOICE_NOT_APPROVED")) {
        toast.error("ابتدا باید فاکتور مرتبط با این درخواست تأیید شود.");
      } else {
        toastFinanceError(toast, e);
      }
    } finally { setBusy(false); }
  }
  async function reject() {
    setBusy(true);
    await supabase.from("finance_payment_requests").update({ status: "rejected" }).eq("id", pr.id);
    toast.success("رد شد");
    setBusy(false);
    onClose();
  }

  // ---------------------------------------------------------------------
  // Header amounts. The DB trigger keeps `confirmed_amount` equal to the
  // SUM of APPROVED items only — rejected items are excluded. So we use
  // it directly with NO fallback to total_amount, otherwise the rejected
  // value would inflate the approved/payable figure shown to the user.
  // ---------------------------------------------------------------------
  const headerRequested = Number(headerRefresh.total_amount || 0);
  const headerApproved = Number(headerRefresh.confirmed_amount || 0);
  const headerPaid = Number(headerRefresh.total_paid_amount || 0);
  const headerRemaining = Math.max(0, headerApproved - headerPaid);
  const headerStatus = headerRefresh.status;
  const headerPaymentStatus = headerRefresh.payment_status || "unpaid";
  // Linking is allowed when: request is approved (or partially_paid) AND
  // there are approved payable items AND payment is not yet fully complete
  // AND there is remaining amount. Mirrors the BEFORE-INSERT DB trigger.
  const canLinkOnRequest =
    (headerStatus === "approved" || headerStatus === "partially_paid") &&
    headerApproved > 0 &&
    headerPaymentStatus !== "full_payment" &&
    headerRemaining > 0;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex justify-end" onClick={onClose}>
      <div className="bg-card border-l shadow-lg w-full max-w-2xl h-full overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b flex items-center justify-between sticky top-0 bg-card z-10">
          <div>
            <h3 className="font-bold">{pr.title || "درخواست تسویه"}</h3>
            <p className="text-[11px] text-muted-foreground mt-0.5">{getPaymentRequestTypeLabel(pr.legacy_request_type_code)}</p>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              {/* Approval status badge */}
              <FinanceStatusBadge status={headerStatus} />
              {/* Payment-completion badge — separate concept, distinct chip */}
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-foreground/80 border">
                {PAYMENT_STATUS_LABEL[headerPaymentStatus] || "—"}
              </span>
              <JalaliDateCell value={pr.created_at} />
            </div>
          </div>
          <Button size="icon" variant="ghost" onClick={onClose}><X className="w-4 h-4" /></Button>
        </div>
        <div className="p-4 space-y-4">
          {pr.description && <p className="text-sm text-muted-foreground">{pr.description}</p>}

          {/* Header summary — requested / approved-payable / paid / remaining */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="rounded-lg border p-2">
              <div className="text-[11px] text-muted-foreground">مبلغ کل درخواستی</div>
              <MoneyCell value={headerRequested} className="text-sm" />
            </div>
            <div className="rounded-lg border p-2">
              <div className="text-[11px] text-muted-foreground">تأیید شده قابل پرداخت</div>
              <MoneyCell value={headerApproved} className="text-sm" />
            </div>
            <div className="rounded-lg border p-2">
              <div className="text-[11px] text-muted-foreground">پرداخت‌شده</div>
              <MoneyCell value={headerPaid} className="text-sm" positive />
            </div>
            <div className="rounded-lg border p-2">
              <div className="text-[11px] text-muted-foreground">باقی‌مانده</div>
              <MoneyCell value={headerRemaining} className="text-sm" negative={headerRemaining > 0} />
            </div>
          </div>

          {/* When the request is approved but no item is payable (all rejected),
              warn explicitly so the user understands why the link button is hidden. */}
          {headerStatus === "approved" && headerApproved <= 0 && (
            <div className="rounded-lg border border-red-300/60 bg-red-50 dark:bg-red-950/30 text-red-900 dark:text-red-200 p-3 text-xs">
              هیچ آیتم تأیید شده‌ای برای این درخواست وجود ندارد، بنابراین پرداختی قابل ثبت نیست.
            </div>
          )}


          {/* Status messages: approved-but-incomplete warning OR fully-paid confirmation. */}
          {headerStatus === "approved" && headerPaymentStatus !== "full_payment" && headerRemaining > 0 && (
            <div className="rounded-lg border border-amber-300/60 bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200 p-3 text-xs">
              این درخواست تأیید شده است اما پرداخت آن هنوز کامل نشده است.
            </div>
          )}
          {headerPaymentStatus === "full_payment" && (
            <div className="rounded-lg border border-emerald-300/60 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-900 dark:text-emerald-200 p-3 text-xs">
              پرداخت این درخواست کامل شده است.
            </div>
          )}



          {/* Phase 8: per-request progress summary. Pure component derived
              from the already-loaded items list — no extra fetch. Shows
              count chips per execution-status bucket plus the three monetary
              KPIs (total commitment / executed / remaining). */}
          <SettlementRequestProgressSummary items={items} />

          {/* Items table */}
          <div className="rounded-xl border divide-y">
            {items.map((i, idx) => {
              const amt = Number(i.amount || 0);
              const paid = Number(i.paid_amount || 0);
              const remaining = Math.max(0, amt - paid);
              const itemStatus = String(i.status || "");
              const isRejected = itemStatus === "rejected" || itemStatus === "cancelled" || itemStatus === "deleted";
              // Payable amount per item = the item's own approved amount
              // (approved-family status). Rejected rows = 0 payable.
              const payableForItem = isRejected ? 0 : amt;
              // Item-level payment status — derived from approved vs paid.
              const itemPayStatus: "unpaid" | "partial_payment" | "full_payment" =
                paid <= 0
                  ? "unpaid"
                  : amt > 0 && paid + 1e-6 >= amt
                    ? "full_payment"
                    : "partial_payment";
              // Link button mirrors the request-level rule AND requires
              // the item itself to be approved-family with remaining > 0.
              const terminalStatuses = ["paid", "cancelled", "rejected", "deleted"];
              const canAllocate =
                canLinkOnRequest &&
                remaining > 0 &&
                !terminalStatuses.includes(itemStatus);

              return (
                <div
                  key={i.id || idx}
                  className={
                    "p-3 space-y-2 " +
                    (isRejected ? "opacity-60 bg-red-50/40 dark:bg-red-950/10" : "")
                  }
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className={"font-bold text-sm truncate " + (isRejected ? "line-through" : "")}>
                        {i.party ? partyName(i.party) : "—"}
                      </p>
                      {i.description && <p className="text-xs text-muted-foreground truncate">{i.description}</p>}
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <FinanceStatusBadge status={i.status} />
                      {!isRejected && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-foreground/80 border">
                          {PAYMENT_STATUS_LABEL[
                            paid <= 0
                              ? "unpaid"
                              : amt > 0 && paid + 1e-6 >= amt
                                ? "full_payment"
                                : "partial_payment"
                          ]}
                        </span>
                      )}
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-800">
                        {getPaymentAmountTypeLabel(i.amount_type_code)}
                      </span>
                      {/* Phase 4 legacy badge — pre-Phase-3 items carry
                          payment_method='legacy' and must be visually
                          marked as read-only. The Persian wording is fixed
                          by spec: «قدیمی / فقط نمایش». */}
                      {isLegacyItem(i) && (
                        <span
                          className="text-[10px] px-1.5 py-0.5 rounded border border-amber-400/60 bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
                          title="این آیتم مربوط به ساختار قبلی است و فقط قابل مشاهده است."
                        >
                          قدیمی / فقط نمایش
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                    <div className="rounded bg-muted/40 px-2 py-1 flex justify-between">
                      <span className="text-muted-foreground">درخواستی</span>
                      <MoneyCell value={amt} className="text-[11px]" />
                    </div>
                    <div className="rounded bg-muted/40 px-2 py-1 flex justify-between">
                      <span className="text-muted-foreground">قابل پرداخت</span>
                      <MoneyCell value={payableForItem} className="text-[11px]" />
                    </div>
                    <div className="rounded bg-muted/40 px-2 py-1 flex justify-between">
                      <span className="text-muted-foreground">پرداخت‌شده</span>
                      <MoneyCell value={paid} className="text-[11px]" />
                    </div>
                    <div className="rounded bg-muted/40 px-2 py-1 flex justify-between">
                      <span className="text-muted-foreground">مانده</span>
                      <MoneyCell value={isRejected ? 0 : remaining} className="text-[11px]" />
                    </div>
                  </div>

                  {/* Phase 4 metadata strip — shows the new lifecycle fields
                      for NEW items. For legacy rows we render a single
                      explanatory line instead of fake/empty cells, so the
                      missing data isn't confusing. */}
                  {isLegacyItem(i) ? (
                    <div className="text-[11px] text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/30 border border-amber-300/40 rounded px-2 py-1">
                      این آیتم مربوط به ساختار قبلی است و برای جلوگیری از تغییر ناخواسته فقط قابل مشاهده است.
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                      <div className="rounded bg-muted/30 px-2 py-1 flex justify-between">
                        <span className="text-muted-foreground">روش پرداخت</span>
                        <span>{labelForPaymentMethod(i.payment_method)}</span>
                      </div>
                      <div className="rounded bg-muted/30 px-2 py-1 flex justify-between">
                        <span className="text-muted-foreground">موضوع</span>
                        <span>{labelForSubjectType(i.settlement_subject_type)}</span>
                      </div>
                      <div className="rounded bg-muted/30 px-2 py-1 flex justify-between">
                        <span className="text-muted-foreground">سررسید</span>
                        {/* Convert Gregorian DB date back to Jalali for display. */}
                        <span dir="ltr">{gregorianDateToJalali(i.due_date) || "—"}</span>
                      </div>
                      <div className="rounded bg-muted/30 px-2 py-1 flex justify-between">
                        <span className="text-muted-foreground">اولویت</span>
                        <span>{labelForExecutionPriority(i.execution_priority)}</span>
                      </div>
                    </div>
                  )}

                  {/* Phase 5 method-specific summary. Rendered only for
                      non-legacy items (legacy rows already show a separate
                      read-only banner above). The text is built by
                      `summarizeDetails` so the formatting stays consistent
                      with the new-request form. */}
                  {!isLegacyItem(i) && i.payment_method && (
                    <div className="rounded bg-muted/30 border border-dashed px-2 py-1 text-[11px] flex items-start gap-2">
                      <span className="text-muted-foreground shrink-0">جزئیات روش:</span>
                      <span className="break-words">{summarizeDetails(i.payment_method, i.details)}</span>
                    </div>
                  )}


                  {isRejected && (
                    <div className="text-[11px] text-red-700 dark:text-red-300">
                      این آیتم رد شده است و در محاسبات پرداخت لحاظ نمی‌شود.
                    </div>
                  )}

                  {canAllocate && (
                    <Button size="sm" variant="outline" className="w-full" onClick={() => setAllocItem(i)}>
                      <Link2 className="w-3.5 h-3.5 ml-1" /> اتصال تراکنش پرداخت
                    </Button>
                  )}

                  {/* "Edit amount" button — visible only for items where the
                      RPC will accept the call. Legacy rows are not editable
                      here because their status is typically out of the
                      whitelist; even if it slipped through, the RPC would
                      reject the change. */}
                  {!isLegacyItem(i) && canEditItemAmount(i.status, headerRefresh.status) && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="w-full border border-dashed"
                      onClick={() => setEditAmountItem(i)}
                    >
                      <Pencil className="w-3.5 h-3.5 ml-1" /> ویرایش مبلغ
                    </Button>
                  )}


                  {/* Phase 8: per-item execution panel. The panel itself
                      no-ops for legacy rows (renders a tiny "read-only"
                      banner) so we don't need to guard here. After any
                      successful action we call reload() so the progress
                      summary and status badges refresh. */}
                  <SettlementItemExecutionPanel
                    item={{
                      id: i.id,
                      party_id: i.party_id,
                      amount: Number(i.amount || 0),
                      payment_method: i.payment_method,
                      due_date: i.due_date,
                      description: i.description,
                      execution_status: i.execution_status,
                      // Task 1: forward `details` so the exec panel can seed
                      // the cheque dialog with payee name + national id.
                      details: (i.details as Record<string, unknown> | null | undefined) ?? null,
                    }}
                    onChanged={reload}
                  />
                </div>
              );
            })}

          </div>


          {/* Allocations list */}
          {allocations.length > 0 && (
            <div className="rounded-xl border">
              <div className="p-2 border-b bg-muted/40 text-sm font-bold">تخصیص‌های پرداخت</div>
              <div className="divide-y">
                {allocations.map((a) => (
                  <div key={a.id} className="p-3 space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs">
                        <span className="font-bold">{a.bank?.title || a.bank?.bank_name || "بانک"}</span>
                        <span className="text-muted-foreground"> — سند: {a.bank_transaction?.document_number || "—"}</span>
                      </div>
                      <FinanceStatusBadge status={a.status} />
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                      <span>{a.bank_transaction?.transaction_jalali_date || formatJalaliDateTime(a.allocation_datetime)}</span>
                      <MoneyCell value={a.amount} className="text-[11px]" />
                    </div>
                    {a.sepidar_error_message && (
                      <div className="text-[11px] text-red-700 bg-red-50 rounded px-2 py-1">{a.sepidar_error_message}</div>
                    )}
                    {a.status !== "synced" && a.status !== "cancelled" && (
                      <div className="flex gap-2">
                        {a.status === "sync_failed" && (
                          <Button size="sm" variant="outline" disabled={busy} onClick={async () => {
                            setBusy(true);
                            try {
                              const r = await retryPaymentAllocationSync(a.id);
                              if (r.ok) toast.success("ثبت سند انجام شد");
                              else toastFinanceError(toast, r.error || new Error("خطا"));
                              await reload();
                            } catch (e: unknown) { toastFinanceError(toast, e); }
                            finally { setBusy(false); }
                          }}>
                            <RefreshCw className="w-3.5 h-3.5 ml-1" /> تلاش مجدد
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" disabled={busy} onClick={async () => {
                          if (!confirm("لغو تخصیص؟")) return;
                          setBusy(true);
                          try { await cancelPaymentAllocation(a.id); toast.success("لغو شد"); await reload(); }
                          catch (e: unknown) { toastFinanceError(toast, e); }
                          finally { setBusy(false); }
                        }}>
                          <XCircle className="w-3.5 h-3.5 ml-1" /> لغو تخصیص
                        </Button>
                      </div>
                    )}
                    {/* Phase 4: allocation rollback — only meaningful once the
                        allocation actually created a Sepidar voucher. The
                        existing «لغو تخصیص» path above is kept for failed
                        allocations that never reached Sepidar. */}
                    {a.status === "synced" && (
                      <div className="flex gap-2">
                        <RollbackButton
                          entityType="payment_allocation"
                          entityId={a.id}
                          metadata={{
                            operationLabel: "تخصیص پرداخت",
                            amount: a.amount,
                            bankLabel: a.bank?.title || a.bank?.bank_name || null,
                            sepidarVoucherId: a.bank_transaction?.document_number || null,
                            extraLines: a.bank_transaction?.transaction_jalali_date
                              ? [{ label: "تاریخ تراکنش", value: a.bank_transaction.transaction_jalali_date }]
                              : undefined,
                          }}
                          onSuccess={() => { void reload(); }}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Approval actions */}
          <div className="grid grid-cols-2 gap-2">
            {(headerStatus === "draft" || headerStatus === "pending_approval") && (
              <>
                <Button onClick={approve} disabled={busy}><CheckCircle2 className="w-4 h-4 ml-1" /> تایید مدیریت</Button>
                <Button onClick={reject} variant="outline" disabled={busy}>رد درخواست</Button>
              </>
            )}
            {/* Phase 4: full request rollback — admin/super_admin only. Cancels
                every linked allocation, soft-deletes any posted voucher, and
                recomputes party balances via the orchestrator. */}
            {(headerStatus === "approved" || headerStatus === "partially_paid" || headerStatus === "paid") && (
              <div className="col-span-2 flex justify-end">
                <RollbackButton
                  entityType="payment_request"
                  entityId={pr.id}
                  metadata={{
                    operationLabel: "درخواست تسویه",
                    amount: headerApproved || headerRequested,
                    extraLines: [
                      { label: "وضعیت", value: PAYMENT_REQUEST_STATUS_LABEL[headerStatus || ""] || headerStatus || "—" },
                      { label: "پرداخت شده", value: formatMoney(headerPaid) },
                    ],
                  }}
                  onSuccess={() => { void reload(); }}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {allocItem && (
        <AllocationDialog
          item={allocItem}
          requestId={pr.id}
          onClose={() => setAllocItem(null)}
          onDone={async () => { setAllocItem(null); await reload(); }}
        />
      )}

      {/* Edit-amount dialog. Reloads the request detail on success so the
          item status badges, paid/remaining cells, and header progress
          summary all reflect the new server-side values. */}
      {editAmountItem && (
        <EditItemAmountDialog
          item={{
            id: editAmountItem.id,
            amount: Number(editAmountItem.amount || 0),
            confirmed_amount: editAmountItem.confirmed_amount,
            paid_amount: editAmountItem.paid_amount,
            status: editAmountItem.status,
          }}
          requestStatus={headerRefresh.status}
          onClose={() => setEditAmountItem(null)}
          onSaved={reload}
        />
      )}
    </div>
  );
}

interface BankLite { id: string; title: string | null; bank_name: string | null }
interface TxRow {
  id: string; bank_id: string; transaction_jalali_date: string | null;
  withdraw_amount: number; description: string | null; document_number: string | null;
  // Gregorian timestamp — used for display fallback when the legacy Jalali
  // text column is null (which it is for every row).
  transaction_datetime: string | null;
}

function AllocationDialog({ item, requestId, onClose, onDone }: { item: PRItemFull; requestId: string; onClose: () => void; onDone: () => void }) {
  const [banks, setBanks] = useState<BankLite[]>([]);
  const [bankFilter, setBankFilter] = useState<string>("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [amountFilter, setAmountFilter] = useState("");
  const [descFilter, setDescFilter] = useState("");
  const [docFilter, setDocFilter] = useState("");
  const [txs, setTxs] = useState<TxRow[]>([]);
  const [selected, setSelected] = useState<TxRow | null>(null);
  const [allocAmount, setAllocAmount] = useState<number>(0);
  const [busy, setBusy] = useState(false);

  // Approved payable for THIS item = confirmed_amount when set by the
  // DB trigger, otherwise fall back to the requested `amount`. The
  // remaining unpaid amount is the cap we never let the user exceed.
  const payable = Math.max(0, Number(item.confirmed_amount || 0) || Number(item.amount || 0));
  const remaining = Math.max(0, payable - Number(item.paid_amount || 0));

  useEffect(() => {
    void supabase.from("finance_banks").select("id,title,bank_name").eq("is_deleted", false).then(({ data }) => setBanks((data as BankLite[]) || []));
  }, []);

  useEffect(() => {
    // Convert the Jalali range picked by the user into a Gregorian timestamp
    // window. `from` becomes start-of-day (00:00:00 +03:30) and `to` becomes
    // inclusive end-of-day (23:59:59.999 +03:30) so the query covers the
    // entire selected Jalali day(s). Both can be null when the user has not
    // picked that bound yet.
    const { from: fromGregorian, to: toGregorian } = jalaliRangeToGregorianRange(fromDate, toDate);

    // Defense-in-depth: even though `assignment_status='unassigned'` is set
    // by the lib + DB trigger when a transaction gets linked, we ALSO
    // explicitly exclude any transaction already present in an ACTIVE
    // payment allocation or receive identification. This way, if
    // `assignment_status` ever drifts out of sync with the source-of-truth
    // tables, the user can still never accidentally pick a reused
    // transaction. The DB unique indexes + BEFORE trigger remain the final
    // line of defense against race conditions.
    void (async () => {
      const [{ data: usedAllocs }, { data: usedIds }] = await Promise.all([
        supabase
          .from("finance_payment_allocations")
          .select("bank_transaction_id")
          .eq("is_deleted", false)
          .not("status", "in", "(cancelled,rejected)"),
        supabase
          .from("finance_receive_identifications")
          .select("bank_transaction_id")
          .eq("is_deleted", false)
          .not("status", "in", "(cancelled,rejected)"),
      ]);
      const usedSet = new Set<string>();
      ((usedAllocs as { bank_transaction_id: string | null }[]) || []).forEach((r) => {
        if (r.bank_transaction_id) usedSet.add(r.bank_transaction_id);
      });
      ((usedIds as { bank_transaction_id: string | null }[]) || []).forEach((r) => {
        if (r.bank_transaction_id) usedSet.add(r.bank_transaction_id);
      });

      let q = supabase
        .from("finance_bank_transactions")
        .select("id,bank_id,transaction_jalali_date,withdraw_amount,description,document_number,transaction_datetime")
        .eq("is_deleted", false)
        .eq("transaction_type", "withdraw")
        .eq("assignment_status", "unassigned")
        .order("transaction_datetime", { ascending: false })
        .limit(100);
      if (bankFilter) q = q.eq("bank_id", bankFilter);
      // Filter on the real Gregorian timestamp column, NOT the legacy Jalali
      // text column (which is empty for all rows).
      if (fromGregorian) q = q.gte("transaction_datetime", fromGregorian);
      if (toGregorian) q = q.lte("transaction_datetime", toGregorian);
      if (amountFilter) {
        const a = parseMoney(amountFilter);
        if (a) q = q.eq("withdraw_amount", a);
      }
      if (descFilter) q = q.ilike("description", `%${descFilter}%`);
      if (docFilter) q = q.ilike("document_number", `%${docFilter}%`);
      const { data } = await q;
      // Final client-side scrub: hide any tx that's already used elsewhere.
      const rows = ((data as TxRow[]) || []).filter((t) => !usedSet.has(t.id));
      setTxs(rows);
    })();
  }, [bankFilter, fromDate, toDate, amountFilter, descFilter, docFilter]);

  function selectTx(tx: TxRow) {
    setSelected(tx);
    const w = Number(tx.withdraw_amount || 0);
    setAllocAmount(Math.min(w, remaining));
  }

  async function submit() {
    if (busy) return;
    if (!selected) return;
    // Frontend guards — these are duplicated server-side in
    // `createPaymentAllocation` and inside `fn_finance_payment_allocations_guard`
    // so race conditions / bypass attempts are still rejected.
    if (!allocAmount || allocAmount <= 0) {
      return toast.error("مبلغ تخصیص باید بزرگ‌تر از صفر باشد.");
    }
    if (remaining <= 0) {
      return toast.error("این ردیف مانده قابل پرداختی ندارد.");
    }
    if (allocAmount > remaining + 1e-6) {
      // Exact wording requested by product spec.
      return toast.error("مبلغ تراکنش از مانده قابل پرداخت این درخواست بیشتر است.");
    }
    if (allocAmount > Number(selected.withdraw_amount || 0) + 1e-6) {
      return toast.error("مبلغ تخصیص از مبلغ تراکنش بانکی بیشتر است.");
    }
    setBusy(true);
    try {
      const r = await createPaymentAllocation({
        payment_request_id: requestId,
        payment_request_item_id: item.id,
        bank_transaction_id: selected.id,
        amount: allocAmount,
      });
      if (r.ok) toast.success("تخصیص و سند داخلی ثبت شد");
      else toastFinanceError(toast, r.error || new Error("تخصیص ثبت شد ولی ثبت سپیدار ناموفق بود"));
      onDone();
    } catch (e: unknown) {
      toastFinanceError(toast, e);
    } finally { setBusy(false); }
  }

  const bankName = (id: string) => {
    const b = banks.find((x) => x.id === id);
    return b ? (b.title || b.bank_name || "—") : "—";
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-card rounded-t-2xl sm:rounded-2xl border shadow-lg w-full max-w-2xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b flex items-center justify-between sticky top-0 bg-card">
          <h3 className="font-bold">انتخاب تراکنش برداشت</h3>
          <Button size="icon" variant="ghost" onClick={onClose}><X className="w-4 h-4" /></Button>
        </div>
        <div className="p-4 space-y-3">
          <div className="rounded-lg bg-muted/40 p-2 text-xs grid grid-cols-3 gap-2">
            <div><span className="text-muted-foreground">ذینفع: </span><span className="font-bold">{item.party ? partyName(item.party) : "—"}</span></div>
            <div><span className="text-muted-foreground">مبلغ ردیف: </span>{formatMoney(item.amount)}</div>
            <div><span className="text-muted-foreground">مانده ردیف: </span>{formatMoney(remaining)}</div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <select value={bankFilter} onChange={(e) => setBankFilter(e.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-sm">
              <option value="">همه بانک‌ها</option>
              {banks.map((b) => <option key={b.id} value={b.id}>{b.title || b.bank_name}</option>)}
            </select>
            {/* These two filters target the legacy `transaction_jalali_date`
                text column, which stores Jalali strings — so we use the
                Shamsi (string-out) picker rather than the new Gregorian
                DatePicker. Both pickers render the SAME Jalali calendar UI. */}
            <ShamsiDatePicker value={fromDate} onChange={setFromDate} placeholder="تاریخ از (شمسی)" />
            <ShamsiDatePicker value={toDate} onChange={setToDate} placeholder="تاریخ تا (شمسی)" />
            <Input dir="ltr" placeholder="مبلغ" value={amountFilter} onChange={(e) => setAmountFilter(e.target.value)} />
            <Input placeholder="شرح" value={descFilter} onChange={(e) => setDescFilter(e.target.value)} />
            <Input placeholder="شماره سند" value={docFilter} onChange={(e) => setDocFilter(e.target.value)} />
          </div>

          <div className="rounded-lg border max-h-72 overflow-y-auto">
            {txs.length === 0 && <div className="p-6 text-center text-sm text-muted-foreground">تراکنش برداشت تخصیص‌نشده‌ای یافت نشد</div>}
            {txs.map((tx) => (
              <button key={tx.id} onClick={() => selectTx(tx)}
                className={`w-full text-right p-3 border-b last:border-b-0 hover:bg-muted/60 transition ${selected?.id === tx.id ? "bg-primary/5" : ""}`}>
                <div className="flex justify-between items-center gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-bold">{bankName(tx.bank_id)}</div>
                    <div className="text-[11px] text-muted-foreground truncate">{tx.description || "—"}</div>
                    {/* Prefer legacy Jalali text column when present, otherwise
                        convert the real Gregorian timestamp to a Jalali date+time
                        string so users always see a Persian date. */}
                    <div className="text-[10px] text-muted-foreground">سند: {tx.document_number || "—"} · {tx.transaction_jalali_date || formatJalaliDateTime(tx.transaction_datetime) || ""}</div>
                  </div>
                  <MoneyCell value={tx.withdraw_amount} className="text-sm" negative />
                </div>
              </button>
            ))}
          </div>

          {selected && (
            <div className="rounded-lg border p-3 space-y-2 bg-muted/20">
              <div className="text-sm font-bold">تایید تخصیص</div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div><span className="text-muted-foreground">بانک: </span>{bankName(selected.bank_id)}</div>
                <div><span className="text-muted-foreground">تاریخ: </span>{selected.transaction_jalali_date || formatJalaliDateTime(selected.transaction_datetime) || "—"}</div>
                <div><span className="text-muted-foreground">مبلغ تراکنش: </span>{formatMoney(selected.withdraw_amount)}</div>
                <div><span className="text-muted-foreground">مانده ردیف: </span>{formatMoney(remaining)}</div>
              </div>
              <div className="space-y-1">
                <Label className="text-[11px]">مبلغ تخصیص</Label>
                <Input dir="ltr" inputMode="numeric" value={allocAmount || ""} onChange={(e) => setAllocAmount(parseMoney(e.target.value))} />
              </div>
              <Button onClick={submit} disabled={busy} className="w-full">
                <CheckCircle2 className="w-4 h-4 ml-1" /> ثبت تخصیص و ایجاد سند
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
