import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { FileText, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toPersianDigits } from "@/lib/jalali";

interface StoredInvoice {
  id: string;
  productType: string;
  invoiceType: string;
  date: { year: number; month: number; day: number } | null;
  invoiceNumber: string;
  payable: number;
  createdAt: string;
  settlement: string;
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

export default function Invoices() {
  const navigate = useNavigate();
  const [invoices, setInvoices] = useState<StoredInvoice[]>([]);

  useEffect(() => {
    const stored = JSON.parse(localStorage.getItem("shirdaneh_invoices") || "[]");
    setInvoices(stored.reverse());
  }, []);

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
            <div
              key={inv.id}
              className="rounded-xl border border-border bg-card p-4 space-y-2 transition-all duration-200 hover:shadow-[0_4px_20px_-4px_hsl(142_50%_36%/0.2)] hover:border-primary/20"
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
                <span className="text-xs text-muted-foreground">
                  {inv.date
                    ? toPersianDigits(`${inv.date.year}/${String(inv.date.month).padStart(2, "0")}/${String(inv.date.day).padStart(2, "0")}`)
                    : "—"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">شماره: {toPersianDigits(inv.invoiceNumber || "—")}</span>
                <span className="text-body font-bold text-primary">
                  {toPersianDigits(inv.payable?.toLocaleString("en-US") || "0")} ریال
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
