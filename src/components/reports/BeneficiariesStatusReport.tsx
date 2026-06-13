// ---------------------------------------------------------------------------
// گزارش وضعیت ذینفعان (Beneficiaries Status Report)
// ---------------------------------------------------------------------------
// Data contract (single source of truth = SQL RPC):
//   public.get_beneficiaries_balance_report(p_search, p_limit, p_offset)
//
// Per the product spec, for every beneficiary we show:
//   • بدهکار  = SUM(COALESCE(finance_voucher_items.debit, 0))
//   • بستانکار = SUM(COALESCE(finance_voucher_items.credit, 0))
//   • مانده   = بستانکار − بدهکار
//
// Sign convention (color + chip both derive from the same `balance` value
// so they can never disagree):
//   مانده > 0 → بستانکار (party is owed; GREEN)
//   مانده < 0 → بدهکار   (party owes us;  RED)
//   مانده = 0 → بی‌حساب  (neutral / foreground)
//
// Beneficiaries with zero voucher activity MUST still appear in the table
// with 0 / 0 / 0. The RPC guarantees this by using a LEFT JOIN with the
// deleted-voucher predicate on the JOIN condition (NOT in WHERE) — otherwise
// the LEFT JOIN would collapse to INNER JOIN and drop those rows.
//
// We deliberately ignore finance_parties.balance here: it can be out of sync
// with the voucher_items ledger. The report must always reflect the actual
// posted ledger so reconciliation is meaningful.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/finance";
import { cn } from "@/lib/utils";
import { ChevronUp, ChevronDown, Search, Loader2 } from "lucide-react";

// One page = 25 rows. Matches the previous behaviour so the UI stays familiar.
const PAGE_SIZE = 25;

// Shape returned by the RPC. We mirror only what the table actually uses.
interface RpcRow {
  party_id: string;
  party_name: string;
  debit_total: number | string | null;
  credit_total: number | string | null;
  balance: number | string | null;
  balance_status: "debtor" | "creditor" | "settled" | string;
  total_count: number | string | null; // same number on every row
}

// Local view-model after numeric coercion. RPC returns NUMERIC which the
// PostgREST client serialises as strings to avoid precision loss — we coerce
// here so the sort comparators behave correctly.
interface ViewRow {
  id: string;
  display_name: string;
  debit: number;
  credit: number;
  balance: number;
  status: "debtor" | "creditor" | "settled";
}

type SortKey = "display_name" | "debit" | "credit" | "balance";

// Map balance bucket → label + chip tone. We accept either the RPC-provided
// status string OR a balance number; both paths must produce the same chip.
function categorize(status: ViewRow["status"]): { label: string; tone: string } {
  if (status === "creditor") return { label: "بستانکار", tone: "bg-emerald-100 text-emerald-800" };
  if (status === "debtor") return { label: "بدهکار", tone: "bg-red-100 text-red-800" };
  return { label: "بی‌حساب", tone: "bg-muted text-muted-foreground" };
}

// Safe Number() coercion: handles null/undefined/strings ("12345.67") and
// guarantees we never feed NaN into Math operations or formatMoney.
function n(v: number | string | null | undefined): number {
  if (v == null) return 0;
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

export default function BeneficiariesStatusReport() {
  const [rows, setRows] = useState<ViewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("display_name");
  const [sortAsc, setSortAsc] = useState(true);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState<number>(0);

  // Debounce the search input so we don't fire an RPC on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Reset to page 1 when the search term changes — otherwise the user can
  // land on an empty page (e.g. they were on page 4 of a long list).
  useEffect(() => setPage(1), [debouncedSearch]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, page]);

  async function load() {
    setLoading(true);
    setError(null);

    // Single round-trip: the RPC returns aggregates + total_count window.
    // This removes the previous client-side aggregation that was vulnerable
    // to Supabase's 1000-row response cap.
    const { data, error: rpcErr } = await supabase.rpc(
      "get_beneficiaries_balance_report",
      {
        p_search: debouncedSearch || null,
        p_limit: PAGE_SIZE,
        p_offset: (page - 1) * PAGE_SIZE,
      },
    );

    if (rpcErr) {
      setError(rpcErr.message);
      setRows([]);
      setTotalCount(0);
      setLoading(false);
      return;
    }

    const list = (data as RpcRow[]) || [];

    // Project RPC rows → ViewRow with numeric coercion done once up-front.
    const mapped: ViewRow[] = list.map((r) => ({
      id: r.party_id,
      display_name: r.party_name || "بدون نام",
      debit: n(r.debit_total),
      credit: n(r.credit_total),
      balance: n(r.balance),
      status:
        r.balance_status === "creditor" || r.balance_status === "debtor"
          ? r.balance_status
          : "settled",
    }));

    setRows(mapped);
    // total_count is identical on every row (it's a window-function over the
    // filtered set) — read it from the first row, fall back to length.
    setTotalCount(list.length ? n(list[0].total_count) : 0);
    setLoading(false);
  }

  // Client-side sort over the current page only. The RPC already sorts by
  // party_name; we re-sort here when the user clicks a different header.
  const view = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "display_name") cmp = a.display_name.localeCompare(b.display_name, "fa");
      else if (sortKey === "debit") cmp = a.debit - b.debit;
      else if (sortKey === "credit") cmp = a.credit - b.credit;
      else if (sortKey === "balance") cmp = a.balance - b.balance;
      return sortAsc ? cmp : -cmp;
    });
    return copy;
  }, [rows, sortKey, sortAsc]);

  const pageCount = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

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
    <section className="space-y-3 rounded-lg border bg-card p-4" dir="rtl">
      <header className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-bold">وضعیت ذینفعان</h2>
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="جستجو نام، کد ملی، شناسه ملی، موبایل..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pr-8"
          />
        </div>
      </header>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> در حال بارگذاری…
        </div>
      ) : error ? (
        <p className="text-center text-red-500 py-8">خطا در بارگذاری: {error}</p>
      ) : view.length === 0 ? (
        <p className="text-center text-muted-foreground py-8">ذینفعی یافت نشد</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b">
              <tr>
                <th className="text-right p-2"><SortHeader k="display_name">نام ذینفع</SortHeader></th>
                <th className="text-right p-2"><SortHeader k="debit">بدهکار</SortHeader></th>
                <th className="text-right p-2"><SortHeader k="credit">بستانکار</SortHeader></th>
                <th className="text-right p-2"><SortHeader k="balance">مانده</SortHeader></th>
                <th className="text-right p-2">دسته</th>
              </tr>
            </thead>
            <tbody>
              {view.map((p) => {
                // Color the balance number from the SAME bucket the chip uses
                // so a single source of truth (RPC's balance_status) drives
                // the visual category everywhere on the row.
                const cat = categorize(p.status);
                const balanceTone =
                  p.status === "creditor"
                    ? "text-emerald-600 dark:text-emerald-400"
                    : p.status === "debtor"
                      ? "text-red-600 dark:text-red-400"
                      : "text-foreground";
                return (
                  <tr key={p.id} className="border-b border-border/50 hover:bg-muted/30">
                    <td className="p-2 font-medium">{p.display_name}</td>
                    {/* formatMoney(0) → "۰" — zeros are never blank. */}
                    <td className="p-2 font-mono tabular-nums">{formatMoney(p.debit)}</td>
                    <td className="p-2 font-mono tabular-nums">{formatMoney(p.credit)}</td>
                    <td className={cn("p-2 font-mono font-bold tabular-nums", balanceTone)}>
                      {formatMoney(p.balance)}
                    </td>
                    <td className="p-2">
                      <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold", cat.tone)}>
                        {cat.label}
                      </span>
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
