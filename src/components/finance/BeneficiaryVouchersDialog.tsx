// ---------------------------------------------------------------------------
// BeneficiaryVouchersDialog
//
// نمایش اسناد مالی داخلی یک ذینفع به صورت مودال — مشابه دیالوگ «مقایسه
// صورتحساب با سپیدار» اما فقط منبع داخلی (finance_voucher_items +
// finance_vouchers). با کلیک روی دکمه «مشاهده اسناد» در گزارش وضعیت ذینفعان
// باز می‌شود.
//
// قواعد دامنه:
//   - فقط اسناد حذف‌نشده (finance_vouchers.is_deleted = false) لحاظ شوند.
//   - بدهکار از debit، بستانکار از credit، مانده = credit − debit.
//   - تاریخ نمایشی همیشه از finance_vouchers.voucher_date خوانده می‌شود و
//     قبل از فرمت Jalali به روز تقویم تهران نرمال می‌شود تا با تأخیر
//     UTC ↔ تهران، روزِ نزدیک نیمه‌شب جابه‌جا نشود (همان منطقی که در
//     beneficiaryStatement.ts برای تب «مقایسه صورتحساب» جواب داده است).
//   - مانده تجمعی روی ترتیب زمانی صعودی محاسبه می‌شود تا با گزارش‌های
//     استاندارد حسابداری هم‌خوان باشد.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Eye, RefreshCw, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { formatMoney, formatJalaliDate } from "@/lib/finance";
import { MoneyCell, JalaliDateCell, SepidarStatusBadge } from "@/components/finance/atoms";
import { toast } from "sonner";

// طول مجاز پیش‌نمایش شرح. شرح طولانی‌تر با دکمه چشم در مودال جداگانه باز
// می‌شود تا ردیف جدول جمع‌و‌جور بماند.
const DESC_PREVIEW = 60;

// شکل خام ردیف خروجی Supabase. embed یک‌به‌چند با finance_vouchers.
interface RawItemRow {
  id: string;
  debit: number | string | null;
  credit: number | string | null;
  description: string | null;
  voucher_id: string;
  finance_vouchers: {
    id: string;
    voucher_date: string | null;
    voucher_number: number | string | null;
    title: string | null;
    description: string | null;
    is_deleted: boolean | null;
    status: string | null;
    sepidar_voucher_id: number | null;
    sepidar_voucher_number: number | null;
    sepidar_sync_status: string | null;
  } | null;
}

// ردیف نهایی نمایشی پس از نرمال‌سازی + محاسبه مانده تجمعی.
interface VoucherRow {
  itemId: string;
  voucherId: string;
  date: string | null;        // YYYY-MM-DD نرمال‌شده به تقویم تهران
  rawDate: string | null;     // مقدار خام DB برای tooltip/debug
  voucherNumber: string | null;
  description: string;
  debit: number;
  credit: number;
  balance: number;            // مانده تجمعی credit − debit از ابتدا تا این ردیف
  status: string | null;
  sepidarVoucherId: number | null;
  sepidarVoucherNumber: number | null;
  sepidarSyncStatus: string | null;
}

export interface BeneficiaryVouchersDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  partyId: string | null;
  partyName: string;
  // خلاصهٔ گرفته‌شده از گزارش بالادست — برای کارت بالای مودال.
  summary?: {
    debtor: number;
    creditor: number;
    balance: number;
  };
}

// تبدیل timestamptz به YYYY-MM-DD در منطقه زمانی تهران. منطق دقیقاً همان
// چیزی است که در beneficiaryStatement.ts برای حل اختلاف روز استفاده شده.
const tehranYmdFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Tehran",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
function toTehranYmd(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return tehranYmdFmt.format(d);
}

// همان helper سلول شرح که در دیالوگ مقایسه صورتحساب استفاده شده — کپی شده
// تا کوپلینگ بین دو دیالوگ حذف بماند و این فایل self-contained باشد.
function DescriptionCell({ text, onExpand }: { text: string; onExpand: (full: string) => void }) {
  const value = text || "";
  if (!value) return <span className="text-muted-foreground">—</span>;
  const isLong = value.length > DESC_PREVIEW;
  return (
    <div className="flex items-start gap-1 max-w-xs">
      <span className="truncate text-foreground/90" title={value} dir="auto">
        {value}
      </span>
      {isLong && (
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6 shrink-0"
          onClick={() => onExpand(value)}
          aria-label="نمایش کامل شرح"
          title="نمایش کامل شرح"
        >
          <Eye className="w-3.5 h-3.5" />
        </Button>
      )}
    </div>
  );
}

