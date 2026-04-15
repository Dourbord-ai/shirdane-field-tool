import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronDown, FileText, Plus, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { toPersianDigits } from "@/lib/jalali";
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
  company: string | null;
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

function InvoiceDetail({ factor, items, milkItems, onClose }: { factor: FactorRow; items: SpermBuyRow[]; milkItems: MilkRow[]; onClose: () => void }) {
  const dateStr = factor.invoice_date ? toPersianDigits(factor.invoice_date) : "—";

  return (
    <div className="animate-fade-in">
      <div className="rounded-2xl border-2 border-dashed border-primary/30 bg-card overflow-hidden">
        <div className="bg-primary/5 border-b border-primary/10 p-4 flex items-center justify-between">
          <h2 className="text-body-lg font-bold text-foreground">جزئیات فاکتور</h2>
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
          {factor.delivery_date && <DetailRow label="تاریخ تحویل" value={toPersianDigits(factor.delivery_date)} />}
          <DetailRow
            label="فروشنده/خریدار"
            value={
              factor.buyer_type === "company"
                ? (companyLabels[factor.company || ""] || factor.company || "شرکت")
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

  useEffect(() => {
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
    fetchFactors();
  }, []);

  const handleSelect = async (id: string) => {
    if (selectedId === id) {
      setSelectedId(null);
      setSelectedItems([]);
      return;
    }
    setSelectedId(id);

    const factor = factors.find((f) => f.id === id);
    if (factor?.product_type === "sperm") {
      const { data } = await supabase
        .from("spermbuy")
        .select("*")
        .eq("factor_id", id);
      setSelectedItems((data as SpermBuyRow[]) || []);
    } else {
      setSelectedItems([]);
    }
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
      <div className="flex items-center">
        <h1 className="text-heading text-foreground">فاکتورها</h1>
      </div>

      {selectedFactor && (
        <InvoiceDetail factor={selectedFactor} items={selectedItems} onClose={() => { setSelectedId(null); setSelectedItems([]); }} />
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
                    {f.invoice_date ? toPersianDigits(f.invoice_date) : "—"}
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
