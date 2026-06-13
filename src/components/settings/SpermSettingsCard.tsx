// SpermSettingsCard
// -----------------
// Settings card that lists every sperm row from the `sperms` table and lets
// the operator flip its `is_active` flag on/off. Inactive sperms are hidden
// from the regular sperm selection dropdowns throughout the app
// (insemination, list builder, new invoice) but remain visible here so they
// can be re-activated at any time.
//
// This version uses SERVER-SIDE pagination + search instead of pulling the
// whole table into the browser. The reason: the `sperms` table can grow
// large (thousands of imported rows) and loading everything at once was
// both slow and forced the user to filter on whatever subset happened to
// be in memory. With server-side search the user can find ANY sperm by
// name/code across the entire table, and pagination keeps the UI snappy.
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  FlaskConical,
  Search,
  ChevronRight,
  ChevronLeft,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";

// Local shape — we only need the columns relevant to settings/listing.
type SpermRow = {
  id: number;
  name: string | null;
  code: string | null;
  is_active: boolean;
};

// Tab filter for the list: all / active / inactive. This is applied on the
// server via an `.eq("is_active", ...)` filter when it isn't "all".
type Filter = "all" | "active" | "inactive";

// Fixed page size. 25 keeps each page short enough to scan without too
// many trips to the server when paging through hundreds of rows.
const PAGE_SIZE = 25;

