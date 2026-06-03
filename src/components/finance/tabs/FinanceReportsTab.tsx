// ---------------------------------------------------------------------------
// Finance → گزارش‌ها tab. Hosts the "وضعیت ذینفعان" report (moved here from
// the global Reports page per product request). Read-only over
// public.finance_parties. Never mutates balance or request_balance.
//
// What this tab supports:
//  • Server-side pagination + global search (name/code/mobile)
//  • Per-column filter inputs (sortable & filterable on every header)
//  • Top quick-filter chips: همه / فقط بدهکار / فقط بستانکار
//  • Two split columns: بدهکار (balance < 0) and بستانکار (balance > 0)
//  • Drops the "وضعیت تایید سپیدار" column (excluded per spec)
//  • Money cells rendered LTR so the negative sign stays on the LEFT of the
//    digits even inside the RTL layout.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/finance";
import { cn } from "@/lib/utils";
import { ChevronUp, ChevronDown, Search, Loader2 } from "lucide-react";

const PAGE_SIZE = 25;

// Minimal row projection — matches the columns this report renders.
interface PartyRow {
  id: string;
  company_name: string | null;
  first_name: string | null;
  last_name: string | null;
  sepidar_full_name: string | null;
  ownership_type: string | null;
  status: string | null;
  approval_status: string | null;
  balance: number | null;
  request_balance: number | null;
}

// Closed set of sortable keys → prevents bad strings reaching PostgREST.
// `debtor` / `creditor` are derived from `balance`, so we sort by `balance`
// server-side and only flip the direction depending on which side the user
// clicked.
type SortKey =
  | "display_name"
  | "debtor"
  | "creditor"
  | "balance"
  | "request_balance";

const SORT_DB_COLUMN: Record<SortKey, string> = {
  display_name: "sepidar_full_name",
  debtor: "balance",
  creditor: "balance",
  balance: "balance",
  request_balance: "request_balance",
};

// Quick-filter for the balance sign — applied server-side via `.lt` / `.gt`
// so the page count is correct.
type SideFilter = "all" | "debtor" | "creditor";

function computeDisplayName(p: PartyRow): string {
  if (p.company_name || p.ownership_type === "legal") {
    return p.company_name || p.sepidar_full_name || "—";
  }
  const personal = [p.first_name, p.last_name].filter(Boolean).join(" ").trim();
  return personal || p.sepidar_full_name || "—";
}

// Money cell — wraps the formatted number in dir="ltr" so the leading minus
// sign visually sits to the LEFT of the digits, even though the surrounding
// table is RTL. tabular-nums keeps column edges aligned for scanning.
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

