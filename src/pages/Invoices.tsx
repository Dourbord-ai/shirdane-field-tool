import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronDown, FileText, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { toPersianDigits } from "@/lib/jalali";
import { cn } from "@/lib/utils";

interface StoredInvoice {
  id: string;
  productType: string;
  invoiceType: string;
  date: { year: number; month: number; day: number } | null;
  invoiceNumber: string;
  payable: number;
  totalProduct: number;
  discount: number;
  shipping: number;
  taxAmount: number;
  tax: string;
  sellerType: string;
  company: string;
  spermCode: string;
  quantity: string;
  unitPrice: string;
  description: string;
  settlement: string;
  createdAt: string;
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
};

const spermLabels: Record<string, string> = {
  trivia: "Trivia",
  kio: "Kio",
  sahara: "Sahara",
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

function InvoiceDetail({ inv, onClose }: { inv: StoredInvoice; onClose: () => void }) {
  const dateStr = inv.date
    ? toPersianDigits(`${inv.date.year}/${String(inv.date.month).padStart(2, "0")}/${String(inv.date.day).padStart(2, "0")}`)
    : "—";

  return (
    <div className="animate-fade-in">
      {/* Receipt-style card */}
      <div className="rounded-2xl border-2 border-dashed border-primary/30 bg-card overflow-hidden">
        {/* Header */}
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
          {/* Top badges */}
          <div className="flex items-center gap-2 mb-3">
            <span className="px-2.5 py-1 rounded-lg bg-primary/10 text-primary text-xs font-bold">
              {productLabels[inv.productType] || inv.productType}
            </span>
            <span className="px-2.5 py-1 rounded-lg bg-secondary text-secondary-foreground text-xs font-bold">
              {invoiceTypeLabels[inv.invoiceType] || inv.invoiceType}
            </span>
          </div>

          <DetailRow label="شماره فاکتور" value={toPersianDigits(inv.invoiceNumber || "—")} />
          <DetailRow label="تاریخ" value={dateStr} />
          <DetailRow label="فروشنده" value={inv.sellerType === "company" ? (companyLabels[inv.company] || inv.company) : "شخص"} />

          {inv.productType === "sperm" && inv.spermCode && (
            <DetailRow label="کد اسپرم" value={spermLabels[inv.spermCode] || inv.spermCode} />
          )}

          <DetailRow label="تعداد" value={toPersianDigits(inv.quantity || "0")} />
          <DetailRow label="قیمت واحد" value={formatRial(parseInt(inv.unitPrice) || 0)} />

          <Separator className="my-2" />

          <DetailRow label="مبلغ کل" value={formatRial(inv.totalProduct || 0)} />

          {(inv.discount || 0) > 0 && (
            <DetailRow label="تخفیف" value={formatRial(inv.discount)} />
          )}

          {(inv.shipping || 0) > 0 && (
            <DetailRow label="کرایه حمل و نقل" value={formatRial(inv.shipping)} />
          )}

          {inv.tax === "yes" && (
            <DetailRow label="مالیات (۱۰٪)" value={formatRial(inv.taxAmount || 0)} />
          )}

          <DetailRow label="مبلغ قابل پرداخت" value={formatRial(inv.payable || 0)} bold />

          <Separator className="my-2" />

          <DetailRow label="نوع تسویه" value={settlementLabels[inv.settlement] || inv.settlement || "—"} />

          {inv.description && (
            <div className="pt-2">
              <p className="text-xs text-muted-foreground mb-1">توضیحات:</p>
              <p className="text-sm text-foreground bg-secondary/50 rounded-lg p-3">{inv.description}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Invoices() {
  const navigate = useNavigate();
  const [invoices, setInvoices] = useState<StoredInvoice[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    const stored = JSON.parse(localStorage.getItem("shirdaneh_invoices") || "[]");
    setInvoices(stored.reverse());
  }, []);

  const selectedInvoice = invoices.find((inv) => inv.id === selectedId);

  return (
    <div className="py-6 space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <h1 className="text-heading text-foreground">فاکتورها</h1>
        <Button
          onClick={() => navigate("/invoices/new")}
          size="sm"
          className="rounded-xl gap-1 transition-all duration-200 hover:shadow-[0_2px_12px_-2px_hsl(142_50%_36%/0.2)]"
        >
          <Plus className="w-4 h-4" />
          جدید
        </Button>
      </div>

      {/* Detail overlay */}
      {selectedInvoice && (
        <InvoiceDetail inv={selectedInvoice} onClose={() => setSelectedId(null)} />
      )}

      {invoices.length === 0 ? (
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
          {invoices.map((inv) => (
            <button
              key={inv.id}
              onClick={() => setSelectedId(selectedId === inv.id ? null : inv.id)}
              className={cn(
                "w-full text-right rounded-xl border bg-card p-4 space-y-2 transition-all duration-200 hover:shadow-[0_4px_20px_-4px_hsl(142_50%_36%/0.2)] hover:border-primary/20",
                selectedId === inv.id ? "border-primary/30 shadow-[0_4px_20px_-4px_hsl(142_50%_36%/0.15)]" : "border-border"
              )}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="inline-block px-2 py-0.5 rounded-md bg-primary/10 text-primary text-xs font-bold">
                    {productLabels[inv.productType] || inv.productType}
                  </span>
                  <span className="inline-block px-2 py-0.5 rounded-md bg-secondary text-secondary-foreground text-xs font-medium">
                    {invoiceTypeLabels[inv.invoiceType] || inv.invoiceType}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-xs text-muted-foreground">
                    {inv.date
                      ? toPersianDigits(`${inv.date.year}/${String(inv.date.month).padStart(2, "0")}/${String(inv.date.day).padStart(2, "0")}`)
                      : "—"}
                  </span>
                  <ChevronDown className={cn("w-4 h-4 text-muted-foreground transition-transform duration-200", selectedId === inv.id && "rotate-180")} />
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">شماره: {toPersianDigits(inv.invoiceNumber || "—")}</span>
                <span className="text-body font-bold text-primary">
                  {toPersianDigits(inv.payable?.toLocaleString("en-US") || "0")} ریال
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
