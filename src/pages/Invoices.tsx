import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ChevronDown, FileText, Plus, X, Loader2, ChevronRight, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { toPersianDigits } from "@/lib/jalali";
// Universal Shamsi formatter — accepts ISO, Date, or pre-formatted Shamsi
// strings and always returns "YYYY/MM/DD" in Persian digits. Used to keep
// every date in the app on the Iranian calendar.
import { formatShamsi } from "@/lib/dateDisplay";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
// hasPermission is DEV_ACCESS_MODE-aware so today every authenticated user
// can see the action buttons; once roles are enabled we just need to pass
// the right permission key here (see comments on the panels below).
import { hasPermission } from "@/lib/auth";
// Server-side filter UI + URL serialization helpers. All filtering happens
// inside the `list_factors_filtered` Postgres function so we don't paginate
// the entire table client-side anymore.
import FactorFilters, {
  type FactorFiltersValue,
  EMPTY_FILTERS,
  filtersToSearchParams,
  searchParamsToFilters,
  hasActiveFilters,
} from "@/components/invoices/FactorFilters";
// Converts a Jalali "YYYY/MM/DD" string from the filter picker into a Tehran
// wall-clock ISO timestamp so we can compare it against the timestamptz
// `factors.invoice_date` column on the server.
import { jalaliToGregorianTimestamp } from "@/lib/dateUtils";
// Phase 7: structured related costs panel embedded inside the invoice
// detail view. Self-contained — pulls and writes its own rows.
import RelatedCostsSection from "@/components/finance/RelatedCostsSection";
// Invoice ↔ Settlement dependency model: summary card that renders when
// the invoice already owns a settlement request. Used here to also flip
// off the legacy "ثبت درخواست تسویه" CTA inside RelatedCostsSection.
import InvoiceSettlementSummaryCard from "@/components/invoices/sections/InvoiceSettlementSummaryCard";
import type { InvoiceLinkedSettlement } from "@/lib/finance/invoiceSettlementLink";
// Phase 4 — generic rollback dialog for posted factors (admin/super_admin).
import { RollbackButton } from "@/components/finance/RollbackConfirmDialog";

interface FactorRow {
  id: string;
  product_type: string;
  invoice_type: string;
  invoice_date: string | null;
  invoice_number: string | null;
  delivery_date: string | null;
  tax: string | null;
  buyer_type: string | null;
  // Legacy text snapshot of the counterparty's display name. Kept as a
  // fallback for pre-M5 rows where `finance_party_id` is NULL.
  company: string | null;
  // M5: canonical counterparty FK. NULL for ~204 legacy rows whose
  // legacy pointer didn't resolve to a finance_parties row during the
  // step 2b backfill (e.g. factor had no shopping_center_id at all).
  finance_party_id: string | null;
  discount: number | null;
  shipping: number | null;
  tax_amount: number | null;
  total_amount: number | null;
  payable_amount: number | null;
  settlement_type: string | null;
  settlement_date: string | null;
  settlement_number: string | null;
  description: string | null;
  created_at: string;
  // ---- M3r-MVP posting pipeline fields -------------------------------------
  // Already exist as columns on `public.factors` — we just surface them on the
  // row so the detail panel can render the posting status + retry button.
  // They are intentionally optional/null until a factor reaches the posting
  // pipeline; no change to the factor *registration* UI is made.
  lifecycle_state: string | null;
  voucher_id: string | null;
  // Sepidar mirror fields. EITHER of these being non-null means the factor
  // already has a voucher in Sepidar — the post button must stay blocked
  // regardless of lifecycle_state to avoid duplicate posts.
  sepidar_voucher_id: string | null;
  sepidar_voucher_number: string | null;
  last_posting_error: string | null;
  posting_attempt_count: number | null;

  // M5: composed display name from the joined finance_parties row. The
  // join is performed in the supabase select below and reduced to a flat
  // string in fetchFactors so the rest of the UI stays simple.
  party_name: string | null;
  // RPC-derived bucketed status (draft / approved / cancelled / posted /
  // voucher_failed / sepidar_failed). Optional because legacy queries that
  // bypass the RPC may not populate it.
  derived_status?: string | null;
  // factor_type_id is the canonical direction marker (1=purchase, 2=sale).
  // Used to render a direction badge in addition to the legacy invoice_type.
  factor_type_id?: number | null;
}

interface SpermBuyRow {
  id: string;
  sperm_code: string | null;
  sperm_name: string | null;
  quantity: number | null;
  unit_price: number | null;
  row_total: number | null;
  description: string | null;
}

interface MilkRow {
  id: string;
  quantity_kg: number | null;
  quantity_liter: number | null;
  milk_sample: number | null;
  fat: number | null;
  protein: number | null;
  total: number | null;
  somatic: number | null;
  price_per_kg: number | null;
  row_total: number | null;
  description: string | null;
}

interface FeedItemRow {
  id: string;
  feed_name: string | null;
  weight_kg: number | null;
  moisture_loss: number | null;
  price_per_kg: number | null;
  row_total: number | null;
  description: string | null;
}

interface MedicineItemRow {
  id: string;
  medicine_name: string | null;
  medicine_type: string | null;
  quantity: number | null;
  unit_price: number | null;
  row_total: number | null;
  description: string | null;
}

interface LivestockItemRow {
  id: string;
  animal_number: string | null;
  weight_kg: number | null;
  price_per_kg: number | null;
  row_total: number | null;
  description: string | null;
}

// Services-related item rows. Services factors don't have a single items
// table — they live across wage_items / daily_worker_items / rental_items
// (plus medicine_items with medicine_type='معاینات' for examinations). The
// detail panel renders whichever lists are non-empty for the selected row.
interface WageItemRow {
  id: string;
  purpose: string | null;
  work_mode: string | null;
  payment_type: string | null;
  daily_amount: number | null;
  contract_amount: number | null;
  account_holder: string | null;
  iban_or_card: string | null;
  row_total: number | null;
  description: string | null;
}

interface DailyWorkerItemRow {
  id: string;
  purpose: string | null;
  worker_name: string | null;
  days_count: number | null;
  hours_count: number | null;
  daily_rate: number | null;
  hourly_rate: number | null;
  row_total: number | null;
  description: string | null;
}

interface RentalItemRow {
  id: string;
  purpose: string | null;
  driver_name: string | null;
  iban_or_card: string | null;
  amount: number | null;
  row_total: number | null;
  description: string | null;
}

// ---------------------------------------------------------------------------
// MixedItemRow — display-only shape for factors saved via MixedInvoiceForm
// (factors.product_type = 'mixed'). Each row pairs a `factor_items` row with
// its matching `factor_item_<type>_details` snapshot. The detail bag is kept
// loose so we don't have to mirror nine different detail-table schemas — the
// renderer picks the few keys it knows per product_type and otherwise falls
// back to the shared factor_items fields.
// ---------------------------------------------------------------------------
interface MixedItemRow {
  id: string;                 // factor_items.id
  row_number: number | null;
  product_type: string;
  quantity: number | null;
  unit: string | null;
  unit_price: number | null;
  discount_amount: number | null;
  tax_amount: number | null;
  total_amount: number | null;
  description: string | null;
  // Per-type detail bag (possibly empty). Renderer reads e.g. details.feed_name
  details: Record<string, unknown>;
  // Resolved human label for master-table FKs (cow plaque, sperm code…)
  display_label: string | null;
}

const productLabels: Record<string, string> = {
  sperm: "اسپرم",
  milk: "شیر",
  feed: "خوراک",
  medicine: "دارو",
  livestock: "دام",
  manure: "کود دامی",
  // 'mixed' = factors created via MixedInvoiceForm (multi-product-type rows
  // in a single header). Dedicated badge so operators recognize the new flow.
  mixed: "ترکیبی",
  services: "خدمات",
  rental: "کرایه",
  other: "سایر",
};

const invoiceTypeLabels: Record<string, string> = {
  buy: "خرید",
  sell: "فروش",
  milk_receipt: "قبض مراکز خرید شیر",
  retail_sell: "فروش خورده",
};

const settlementLabels: Record<string, string> = {
  cash: "نقدی",
  deferred: "پس پرداخت",
  cheque: "چک",
  cash_cheque: "نقد - پس چک",
};

const companyLabels: Record<string, string> = {
  bayerami: "داروخانه دکتر بایرامی",
  qazvin_union: "اتحادیه قزوین",
  pegah_fars: "شرکت پگاه فارس",
  ramak: "شرکت رامک",
  pegah_ramak: "پگاه + رامک",
};

function formatRial(n: number): string {
  return toPersianDigits(n.toLocaleString("en-US")) + " ریال";
}

function DetailRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={cn("flex justify-between items-center py-2", bold && "border-t-2 border-primary/20 pt-3 mt-1")}>
      <span className={cn("text-sm", bold ? "font-bold text-foreground" : "text-muted-foreground")}>{label}</span>
      <span className={cn("text-sm font-medium", bold ? "text-primary text-base font-bold" : "text-foreground")}>{value}</span>
    </div>
  );
}

