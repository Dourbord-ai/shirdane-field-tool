import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
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
// PostingPanel: minimal MVP UI for the accounting voucher posting pipeline.
// -----------------------------------------------------------------------------
// We deliberately keep this UI very small (status badge + one action button +
// last-error text) per the MVP scope: no mapping editor, no reversal UI, no
// adoption flow, no advanced dashboard. The button just invokes the
// `factor-post-voucher` edge function which:
//   - resolves active factor_accounting_map rows
//   - refuses to proceed if rows are missing/inactive/TBD (clear Persian err)
//   - creates finance_voucher + items, validates debit=credit
//   - tries to post to Sepidar via the same edge function pattern as
//     receive/payment flows, persists the Sepidar voucher number on success
//
// The button is shown for any lifecycle_state in {approved, voucher_failed,
// sepidar_failed}. Posted factors show a green "ثبت شده" badge instead.
function PostingPanel({ factor, onChanged }: { factor: FactorRow; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [resultMsg, setResultMsg] = useState<string | null>(null);
  const [resultOk, setResultOk] = useState<boolean | null>(null);

  const state = factor.lifecycle_state ?? "";
  const isPosted = state === "posted" && !!factor.sepidar_voucher_number;
  const canPost = ["approved", "voucher_failed", "sepidar_failed"].includes(state);
  // If the factor was never moved into the posting pipeline (lifecycle_state
  // is NULL or any other value like 'draft'), we render a passive info hint
  // — there is no MVP UI for "approve" because that flow is owned elsewhere.
  const showNothing = !isPosted && !canPost;

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

      {canPost && (
        <Button
          onClick={handlePost}
          disabled={busy}
          className="rounded-xl gap-2 bg-gradient-primary text-primary-foreground glow-primary w-full"
        >
          {busy && <Loader2 className="w-4 h-4 animate-spin" />}
          {state === "approved" ? "ثبت سند مالی" : "تلاش مجدد"}
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
              factor.buyer_type === "company"
                ? (factor.company || "شرکت")
                : "شخص"
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
          <PostingPanel factor={factor} onChanged={onChanged} />
        </div>
      </div>
    </div>
  );
}

export default function Invoices() {
  const navigate = useNavigate();
  const [factors, setFactors] = useState<FactorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedItems, setSelectedItems] = useState<SpermBuyRow[]>([]);
  const [selectedMilkItems, setSelectedMilkItems] = useState<MilkRow[]>([]);
  const [selectedFeedItems, setSelectedFeedItems] = useState<FeedItemRow[]>([]);
  const [selectedMedicineItems, setSelectedMedicineItems] = useState<MedicineItemRow[]>([]);
  const [selectedLivestockItems, setSelectedLivestockItems] = useState<LivestockItemRow[]>([]);

  // Extracted so PostingPanel can call it to refresh after a post attempt —
  // this is how the badge + error text update without a full page reload.
  const fetchFactors = async () => {
    const { data, error } = await supabase
      .from("factors")
      .select("*")
      .order("created_at", { ascending: false });

    if (!error && data) {
      setFactors(data as FactorRow[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchFactors();
  }, []);

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

  if (loading) {
    return (
      <div className="py-20 flex justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="py-6 space-y-4 animate-fade-in">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-heading text-foreground">فاکتورها</h1>
        {/* Always-visible CTA — primary entry point for ثبت فاکتور خرید و فروش.
            Previously only rendered in the empty state, which hid it once any
            factor existed. Surfacing it in the header keeps it discoverable. */}
        <Button
          onClick={() => navigate("/invoices/new")}
          className="rounded-xl gap-2 bg-gradient-primary text-primary-foreground glow-primary"
        >
          <Plus className="w-4 h-4" />
          ثبت فاکتور خرید و فروش
        </Button>
      </div>

      {selectedFactor && (
        <InvoiceDetail factor={selectedFactor} items={selectedItems} milkItems={selectedMilkItems} feedItems={selectedFeedItems} medicineItems={selectedMedicineItems} livestockItems={selectedLivestockItems} onChanged={fetchFactors} onClose={() => { setSelectedId(null); setSelectedItems([]); setSelectedMilkItems([]); setSelectedFeedItems([]); setSelectedMedicineItems([]); setSelectedLivestockItems([]); }} />
      )}

      {factors.length === 0 ? (
        <div className="text-center py-16 space-y-3">
          <div className="w-16 h-16 mx-auto rounded-full bg-muted flex items-center justify-center">
            <FileText className="w-7 h-7 text-muted-foreground" />
          </div>
          <p className="text-body text-muted-foreground">هنوز فاکتوری ثبت نشده</p>
          <Button
            onClick={() => navigate("/invoices/new")}
            variant="outline"
            className="rounded-xl gap-2 transition-all duration-200 hover:shadow-[0_2px_12px_-2px_hsl(142_50%_36%/0.15)] hover:border-primary/20"
          >
            <Plus className="w-4 h-4" />
            ثبت فاکتور جدید
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {factors.map((f) => (
            <button
              key={f.id}
              onClick={() => handleSelect(f.id)}
              className={cn(
                "w-full text-right rounded-xl border bg-card p-4 space-y-2 transition-all duration-200 hover:shadow-[0_4px_20px_-4px_hsl(142_50%_36%/0.2)] hover:border-primary/20",
                selectedId === f.id ? "border-primary/30 shadow-[0_4px_20px_-4px_hsl(142_50%_36%/0.15)]" : "border-border"
              )}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="inline-block px-2 py-0.5 rounded-md bg-primary/10 text-primary text-xs font-bold">
                    {productLabels[f.product_type] || f.product_type}
                  </span>
                  <span className="inline-block px-2 py-0.5 rounded-md bg-secondary text-secondary-foreground text-xs font-medium">
                    {invoiceTypeLabels[f.invoice_type] || f.invoice_type}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-xs text-muted-foreground">
                    {/* Always render via the universal Shamsi helper so an ISO date
                        like "2025-05-12" is converted to "۱۴۰۴/۰۲/۲۲" instead of
                        being shown as Gregorian numerals. The helper also handles
                        the case where invoice_date is already a Shamsi string. */}
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
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