export default function BeneficiaryVouchersDialog({
  open,
  onOpenChange,
  partyId,
  partyName,
  summary,
}: BeneficiaryVouchersDialogProps) {
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<VoucherRow[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  // بارگذاری هر بار که مودال باز می‌شود یا partyId عوض می‌شود.
  useEffect(() => {
    if (!open || !partyId) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, partyId]);

  async function load() {
    if (!partyId) return;
    setLoading(true);
    try {
      // فقط ردیف‌های همین ذینفع + اسناد حذف‌نشده. is_deleted در شرط embed
      // به‌صورت فیلتر روی جدول fk اعمال می‌شود؛ از !inner استفاده می‌کنیم تا
      // ردیف‌هایی که سند والدشان حذف شده اصلاً برنگردند.
      const { data, error } = await supabase
        .from("finance_voucher_items")
        .select(
          "id, debit, credit, description, voucher_id, " +
            "finance_vouchers!inner(id, voucher_date, voucher_number, title, description, is_deleted, status, sepidar_voucher_id, sepidar_voucher_number, sepidar_sync_status)",
        )
        .eq("party_id", partyId)
        .eq("finance_vouchers.is_deleted", false)
        .limit(5000);

      if (error) throw error;

      // مرتب‌سازی صعودی بر اساس voucher_date؛ ردیف‌های بدون تاریخ به انتها
      // می‌روند تا مانده تجمعی برای ردیف‌های دارای تاریخ منطقی باقی بماند.
      const sorted = [...((data as unknown as RawItemRow[]) || [])].sort((a, b) => {
        const da = a.finance_vouchers?.voucher_date
          ? new Date(a.finance_vouchers.voucher_date).getTime()
          : Number.POSITIVE_INFINITY;
        const db = b.finance_vouchers?.voucher_date
          ? new Date(b.finance_vouchers.voucher_date).getTime()
          : Number.POSITIVE_INFINITY;
        return da - db;
      });

      // ساخت ردیف‌های نهایی + محاسبه مانده تجمعی credit − debit.
      let running = 0;
      const result: VoucherRow[] = sorted.map((r) => {
        const debit = Number(r.debit ?? 0) || 0;
        const credit = Number(r.credit ?? 0) || 0;
        running += credit - debit;
        const v = r.finance_vouchers;
        return {
          itemId: r.id,
          voucherId: r.voucher_id,
          date: toTehranYmd(v?.voucher_date ?? null),
          rawDate: v?.voucher_date ?? null,
          voucherNumber:
            v?.voucher_number != null ? String(v.voucher_number) : v?.id?.slice(0, 8) ?? null,
          description: r.description || v?.title || v?.description || "",
          debit,
          credit,
          balance: running,
          status: v?.status ?? null,
          sepidarVoucherId: v?.sepidar_voucher_id ?? null,
          sepidarVoucherNumber: v?.sepidar_voucher_number ?? null,
          sepidarSyncStatus: v?.sepidar_sync_status ?? null,
        };
      });
      setRows(result);
    } catch (e) {
      console.error("[BeneficiaryVouchersDialog] load failed", e);
      toast.error("خطا در بارگذاری اسناد ذینفع");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  // فیلتر سادهٔ جستجو روی شماره سند و شرح — کلاینت‌ساید چون حجم کم است.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        (r.voucherNumber || "").toLowerCase().includes(q) ||
        (r.description || "").toLowerCase().includes(q),
    );
  }, [rows, search]);

  // مجموع‌ها از خود ردیف‌های نمایشی محاسبه می‌شوند تا با لیست هم‌خوان بمانند
  // (در نبود فیلتر، با مقادیر summary بالادست برابر خواهند بود).
  const totals = useMemo(() => {
    let d = 0;
    let c = 0;
    for (const r of rows) {
      d += r.debit;
      c += r.credit;
    }
    return { debtor: d, creditor: c, balance: c - d };
  }, [rows]);

  // دستهٔ نهایی برای چیپ بالای کارت — همان قاعدهٔ گزارش بالادست.
  const category = (() => {
    const bal = summary?.balance ?? totals.balance;
    if (bal < 0) return { label: "بدهکار", className: "bg-red-500/15 text-red-600 dark:text-red-400" };
    if (bal > 0) return { label: "بستانکار", className: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" };
    return { label: "بی‌حساب", className: "bg-muted text-muted-foreground" };
  })();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        dir="rtl"
        className="max-w-5xl w-[95vw] max-h-[90vh] overflow-hidden flex flex-col gap-0 p-0"
      >
        {/* هدر مودال — اسم ذینفع + اکشن‌های refresh و close. */}
        <DialogHeader className="px-4 sm:px-6 pt-5 pb-3 border-b">
          <div className="flex items-center justify-between gap-2">
            <DialogTitle className="text-base sm:text-lg font-bold">
              اسناد مالی ذینفع
              <span className="text-muted-foreground font-normal mr-2">— {partyName}</span>
            </DialogTitle>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => void load()}
                disabled={loading}
                title="بارگذاری مجدد"
              >
                <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
              </Button>
            </div>
          </div>
        </DialogHeader>

        {/* خلاصهٔ مالی — مقادیر اولویتاً از summary بالادست (سازگار با گزارش)؛
            در صورت نبود، از totals محاسبه‌شدهٔ همین مودال. */}
        <div className="px-4 sm:px-6 py-3 border-b bg-muted/30">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div className="rounded-md border bg-card p-3">
              <div className="text-xs text-muted-foreground mb-1">جمع بدهکار</div>
              <MoneyCell value={summary?.debtor ?? totals.debtor} negative />
            </div>
            <div className="rounded-md border bg-card p-3">
              <div className="text-xs text-muted-foreground mb-1">جمع بستانکار</div>
              <MoneyCell value={summary?.creditor ?? totals.creditor} positive />
            </div>
            <div className="rounded-md border bg-card p-3">
              <div className="text-xs text-muted-foreground mb-1">مانده</div>
              <MoneyCell
                value={summary?.balance ?? totals.balance}
                positive={(summary?.balance ?? totals.balance) > 0}
                negative={(summary?.balance ?? totals.balance) < 0}
              />
            </div>
            <div className="rounded-md border bg-card p-3 flex items-center justify-between">
              <span className="text-xs text-muted-foreground">دسته</span>
              <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-bold", category.className)}>
                {category.label}
              </span>
            </div>
          </div>

          {/* جستجوی داخل مودال — برای فهرست‌های بلند مفید است. */}
          <div className="mt-3 flex items-center gap-2">
            <Input
              placeholder="جستجو در شماره سند یا شرح…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 text-xs"
            />
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              {filtered.length.toLocaleString("fa-IR")} سند
            </span>
          </div>
        </div>

        {/* بدنه — جدول اسناد. اسکرول عمودی روی همین کانتینر تا هدر/خلاصه
            ثابت بمانند و موبایل هم با اسکرول افقی جدول راحت باشد. */}
        <div className="flex-1 overflow-auto px-2 sm:px-4 py-2">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> در حال بارگذاری اسناد…
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center text-muted-foreground py-12 text-sm">
              سندی برای این ذینفع ثبت نشده است
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs sm:text-sm">
                <thead className="text-[11px] text-muted-foreground border-b">
                  <tr>
                    <th className="text-right p-2 whitespace-nowrap">تاریخ سند</th>
                    <th className="text-right p-2 whitespace-nowrap">شماره سند</th>
                    <th className="text-right p-2">شرح</th>
                    <th className="text-right p-2 whitespace-nowrap">بدهکار</th>
                    <th className="text-right p-2 whitespace-nowrap">بستانکار</th>
                    <th className="text-right p-2 whitespace-nowrap">مانده تجمعی</th>
                    <th className="text-right p-2 whitespace-nowrap">سپیدار</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr key={r.itemId} className="border-b border-border/40 hover:bg-muted/30">
                      <td className="p-2 whitespace-nowrap" title={r.rawDate || ""}>
                        <JalaliDateCell value={r.date} />
                      </td>
                      <td className="p-2 whitespace-nowrap font-mono tabular-nums">
                        {r.voucherNumber || "—"}
                      </td>
                      <td className="p-2">
                        <DescriptionCell text={r.description} onExpand={setExpanded} />
                      </td>
                      <td className="p-2 whitespace-nowrap">
                        <MoneyCell value={r.debit} negative={r.debit > 0} />
                      </td>
                      <td className="p-2 whitespace-nowrap">
                        <MoneyCell value={r.credit} positive={r.credit > 0} />
                      </td>
                      <td className="p-2 whitespace-nowrap">
                        <MoneyCell
                          value={r.balance}
                          positive={r.balance > 0}
                          negative={r.balance < 0}
                        />
                      </td>
                      <td className="p-2 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <SepidarStatusBadge status={r.sepidarSyncStatus} />
                          {r.sepidarVoucherNumber != null && (
                            <span className="font-mono tabular-nums text-[11px] text-muted-foreground">
                              #{r.sepidarVoucherNumber}
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </DialogContent>

      {/* مودال فرعی برای نمایش شرح کامل سند — وقتی متن طولانی truncate شده
          است. ساختار ساده‌ای دارد چون فقط متن خام را نشان می‌دهد. */}
      <Dialog open={!!expanded} onOpenChange={(o) => !o && setExpanded(null)}>
        <DialogContent dir="rtl" className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-sm">شرح کامل سند</DialogTitle>
          </DialogHeader>
          <p className="text-sm whitespace-pre-wrap leading-7" dir="auto">
            {expanded}
          </p>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}
