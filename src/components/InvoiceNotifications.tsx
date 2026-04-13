import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { FileText, X, Bell } from "lucide-react";
import { toPersianDigits, jalaliMonthNames } from "@/lib/jalali";

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

function formatDateTime(dateStr: string): string {
  const date = new Date(dateStr);
  const jalali = new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
  const time = new Intl.DateTimeFormat("fa-IR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
  return `${jalali} · ${time}`;
}

interface SwipeCardProps {
  invoice: StoredInvoice;
  onDismiss: (id: string) => void;
}

function SwipeCard({ invoice, onDismiss }: SwipeCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const startX = useRef(0);
  const currentX = useRef(0);
  const isDragging = useRef(false);
  const [offset, setOffset] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  const handleStart = (clientX: number) => {
    isDragging.current = true;
    startX.current = clientX;
    currentX.current = clientX;
  };

  const handleMove = (clientX: number) => {
    if (!isDragging.current) return;
    currentX.current = clientX;
    const diff = currentX.current - startX.current;
    if (diff > 0) {
      setOffset(diff);
    }
  };

  const handleEnd = () => {
    if (!isDragging.current) return;
    isDragging.current = false;
    if (offset > 100) {
      setDismissed(true);
      setTimeout(() => onDismiss(invoice.id), 300);
    } else {
      setOffset(0);
    }
  };

  return (
    <div
      ref={ref}
      className={`relative overflow-hidden rounded-xl transition-all ${dismissed ? "opacity-0 max-h-0 mb-0 scale-95" : "opacity-100 max-h-40 mb-2"}`}
      style={{ transitionDuration: dismissed ? "300ms" : offset > 0 ? "0ms" : "300ms" }}
    >
      {/* Background hint for swipe */}
      <div className="absolute inset-0 rounded-xl bg-destructive/15 flex items-center px-4">
        <X className="w-5 h-5 text-destructive" />
      </div>

      {/* Card */}
      <div
        className="relative rounded-xl border border-border bg-white shadow-sm p-3 flex items-center gap-3 cursor-grab active:cursor-grabbing select-none"
        style={{
          transform: `translateX(${offset}px)`,
          transition: isDragging.current ? "none" : "transform 300ms ease",
          opacity: Math.max(0.4, 1 - offset / 250),
        }}
        onMouseDown={(e) => handleStart(e.clientX)}
        onMouseMove={(e) => handleMove(e.clientX)}
        onMouseUp={handleEnd}
        onMouseLeave={handleEnd}
        onTouchStart={(e) => handleStart(e.touches[0].clientX)}
        onTouchMove={(e) => handleMove(e.touches[0].clientX)}
        onTouchEnd={handleEnd}
      >
        {/* Left accent bar */}
        <div className="absolute right-0 top-2 bottom-2 w-1 rounded-full bg-primary" />
        
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0 mr-2">
          <FileText className="w-5 h-5 text-primary" />
        </div>
        <div className="min-w-0 flex-1 pl-1">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-foreground">
              فاکتور {invoiceTypeLabels[invoice.invoiceType] || invoice.invoiceType}{" "}
              {productLabels[invoice.productType] || invoice.productType}
            </p>
            <span className="text-[11px] text-muted-foreground shrink-0 whitespace-nowrap" dir="rtl">
              {formatDateTime(invoice.createdAt)}
            </span>
          </div>
          <div className="flex items-center justify-between mt-1">
            <span className="text-xs text-muted-foreground">
              شماره: {toPersianDigits(invoice.invoiceNumber || "—")}
            </span>
            <span className="text-xs font-bold text-primary bg-primary/5 px-2 py-0.5 rounded-full">
              {toPersianDigits(invoice.payable?.toLocaleString("en-US") || "0")} ریال
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function InvoiceNotifications() {
  const navigate = useNavigate();
  const [invoices, setInvoices] = useState<StoredInvoice[]>([]);
  const [dismissedIds, setDismissedIds] = useState<string[]>(() => {
    return JSON.parse(localStorage.getItem("shirdaneh_dismissed_notifs") || "[]");
  });

  useEffect(() => {
    const stored: StoredInvoice[] = JSON.parse(localStorage.getItem("shirdaneh_invoices") || "[]");
    const visible = stored
      .reverse()
      .filter((inv) => !dismissedIds.includes(inv.id))
      .slice(0, 5);
    setInvoices(visible);
  }, [dismissedIds]);

  const handleDismiss = (id: string) => {
    const updated = [...dismissedIds, id];
    setDismissedIds(updated);
    localStorage.setItem("shirdaneh_dismissed_notifs", JSON.stringify(updated));
    setInvoices((prev) => prev.filter((inv) => inv.id !== id));
  };

  if (invoices.length === 0) return null;

  return (
    <div className="rounded-2xl bg-white border border-border shadow-sm p-4 space-y-2">
      {/* Header with bell icon and professional styling */}
      <div className="flex items-center justify-between mb-3 pb-2 border-b border-border/50">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
            <Bell className="w-4 h-4 text-primary" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-foreground">رویدادهای اخیر</h3>
            <p className="text-[11px] text-muted-foreground">{toPersianDigits(invoices.length)} مورد جدید</p>
          </div>
        </div>
        <span className="text-[11px] text-muted-foreground bg-muted px-2 py-1 rounded-full">← بکشید برای حذف</span>
      </div>
      {invoices.map((inv) => (
        <SwipeCard key={inv.id} invoice={inv} onDismiss={handleDismiss} />
      ))}
    </div>
  );
}