// -----------------------------------------------------------------------------
// =============================================================================
// Action visibility rules — single source of truth for which factor types are
// allowed to post to Sepidar today. Keep this tiny + colocated so it's obvious
// when adding a new product type.
//
// Current truth (audited 2026-05-28 against factor_accounting_map):
//   - `post_approved_factor` now supports the simple two-line voucher model
//     for: livestock, feed, medicine, sperm, manure, services. Each has
//     active mappings (inventory/ap for buy, ar/revenue for sell).
//   - Feed *sales* historically had an explicit "do not post" rule (M5);
//     that rule is kept here as a defensive override so a single product_type
//     toggle does not accidentally re-enable it. Flip the helper if/when
//     finance signs off on feed-sale posting.
//   - milk / other / legacy_product_* are intentionally NOT in the supported
//     set — they have no accounting mappings yet.
// =============================================================================
const POSTING_SUPPORTED_PRODUCT_TYPES = new Set<string>([
  "livestock",
  "feed",
  "medicine",
  "sperm",
  "manure",
  "services",
]);

function isFeedSale(f: FactorRow): boolean {
  return (
    f.product_type === "feed" &&
    (f.factor_type_id === 2 || f.invoice_type === "sell" || f.invoice_type === "retail_sell")
  );
}

function supportsSepidarPosting(f: FactorRow): boolean {
  // Defensive: feed sales remain explicitly blocked even though the engine
  // could technically build a balanced voucher for them now.
  if (isFeedSale(f)) return false;
  return POSTING_SUPPORTED_PRODUCT_TYPES.has(f.product_type);
}


// -----------------------------------------------------------------------------
// ApprovalPanel: Approve / Reject controls for draft (or NULL lifecycle) rows.
// -----------------------------------------------------------------------------
// All 2k+ legacy factors live with `lifecycle_state IS NULL`, which the RPC
// reports as derived_status='draft'. Without this panel the user could never
// move a factor into the `approved` state and therefore never see the Post
// button. We write directly to `public.factors` (open RLS today) and only
// touch the lifecycle / approval timestamp columns — no accounting fields.
function ApprovalPanel({ factor, onChanged }: { factor: FactorRow; onChanged: () => void }) {
  const [busy, setBusy] = useState<null | "approve" | "reject">(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const state = factor.derived_status || factor.lifecycle_state || "draft";
  // Show Approve/Reject only while the factor is still in the editable bucket.
  // Anything past 'approved' is owned by the PostingPanel below.
  const isDraft = state === "draft";
  // TODO: swap these for real permission keys when DEV_ACCESS_MODE is removed
  // (e.g. "factor.approve", "factor.reject"). hasPermission already returns
  // true under DEV_ACCESS_MODE so today every user sees the buttons.
  const canApprove = hasPermission("factor.approve");
  const canReject = hasPermission("factor.reject");

  if (!isDraft) return null;
  if (!canApprove && !canReject) return null;

  const run = async (action: "approve" | "reject") => {
    // Hard gate: refuse to approve a factor that has no counterparty link.
    // Posting to Sepidar would fail downstream, and the operator would have
    // to come back to fix it anyway. Reject is still allowed.
    if (action === "approve" && !factor.finance_party_id) {
      setMsg({
        ok: false,
        text: "ذینفع فاکتور مشخص نشده است. ابتدا ذینفع را انتخاب و ذخیره کنید.",
      });
      return;
    }
    setBusy(action);
    setMsg(null);
    try {
      // Only touch lifecycle + approval-audit columns. We deliberately avoid
      // mutating anything that could affect accounting totals.
      const patch =
        action === "approve"
          ? { lifecycle_state: "approved", approved_at: new Date().toISOString() }
          : { lifecycle_state: "cancelled", rejected_at: new Date().toISOString() };
      const { error } = await supabase.from("factors").update(patch).eq("id", factor.id);
      if (error) throw error;
      setMsg({ ok: true, text: action === "approve" ? "فاکتور تأیید شد." : "فاکتور رد شد." });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message || "خطا در ثبت تغییر وضعیت." });
    } finally {
      setBusy(null);
      onChanged();
    }
  };


  return (
    <div className="mt-4 rounded-xl border border-border bg-secondary/30 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-bold text-foreground">وضعیت تأیید فاکتور</span>
        <span className="px-2.5 py-1 rounded-lg bg-muted text-muted-foreground text-xs font-bold">
          در انتظار تأیید
        </span>
      </div>
      {msg && (
        <p
          className={cn(
            "text-xs rounded-lg p-2",
            msg.ok ? "text-primary bg-primary/5" : "text-destructive bg-destructive/5",
          )}
        >
          {msg.text}
        </p>
      )}
      <div className="flex gap-2">
        {canApprove && (
          <Button
            onClick={() => run("approve")}
            disabled={busy !== null}
            className="rounded-xl gap-2 bg-gradient-primary text-primary-foreground glow-primary flex-1"
          >
            {busy === "approve" && <Loader2 className="w-4 h-4 animate-spin" />}
            تأیید فاکتور
          </Button>
        )}
        {canReject && (
          <Button
            onClick={() => run("reject")}
            disabled={busy !== null}
            variant="outline"
            className="rounded-xl gap-2 flex-1 border-destructive/40 text-destructive hover:bg-destructive/10"
          >
            {busy === "reject" && <Loader2 className="w-4 h-4 animate-spin" />}
            رد / لغو
          </Button>
        )}
      </div>
    </div>
  );
}

