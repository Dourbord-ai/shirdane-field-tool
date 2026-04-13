import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { FileText, X } from "lucide-react";
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

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMin = Math.floor((now - then) / 60000);
  if (diffMin < 1) return "همین الان";
  if (diffMin < 60) return toPersianDigits(diffMin) + " دقیقه پیش";
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return toPersianDigits(diffHr) + " ساعت پیش";
  const diffDay = Math.floor(diffHr / 24);
  return toPersianDigits(diffDay) + " روز پیش";
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
    // Only allow swipe right (positive direction in RTL = visual right = negative translateX)
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
      {/* Background hint */}
      <div className="absolute inset-0 rounded-xl bg-primary/10 flex items-center px-4">
        <X className="w-5 h-5 text-primary" />
      </div>

      {/* Card */}
      <div
        className="relative rounded-xl border border-primary/15 bg-card p-3 flex items-center gap-3 cursor-grab active:cursor-grabbing select-none"
        style={{
          transform: `translateX(${offset}px)`,
          transition: isDragging.current ? "none" : "transform 300ms ease",
          opacity: Math.max(0.3, 1 - offset / 250),
        }}
        onMouseDown={(e) => handleStart(e.clientX)}
        onMouseMove={(e) => handleMove(e.clientX)}
        onMouseUp={handleEnd}
        onMouseLeave={handleEnd}
        onTouchStart={(e) => handleStart(e.touches[0].clientX)}
        onTouchMove={(e) => handleMove(e.touches[0].clientX)}
        onTouchEnd={handleEnd}
      >
        <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
          <FileText className="w-4 h-4 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between">
            <p className="text-sm font-bold text-foreground">
              فاکتور {invoiceTypeLabels[invoice.invoiceType] || invoice.invoiceType}{" "}
              {productLabels[invoice.productType] || invoice.productType}
            </p>
            <span className="text-[11px] text-muted-foreground shrink-0 mr-2">
              {timeAgo(invoice.createdAt)}
            </span>
          </div>
          <div className="flex items-center justify-between mt-0.5">
            <span className="text-xs text-muted-foreground">
              شماره: {toPersianDigits(invoice.invoiceNumber || "—")}
            </span>
            <span className="text-xs font-bold text-primary">
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
    // Show latest 5 that aren't dismissed
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
    <div className="space-y-1">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-bold text-foreground">رویدادهای اخیر</h3>
        <span className="text-[11px] text-muted-foreground">← بکشید برای حذف</span>
      </div>
      {invoices.map((inv) => (
        <SwipeCard key={inv.id} invoice={inv} onDismiss={handleDismiss} />
      ))}
    </div>
  );
}
