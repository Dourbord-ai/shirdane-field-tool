// ---------------------------------------------------------------------------
// Finance → گزارش‌ها tab. Hosts the "وضعیت ذینفعان" report.
//
// منبع داده (طبق درخواست محصول):
//   مقادیر بدهکار/بستانکار/مانده مستقیماً از aggregate واقعی
//   finance_voucher_items (با حذف اسناد soft-deleted) محاسبه می‌شوند، نه از
//   ستون cache‌شدهٔ finance_parties.balance. این کار با RPC
//   public.get_beneficiary_balances() در دیتابیس انجام می‌شود تا join و
//   group by همانجا اجرا شود و ذینفعان بدون سند هم با مقدار 0 برگردند.
//
// فرمول‌ها (همان چیزی که RPC برمی‌گرداند):
//   debtor_total   = SUM(COALESCE(vi.debit, 0))
//   creditor_total = SUM(COALESCE(vi.credit, 0))
//   balance        = creditor_total − debtor_total
//   balance < 0 → بدهکار (قرمز)
//   balance > 0 → بستانکار (سبز)
//   balance = 0 → بی‌حساب (خنثی)
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/finance";
import { cn } from "@/lib/utils";
import { ChevronUp, ChevronDown, Search, Loader2, FileText } from "lucide-react";
import BeneficiaryVouchersDialog from "@/components/finance/BeneficiaryVouchersDialog";

const PAGE_SIZE = 25;

// ردیف خام ذینفع که از finance_parties بارگذاری می‌شود — فقط ستون‌های نمایشی.
// مقادیر مالی از RPC جداگانه می‌آیند تا منبع داده دقیقاً voucher_items باشد.
interface PartyRow {
  id: string;
  company_name: string | null;
  first_name: string | null;
  last_name: string | null;
  sepidar_full_name: string | null;
  ownership_type: string | null;
  request_balance: number | null;
}

// خروجی RPC get_beneficiary_balances — برای هر ذینفع جمع بدهکار/بستانکار/مانده.
interface BalanceRow {
  party_id: string;
  debtor_total: number | string | null;
  creditor_total: number | string | null;
  balance: number | string | null;
  balance_status: "debtor" | "creditor" | "settled" | null;
}

// ردیف نهایی نمایشی — ترکیب اطلاعات نمایشی ذینفع با aggregate مالی.
interface ViewRow {
  id: string;
  display_name: string;
  debtor: number;   // جمع بدهکار (>= 0)
  creditor: number; // جمع بستانکار (>= 0)
  balance: number;  // creditor - debtor (می‌تواند منفی شود)
  request_balance: number;
}

type SortKey = "display_name" | "debtor" | "creditor" | "balance" | "request_balance";
type SideFilter = "all" | "debtor" | "creditor" | "settled";

// نام نمایشی ذینفع: شخصیت حقوقی از company_name، حقیقی از first/last_name،
// و در نبود همه، sepidar_full_name. این تابع همان منطق قبلی است.
function computeDisplayName(p: PartyRow): string {
  if (p.company_name || p.ownership_type === "legal") {
    return p.company_name || p.sepidar_full_name || "—";
  }
  const personal = [p.first_name, p.last_name].filter(Boolean).join(" ").trim();
  return personal || p.sepidar_full_name || "—";
}

// سلول مبلغ — LTR تا علامت منفی سمت چپ ارقام دیده شود (داخل layout راست‌چین).
function Money({ value, tone }: { value: number; tone?: "debit" | "credit" | "neutral" }) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  const color =
    tone === "debit"
      ? "text-red-600 dark:text-red-400"
      : tone === "credit"
        ? "text-emerald-600 dark:text-emerald-400"
        : "text-foreground";
  return (
    <span
      dir="ltr"
      className={cn(
        "inline-block font-mono tabular-nums tracking-tight font-semibold text-[15px]",
        color,
      )}
    >
      {formatMoney(value)}
    </span>
  );
}

// تبدیل اعداد فارسی/عربی به ASCII تا فیلترهای عددی هم با ۱۲۳ کار کنند.
function toAsciiNumber(s: string): number | null {
  if (!s) return null;
  const fa = "۰۱۲۳۴۵۶۷۸۹";
  const ar = "٠١٢٣٤٥٦٧٨٩";
  let out = s;
  for (let i = 0; i < 10; i++) {
    out = out.replace(new RegExp(fa[i], "g"), String(i));
    out = out.replace(new RegExp(ar[i], "g"), String(i));
  }
  out = out.replace(/[،,\s]/g, "");
  const n = Number(out);
  return Number.isFinite(n) ? n : null;
}

