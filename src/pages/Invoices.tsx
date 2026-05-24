import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ChevronDown, FileText, Plus, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
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

const productLabels: Record<string, string> = {
  sperm: "اسپرم",
  milk: "شیر",
  feed: "خوراک",
  medicine: "دارو",
  livestock: "دام",
  // Manure (کود دامی): single product_type — direction (خرید/فروش) is shown
  // via the separate invoice_type badge, identical to the خوراک treatment.
  manure: "کود دامی",
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
// Current truth (audited 2026-05-24 against factor_accounting_map):
//   - Only `product_type = 'livestock'` has accounting map rows wired into the
//     `post_approved_factor` engine. So that is the only type for which we
//     surface the "Post to Sepidar" button via the MVP voucher pipeline.
//   - Feed *sales* must NEVER show Sepidar posting yet (explicit M5 rule).
//   - Feed *purchase* historically used the legacy `sync_queue` worker path,
//     not the voucher engine. We intentionally do NOT resurface that button
//     here until that pipeline is reconnected — showing it would just fail
//     with "no accounting map" because the engine doesn't know feed yet.
// =============================================================================
const POSTING_SUPPORTED_PRODUCT_TYPES = new Set<string>(["livestock"]);

function isFeedSale(f: FactorRow): boolean {
  return (
    f.product_type === "feed" &&
    (f.factor_type_id === 2 || f.invoice_type === "sell" || f.invoice_type === "retail_sell")
  );
}

function supportsSepidarPosting(f: FactorRow): boolean {
  // Feed sales rule wins over everything else.
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
  const isPosted = state === "posted" && !!factor.sepidar_voucher_number;
  const canPost = ["approved", "voucher_failed", "sepidar_failed"].includes(state);
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
            ثبت شده • سپیدار {toPersianDigits(factor.sepidar_voucher_number || "")}
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
    </div>
  );
}

function InvoiceDetail({ factor, items, milkItems, feedItems, medicineItems, livestockItems, onClose, onChanged }: { factor: FactorRow; items: SpermBuyRow[]; milkItems: MilkRow[]; feedItems: FeedItemRow[]; medicineItems: MedicineItemRow[]; livestockItems: LivestockItemRow[]; onClose: () => void; onChanged: () => void }) {
  // Group C: factor.invoice_date is now a Gregorian timestamptz coming from
  // PostgreSQL. Render it through formatShamsi so the user still sees a
  // Jalali/Persian date — never pipe a raw timestamp through toPersianDigits.
  const dateStr = factor.invoice_date ? formatShamsi(factor.invoice_date) : "—";

  return (
    <div className="animate-fade-in">
      <div className="rounded-2xl border-2 border-dashed border-primary/30 bg-card overflow-hidden">
        <div className="bg-primary/5 border-b border-primary/10 p-4 flex items-center justify-between">
          <h2 className="text-body-lg font-bold text-primary">جزئیات فاکتور</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg border border-border flex items-center justify-center transition-all duration-200 hover:bg-secondary hover:shadow-[0_2px_12px_-2px_hsl(142_50%_36%/0.15)]"
          >
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        <div className="p-5 space-y-1">
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

          {/* MVP posting controls — renders nothing for factors that have not
              yet entered the accounting pipeline (lifecycle_state NULL/draft). */}
          {/* Approval (Approve/Reject) runs first for draft rows; PostingPanel
              takes over once the factor reaches the 'approved' bucket. */}
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

  const handleSelect = async (id: string) => {
    if (selectedId === id) {
      setSelectedId(null);
      setSelectedItems([]);
      setSelectedMilkItems([]);
      setSelectedFeedItems([]);
      setSelectedMedicineItems([]);
      setSelectedLivestockItems([]);
      return;
    }
    setSelectedId(id);
    setSelectedItems([]);
    setSelectedMilkItems([]);
    setSelectedFeedItems([]);
    setSelectedMedicineItems([]);
    setSelectedLivestockItems([]);

    // The RPC row only includes the fields the list/filter needs. The detail
    // panel renders many more legacy columns (delivery_date, tax, buyer_type,
    // settlement_*, description, etc.) so we lazily fetch the full row + the
    // joined party display name when a row is expanded, then merge it back
    // into `factors` so InvoiceDetail has the complete shape.
    const { data: full } = await supabase
      .from("factors")
      .select(
        "*, party:finance_party_id(company_name, first_name, last_name, sepidar_full_name)",
      )
      .eq("id", id)
      .maybeSingle();
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

    const factor = factors.find((f) => f.id === id);
    if (factor?.product_type === "sperm") {
      const { data } = await supabase
        .from("spermbuy")
        .select("*")
        .eq("factor_id", id);
      setSelectedItems((data as SpermBuyRow[]) || []);
    } else if (factor?.product_type === "milk") {
      const { data } = await supabase.from("milk").select("*").eq("factor_id", id);
      setSelectedMilkItems((data as MilkRow[]) || []);
    } else if (factor?.product_type === "feed") {
      const { data } = await supabase.from("feed_items").select("*").eq("factor_id", id);
      setSelectedFeedItems((data as FeedItemRow[]) || []);
    } else if (factor?.product_type === "medicine") {
      const { data } = await supabase.from("medicine_items").select("*").eq("factor_id", id);
      setSelectedMedicineItems((data as MedicineItemRow[]) || []);
    } else if (factor?.product_type === "livestock") {
      const { data } = await supabase.from("livestock_items").select("*").eq("factor_id", id);
      setSelectedLivestockItems((data as LivestockItemRow[]) || []);
    }
    // Note: "other" product type stores item info in factor.description (no dedicated table yet)
  };

  const selectedFactor = factors.find((f) => f.id === selectedId);
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

      {selectedFactor && (
        <InvoiceDetail
          factor={selectedFactor}
          items={selectedItems}
          milkItems={selectedMilkItems}
          feedItems={selectedFeedItems}
          medicineItems={selectedMedicineItems}
          livestockItems={selectedLivestockItems}
          onChanged={fetchFactors}
          onClose={() => {
            setSelectedId(null);
            setSelectedItems([]);
            setSelectedMilkItems([]);
            setSelectedFeedItems([]);
            setSelectedMedicineItems([]);
            setSelectedLivestockItems([]);
          }}
        />
      )}

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