export default function FinanceReportsTab() {
  // ---- state --------------------------------------------------------------
  const [rows, setRows] = useState<PartyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("display_name");
  const [sortAsc, setSortAsc] = useState(true);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [side, setSide] = useState<SideFilter>("all");

  // Per-column filters — text for textual columns, numeric "≥" for amounts.
  const [fName, setFName] = useState("");
  const [fDebtor, setFDebtor] = useState("");
  const [fCreditor, setFCreditor] = useState("");
  const [fBalance, setFBalance] = useState("");
  const [fRequest, setFRequest] = useState("");

  // Debounce the global search box — 300ms is enough to feel live but spares
  // the DB on every keystroke (Persian IME may fire many events per char).
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Whenever any filter narrows the set, jump back to the first page so we
  // never land on an out-of-range offset.
  useEffect(() => setPage(1), [debouncedSearch, sortKey, sortAsc, side, fDebtor, fCreditor, fBalance, fRequest]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, sortKey, sortAsc, page, side, fDebtor, fCreditor, fBalance, fRequest]);

  // Persian/Arabic digit → ASCII so numeric filter inputs accept ۱۲۳ etc.
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

  async function load() {
    setLoading(true);

    let q = supabase
      .from("finance_parties")
      .select(
        "id, company_name, first_name, last_name, sepidar_full_name, ownership_type, status, approval_status, balance, request_balance",
        { count: "exact" },
      );

    // Soft-delete guard — some rows have null is_deleted, treat as live.
    q = q.or("is_deleted.is.null,is_deleted.eq.false");

    // Top side filter (همه / فقط بدهکار / فقط بستانکار). Bank-style sign
    // convention: balance < 0 = debtor, > 0 = creditor.
    if (side === "debtor") q = q.lt("balance", 0);
    else if (side === "creditor") q = q.gt("balance", 0);

    if (debouncedSearch) {
      const safe = debouncedSearch.replace(/[%,()*]/g, " ").trim();
      if (safe) {
        const pat = `*${safe}*`;
        q = q.or(
          [
            `company_name.ilike.${pat}`,
            `first_name.ilike.${pat}`,
            `last_name.ilike.${pat}`,
            `sepidar_full_name.ilike.${pat}`,
            `national_code.ilike.${pat}`,
            `national_id.ilike.${pat}`,
            `mobile.ilike.${pat}`,
          ].join(","),
        );
      }
    }

    // Numeric per-column filters — interpreted as "absolute value at least".
    // debtor filter: balance <= -threshold ; creditor filter: balance >= threshold.
    const debtorMin = toAsciiNumber(fDebtor);
    if (debtorMin != null && debtorMin > 0) q = q.lte("balance", -debtorMin);
    const creditorMin = toAsciiNumber(fCreditor);
    if (creditorMin != null && creditorMin > 0) q = q.gte("balance", creditorMin);
    const requestMin = toAsciiNumber(fRequest);
    if (requestMin != null && requestMin > 0) q = q.gte("request_balance", requestMin);
    // مانده |≥| → match rows whose absolute balance is at least the threshold.
    const balMin = toAsciiNumber(fBalance);
    if (balMin != null && balMin > 0) q = q.or(`balance.gte.${balMin},balance.lte.${-balMin}`);

    q = q.order(SORT_DB_COLUMN[sortKey], {
      // debtor column: smaller (more negative) balance comes first when ASC.
      // creditor column: larger balance first when ASC. Invert ordering for
      // creditor so the click-direction matches what users see in the cells.
      ascending: sortKey === "creditor" ? !sortAsc : sortAsc,
      nullsFirst: false,
    });

    const from = (page - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    q = q.range(from, to);

    const { data, count, error } = await q;
    if (!error) {
      setRows((data as PartyRow[]) || []);
      setTotalCount(count ?? 0);
    }
    setLoading(false);
  }

  // Derived view — compute display name, then apply the per-column TEXT
  // filters client-side (server already handled numeric/side filters).
  const view = useMemo(() => {
    let list = rows.map((r) => ({ ...r, _display: computeDisplayName(r) }));
    if (fName) {
      const q = fName.toLowerCase();
      list = list.filter((p) => p._display.toLowerCase().includes(q));
    }
    if (sortKey === "display_name") {
      list.sort((a, b) => a._display.localeCompare(b._display, "fa"));
      if (!sortAsc) list.reverse();
    }
    return list;
  }, [rows, sortKey, sortAsc, fName]);

  const pageCount = Math.max(1, Math.ceil((totalCount ?? 0) / PAGE_SIZE));

  // Header button — click toggles sort direction; same key already active
  // flips ascending/descending, otherwise sets new key ascending.
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
          {/* Side quick-filter chips. Server-side balance.lt/gt → counts
              stay accurate so pagination doesn't lie. */}
          <div className="inline-flex rounded-lg border bg-muted/30 p-1 text-xs">
            {([
              { k: "all", label: "همه" },
              { k: "debtor", label: "فقط بدهکار" },
              { k: "creditor", label: "فقط بستانکار" },
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
              placeholder="جستجو نام، کد ملی، شناسه ملی، موبایل..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pr-8"
            />
          </div>
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
              </tr>
              {/* Per-column filter row — empty string means no filter. */}
              <tr className="border-b">
                <th className="p-1"><Input value={fName} onChange={(e) => setFName(e.target.value)} placeholder="فیلتر…" className="h-7 text-xs" /></th>
                <th className="p-1"><Input value={fDebtor} onChange={(e) => setFDebtor(e.target.value)} placeholder="≥" inputMode="numeric" className="h-7 text-xs" /></th>
                <th className="p-1"><Input value={fCreditor} onChange={(e) => setFCreditor(e.target.value)} placeholder="≥" inputMode="numeric" className="h-7 text-xs" /></th>
                <th className="p-1"><Input value={fBalance} onChange={(e) => setFBalance(e.target.value)} placeholder="|≥|" inputMode="numeric" className="h-7 text-xs" /></th>
                <th className="p-1"><Input value={fRequest} onChange={(e) => setFRequest(e.target.value)} placeholder="≥" inputMode="numeric" className="h-7 text-xs" /></th>
              </tr>
            </thead>
            <tbody>
              {view.map((p) => {
                const bal = Number(p.balance ?? 0);
                // Split balance into the two visual columns — debtor cell only
                // shows a value when balance is strictly negative, creditor
                // cell only when strictly positive. Zero collapses to "—".
                const debtor = bal < 0 ? -bal : 0;
                const creditor = bal > 0 ? bal : 0;
                return (
                  <tr key={p.id} className="border-b border-border/50 hover:bg-muted/30">
                    <td className="p-2 font-medium">{p._display}</td>
                    <td className="p-2"><Money value={debtor} tone="debit" /></td>
                    <td className="p-2"><Money value={creditor} tone="credit" /></td>
                    <td className="p-2"><Money value={bal} tone={bal < 0 ? "debit" : bal > 0 ? "credit" : "neutral"} /></td>
                    <td className="p-2"><Money value={Number(p.request_balance ?? 0)} tone="neutral" /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {totalCount !== null && totalCount > PAGE_SIZE && (
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