// PostingPanel: minimal MVP UI for the accounting voucher posting pipeline.
// -----------------------------------------------------------------------------
// Visibility rules (see ApprovalPanel for the upstream "draft" step):
//   - hidden entirely for product_types not in POSTING_SUPPORTED_PRODUCT_TYPES
//     and for feed sales (see supportsSepidarPosting)
//   - "Post" button on lifecycle_state='approved'
//   - "Retry" button on voucher_failed / sepidar_failed
//   - read-only "posted" badge when lifecycle_state='posted'
function PostingPanel({ factor, onChanged }: { factor: FactorRow; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [resultMsg, setResultMsg] = useState<string | null>(null);
  const [resultOk, setResultOk] = useState<boolean | null>(null);

  const state = factor.lifecycle_state ?? "";
  // SINGLE SOURCE OF TRUTH for "this factor is already in Sepidar":
  // either mirror field is enough — we never want to allow a second post
  // even if a partial update left lifecycle_state behind. This guards
  // against duplicate Sepidar vouchers from a double-click or stale state.
  const hasSepidarVoucher = !!(factor.sepidar_voucher_id || factor.sepidar_voucher_number);
  const isPosted = state === "posted" || hasSepidarVoucher;
  // Posting is only allowed when there is NO sepidar mirror yet AND the
  // factor is in a re-postable state. Note `isPosted` already covers the
  // sepidar-mirror case, so we additionally require !hasSepidarVoucher.
  const canPost =
    !hasSepidarVoucher &&
    ["approved", "voucher_failed", "sepidar_failed"].includes(state);
  // Gate the whole panel by product-type support. This is what hides Sepidar
  // posting for feed sales and for any product type the engine can't handle.
  const supported = supportsSepidarPosting(factor);
  // TODO: replace with the real permission key once roles are enabled.
  const canUserPost = hasPermission("factor.post_sepidar");
  const showNothing = !supported || (!isPosted && !canPost);


  const handlePost = async () => {
    setBusy(true); setResultMsg(null); setResultOk(null);
    try {
      // We use supabase.functions.invoke so the user's JWT is forwarded
      // automatically — the edge function uses it to fill triggered_by.
      const { data, error } = await supabase.functions.invoke("factor-post-voucher", {
        body: { factor_id: factor.id },
      });
      if (error) {
        setResultOk(false);
        setResultMsg(error.message || "خطا در ارتباط با سرور.");
      } else {
        const r = (data ?? {}) as { success?: boolean; message?: string };
        setResultOk(Boolean(r.success));
        setResultMsg(r.message ?? (r.success ? "انجام شد." : "ناموفق."));
      }
    } catch (e) {
      setResultOk(false);
      setResultMsg((e as Error).message || "خطای نامشخص.");
    } finally {
      setBusy(false);
      // Trigger parent refetch so the badge + error text reflect the new
      // lifecycle_state without requiring a page reload.
      onChanged();
    }
  };

  if (showNothing) return null;

  return (
    <div className="mt-4 rounded-xl border border-border bg-secondary/30 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-bold text-foreground">وضعیت ثبت سند مالی</span>
        {isPosted ? (
          <span className="px-2.5 py-1 rounded-lg bg-primary/15 text-primary text-xs font-bold">
            ثبت شده • سپیدار {toPersianDigits(factor.sepidar_voucher_number || factor.sepidar_voucher_id || "")}
          </span>
        ) : state === "voucher_failed" ? (
          <span className="px-2.5 py-1 rounded-lg bg-destructive/15 text-destructive text-xs font-bold">
            خطای ساخت سند
          </span>
        ) : state === "sepidar_failed" ? (
          <span className="px-2.5 py-1 rounded-lg bg-destructive/15 text-destructive text-xs font-bold">
            خطای ثبت در سپیدار
          </span>
        ) : (
          <span className="px-2.5 py-1 rounded-lg bg-muted text-muted-foreground text-xs font-bold">
            آماده ثبت
          </span>
        )}
      </div>

      {/* Last persisted error from the DB — separate from the just-attempted
          response so the operator can always see why the previous attempt
          failed even after closing/reopening the detail panel. */}
      {factor.last_posting_error && !resultMsg && (
        <p className="text-xs text-destructive bg-destructive/5 rounded-lg p-2">
          {factor.last_posting_error}
        </p>
      )}

      {/* Live result from the click that just happened. */}
      {resultMsg && (
        <p className={cn(
          "text-xs rounded-lg p-2",
          resultOk ? "text-primary bg-primary/5" : "text-destructive bg-destructive/5"
        )}>
          {resultMsg}
        </p>
      )}

      {factor.posting_attempt_count != null && factor.posting_attempt_count > 0 && (
        <p className="text-xs text-muted-foreground">
          تعداد تلاش: {toPersianDigits(String(factor.posting_attempt_count))}
        </p>
      )}

      {canPost && canUserPost && (
        <Button
          onClick={handlePost}
          disabled={busy}
          className="rounded-xl gap-2 bg-gradient-primary text-primary-foreground glow-primary w-full"
        >
          {busy && <Loader2 className="w-4 h-4 animate-spin" />}
          {state === "approved" ? "ثبت سند مالی در سپیدار" : "تلاش مجدد ثبت سپیدار"}
        </Button>
      )}

      {/* Phase 4 — rollback for already-posted factors. Role-gated by the
          dialog component itself. Hidden when no Sepidar voucher exists. */}
      {isPosted && (
        <RollbackButton
          entityType="factor"
          entityId={factor.id}
          buttonClassName="w-full rounded-xl"
          metadata={{
            operationLabel: "فاکتور",
            amount: Number((factor as { total_amount?: number | null }).total_amount ?? 0) || null,
            sepidarVoucherId: factor.sepidar_voucher_id ?? factor.sepidar_voucher_number,
            extraLines: [
              { label: "شماره فاکتور", value: toPersianDigits(String((factor as { invoice_number?: string | number | null }).invoice_number ?? "—")) },
            ],
          }}
          onSuccess={onChanged}
        />
      )}
    </div>
  );
}

// FixPartyPanel: recovery UI for factors whose finance_party_id is NULL.
// ---------------------------------------------------------------------------
// Lets the operator assign a finance_parties row to an existing factor so
// Sepidar posting can resolve the counterparty. Required for factors created
// before validation was added, or imported rows where the legacy pointer
// didn't backfill. Writes directly to factors.finance_party_id and snapshots
// the chosen party's display name into the legacy factors.company column so
// list rendering stays consistent.
function FixPartyPanel({ factor, onChanged }: { factor: FactorRow; onChanged: () => void }) {
  // Only show when there is no canonical party link. Legacy fallback (the
  // edge function still tries shopping_center_id / buyer_user_id) cannot be
  // detected from this lean row shape, so we key purely off finance_party_id
  // — when it's set, the panel is irrelevant; when it's not, we offer the fix.
  const [open, setOpen] = useState(false);
  const [parties, setParties] = useState<{ id: string; label: string }[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [errMsg, setErrMsg] = useState<string | null>(null);

  // Lazy-load the finance_parties list only when the operator opens the panel
  // (avoids fetching ~hundreds of rows for every detail view).
  useEffect(() => {
    if (!open || parties.length > 0) return;
    (async () => {
      const { data } = await supabase
        .from("finance_parties")
        .select("id, company_name, first_name, last_name, sepidar_full_name")
        .eq("is_deleted", false);
      if (!data) return;
      const opts = data.map((p) => {
        const personName = [p.first_name, p.last_name].filter(Boolean).join(" ").trim();
        const label = p.sepidar_full_name || p.company_name || personName || "(بدون نام)";
        return { id: p.id as string, label };
      });
      opts.sort((a, b) => a.label.localeCompare(b.label, "fa"));
      setParties(opts);
    })();
  }, [open, parties.length]);

  if (factor.finance_party_id) return null;

  const filtered = search.trim()
    ? parties.filter((p) => p.label.toLowerCase().includes(search.trim().toLowerCase()))
    : parties;

  const save = async () => {
    if (!selected) return;
    setSaving(true); setErrMsg(null);
    try {
      const chosen = parties.find((p) => p.id === selected);
      const { error } = await supabase
        .from("factors")
        .update({
          finance_party_id: selected,
          // Snapshot label into legacy `company` column so the list/detail
          // still shows a human-readable name on first paint (party_name
          // join will overwrite on next fetch).
          company: chosen?.label || null,
          // Clear stale posting error so PostingPanel re-enables retry.
          last_posting_error: null,
        })
        .eq("id", factor.id);
      if (error) throw error;
      setOpen(false);
      onChanged();
    } catch (e) {
      setErrMsg((e as Error).message || "خطا در ذخیره ذینفع.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-4 rounded-xl border border-destructive/40 bg-destructive/5 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-bold text-destructive">ذینفع فاکتور مشخص نشده است</span>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setOpen((v) => !v)}
          className="rounded-lg text-xs"
        >
          {open ? "بستن" : "انتخاب/اصلاح ذینفع"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        برای ارسال این فاکتور به سپیدار باید ذینفع آن مشخص باشد. ذینفع را انتخاب و ذخیره کنید.
      </p>
      {open && (
        <div className="space-y-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="جستجو نام طرف حساب..."
            className="w-full h-9 rounded-lg border border-border bg-background px-3 text-sm"
            dir="auto"
          />
          <div className="max-h-48 overflow-y-auto rounded-lg border border-border bg-card">
            {filtered.length === 0 ? (
              <p className="p-3 text-xs text-muted-foreground text-center">موردی یافت نشد</p>
            ) : (
              filtered.slice(0, 200).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelected(p.id)}
                  className={cn(
                    "w-full text-right px-3 py-2 text-sm hover:bg-secondary/60 border-b border-border last:border-b-0",
                    selected === p.id && "bg-primary/10 text-primary font-bold",
                  )}
                >
                  {p.label}
                </button>
              ))
            )}
          </div>
          {errMsg && <p className="text-xs text-destructive">{errMsg}</p>}
          <Button
            onClick={save}
            disabled={!selected || saving}
            className="w-full rounded-lg bg-gradient-primary text-primary-foreground"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin ml-2" />}
            ذخیره ذینفع
          </Button>
        </div>
      )}
    </div>
  );
}


function InvoiceDetail({
  factor,
  items,
  milkItems,
  feedItems,
  medicineItems,
  livestockItems,
  wageItems,
  dailyWorkerItems,
  rentalItems,
  mixedItems,
  loading,
  errorMsg,
  onClose,
  onChanged,
}: {
  factor: FactorRow;
  items: SpermBuyRow[];
  milkItems: MilkRow[];
  feedItems: FeedItemRow[];
  medicineItems: MedicineItemRow[];
  livestockItems: LivestockItemRow[];
  wageItems: WageItemRow[];
  dailyWorkerItems: DailyWorkerItemRow[];
  rentalItems: RentalItemRow[];
  // Rows for factors.product_type === 'mixed' (new MixedInvoiceForm flow).
  // Each row may be a different product_type — see MixedItemsSection.
  mixedItems: MixedItemRow[];
  loading: boolean;
  errorMsg: string | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  // Group C: factor.invoice_date is now a Gregorian timestamptz coming from
  // PostgreSQL. Render it through formatShamsi so the user still sees a
  // Jalali/Persian date — never pipe a raw timestamp through toPersianDigits.
  const dateStr = factor.invoice_date ? formatShamsi(factor.invoice_date) : "—";

  // Invoice ↔ Settlement dependency model — local state tracking whether
  // this invoice already owns an active settlement request. The summary
  // card sets it via onLinkedChange; we read it to (a) hide the legacy
  // creation CTA inside RelatedCostsSection and (b) avoid showing two
  // entry points side-by-side.
  const [linkedSettlement, setLinkedSettlement] = useState<InvoiceLinkedSettlement | null>(null);

  return (
    <div className="animate-fade-in">
      <div className="rounded-2xl bg-card overflow-hidden">

        <div className="border-b border-border p-3 mb-2">
          <h2 className="text-body-lg font-bold text-primary">جزئیات فاکتور</h2>
        </div>

        <div className="p-1 space-y-1">

          <div className="flex items-center gap-2 mb-3">
            <span className="px-2.5 py-1 rounded-lg bg-primary/10 text-primary text-xs font-bold">
              {productLabels[factor.product_type] || factor.product_type}
            </span>
            <span className="px-2.5 py-1 rounded-lg bg-secondary text-secondary-foreground text-xs font-bold">
              {invoiceTypeLabels[factor.invoice_type] || factor.invoice_type}
            </span>
          </div>

          <DetailRow label="شماره فاکتور" value={toPersianDigits(factor.invoice_number || "—")} />
          <DetailRow label="تاریخ" value={dateStr} />
          {factor.delivery_date && <DetailRow label="تاریخ تحویل" value={formatShamsi(factor.delivery_date)} />}
          <DetailRow
            label="فروشنده/خریدار"
            value={
              // M5: prefer the joined finance_parties display name; fall
              // back to the legacy `company` text snapshot for pre-M5
              // rows where finance_party_id is NULL.
              factor.party_name
              || (factor.buyer_type === "company" ? (factor.company || "شرکت") : (factor.company || "شخص"))
            }
          />

          {/* Line items for sperm */}
          {factor.product_type === "sperm" && items.length > 0 && (
            <>
              <Separator className="my-2" />
              <p className="text-xs font-bold text-foreground mb-2">اقلام فاکتور:</p>
              {items.map((item, idx) => (
                <div key={item.id} className="bg-secondary/50 rounded-lg p-3 mb-2 space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">ردیف {toPersianDigits(String(idx + 1))}</span>
                    <span className="font-medium text-foreground">
                      {item.sperm_code} - {item.sperm_name}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">تعداد × قیمت واحد</span>
                    <span className="text-foreground">
                      {toPersianDigits(String(item.quantity || 0))} × {formatRial(item.unit_price || 0)}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm font-bold">
                    <span className="text-muted-foreground">جمع ردیف</span>
                    <span className="text-foreground">{formatRial(item.row_total || 0)}</span>
                  </div>
                </div>
              ))}
            </>
          )}

          {/* Line items for milk */}
          {factor.product_type === "milk" && milkItems.length > 0 && (
            <>
              <Separator className="my-2" />
              <p className="text-xs font-bold text-foreground mb-2">اقلام فاکتور:</p>
              {milkItems.map((item) => (
                <div key={item.id} className="bg-secondary/50 rounded-lg p-3 mb-2 space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">مقدار (کیلو)</span>
                    <span className="text-foreground">{toPersianDigits(String(item.quantity_kg || 0))}</span>
                  </div>
                  {(item.quantity_liter || 0) > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">مقدار (لیتر)</span>
                      <span className="text-foreground">{toPersianDigits(String(item.quantity_liter || 0))}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">قیمت هر کیلو</span>
                    <span className="text-foreground">{formatRial(item.price_per_kg || 0)}</span>
                  </div>
                  {(item.fat || 0) > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">چربی</span>
                      <span className="text-foreground">{toPersianDigits(String(item.fat))}</span>
                    </div>
                  )}
                  {(item.protein || 0) > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">پروتئین</span>
                      <span className="text-foreground">{toPersianDigits(String(item.protein))}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm font-bold">
                    <span className="text-muted-foreground">جمع</span>
                    <span className="text-foreground">{formatRial(item.row_total || 0)}</span>
                  </div>
                </div>
              ))}
            </>
          )}

          {/* Line items for feed */}
          {factor.product_type === "feed" && feedItems.length > 0 && (
            <>
              <Separator className="my-2" />
              <p className="text-xs font-bold text-foreground mb-2">اقلام فاکتور:</p>
              {feedItems.map((item, idx) => (
                <div key={item.id} className="bg-secondary/50 rounded-lg p-3 mb-2 space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">ردیف {toPersianDigits(String(idx + 1))}</span>
                    <span className="font-medium text-foreground">{item.feed_name || "—"}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">وزن (کیلوگرم)</span>
                    <span className="text-foreground">{toPersianDigits(String(item.weight_kg || 0))}</span>
                  </div>
                  {(item.moisture_loss || 0) > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">افت رطوبت</span>
                      <span className="text-foreground">{toPersianDigits(String(item.moisture_loss))}٪</span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">قیمت هر کیلو</span>
                    <span className="text-foreground">{formatRial(item.price_per_kg || 0)}</span>
                  </div>
                  <div className="flex justify-between text-sm font-bold">
                    <span className="text-muted-foreground">جمع ردیف</span>
                    <span className="text-foreground">{formatRial(item.row_total || 0)}</span>
                  </div>
                </div>
              ))}
            </>
          )}

          {/* Line items for livestock */}
          {factor.product_type === "livestock" && livestockItems.length > 0 && (
            <>
              <Separator className="my-2" />
              <p className="text-xs font-bold text-foreground mb-2">اقلام فاکتور:</p>
              {livestockItems.map((item, idx) => (
                <div key={item.id} className="bg-secondary/50 rounded-lg p-3 mb-2 space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">ردیف {toPersianDigits(String(idx + 1))}</span>
                    <span className="font-medium text-foreground">شماره دام: {toPersianDigits(item.animal_number || "—")}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">وزن × قیمت هر کیلو</span>
                    <span className="text-foreground">
                      {toPersianDigits(String(item.weight_kg || 0))} × {formatRial(item.price_per_kg || 0)}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm font-bold">
                    <span className="text-muted-foreground">جمع ردیف</span>
                    <span className="text-foreground">{formatRial(item.row_total || 0)}</span>
                  </div>
                  {item.description && (
                    <div className="text-xs text-muted-foreground border-t border-border pt-1.5 mt-1.5">
                      {item.description}
                    </div>
                  )}
                </div>
              ))}
            </>
          )}

          {/* Line items for medicine */}
          {factor.product_type === "medicine" && medicineItems.length > 0 && (
            <>
              <Separator className="my-2" />
              <p className="text-xs font-bold text-foreground mb-2">اقلام فاکتور:</p>
              {medicineItems.map((item, idx) => (
                <div key={item.id} className="bg-secondary/50 rounded-lg p-3 mb-2 space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">ردیف {toPersianDigits(String(idx + 1))}</span>
                    <span className="font-medium text-foreground">{item.medicine_name || "—"}</span>
                  </div>
                  {item.medicine_type && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">نوع دارو</span>
                      <span className="text-primary font-medium">{item.medicine_type}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">تعداد × قیمت واحد</span>
                    <span className="text-foreground">
                      {toPersianDigits(String(item.quantity || 0))} × {formatRial(item.unit_price || 0)}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm font-bold">
                    <span className="text-muted-foreground">جمع ردیف</span>
                    <span className="text-foreground">{formatRial(item.row_total || 0)}</span>
                  </div>
                </div>
              ))}
            </>
          )}

          {/* Services factors split into 4 lists. Each list renders only when
              it has rows. We always show the section header so the operator
              can tell that services items WERE expected to be there even if
              empty (e.g. an old factor that was only described in the
              factor.description field). */}
          {factor.product_type === "services" && (
            <>
              <Separator className="my-2" />
              <p className="text-xs font-bold text-foreground mb-2">اقلام خدمات:</p>

              {wageItems.length > 0 && (
                <div className="space-y-2 mb-2">
                  <p className="text-[11px] text-muted-foreground">اجرت</p>
                  {wageItems.map((it, idx) => (
                    <div key={it.id} className="bg-secondary/50 rounded-lg p-3 space-y-1 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">ردیف {toPersianDigits(String(idx + 1))}</span>
                        <span className="font-medium">{it.purpose || "—"}</span>
                      </div>
                      {(it.daily_amount || 0) > 0 && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">مبلغ روزانه</span>
                          <span>{formatRial(it.daily_amount || 0)}</span>
                        </div>
                      )}
                      {(it.contract_amount || 0) > 0 && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">مبلغ پیمانی</span>
                          <span>{formatRial(it.contract_amount || 0)}</span>
                        </div>
                      )}
                      <div className="flex justify-between font-bold">
                        <span className="text-muted-foreground">جمع ردیف</span>
                        <span>{formatRial(it.row_total || 0)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {dailyWorkerItems.length > 0 && (
                <div className="space-y-2 mb-2">
                  <p className="text-[11px] text-muted-foreground">کارگر روزمزد</p>
                  {dailyWorkerItems.map((it, idx) => (
                    <div key={it.id} className="bg-secondary/50 rounded-lg p-3 space-y-1 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">ردیف {toPersianDigits(String(idx + 1))}</span>
                        <span className="font-medium">{it.worker_name || it.purpose || "—"}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">روز × نرخ</span>
                        <span>
                          {toPersianDigits(String(it.days_count || 0))} × {formatRial(it.daily_rate || 0)}
                        </span>
                      </div>
                      {(it.hours_count || 0) > 0 && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">ساعت × نرخ</span>
                          <span>
                            {toPersianDigits(String(it.hours_count))} × {formatRial(it.hourly_rate || 0)}
                          </span>
                        </div>
                      )}
                      <div className="flex justify-between font-bold">
                        <span className="text-muted-foreground">جمع ردیف</span>
                        <span>{formatRial(it.row_total || 0)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {rentalItems.length > 0 && (
                <div className="space-y-2 mb-2">
                  <p className="text-[11px] text-muted-foreground">کرایه</p>
                  {rentalItems.map((it, idx) => (
                    <div key={it.id} className="bg-secondary/50 rounded-lg p-3 space-y-1 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">ردیف {toPersianDigits(String(idx + 1))}</span>
                        <span className="font-medium">{it.driver_name || it.purpose || "—"}</span>
                      </div>
                      <div className="flex justify-between font-bold">
                        <span className="text-muted-foreground">مبلغ</span>
                        <span>{formatRial(it.row_total || it.amount || 0)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Examination items live in medicine_items with medicine_type='معاینات' */}
              {medicineItems.length > 0 && (
                <div className="space-y-2 mb-2">
                  <p className="text-[11px] text-muted-foreground">معاینات / سایر خدمات</p>
                  {medicineItems.map((it, idx) => (
                    <div key={it.id} className="bg-secondary/50 rounded-lg p-3 space-y-1 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">ردیف {toPersianDigits(String(idx + 1))}</span>
                        <span className="font-medium">{it.medicine_name || "—"}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">تعداد × قیمت واحد</span>
                        <span>
                          {toPersianDigits(String(it.quantity || 0))} × {formatRial(it.unit_price || 0)}
                        </span>
                      </div>
                      <div className="flex justify-between font-bold">
                        <span className="text-muted-foreground">جمع ردیف</span>
                        <span>{formatRial(it.row_total || 0)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {wageItems.length === 0 &&
                dailyWorkerItems.length === 0 &&
                rentalItems.length === 0 &&
                medicineItems.length === 0 &&
                !loading && (
                  <p className="text-xs text-muted-foreground bg-secondary/40 rounded-lg p-3">
                    ردیف خدماتی ثبت نشده — جزئیات در توضیحات فاکتور قابل مشاهده است.
                  </p>
                )}
            </>
          )}

          {/* Manure has no dedicated items table; we surface a friendly note
              so the operator knows the totals below come straight from the
              factor row itself. */}
          {factor.product_type === "manure" && !loading && (
            <>
              <Separator className="my-2" />
              <p className="text-xs text-muted-foreground bg-secondary/40 rounded-lg p-3">
                این فاکتور کود دامی ردیف اقلام تفکیکی ندارد؛ توضیحات و مبالغ در بخش زیر آمده است.
              </p>
            </>
          )}

          {/* Line items for MIXED factors (new MixedInvoiceForm flow). Each
              factor_items row may use a different product_type, so we render
              one card per row and switch the per-row body by product_type.
              Rows are sorted by row_number client-side fallback. */}
          {factor.product_type === "mixed" && mixedItems.length > 0 && (
            <>
              <Separator className="my-2" />
              <p className="text-xs font-bold text-foreground mb-2">اقلام فاکتور ترکیبی:</p>
              {mixedItems.map((it, idx) => {
                const d = it.details || {};
                // Per-row product label — falls back to raw key for unknown
                // types so we never render an empty badge.
                const typeLabel = productLabels[it.product_type] || it.product_type;
                return (
                  <div key={it.id} className="bg-secondary/50 rounded-lg p-3 mb-2 space-y-1">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">
                        ردیف {toPersianDigits(String(it.row_number ?? idx + 1))}
                      </span>
                      <span className="inline-flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded-md bg-primary/10 text-primary text-[10px] font-bold">
                          {typeLabel}
                        </span>
                        {it.display_label && (
                          <span className="font-medium text-foreground">
                            {toPersianDigits(it.display_label)}
                          </span>
                        )}
                      </span>
                    </div>

                    {/* Per-type detail snippets. We render only the few fields
                        that are most useful at a glance — full snapshot is
                        always in the DB. */}
                    {it.product_type === "livestock" && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">وزن × قیمت پایه</span>
                        <span className="text-foreground">
                          {toPersianDigits(String((d.weight as number | null) ?? 0))} × {formatRial((d.off_unit_price as number | null) ?? 0)}
                        </span>
                      </div>
                    )}
                    {it.product_type === "feed" && (
                      <>
                        {d.batch_number ? (
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">شماره بچ</span>
                            <span className="text-foreground">{toPersianDigits(String(d.batch_number))}</span>
                          </div>
                        ) : null}
                      </>
                    )}
                    {it.product_type === "medicine" && d.batch_number ? (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">شماره بچ</span>
                        <span className="text-foreground">{toPersianDigits(String(d.batch_number))}</span>
                      </div>
                    ) : null}
                    {it.product_type === "manure" && d.vehicle_plate ? (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">پلاک خودرو</span>
                        <span className="text-foreground">{toPersianDigits(String(d.vehicle_plate))}</span>
                      </div>
                    ) : null}

                    {/* Shared factor_items fields — quantity × unit_price → total. */}
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">تعداد × قیمت واحد</span>
                      <span className="text-foreground">
                        {toPersianDigits(String(it.quantity ?? 0))}
                        {it.unit ? ` ${it.unit}` : ""} × {formatRial(it.unit_price ?? 0)}
                      </span>
                    </div>
                    {(it.discount_amount || 0) > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">تخفیف</span>
                        <span className="text-foreground">{formatRial(it.discount_amount || 0)}</span>
                      </div>
                    )}
                    {(it.tax_amount || 0) > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">مالیات</span>
                        <span className="text-foreground">{formatRial(it.tax_amount || 0)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-sm font-bold">
                      <span className="text-muted-foreground">جمع ردیف</span>
                      <span className="text-foreground">{formatRial(it.total_amount || 0)}</span>
                    </div>
                    {it.description && (
                      <div className="text-xs text-muted-foreground border-t border-border pt-1.5 mt-1.5">
                        {it.description}
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}

          {/* Generic "no items" fallback. Only shown when the dedicated query
              for this product_type successfully returned ZERO rows — never
              when the query simply hasn't loaded yet (handled by `loading`)
              or failed (handled by `errorMsg`). Mixed factors are included
              so operators see a clear message instead of a blank panel. */}
          {!loading && !errorMsg && (
            (factor.product_type === "sperm" && items.length === 0) ||
            (factor.product_type === "milk" && milkItems.length === 0) ||
            (factor.product_type === "feed" && feedItems.length === 0) ||
            (factor.product_type === "medicine" && medicineItems.length === 0) ||
            (factor.product_type === "livestock" && livestockItems.length === 0) ||
            (factor.product_type === "mixed" && mixedItems.length === 0)
          ) && (
            <p className="text-xs text-muted-foreground bg-secondary/40 rounded-lg p-3">
              ردیف اقلامی برای این فاکتور یافت نشد.
            </p>
          )}

          {/* Loading + empty + error states for the items area */}

          {loading && (
            <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> در حال بارگذاری اقلام فاکتور…
            </div>
          )}
          {errorMsg && !loading && (
            <p className="text-xs text-destructive bg-destructive/5 rounded-lg p-2">
              {errorMsg}
            </p>
          )}

          <Separator className="my-2" />



          <DetailRow label="مبلغ کل" value={formatRial(factor.total_amount || 0)} />
          {(factor.discount || 0) > 0 && <DetailRow label="تخفیف" value={formatRial(factor.discount!)} />}
          {(factor.shipping || 0) > 0 && <DetailRow label="کرایه حمل و نقل" value={formatRial(factor.shipping!)} />}
          {factor.tax === "yes" && <DetailRow label="مالیات (۱۰٪)" value={formatRial(factor.tax_amount || 0)} />}
          <DetailRow label="مبلغ قابل پرداخت" value={formatRial(factor.payable_amount || 0)} bold />

          <Separator className="my-2" />
          <DetailRow label="نوع تسویه" value={settlementLabels[factor.settlement_type || ""] || factor.settlement_type || "—"} />

          {factor.description && (
            <div className="pt-2">
              <p className="text-xs text-muted-foreground mb-1">توضیحات:</p>
              <p className="text-sm text-foreground bg-secondary/50 rounded-lg p-3">{factor.description}</p>
            </div>
          )}

          {/* Invoice ↔ Settlement summary card. Rendered ABOVE the costs
              section so the linked-request status is the first thing the
              operator sees. When no link exists this component renders
              nothing and we fall back to the legacy creation CTA inside
              RelatedCostsSection (Rule 5 — flexible invoices). */}
          <InvoiceSettlementSummaryCard
            factorId={factor.id}
            onLinkedChange={setLinkedSettlement}
          />

          {/* Phase 7: structured related costs (freight, weighing, unloading,
              misc). Lives inside the invoice detail because each row is
              factor-scoped. Renders its own list + "ثبت درخواست تسویه" CTA
              that hands a draft to PaymentRequestsTab via sessionStorage.
              The CTA is suppressed when an invoice-owned settlement
              already exists (Rule 3 — no duplicate creation). */}
          <RelatedCostsSection
            invoice={{
              id: factor.id,
              invoice_number: factor.invoice_number,
              finance_party_id: factor.finance_party_id,
              total_amount: factor.total_amount,
              payable_amount: factor.payable_amount,
            }}
            hideSettlementCta={linkedSettlement !== null}
          />

          {/* MVP posting controls — renders nothing for factors that have not
              yet entered the accounting pipeline (lifecycle_state NULL/draft). */}
          {/* Approval (Approve/Reject) runs first for draft rows; PostingPanel
              takes over once the factor reaches the 'approved' bucket. */}
          {/* Recovery: surfaces when finance_party_id is NULL so the operator
              can repair pre-validation or imported factors and unblock posting. */}
          <FixPartyPanel factor={factor} onChanged={onChanged} />
          <ApprovalPanel factor={factor} onChanged={onChanged} />
          <PostingPanel factor={factor} onChanged={onChanged} />

        </div>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Status badge helpers — keep label + color colocated so the list and the
// active-filter-chip row stay visually consistent.
// -----------------------------------------------------------------------------
const STATUS_META: Record<string, { label: string; cls: string }> = {
  draft:          { label: "پیش‌نویس",          cls: "bg-muted text-muted-foreground" },
  approved:       { label: "تأیید شده",          cls: "bg-primary/15 text-primary" },
  cancelled:      { label: "لغو شده",            cls: "bg-muted text-muted-foreground line-through" },
  posted:         { label: "ثبت شده در سپیدار",  cls: "bg-primary/20 text-primary" },
  voucher_failed: { label: "خطای ساخت سند",      cls: "bg-destructive/15 text-destructive" },
  sepidar_failed: { label: "خطای ثبت سپیدار",    cls: "bg-destructive/15 text-destructive" },
};

// Default page size for the server-side filtered list. The RPC clamps to 500.
const PAGE_SIZE = 50;

export default function Invoices() {
  const navigate = useNavigate();
  // -------------------------------------------------------------------------
  // URL <-> filter state. `useSearchParams` is the single source of truth for
  // the filter values so reload / share-link / back-button "just work".
  // -------------------------------------------------------------------------
  const [searchParams, setSearchParams] = useSearchParams();
  // Initial state derived from the URL on first render. We then keep a local
  // mirror because the filter component is fully controlled.
  const [filters, setFilters] = useState<FactorFiltersValue>(() =>
    searchParamsToFilters(searchParams),
  );
  // `appliedFilters` is what we actually queried with. Separating it from
  // `filters` (the form's draft state) lets users tweak the form without
  // refetching until they hit "اعمال فیلتر".
  const [appliedFilters, setAppliedFilters] = useState<FactorFiltersValue>(filters);

  const [factors, setFactors] = useState<FactorRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Party options for the filter selector. Loaded once at mount; we keep the
  // payload small by only selecting the fields needed for the display label.
  const [partyOptions, setPartyOptions] = useState<Array<{ label: string; value: string }>>([]);
  const [partyLoading, setPartyLoading] = useState(true);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedItems, setSelectedItems] = useState<SpermBuyRow[]>([]);
  const [selectedMilkItems, setSelectedMilkItems] = useState<MilkRow[]>([]);
  const [selectedFeedItems, setSelectedFeedItems] = useState<FeedItemRow[]>([]);
  const [selectedMedicineItems, setSelectedMedicineItems] = useState<MedicineItemRow[]>([]);
  const [selectedLivestockItems, setSelectedLivestockItems] = useState<LivestockItemRow[]>([]);
  // Services factors split across three line-item tables (wage/daily worker/
  // rental) plus examinations which we store in medicine_items. We keep three
  // separate buckets so the renderer can label each section correctly.
  const [selectedWageItems, setSelectedWageItems] = useState<WageItemRow[]>([]);
  const [selectedDailyWorkerItems, setSelectedDailyWorkerItems] = useState<DailyWorkerItemRow[]>([]);
  const [selectedRentalItems, setSelectedRentalItems] = useState<RentalItemRow[]>([]);
  // Mixed-factor rows (factors.product_type='mixed'). One entry per factor_items
  // row, hydrated with the matching factor_item_<type>_details snapshot and a
  // resolved human label for master-table FKs.
  const [selectedMixedItems, setSelectedMixedItems] = useState<MixedItemRow[]>([]);
  // Loading flag drives the spinner + "empty" message inside the detail panel.
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  // -------------------------------------------------------------------------
  // Load finance_parties for the counterparty selector. We compose the same
  // display name the RPC uses so the dropdown matches the list column.
  // -------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("finance_parties")
        .select("id, company_name, first_name, last_name, sepidar_full_name, is_deleted")
        .eq("is_deleted", false)
        .order("sepidar_full_name", { ascending: true, nullsFirst: false })
        .limit(2000);
      if (cancelled) return;
      if (!error && data) {
        const opts = data.map((p) => {
          const person = [p.first_name, p.last_name].filter(Boolean).join(" ").trim();
          const label = p.sepidar_full_name || p.company_name || person || "بدون نام";
          return { label, value: p.id as string };
        });
        setPartyOptions(opts);
      }
      setPartyLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // -------------------------------------------------------------------------
  // Server-side fetch — wraps the new `list_factors_filtered` RPC. We convert
  // the Jalali UI dates to Tehran-anchored timestamptz here so the SQL gets
  // a clean range comparison.
  // -------------------------------------------------------------------------
  const fetchFactors = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    const f = appliedFilters;
    // The picker hands us "YYYY/MM/DD" strings; convert to timestamptz at the
    // exclusive upper bound by adding a day to `to` (RPC uses `< p_to_date`).
    const fromTs = f.fromDate ? jalaliToGregorianTimestamp(f.fromDate, "00:00") : null;
    const toTs = f.toDate ? jalaliToGregorianTimestamp(f.toDate, "23:59") : null;
    // Cast through `never` because the generated types don't yet include
    // this RPC; types will be regenerated on next sync.
    const { data, error } = await supabase.rpc(
      "list_factors_filtered" as never,
      {
        p_from_date: fromTs,
        p_to_date: toTs,
        p_invoice_number: f.invoiceNumber || null,
        p_finance_party_id: f.financePartyId || null,
        p_direction: f.direction || null,
        p_product_types: f.productTypes.length ? f.productTypes : null,
        p_statuses: f.statuses.length ? f.statuses : null,
        p_limit: PAGE_SIZE,
        p_offset: 0,
      } as never,
    );
    if (error) {
      setErrorMsg(error.message || "خطا در بارگذاری فاکتورها");
      setFactors([]);
      setTotalCount(0);
    } else {
      const rows = (data || []) as Array<FactorRow & { total_count: number }>;
      // Cast RPC rows to the page's FactorRow shape. The RPC doesn't return a
      // few rarely-used legacy columns (delivery_date, tax, buyer_type, etc.);
      // we leave those undefined which the detail panel handles gracefully.
      setFactors(rows.map((r) => ({ ...r })));
      setTotalCount(rows.length > 0 ? Number(rows[0].total_count || rows.length) : 0);
    }
    setLoading(false);
  }, [appliedFilters]);

  useEffect(() => {
    fetchFactors();
  }, [fetchFactors]);

  // -------------------------------------------------------------------------
  // Apply handler: commit the draft `filters` to both URL state and the
  // `appliedFilters` query trigger.
  // -------------------------------------------------------------------------
  const handleApply = useCallback(() => {
    setAppliedFilters(filters);
    setSearchParams(filtersToSearchParams(filters), { replace: true });
  }, [filters, setSearchParams]);

  // Remove a single active filter chip. Mirrors the behaviour of `handleApply`
  // for a single dimension so chips feel instant.
  const removeFilterDim = useCallback(
    (patch: Partial<FactorFiltersValue>) => {
      const next = { ...filters, ...patch };
      setFilters(next);
      setAppliedFilters(next);
      setSearchParams(filtersToSearchParams(next), { replace: true });
    },
    [filters, setSearchParams],
  );

  // -------------------------------------------------------------------------
  // Active-filter chips — small dismissible pills shown above the list when
  // at least one filter is set. Computed from `appliedFilters` (not the draft)
  // so the chips reflect what's actually being queried.
  // -------------------------------------------------------------------------
  const activeChips = useMemo(() => {
    const chips: Array<{ key: string; label: string; clear: () => void }> = [];
    const f = appliedFilters;
    if (f.fromDate) {
      chips.push({
        key: "from",
        label: `از ${toPersianDigits(f.fromDate)}`,
        clear: () => removeFilterDim({ fromDate: "" }),
      });
    }
    if (f.toDate) {
      chips.push({
        key: "to",
        label: `تا ${toPersianDigits(f.toDate)}`,
        clear: () => removeFilterDim({ toDate: "" }),
      });
    }
    if (f.invoiceNumber) {
      chips.push({
        key: "num",
        label: `شماره: ${toPersianDigits(f.invoiceNumber)}`,
        clear: () => removeFilterDim({ invoiceNumber: "" }),
      });
    }
    if (f.financePartyId) {
      const party = partyOptions.find((p) => p.value === f.financePartyId);
      chips.push({
        key: "party",
        label: `طرف حساب: ${party?.label || "—"}`,
        clear: () => removeFilterDim({ financePartyId: "" }),
      });
    }
    if (f.direction) {
      chips.push({
        key: "dir",
        label: f.direction === "purchase" ? "خرید" : "فروش",
        clear: () => removeFilterDim({ direction: "" }),
      });
    }
    f.productTypes.forEach((pt) => {
      chips.push({
        key: `cat:${pt}`,
        label: productLabels[pt] || pt,
        clear: () =>
          removeFilterDim({
            productTypes: f.productTypes.filter((x) => x !== pt),
          }),
      });
    });
    f.statuses.forEach((st) => {
      chips.push({
        key: `status:${st}`,
        label: STATUS_META[st]?.label || st,
        clear: () =>
          removeFilterDim({ statuses: f.statuses.filter((x) => x !== st) }),
      });
    });
    return chips;
  }, [appliedFilters, partyOptions, removeFilterDim]);

  // Reset all per-type item state. Used both by close-modal and by
  // prev/next navigation so each new factor renders against a clean slate.
  const resetSelectedItems = () => {
    setSelectedItems([]);
    setSelectedMilkItems([]);
    setSelectedFeedItems([]);
    setSelectedMedicineItems([]);
    setSelectedLivestockItems([]);
    setSelectedWageItems([]);
    setSelectedDailyWorkerItems([]);
    setSelectedRentalItems([]);
    setSelectedMixedItems([]);
    setDetailError(null);
  };

  const handleSelect = async (id: string) => {
    // Toggle off when the same row is clicked again — keeps the legacy
    // "click row to collapse" gesture working alongside the new modal.
    if (selectedId === id) {
      setSelectedId(null);
      resetSelectedItems();
      return;
    }
    setSelectedId(id);
    resetSelectedItems();
    setDetailLoading(true);


    try {
      // The RPC row only includes the fields the list/filter needs. The detail
      // panel renders many more legacy columns (delivery_date, tax, buyer_type,
      // settlement_*, description, etc.) so we lazily fetch the full row + the
      // joined party display name when a row is expanded, then merge it back
      // into `factors` so InvoiceDetail has the complete shape.
      const { data: full, error: fullErr } = await supabase
        .from("factors")
        .select(
          "*, party:finance_party_id(company_name, first_name, last_name, sepidar_full_name)",
        )
        .eq("id", id)
        .maybeSingle();
      if (fullErr) throw fullErr;
      if (full) {
        const raw = full as Record<string, unknown>;
        const party = (raw.party ?? null) as
          | {
              company_name: string | null;
              first_name: string | null;
              last_name: string | null;
              sepidar_full_name: string | null;
            }
          | null;
        const personName = party
          ? [party.first_name, party.last_name].filter(Boolean).join(" ").trim()
          : "";
        const party_name =
          party?.sepidar_full_name || party?.company_name || personName || null;
        const { party: _omit, ...rest } = raw as { party?: unknown };
        const merged = { ...(rest as unknown as FactorRow), party_name };
        setFactors((prev) => prev.map((p) => (p.id === id ? { ...p, ...merged } : p)));
      }

      // Re-read the factor from the freshly-merged list so product_type is
      // correct even when the list row was stale.
      const factor = (full as unknown as FactorRow | null) ?? factors.find((f) => f.id === id) ?? null;
      const pt = factor?.product_type;

      // Fan-out fetch: one query per dedicated items table the product_type
      // is known to use. Manure has no items table yet — the description /
      // totals are rendered from the factor row itself.
      if (pt === "sperm") {
        const { data } = await supabase.from("spermbuy").select("*").eq("factor_id", id);
        setSelectedItems((data as SpermBuyRow[]) || []);
      } else if (pt === "milk") {
        const { data } = await supabase.from("milk").select("*").eq("factor_id", id);
        setSelectedMilkItems((data as MilkRow[]) || []);
      } else if (pt === "feed") {
        const { data } = await supabase.from("feed_items").select("*").eq("factor_id", id);
        setSelectedFeedItems((data as FeedItemRow[]) || []);
      } else if (pt === "medicine") {
        const { data } = await supabase.from("medicine_items").select("*").eq("factor_id", id);
        setSelectedMedicineItems((data as MedicineItemRow[]) || []);
      } else if (pt === "livestock") {
        // Livestock factors store their per-cow lines in `cow_factor_details`.
        // `cow_id` here is an internal UUID — never show that to the operator.
        // We fan out to `public.cows` and prefer `bodynumber` (شماره بدنه),
        // then `tag_number`, then `earnumber` as a last resort. If none
        // exists we display the literal "دام بدون پلاک".
        const { data: cfd } = await supabase
          .from("cow_factor_details")
          .select("id, cow_id, weight, unit_price, row_price, description")
          .eq("factor_id", id);
        const cfdRows = (cfd as Array<Record<string, unknown>> | null) || [];

        // cows.id is a bigint — keep numeric ids for the `.in()` filter, and
        // build the lookup map keyed by string for stable matching.

        const cowIds = Array.from(
          new Set(
            cfdRows
              .map((r) => (r.cow_id != null ? Number(r.cow_id) : NaN))
              .filter((v) => Number.isFinite(v)) as number[],
          ),
        );
        const cowLabelMap = new Map<string, string>();
        if (cowIds.length > 0) {
          const { data: cowRows } = await supabase
            .from("cows")
            .select("id, bodynumber, tag_number, earnumber")
            .in("id", cowIds);
          for (const c of (cowRows as Array<Record<string, unknown>> | null) || []) {
            const label =
              (c.bodynumber != null && String(c.bodynumber).trim()) ||
              (c.tag_number != null && String(c.tag_number).trim()) ||
              (c.earnumber != null && String(c.earnumber).trim()) ||
              "دام بدون پلاک";
            cowLabelMap.set(String(c.id), String(label));
          }
        }

        let rows: LivestockItemRow[] = cfdRows.map((r) => ({
          id: String(r.id),
          // Resolved display label — never the UUID.
          animal_number: r.cow_id != null
            ? (cowLabelMap.get(String(r.cow_id)) ?? "دام بدون پلاک")
            : "دام بدون پلاک",
          weight_kg: (r.weight as number | null) ?? null,
          price_per_kg: (r.unit_price as number | null) ?? null,
          row_total: (r.row_price as number | null) ?? null,
          description: (r.description as string | null) ?? null,
        }));
        if (rows.length === 0) {
          const { data } = await supabase
            .from("livestock_items")
            .select("*")
            .eq("factor_id", id);
          rows = (data as LivestockItemRow[]) || [];
        }
        setSelectedLivestockItems(rows);


      } else if (pt === "services") {
        // Services pull from up to FOUR tables in parallel — wage, daily
        // worker, rental, and medicine_items (medicine_type='معاینات' is the
        // examination sub-flow which reuses the medicine table per NewInvoice).
        const [wageRes, dwRes, rentalRes, examRes] = await Promise.all([
          (supabase as unknown as { from: (t: string) => { select: (s: string) => { eq: (c: string, v: string) => Promise<{ data: unknown }> } } })
            .from("wage_items").select("*").eq("factor_id", id),
          (supabase as unknown as { from: (t: string) => { select: (s: string) => { eq: (c: string, v: string) => Promise<{ data: unknown }> } } })
            .from("daily_worker_items").select("*").eq("factor_id", id),
          (supabase as unknown as { from: (t: string) => { select: (s: string) => { eq: (c: string, v: string) => Promise<{ data: unknown }> } } })
            .from("rental_items").select("*").eq("factor_id", id),
          supabase.from("medicine_items").select("*").eq("factor_id", id),
        ]);
        setSelectedWageItems((wageRes.data as WageItemRow[]) || []);
        setSelectedDailyWorkerItems((dwRes.data as DailyWorkerItemRow[]) || []);
        setSelectedRentalItems((rentalRes.data as RentalItemRow[]) || []);
        setSelectedMedicineItems((examRes.data as MedicineItemRow[]) || []);
      } else if (pt === "mixed") {
        // -----------------------------------------------------------------
        // Mixed factor — created by MixedInvoiceForm. The header lives in
        // `factors` with product_type='mixed'; each line is a `factor_items`
        // row whose per-type fields live in `factor_item_<type>_details`
        // keyed by factor_item_id. We fetch all detail tables in parallel
        // and join in memory so a single map() builds the display rows
        // regardless of how many product types the operator mixed.
        // -----------------------------------------------------------------
        // Cast the typed supabase client to a loose shape so we can hit
        // dynamic detail-table names that are not in the generated types yet.
        const sbAny = supabase as unknown as {
          from: (t: string) => {
            select: (s: string) => {
              in: (c: string, v: string[]) => Promise<{ data: unknown }>;
            };
          };
        };
        const itemsRes = await supabase
          .from("factor_items")
          .select("*")
          .eq("factor_id", id)
          .order("row_number", { ascending: true });
        const itemRows = (itemsRes.data as Array<Record<string, unknown>> | null) || [];
        const itemIds = itemRows.map((r) => String(r.id));

        // Fan-out detail fetches. Each detail table is keyed by
        // factor_item_id which is unique per row, so `.in(...)` returns at
        // most one record per item. We tolerate missing tables (legacy DBs)
        // by swallowing errors per fetch — the row still renders using the
        // shared factor_items fields if its detail snapshot is absent.
        const detailTables = [
          "factor_item_livestock_details",
          "factor_item_feed_details",
          "factor_item_medicine_details",
          "factor_item_sperm_details",
          "factor_item_milk_details",
          "factor_item_manure_details",
          "factor_item_service_details",
          "factor_item_rental_details",
          "factor_item_other_details",
        ] as const;

        const detailByItem = new Map<string, Record<string, unknown>>();
        if (itemIds.length > 0) {
          await Promise.all(
            detailTables.map(async (tbl) => {
              try {
                const { data } = await sbAny
                  .from(tbl)
                  .select("*")
                  .in("factor_item_id", itemIds);
                for (const row of ((data as Array<Record<string, unknown>> | null) || [])) {
                  detailByItem.set(String(row.factor_item_id), row);
                }
              } catch {
                // Detail table missing or RLS denied — ignore, fall back to shared fields.
              }
            }),
          );
        }

        // Resolve cow labels for livestock rows (cow_id is an internal bigint
        // we must not show to operators — prefer bodynumber / tag_number /
        // earnumber, exactly like the single-product livestock branch above).
        const cowIds = Array.from(
          new Set(
            itemRows
              .map((r) => detailByItem.get(String(r.id))?.cow_id)
              .filter((v) => v != null)
              .map((v) => Number(v))
              .filter((v) => Number.isFinite(v)),
          ),
        ) as number[];
        const cowLabelMap = new Map<string, string>();
        if (cowIds.length > 0) {
          const { data: cows } = await supabase
            .from("cows")
            .select("id, bodynumber, tag_number, earnumber")
            .in("id", cowIds);
          for (const c of ((cows as Array<Record<string, unknown>> | null) || [])) {
            const label =
              (c.bodynumber != null && String(c.bodynumber).trim()) ||
              (c.tag_number != null && String(c.tag_number).trim()) ||
              (c.earnumber != null && String(c.earnumber).trim()) ||
              "دام بدون پلاک";
            cowLabelMap.set(String(c.id), String(label));
          }
        }

        const mixedRows: MixedItemRow[] = itemRows.map((r) => {
          const det = detailByItem.get(String(r.id)) || {};
          const pType = String(r.product_type ?? "other");
          // Build a friendly per-row label so the operator sees the master
          // record (cow plaque, feed/medicine commercial name, sperm code…)
          // instead of a UUID. Each branch reads the columns that branch's
          // detail table is known to have.
          let label: string | null = null;
          if (pType === "livestock" && det.cow_id != null) {
            label = cowLabelMap.get(String(det.cow_id)) ?? "دام بدون پلاک";
          } else if (pType === "feed") {
            label =
              (det.commercial_product_name_fa as string | null) ||
              (det.name_fa as string | null) ||
              (det.feed_name as string | null) ||
              (det.feed_code as string | null) ||
              null;
          } else if (pType === "medicine") {
            label =
              (det.commercial_product_name_fa as string | null) ||
              (det.medicine_name as string | null) ||
              null;
          } else if (pType === "sperm") {
            const code = (det.bull_code as string | null) || "";
            const name = (det.bull_name as string | null) || "";
            label = `${code}${name ? " - " + name : ""}`.trim() || null;
          } else if (pType === "manure") {
            label = (det.manure_type as string | null) || null;
          } else if (pType === "services") {
            label =
              (det.service_name as string | null) ||
              (det.service_code as string | null) ||
              null;
          } else if (pType === "rental") {
            label = (det.purpose as string | null) || (det.driver_name as string | null) || null;
          } else if (pType === "other") {
            label = (det.item_name as string | null) || null;
          }

          return {
            id: String(r.id),
            row_number: (r.row_number as number | null) ?? null,
            product_type: pType,
            quantity: (r.quantity as number | null) ?? null,
            unit: (r.unit as string | null) ?? null,
            unit_price: (r.unit_price as number | null) ?? null,
            discount_amount: (r.discount_amount as number | null) ?? null,
            tax_amount: (r.tax_amount as number | null) ?? null,
            total_amount: (r.total_amount as number | null) ?? null,
            description: (r.description as string | null) ?? null,
            details: det,
            display_label: label,
          };
        });
        setSelectedMixedItems(mixedRows);
      }
      // Note: "manure" / "other" / legacy_product_* have no dedicated items
      // table — the detail panel renders factor.description + totals only.
    } catch (e) {
      setDetailError((e as Error).message || "خطا در بارگذاری جزئیات فاکتور");
    } finally {
      setDetailLoading(false);
    }
  };

  const selectedFactor = factors.find((f) => f.id === selectedId);
  // Index of the open factor inside the currently filtered/sorted list — drives
  // the Previous / Next buttons inside the detail modal so the operator can
  // browse without scrolling back to the row, and without losing their place.
  const selectedIndex = selectedFactor
    ? factors.findIndex((f) => f.id === selectedId)
    : -1;
  const prevFactor = selectedIndex > 0 ? factors[selectedIndex - 1] : null;
  const nextFactor =
    selectedIndex >= 0 && selectedIndex < factors.length - 1
      ? factors[selectedIndex + 1]
      : null;
  const closeDetail = () => {
    setSelectedId(null);
    resetSelectedItems();
  };
  const activeFiltersExist = hasActiveFilters(appliedFilters);


  return (
    <div className="py-6 space-y-4 animate-fade-in">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-heading text-foreground">فاکتورها</h1>
        {/* Always-visible CTA — primary entry point for ثبت فاکتور خرید و فروش. */}
        <Button
          onClick={() => navigate("/invoices/new")}
          className="rounded-xl gap-2 bg-gradient-primary text-primary-foreground glow-primary"
        >
          <Plus className="w-4 h-4" />
          ثبت فاکتور خرید و فروش
        </Button>
      </div>

      {/* Advanced filter panel — inline on lg+, drawer on mobile. */}
      <FactorFilters
        value={filters}
        onChange={setFilters}
        onApply={handleApply}
        partyOptions={partyOptions}
        partyLoading={partyLoading}
      />

      {/* Active filter chips row — only when at least one filter is applied. */}
      {activeFiltersExist && activeChips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">فیلترهای فعال:</span>
          {activeChips.map((chip) => (
            <button
              key={chip.key}
              onClick={chip.clear}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-primary/10 text-primary border border-primary/20 hover:bg-primary/15 transition-colors"
            >
              {chip.label}
              <X className="w-3 h-3" />
            </button>
          ))}
        </div>
      )}

      {/* Detail modal — replaces the legacy inline top-of-page panel so the
          user keeps their scroll position when opening a row. On desktop it
          renders as a centered max-w-3xl dialog; on mobile we expand it to
          ~95vw / 95vh which gives a near full-screen sheet feel without
          requiring a separate Sheet component. */}
      <Dialog
        open={!!selectedFactor}
        onOpenChange={(open) => {
          if (!open) closeDetail();
        }}
      >
        <DialogContent
          dir="rtl"
          className="max-w-3xl w-[95vw] max-h-[90vh] overflow-hidden p-0 gap-0 flex flex-col"
        >
          {selectedFactor && (
            <>
              {/* Scrollable body — keeps the prev/next bar pinned at the bottom. */}
              <div className="flex-1 overflow-y-auto p-4">
                <InvoiceDetail
                  factor={selectedFactor}
                  items={selectedItems}
                  milkItems={selectedMilkItems}
                  feedItems={selectedFeedItems}
                  medicineItems={selectedMedicineItems}
                  livestockItems={selectedLivestockItems}
                  wageItems={selectedWageItems}
                  dailyWorkerItems={selectedDailyWorkerItems}
                  rentalItems={selectedRentalItems}
                  mixedItems={selectedMixedItems}
                  loading={detailLoading}
                  errorMsg={detailError}
                  onChanged={fetchFactors}
                  onClose={closeDetail}
                />
              </div>

              {/* Prev / Next navigation bar — follows the current filtered &
                  sorted factors list order so it matches what the operator
                  sees in the table. Buttons are disabled at the boundaries. */}
              <div className="flex items-center justify-between gap-2 border-t border-border bg-card px-4 py-3">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!prevFactor || detailLoading}
                  onClick={() => prevFactor && handleSelect(prevFactor.id)}
                  className="gap-1"
                >
                  <ChevronRight className="w-4 h-4" />
                  فاکتور قبلی
                </Button>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {selectedIndex >= 0
                    ? `${toPersianDigits(String(selectedIndex + 1))} / ${toPersianDigits(String(factors.length))}`
                    : ""}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!nextFactor || detailLoading}
                  onClick={() => nextFactor && handleSelect(nextFactor.id)}
                  className="gap-1"
                >
                  فاکتور بعدی
                  <ChevronLeft className="w-4 h-4" />
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>


      {/* Result count + loading + error states */}
      {errorMsg && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {errorMsg}
        </div>
      )}

      {loading ? (
        <div className="py-20 flex justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : factors.length === 0 ? (
        <div className="text-center py-16 space-y-3">
          <div className="w-16 h-16 mx-auto rounded-full bg-muted flex items-center justify-center">
            <FileText className="w-7 h-7 text-muted-foreground" />
          </div>
          <p className="text-body text-muted-foreground">
            {activeFiltersExist
              ? "فاکتوری با این فیلترها یافت نشد"
              : "هنوز فاکتوری ثبت نشده"}
          </p>
          {!activeFiltersExist && (
            <Button
              onClick={() => navigate("/invoices/new")}
              variant="outline"
              className="rounded-xl gap-2 transition-all duration-200 hover:shadow-[0_2px_12px_-2px_hsl(142_50%_36%/0.15)] hover:border-primary/20"
            >
              <Plus className="w-4 h-4" />
              ثبت فاکتور جدید
            </Button>
          )}
        </div>
      ) : (
        <>
          <div className="text-xs text-muted-foreground">
            نمایش {toPersianDigits(String(factors.length))} از{" "}
            {toPersianDigits(String(totalCount))} فاکتور
            {totalCount > PAGE_SIZE && " (برای دیدن بقیه، فیلترها را محدودتر کنید)"}
          </div>
          <div className="space-y-3">
            {factors.map((f) => {
              // Map RPC `derived_status` (preferred) to badge metadata; fall
              // back to lifecycle_state for any non-RPC code paths.
              const statusKey = f.derived_status || f.lifecycle_state || "draft";
              const status = STATUS_META[statusKey] || STATUS_META.draft;
              return (
                <button
                  key={f.id}
                  onClick={() => handleSelect(f.id)}
                  className={cn(
                    "w-full text-right rounded-xl border bg-card p-4 space-y-2 transition-all duration-200 hover:shadow-[0_4px_20px_-4px_hsl(142_50%_36%/0.2)] hover:border-primary/20",
                    selectedId === f.id ? "border-primary/30 shadow-[0_4px_20px_-4px_hsl(142_50%_36%/0.15)]" : "border-border",
                  )}
                >
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="inline-block px-2 py-0.5 rounded-md bg-primary/10 text-primary text-xs font-bold">
                        {productLabels[f.product_type] || f.product_type}
                      </span>
                      <span className="inline-block px-2 py-0.5 rounded-md bg-secondary text-secondary-foreground text-xs font-medium">
                        {/* Prefer canonical factor_type_id direction label;
                            fall back to legacy invoice_type for old rows. */}
                        {f.factor_type_id === 1
                          ? "خرید"
                          : f.factor_type_id === 2
                          ? "فروش"
                          : invoiceTypeLabels[f.invoice_type] || f.invoice_type}
                      </span>
                      <span
                        className={cn(
                          "inline-block px-2 py-0.5 rounded-md text-xs font-medium",
                          status.cls,
                        )}
                      >
                        {status.label}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-muted-foreground">
                        {formatShamsi(f.invoice_date)}
                      </span>
                      <ChevronDown className={cn("w-4 h-4 text-muted-foreground transition-transform duration-200", selectedId === f.id && "rotate-180")} />
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">شماره: {toPersianDigits(f.invoice_number || "—")}</span>
                    <span className="text-body font-bold text-primary">
                      {toPersianDigits((f.payable_amount || 0).toLocaleString("en-US"))} ریال
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    طرف حساب: {f.party_name || f.company || "—"}
                  </div>
                  {/* Show last posting error inline on failed rows so the
                      operator doesn't need to open the detail panel to triage
                      a Sepidar/voucher failure. */}
                  {f.last_posting_error &&
                    (statusKey === "voucher_failed" || statusKey === "sepidar_failed") && (
                      <div className="text-xs text-destructive bg-destructive/5 rounded-lg p-2">
                        {f.last_posting_error}
                      </div>
                    )}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

