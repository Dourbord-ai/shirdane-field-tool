// ---------------------------------------------------------------------------
// گزارش وضعیت ذینفعان (Beneficiaries Status Report)
//
// Read-only report over `public.finance_parties`. It is intentionally
// decoupled from any mutation helper — opening / paginating / sorting this
// report MUST NEVER change a party's balance or request_balance. All number
// formatting happens client-side (Persian digits + thousand separators).
//
// Behavioural contract (per product spec):
//   • Search box hits the database (multi-column ilike via PostgREST `.or()`)
//     across: company_name, first_name, last_name, sepidar_full_name,
//     national_code, national_id, mobile.
//   • Every column is sortable ASC/DESC.
//   • Pagination is server-side (cheap because we never project blobs).
//   • Loading + empty states are explicit (operators rely on them to
//     understand "no data" vs "still fetching").
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/finance";
import { ChevronUp, ChevronDown, Search, Loader2 } from "lucide-react";

// Page-size kept moderate so a single round-trip stays well under the
// PostgREST URI limit and renders quickly on low-end devices.
const PAGE_SIZE = 25;

// Narrow projection — only the columns this report actually renders.
// `balance` / `request_balance` are numeric in DB; we keep them as raw
// numbers so formatMoney can apply the Rial separators.
interface PartyRow {
  id: string;
  company_name: string | null;
  first_name: string | null;
  last_name: string | null;
  sepidar_full_name: string | null;
  ownership_type: string | null;
  status: string | null;
  approval_status: string | null;
  sepidar_sync_status: string | null;
  balance: number | null;
  request_balance: number | null;
}

// Allowed sort keys. Limiting to a closed set protects against accidental
// PostgREST injection if the user-controlled string is ever wired in here.
type SortKey =
  | "display_name"
  | "balance"
  | "request_balance"
  | "status"
  | "approval_status"
  | "sepidar_sync_status";

// `display_name` is a derived field — the DB doesn't have a single column
// for it. When the user sorts by it we approximate using sepidar_full_name
// then company_name then first_name on the server, and let the client list
// finalise the ordering. This is good enough for a small page size.
const SORT_DB_COLUMN: Record<SortKey, string> = {
  display_name: "sepidar_full_name",
  balance: "balance",
  request_balance: "request_balance",
  status: "status",
  approval_status: "approval_status",
  sepidar_sync_status: "sepidar_sync_status",
};

function computeDisplayName(p: PartyRow): string {
  // Spec: legal/company first, then first+last, then sepidar_full_name fallback.
  if (p.company_name || p.ownership_type === "legal") {
    return p.company_name || p.sepidar_full_name || "—";
  }
  const personal = [p.first_name, p.last_name].filter(Boolean).join(" ").trim();
  return personal || p.sepidar_full_name || "—";
}

export default function BeneficiariesStatusReport() {
  // ---- UI state -----------------------------------------------------------
  const [rows, setRows] = useState<PartyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("display_name");
  const [sortAsc, setSortAsc] = useState(true);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState<number | null>(null);

  // Debounce search — 300ms feels live without spamming Postgres on every
  // Persian keystroke (each character may also fire IME events).
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Reset to page 1 whenever the result set narrows so we never land on an
  // out-of-range page.
  useEffect(() => setPage(1), [debouncedSearch, sortKey, sortAsc]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, sortKey, sortAsc, page]);

  async function load() {
    setLoading(true);

    // Base query: read-only, count=exact so we can drive pagination labels.
    let q = supabase
      .from("finance_parties")
      .select(
        "id, company_name, first_name, last_name, sepidar_full_name, ownership_type, status, approval_status, sepidar_sync_status, balance, request_balance",
        { count: "exact" },
      );

    // Soft-delete filter — finance_parties has an is_deleted column on
    // most rows; guard defensively in case some rows don't.
    q = q.or("is_deleted.is.null,is_deleted.eq.false");

    if (debouncedSearch) {
      // Sanitise PostgREST `.or()` separators just like the bank-tx tab.
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

    q = q.order(SORT_DB_COLUMN[sortKey], { ascending: sortAsc, nullsFirst: false });

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

  // Derived list with the display name pre-computed so the table cells +
  // the secondary client-side sort (when sortKey === "display_name") agree.
  const view = useMemo(() => {
    const list = rows.map((r) => ({ ...r, _display: computeDisplayName(r) }));
    if (sortKey === "display_name") {
      list.sort((a, b) => a._display.localeCompare(b._display, "fa"));
      if (!sortAsc) list.reverse();
    }
    return list;
  }, [rows, sortKey, sortAsc]);

  const pageCount = Math.max(1, Math.ceil((totalCount ?? 0) / PAGE_SIZE));

  // Tiny header-cell helper to keep the sort handler DRY across columns.
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
          {/* Magnifier icon as a visual affordance — the box is real-time
              so users don't need to press Enter. */}
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
                <th className="text-right p-2"><SortHeader k="balance">وضعیت حساب</SortHeader></th>
                <th className="text-right p-2"><SortHeader k="request_balance">درخواست پرداخت تایید شده</SortHeader></th>
                <th className="text-right p-2"><SortHeader k="status">وضعیت</SortHeader></th>
                <th className="text-right p-2"><SortHeader k="approval_status">تایید</SortHeader></th>
                <th className="text-right p-2"><SortHeader k="sepidar_sync_status">سپیدار</SortHeader></th>
              </tr>
            </thead>
            <tbody>
              {view.map((p) => (
                <tr key={p.id} className="border-b border-border/50 hover:bg-muted/30">
                  <td className="p-2 font-medium">{p._display}</td>
                  <td className="p-2 font-mono">{formatMoney(Number(p.balance ?? 0))}</td>
                  <td className="p-2 font-mono">{formatMoney(Number(p.request_balance ?? 0))}</td>
                  <td className="p-2 text-xs text-muted-foreground">{p.status || "—"}</td>
                  <td className="p-2 text-xs text-muted-foreground">{p.approval_status || "—"}</td>
                  <td className="p-2 text-xs text-muted-foreground">{p.sepidar_sync_status || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination row — hidden when result fits in one page. */}
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
