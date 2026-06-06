// ---------------------------------------------------------------------------
// گزارش وضعیت ذینفعان (Beneficiaries Status Report)
//
// Read-only report. For every beneficiary we show:
//   • بدهکار  = SUM(finance_voucher_items.debit)
//   • بستانکار = SUM(finance_voucher_items.credit)
//   • مانده   = بستانکار − بدهکار
//
// Sign convention (must match finance_parties.balance and the voucher_items
// double-entry model already used across the app):
//   مانده > 0 → بستانکار (party is owed; show GREEN)
//   مانده < 0 → بدهکار   (party owes us;  show RED)
//   مانده = 0 → بی‌حساب  (neutral / white)
//
// Parties with NO voucher activity at all must render as 0 / 0 / 0 — never
// blank, never null. This is enforced by defaulting missing aggregate rows
// to zero after the join.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/finance";
import { cn } from "@/lib/utils";
import { ChevronUp, ChevronDown, Search, Loader2 } from "lucide-react";

const PAGE_SIZE = 25;

interface PartyRow {
  id: string;
  company_name: string | null;
  first_name: string | null;
  last_name: string | null;
  sepidar_full_name: string | null;
  ownership_type: string | null;
}

// Aggregated debit/credit per party computed from finance_voucher_items.
interface PartyTotals {
  debit: number;
  credit: number;
  balance: number; // credit − debit (positive = creditor, negative = debtor)
}

type SortKey = "display_name" | "debit" | "credit" | "balance";

function computeDisplayName(p: PartyRow): string {
  if (p.company_name || p.ownership_type === "legal") {
    return p.company_name || p.sepidar_full_name || "—";
  }
  const personal = [p.first_name, p.last_name].filter(Boolean).join(" ").trim();
  return personal || p.sepidar_full_name || "—";
}

// Category bucket — derived from balance sign per the product spec.
function categorize(balance: number): { label: string; tone: string } {
  if (balance > 0) return { label: "بستانکار", tone: "bg-emerald-100 text-emerald-800" };
  if (balance < 0) return { label: "بدهکار", tone: "bg-red-100 text-red-800" };
  return { label: "بی‌حساب", tone: "bg-muted text-muted-foreground" };
}

export default function BeneficiariesStatusReport() {
  const [rows, setRows] = useState<PartyRow[]>([]);
  // Map keyed by party.id → aggregated debit/credit. Defaults to zero when a
  // party has zero voucher rows (the spec requires 0, never null).
  const [totals, setTotals] = useState<Record<string, PartyTotals>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("display_name");
  const [sortAsc, setSortAsc] = useState(true);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState<number | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => setPage(1), [debouncedSearch]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, page]);

  async function load() {
    setLoading(true);

    // ---- 1) load parties for the current page (search + pagination) ------
    let q = supabase
      .from("finance_parties")
      .select(
        "id, company_name, first_name, last_name, sepidar_full_name, ownership_type",
        { count: "exact" },
      )
      .or("is_deleted.is.null,is_deleted.eq.false")
      .order("sepidar_full_name", { ascending: true, nullsFirst: false });

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

    const from = (page - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    q = q.range(from, to);

    const { data: parties, count, error } = await q;
    if (error) {
      setLoading(false);
      return;
    }

    const list = (parties as PartyRow[]) || [];
    setRows(list);
    setTotalCount(count ?? 0);

    // ---- 2) load voucher_items aggregates for these parties --------------
    // We pull raw debit/credit per party_id and aggregate client-side. This
    // avoids needing a DB view/RPC and keeps the report self-contained.
    // Only non-deleted vouchers should contribute — we filter via inner join.
    const ids = list.map((p) => p.id);
    const aggregates: Record<string, PartyTotals> = {};
    // Pre-seed every visible party with zero so missing data renders as 0/0/0.
    ids.forEach((id) => (aggregates[id] = { debit: 0, credit: 0, balance: 0 }));

    if (ids.length > 0) {
      const { data: items, error: itemsErr } = await supabase
        .from("finance_voucher_items")
        .select("party_id, debit, credit, finance_vouchers!inner(is_deleted)")
        .in("party_id", ids)
        .or("is_deleted.is.null,is_deleted.eq.false", { foreignTable: "finance_vouchers" });

      if (!itemsErr && items) {
        for (const it of items as Array<{ party_id: string | null; debit: number | string | null; credit: number | string | null }>) {
          if (!it.party_id || !(it.party_id in aggregates)) continue;
          const d = Number(it.debit ?? 0) || 0;
          const c = Number(it.credit ?? 0) || 0;
          aggregates[it.party_id].debit += d;
          aggregates[it.party_id].credit += c;
        }
        // Finalise the balance: credit − debit per the product spec.
        for (const id of Object.keys(aggregates)) {
          aggregates[id].balance = aggregates[id].credit - aggregates[id].debit;
        }
      }
    }

    setTotals(aggregates);
    setLoading(false);
  }

  // Client-side sort over the current page (server returns by name already).
  const view = useMemo(() => {
    const enriched = rows.map((r) => {
      const t = totals[r.id] || { debit: 0, credit: 0, balance: 0 };
      return { ...r, _display: computeDisplayName(r), ...t };
    });
    enriched.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "display_name") cmp = a._display.localeCompare(b._display, "fa");
      else if (sortKey === "debit") cmp = a.debit - b.debit;
      else if (sortKey === "credit") cmp = a.credit - b.credit;
      else if (sortKey === "balance") cmp = a.balance - b.balance;
      return sortAsc ? cmp : -cmp;
    });
    return enriched;
  }, [rows, totals, sortKey, sortAsc]);

  const pageCount = Math.max(1, Math.ceil((totalCount ?? 0) / PAGE_SIZE));

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
                // Balance sign drives BOTH the number color and the bucket
                // chip — keep them derived from the same value so the UI can
                // never disagree with itself.
                const cat = categorize(p.balance);
                const balanceTone =
                  p.balance > 0
                    ? "text-emerald-600 dark:text-emerald-400"
                    : p.balance < 0
                      ? "text-red-600 dark:text-red-400"
                      : "text-foreground";
                return (
                  <tr key={p.id} className="border-b border-border/50 hover:bg-muted/30">
                    <td className="p-2 font-medium">{p._display}</td>
                    {/* Always render 0 (never blank) when there is no activity. */}
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