export default function FinanceReportsTab() {
  // داده‌های خام: همهٔ ذینفعان + همهٔ aggregateها یک‌بار بارگذاری می‌شوند.
  // تعداد ذینفعان در حد چند صد است، بنابراین فیلتر/مرتب‌سازی/صفحه‌بندی روی
  // کلاینت انجام می‌شود تا فیلترهای ترکیبی بدون رفت‌و‌برگشت با سرور کار کنند
  // و شمارش صفحه‌ها دقیق بماند.
  const [parties, setParties] = useState<PartyRow[]>([]);
  const [balances, setBalances] = useState<Record<string, BalanceRow>>({});
  const [loading, setLoading] = useState(true);

  // فیلترها
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [side, setSide] = useState<SideFilter>("all");
  const [fName, setFName] = useState("");
  const [fDebtor, setFDebtor] = useState("");
  const [fCreditor, setFCreditor] = useState("");
  const [fBalance, setFBalance] = useState("");
  const [fRequest, setFRequest] = useState("");

  // مرتب‌سازی و صفحه‌بندی
  const [sortKey, setSortKey] = useState<SortKey>("display_name");
  const [sortAsc, setSortAsc] = useState(true);
  const [page, setPage] = useState(1);

  // ذینفع انتخاب‌شده برای مودال «مشاهده اسناد». null یعنی مودال بسته است.
  // ViewRow کامل را نگه می‌داریم تا خلاصهٔ بالای مودال (بدهکار/بستانکار/مانده)
  // را بدون رفت‌وبرگشت اضافه با سرور پاس بدهیم.
  const [openVouchersFor, setOpenVouchersFor] = useState<ViewRow | null>(null);

  // دباونس جستجو تا روی هر کلید فیلتر دوباره ساخته نشود.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  // با تغییر هر فیلتر به صفحه اول برمی‌گردیم تا offset نامعتبر نشود.
  useEffect(() => setPage(1), [debouncedSearch, side, fName, fDebtor, fCreditor, fBalance, fRequest, sortKey, sortAsc]);

  // بارگذاری اولیه: موازی، چون دو منبع مستقل از هم هستند.
  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoading(true);
    // درخواست موازی: لیست ذینفعان + aggregate مالی. هردو read-only هستند و
    // نتایج را در client با id کنار هم می‌چینیم.
    const [pRes, bRes] = await Promise.all([
      supabase
        .from("finance_parties")
        .select("id, company_name, first_name, last_name, sepidar_full_name, ownership_type, request_balance")
        .or("is_deleted.is.null,is_deleted.eq.false")
        .limit(5000),
      // RPC تازه ساخته شده در migration — جمع بدهکار/بستانکار/مانده هر ذینفع
      // را از روی finance_voucher_items (با حذف اسناد soft-deleted) برمی‌گرداند.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc("get_beneficiary_balances"),
    ]);

    if (!pRes.error && pRes.data) setParties(pRes.data as PartyRow[]);
    if (!bRes.error && bRes.data) {
      const map: Record<string, BalanceRow> = {};
      for (const r of bRes.data as BalanceRow[]) map[r.party_id] = r;
      setBalances(map);
    }
    setLoading(false);
  }

  // ترکیب اطلاعات نمایشی + aggregate مالی. ذینفعان بدون ردیف در RPC (که نباید
  // پیش بیاید چون RPC از finance_parties با LEFT JOIN شروع می‌کند) و همچنین
  // ذینفعانی که RPC به هر دلیل برنگردانده، با 0/0/0 رندر می‌شوند.
  const enriched = useMemo<ViewRow[]>(() => {
    return parties.map((p) => {
      const b = balances[p.id];
      const debtor = Number(b?.debtor_total ?? 0) || 0;
      const creditor = Number(b?.creditor_total ?? 0) || 0;
      const balance = Number(b?.balance ?? (creditor - debtor)) || 0;
      return {
        id: p.id,
        display_name: computeDisplayName(p),
        debtor,
        creditor,
        balance,
        request_balance: Number(p.request_balance ?? 0) || 0,
      };
    });
  }, [parties, balances]);

  // اعمال فیلترها روی لیست ترکیب‌شده.
  const filtered = useMemo<ViewRow[]>(() => {
    let list = enriched;

    // فیلتر سراسری جستجو — روی نام نمایشی.
    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase();
      list = list.filter((r) => r.display_name.toLowerCase().includes(q));
    }

    // فیلتر تک‌ستون نام
    if (fName) {
      const q = fName.toLowerCase();
      list = list.filter((r) => r.display_name.toLowerCase().includes(q));
    }

    // فیلتر چیپ بالای جدول — همه/بدهکار/بستانکار/بی‌حساب
    if (side === "debtor") list = list.filter((r) => r.balance < 0);
    else if (side === "creditor") list = list.filter((r) => r.balance > 0);
    else if (side === "settled") list = list.filter((r) => r.balance === 0);

    // فیلترهای عددی ستونی — «حداقل مقدار»
    const dMin = toAsciiNumber(fDebtor);
    if (dMin != null && dMin > 0) list = list.filter((r) => r.debtor >= dMin);
    const cMin = toAsciiNumber(fCreditor);
    if (cMin != null && cMin > 0) list = list.filter((r) => r.creditor >= cMin);
    const bMin = toAsciiNumber(fBalance);
    if (bMin != null && bMin > 0) list = list.filter((r) => Math.abs(r.balance) >= bMin);
    const rMin = toAsciiNumber(fRequest);
    if (rMin != null && rMin > 0) list = list.filter((r) => r.request_balance >= rMin);

    return list;
  }, [enriched, debouncedSearch, fName, side, fDebtor, fCreditor, fBalance, fRequest]);

  // مرتب‌سازی — کلید display_name از localeCompare فارسی استفاده می‌کند.
  const sorted = useMemo<ViewRow[]>(() => {
    const list = [...filtered];
    list.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "display_name") cmp = a.display_name.localeCompare(b.display_name, "fa");
      else if (sortKey === "debtor") cmp = a.debtor - b.debtor;
      else if (sortKey === "creditor") cmp = a.creditor - b.creditor;
      else if (sortKey === "balance") cmp = a.balance - b.balance;
      else if (sortKey === "request_balance") cmp = a.request_balance - b.request_balance;
      return sortAsc ? cmp : -cmp;
    });
    return list;
  }, [filtered, sortKey, sortAsc]);

  // صفحه‌بندی روی نتیجه نهایی
  const totalCount = sorted.length;
  const pageCount = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const view = useMemo(() => {
    const from = (page - 1) * PAGE_SIZE;
    return sorted.slice(from, from + PAGE_SIZE);
  }, [sorted, page]);

  // پاک‌کردن همه فیلترها — راحت‌تر از کلیک تک‌تک روی هر input.
  function clearFilters() {
    setSearch("");
    setDebouncedSearch("");
    setSide("all");
    setFName("");
    setFDebtor("");
    setFCreditor("");
    setFBalance("");
    setFRequest("");
  }

  function SortHeader({ k, children }: { k: SortKey; children: React.ReactNode }) {
    const active = sortKey === k;
    return (
      <button
        type="button"
        onClick={() => {
          if (active) setSortAsc(!sortAsc);
          else {
            setSortKey(k);
            setSortAsc(true);
          }
        }}
        className="inline-flex items-center gap-1 font-bold hover:text-primary transition-colors"
      >
        {children}
        {active && (sortAsc ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
      </button>
    );
  }

  return (
    <section className="space-y-3" dir="rtl">
      <header className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-bold">وضعیت ذینفعان</h2>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex rounded-lg border bg-muted/30 p-1 text-xs">
            {([
              { k: "all", label: "همه" },
              { k: "debtor", label: "فقط بدهکار" },
              { k: "creditor", label: "فقط بستانکار" },
              { k: "settled", label: "بی‌حساب" },
            ] as { k: SideFilter; label: string }[]).map((s) => (
              <button
                key={s.k}
                onClick={() => setSide(s.k)}
                className={cn(
                  "px-3 py-1 rounded-md font-bold transition",
                  side === s.k ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {s.label}
              </button>
            ))}
          </div>

          <div className="relative w-full sm:w-72">
            <Search className="w-4 h-4 absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="جستجو نام ذینفع..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pr-8"
            />
          </div>

          <Button variant="outline" size="sm" onClick={clearFilters}>
            پاک‌کردن فیلترها
          </Button>
        </div>
      </header>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> در حال بارگذاری…
        </div>
      ) : view.length === 0 ? (
        <p className="text-center text-muted-foreground py-8">ذینفعی یافت نشد</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b">
              <tr>
                <th className="text-right p-2"><SortHeader k="display_name">نام ذینفع</SortHeader></th>
                <th className="text-right p-2"><SortHeader k="debtor">بدهکار</SortHeader></th>
                <th className="text-right p-2"><SortHeader k="creditor">بستانکار</SortHeader></th>
                <th className="text-right p-2"><SortHeader k="balance">مانده</SortHeader></th>
                <th className="text-right p-2"><SortHeader k="request_balance">درخواست تسویه تایید شده</SortHeader></th>
                {/* ستون اکشن — بدون مرتب‌سازی، فقط دکمهٔ مشاهدهٔ اسناد. */}
                <th className="text-right p-2">اقدامات</th>
              </tr>
              <tr className="border-b">
                <th className="p-1"><Input value={fName} onChange={(e) => setFName(e.target.value)} placeholder="فیلتر…" className="h-7 text-xs" /></th>
                <th className="p-1"><Input value={fDebtor} onChange={(e) => setFDebtor(e.target.value)} placeholder="≥" inputMode="numeric" className="h-7 text-xs" /></th>
                <th className="p-1"><Input value={fCreditor} onChange={(e) => setFCreditor(e.target.value)} placeholder="≥" inputMode="numeric" className="h-7 text-xs" /></th>
                <th className="p-1"><Input value={fBalance} onChange={(e) => setFBalance(e.target.value)} placeholder="|≥|" inputMode="numeric" className="h-7 text-xs" /></th>
                <th className="p-1"><Input value={fRequest} onChange={(e) => setFRequest(e.target.value)} placeholder="≥" inputMode="numeric" className="h-7 text-xs" /></th>
                <th className="p-1" />
              </tr>
            </thead>
            <tbody>
              {view.map((p) => {
                // tone مانده فقط از علامت balance می‌آید تا با چیپ دسته‌بندی
                // هم‌خوان بماند و هیچ‌گاه UI با خودش تناقض نداشته باشد.
                const balTone = p.balance < 0 ? "debit" : p.balance > 0 ? "credit" : "neutral";
                return (
                  <tr
                    key={p.id}
                    className="border-b border-border/50 hover:bg-muted/30 cursor-pointer"
                    // کلیک روی خود ردیف هم مودال اسناد را باز می‌کند تا تجربهٔ
                    // «کلیک روی ذینفع» راحت‌تر باشد؛ دکمه روی سلول آخر هم
                    // به‌صورت صریح در دسترس است.
                    onClick={() => setOpenVouchersFor(p)}
                  >
                    <td className="p-2 font-medium">{p.display_name}</td>
                    {/* همیشه 0 نمایش داده می‌شود (نه خالی) وقتی گردشی نیست. */}
                    <td className="p-2"><Money value={p.debtor} tone="debit" /></td>
                    <td className="p-2"><Money value={p.creditor} tone="credit" /></td>
                    <td className="p-2"><Money value={p.balance} tone={balTone} /></td>
                    <td className="p-2"><Money value={p.request_balance} tone="neutral" /></td>
                    <td className="p-2" onClick={(e) => e.stopPropagation()}>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 gap-1 text-xs"
                        onClick={() => setOpenVouchersFor(p)}
                      >
                        <FileText className="w-3.5 h-3.5" />
                        مشاهده اسناد
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {totalCount > PAGE_SIZE && (
        <footer className="flex items-center justify-between text-xs text-muted-foreground pt-2">
          <span>
            صفحه {page} از {pageCount} — مجموع {totalCount.toLocaleString("fa-IR")} ذینفع
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              قبلی
            </Button>
            <Button variant="outline" size="sm" disabled={page >= pageCount} onClick={() => setPage(page + 1)}>
              بعدی
            </Button>
          </div>
        </footer>
      )}
    </section>
  );
}