export default function SpermSettingsCard() {
  // Current page of rows (already paginated/filtered by the server).
  const [rows, setRows] = useState<SpermRow[]>([]);
  // Total number of rows matching the current filter+search — used to
  // render page counts and disable the next button at the end.
  const [total, setTotal] = useState(0);
  // Loading flag for any fetch (initial + page change + search).
  const [loading, setLoading] = useState(true);
  // Active filter tab (server-side).
  const [filter, setFilter] = useState<Filter>("all");
  // Free-text search by name/code (server-side, debounced below).
  const [q, setQ] = useState("");
  // Debounced version of `q` — we only re-query after the user pauses
  // typing for ~300ms to avoid hammering the server on every keystroke.
  const [debouncedQ, setDebouncedQ] = useState("");
  // Zero-based page index. Reset to 0 whenever filter/search changes.
  const [page, setPage] = useState(0);
  // Track which row ids are currently being toggled (to disable the switch).
  const [pending, setPending] = useState<Set<number>>(new Set());
  // Cached per-filter counts shown on the filter chips. These are fetched
  // separately with HEAD requests so we don't have to load every row just
  // to display "(123)" next to each tab.
  const [counts, setCounts] = useState({ all: 0, active: 0, inactive: 0 });

  // Debounce the search input. Keeping this as a small effect avoids
  // pulling in a third-party debounce helper for a single field.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  // Whenever the user changes the filter or search term, jump back to the
  // first page — otherwise they could land on an empty page that only
  // exists for the previous query.
  useEffect(() => {
    setPage(0);
  }, [filter, debouncedQ]);

  // Build the base query with the current filter + search applied. We
  // factor this out because both the page fetch and the count fetches
  // Build the `.or(...)` argument string for name/code ilike search, or
  // null when there's no search term. Factored out so the page query and
  // each chip-count query can apply the same clause.
  const orClause = useMemo(() => {
    if (!debouncedQ) return null;
    // Strip characters that would confuse Supabase's `.or()` parser
    // (`,` separates clauses, `%` is the wildcard).
    const escaped = debouncedQ.replace(/[%,]/g, " ");
    return `name.ilike.%${escaped}%,code.ilike.%${escaped}%`;
  }, [debouncedQ]);

  // Refetch the current page whenever filter/search/page changes. We use
  // `.range(from, to)` for offset pagination and `count: 'exact'` so we
  // know the total number of matches for the pager.
  const fetchPage = useCallback(async () => {
    setLoading(true);

    // Build the page query. `count: 'exact'` makes the response include
    // the total matching row count alongside the page slice.
    let pageQuery = supabase
      .from("sperms")
      .select("id, name, code, is_active", { count: "exact" })
      .order("name", { ascending: true })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

    // Apply the active/inactive tab filter on the server.
    if (filter === "active") pageQuery = pageQuery.eq("is_active", true);
    else if (filter === "inactive") pageQuery = pageQuery.eq("is_active", false);

    // Apply the shared search clause.
    if (orClause) pageQuery = pageQuery.or(orClause);

    const { data, error, count } = await pageQuery;
    if (error) {
      toast({
        title: "خطا در بارگذاری اسپرم‌ها",
        description: error.message,
        variant: "destructive",
      });
      setRows([]);
      setTotal(0);
    } else {
      setRows((data ?? []) as SpermRow[]);
      setTotal(count ?? 0);
    }
    setLoading(false);
  }, [page, filter, orClause]);

  // Refetch chip counts when the search term changes. Each chip shows the
  // total number of rows that would appear under its own filter, so we
  // issue three HEAD-only requests in parallel (`head: true` skips the
  // row payload entirely and just returns the count — much cheaper).
  const fetchCounts = useCallback(async () => {
    const make = (state?: boolean) => {
      let q1 = supabase
        .from("sperms")
        .select("id", { count: "exact", head: true });
      if (state !== undefined) q1 = q1.eq("is_active", state);
      if (orClause) q1 = q1.or(orClause);
      return q1;
    };

    // Fire all three in parallel for speed.
    const [allRes, activeRes, inactiveRes] = await Promise.all([
      make(),
      make(true),
      make(false),
    ]);

    setCounts({
      all: allRes.count ?? 0,
      active: activeRes.count ?? 0,
      inactive: inactiveRes.count ?? 0,
    });
  }, [orClause]);

  // Trigger fetches whenever the relevant inputs change.
  useEffect(() => {
    void fetchPage();
  }, [fetchPage]);
  useEffect(() => {
    void fetchCounts();
  }, [fetchCounts]);

  // Toggle is_active for a single sperm and update local state optimistically.
  async function toggle(row: SpermRow, next: boolean) {
    // Mark this row as pending so the switch is disabled briefly.

    setPending((s) => new Set(s).add(row.id));
    // Optimistic UI update on the currently visible page.
    setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, is_active: next } : r)));

    const { error } = await supabase
      .from("sperms")
      .update({ is_active: next })
      .eq("id", row.id);

    if (error) {
      // Revert on failure.
      setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, is_active: !next } : r)));
      toast({ title: "ذخیره نشد", description: error.message, variant: "destructive" });
    } else {
      toast({
        title: next ? "اسپرم فعال شد" : "اسپرم غیرفعال شد",
        description: row.name ?? row.code ?? `#${row.id}`,
      });
      // Refresh chip counts so the active/inactive numbers stay accurate
      // after a toggle. We don't refetch the page itself to avoid a
      // jarring reorder.
      void fetchCounts();
    }

    // Clear pending flag.
    setPending((s) => {
      const n = new Set(s);
      n.delete(row.id);
      return n;
    });
  }

  // Tab definitions for the filter row, wired to the cached counts above.
  const tabs: { key: Filter; label: string; count: number }[] = useMemo(
    () => [
      { key: "all", label: "همه", count: counts.all },
      { key: "active", label: "فعال", count: counts.active },
      { key: "inactive", label: "غیر فعال", count: counts.inactive },
    ],
    [counts],
  );

  // Pager bookkeeping for the footer.
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const fromIdx = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const toIdx = Math.min(total, (page + 1) * PAGE_SIZE);

  return (
    <section className="rounded-2xl border border-border bg-card overflow-hidden">
      {/* Card header: icon + title + short description */}
      <header className="flex items-start gap-3 p-4 border-b border-border bg-gradient-to-l from-primary/10 to-transparent">
        <div className="w-10 h-10 rounded-xl bg-primary/15 text-primary flex items-center justify-center shrink-0">
          <FlaskConical className="w-5 h-5" />
        </div>
        <div className="flex-1">
          <h2 className="text-base font-bold text-foreground">تنظیمات اسپرم</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            فقط اسپرم‌های «فعال» در فهرست‌های انتخاب اسپرم در سراسر برنامه نمایش داده می‌شوند.
          </p>
        </div>
      </header>

      {/* Filter chips + search */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 border-b border-border">
        <div className="flex flex-wrap gap-1.5">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setFilter(t.key)}
              className={
                "px-3 py-1.5 rounded-full text-xs font-bold border transition-colors " +
                (filter === t.key
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-secondary/40 text-muted-foreground border-transparent hover:text-foreground")
              }
            >
              {t.label}
              <span className="opacity-70 mr-1">({t.count})</span>
            </button>
          ))}
        </div>
        <div className="relative w-full sm:w-64">
          <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="جستجو در نام یا کد (کل جدول)..."
            className="pr-9"
          />
        </div>
      </div>

      {/* List body */}
      {loading ? (
        <div className="flex items-center justify-center py-10 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      ) : rows.length === 0 ? (
        <p className="text-center text-muted-foreground py-8 text-sm">موردی یافت نشد</p>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((r) => {
            const isPending = pending.has(r.id);
            return (
              <li
                key={r.id}
                className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-secondary/30 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm text-foreground truncate">
                      {r.name ?? `#${r.id}`}
                    </span>
                    {/* Status badge mirrors the switch state for quick scanning */}
                    <Badge
                      variant={r.is_active ? "default" : "secondary"}
                      className={r.is_active ? "" : "opacity-60"}
                    >
                      {r.is_active ? "فعال" : "غیر فعال"}
                    </Badge>
                  </div>
                  {r.code && (
                    <div className="text-xs text-muted-foreground mt-0.5">کد: {r.code}</div>
                  )}
                </div>
                {/* The actual toggle — disabled while the update is in flight */}
                <Switch
                  checked={r.is_active}
                  disabled={isPending}
                  onCheckedChange={(v) => toggle(r, v)}
                />
              </li>
            );
          })}
        </ul>
      )}

      {/* Pager — hidden when there's only a single page. We show the
          row range ("1-25 از 312") plus prev/next buttons. Buttons use
          ChevronRight for "previous" because the layout is RTL. */}
      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between gap-3 p-3 border-t border-border bg-secondary/20">
          <div className="text-xs text-muted-foreground">
            {fromIdx.toLocaleString("fa-IR")}–{toIdx.toLocaleString("fa-IR")}{" "}
            <span className="opacity-70">از</span>{" "}
            {total.toLocaleString("fa-IR")}
          </div>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0 || loading}
            >
              <ChevronRight className="w-4 h-4" />
              قبلی
            </Button>
            <span className="text-xs text-muted-foreground px-2">
              صفحه {(page + 1).toLocaleString("fa-IR")} از{" "}
              {totalPages.toLocaleString("fa-IR")}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => (p + 1 < totalPages ? p + 1 : p))}
              disabled={page + 1 >= totalPages || loading}
            >
              بعدی
              <ChevronLeft className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
