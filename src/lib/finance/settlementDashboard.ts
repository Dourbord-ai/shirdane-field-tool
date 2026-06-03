// =============================================================================
// settlementDashboard — Phase 9
// -----------------------------------------------------------------------------
// READ-ONLY data layer for the Settlement Dashboard tab. Everything here is a
// thin React-Query hook over PostgREST. We deliberately use MULTIPLE focused
// queries instead of a single monolithic RPC:
//   - Easier to cache/invalidate per section
//   - Each section can fail / refetch independently
//   - No new DB objects required (Phase 9 promise: zero schema changes)
//
// All KPI math is defined in ONE place (computeKpis) so the strip on top and
// any future widget can reuse the exact same definitions.
// =============================================================================
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { todayGregorianISO } from "@/lib/dateUtils";

// -----------------------------------------------------------------------------
// Status sets — single source of truth for what counts as "remaining" etc.
// Mirrors `settlementExecution.ts` categorisation. Keeping a local copy
// (instead of importing the enum) because we filter against the RAW DB string
// and need to be tolerant of NULLs / legacy values (which are bucketed as
// "pending" / "open").
// -----------------------------------------------------------------------------
export const EXECUTED_STATUSES = ["executed", "partially_executed"] as const;
export const LINKED_STATUSES = ["linked"] as const;
export const CLOSED_OUT_STATUSES = ["cancelled", "rejected"] as const;
// "Remaining" = anything that still owes money: not executed, not linked away,
// not cancelled/rejected. NULL counts as remaining (legacy items).
export const REMAINING_STATUSES = [
  "pending",
  "ready_for_execution",
  "in_progress",
  "partially_executed", // still partially owed
  "on_hold",
] as const;

// -----------------------------------------------------------------------------
// Business-category mapping
// -----------------------------------------------------------------------------
// factor_related_costs.cost_category is a free-text column. We bucket it into
// the 5 categories the dashboard cares about. Anything unknown / null falls
// into "miscellaneous" so totals always reconcile.
export type BizCategory = "feed" | "medicine" | "freight" | "services" | "miscellaneous";
export const BIZ_CATEGORY_LABELS_FA: Record<BizCategory, string> = {
  feed: "خوراک",
  medicine: "دارو",
  freight: "حمل و نقل",
  services: "خدمات",
  miscellaneous: "متفرقه",
};
export function bucketCostCategory(raw: string | null | undefined): BizCategory {
  if (!raw) return "miscellaneous";
  const k = raw.toLowerCase().trim();
  if (["feed", "feed_supplier", "food", "خوراک"].includes(k)) return "feed";
  if (["medicine", "vet", "drug", "دارو"].includes(k)) return "medicine";
  if (["freight", "transport", "driver", "حمل", "حمل و نقل"].includes(k)) return "freight";
  if (["service", "services", "خدمات"].includes(k)) return "services";
  return "miscellaneous";
}

// -----------------------------------------------------------------------------
// Row shape used by all hooks. We project only the columns the dashboard
// actually reads to keep payloads small. `party` and `cost` are populated
// only by hooks that join them in.
// -----------------------------------------------------------------------------
export interface DashItem {
  id: string;
  payment_request_id: string;
  party_id: string | null;
  amount: number;
  remaining_amount: number | null;
  payment_method: string | null;
  execution_status: string | null;
  due_date: string | null; // YYYY-MM-DD
  voucher_id: string | null;
  source_related_cost_id: string | null;
  party_name?: string | null;
  cost_category?: string | null;
}

// -----------------------------------------------------------------------------
// Filters: a single shared shape used by the whole tab. All optional —
// every hook treats `undefined` as "no filter on this dimension".
// -----------------------------------------------------------------------------
export interface DashboardFilters {
  fromDate?: string | null; // Gregorian YYYY-MM-DD
  toDate?: string | null;
  partyIds?: string[];
  methods?: string[];
  categories?: BizCategory[];
}

// -----------------------------------------------------------------------------
// Core fetcher — loads the open settlement-item universe ONCE per filter set
// and lets the rest of the dashboard derive aggregates client-side. We do
// this because:
//   1. After "not cancelled/rejected" + date window, the universe is small.
//   2. It guarantees every section uses the same data snapshot (no race
//      between KPI strip and tables).
//   3. We avoid a dozen near-identical SQL queries.
// If profiling later shows the payload >5k rows we will split into RPCs.
// -----------------------------------------------------------------------------
async function fetchDashboardUniverse(filters: DashboardFilters): Promise<DashItem[]> {
  // Start with all non-deleted items belonging to non-archived requests.
  // We embed the parent request and party + related cost in a single query
  // using PostgREST's foreign-table syntax — one round trip, no N+1.
  let query = supabase
    .from("finance_payment_request_items")
    .select(
      `id,
       payment_request_id,
       party_id,
       amount,
       remaining_amount,
       payment_method,
       execution_status,
       due_date,
       voucher_id,
       source_related_cost_id,
       is_deleted,
       finance_payment_requests!inner(status,is_deleted),
       finance_parties(first_name,last_name,company_name),
       factor_related_costs(cost_category)`,
    )
    .eq("is_deleted", false)
    .eq("finance_payment_requests.is_deleted", false)
    // Exclude items the user explicitly closed out; they don't represent a
    // live obligation any more.
    .not("execution_status", "in", `(${CLOSED_OUT_STATUSES.join(",")})`);

  // Apply server-side filters when present. Each is additive.
  if (filters.partyIds && filters.partyIds.length > 0) {
    query = query.in("party_id", filters.partyIds);
  }
  if (filters.methods && filters.methods.length > 0) {
    query = query.in("payment_method", filters.methods);
  }
  // Date filter applies to due_date only. We keep "no due_date" rows in
  // the result because they still represent a liability (just undated).
  if (filters.fromDate) query = query.or(`due_date.gte.${filters.fromDate},due_date.is.null`);
  if (filters.toDate) query = query.or(`due_date.lte.${filters.toDate},due_date.is.null`);

  // Supabase caps default selects at 1000 — bump it; if the project ever
  // crosses 5k open items we'll switch to an RPC.
  const { data, error } = await query.limit(5000);
  if (error) throw new Error(error.message);

  // Flatten the embedded rows into the shape the UI expects.
  const flat: DashItem[] = (data ?? []).map((r: any) => {
    const p = r.finance_parties;
    const partyName = p
      ? p.company_name?.trim() || `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim()
      : null;
    return {
      id: r.id,
      payment_request_id: r.payment_request_id,
      party_id: r.party_id,
      amount: Number(r.amount ?? 0),
      remaining_amount: r.remaining_amount === null ? null : Number(r.remaining_amount),
      payment_method: r.payment_method,
      execution_status: r.execution_status,
      due_date: r.due_date,
      voucher_id: r.voucher_id,
      source_related_cost_id: r.source_related_cost_id,
      party_name: partyName,
      cost_category: r.factor_related_costs?.cost_category ?? null,
    };
  });

  // Apply category filter client-side (we need the joined cost_category to
  // bucket; PostgREST can't filter on a derived bucket).
  if (filters.categories && filters.categories.length > 0) {
    return flat.filter((it) => filters.categories!.includes(bucketCostCategory(it.cost_category)));
  }
  return flat;
}

export function useDashboardUniverse(filters: DashboardFilters) {
  return useQuery({
    queryKey: ["settlement-dashboard-universe", filters],
    queryFn: () => fetchDashboardUniverse(filters),
    staleTime: 60_000, // 1 min — dashboard is operational, not real-time
  });
}

// -----------------------------------------------------------------------------
// KPI derivation — runs over the in-memory universe. Single function so all
// definitions stay co-located.
// -----------------------------------------------------------------------------
export interface DashboardKpis {
  totalOpen: number;
  executed: number;
  remaining: number;
  dueToday: number;
  due7d: number;
  due30d: number;
  overdue: number;
  checkLinked: number;
  bankPending: number;
  executedNotClosed: number; // executed but voucher_id IS NULL
}

// Helper — "amount owed" for an item. Prefer remaining_amount when it is set
// (it accounts for partial payments); fall back to the gross amount.
function owed(it: DashItem): number {
  if (it.remaining_amount !== null && !Number.isNaN(it.remaining_amount)) {
    return it.remaining_amount;
  }
  return it.amount;
}

const isRemaining = (s: string | null) =>
  s === null || (REMAINING_STATUSES as readonly string[]).includes(s);
const isExecuted = (s: string | null) => (EXECUTED_STATUSES as readonly string[]).includes(s ?? "");
const isLinked = (s: string | null) => (LINKED_STATUSES as readonly string[]).includes(s ?? "");

export function computeKpis(items: DashItem[]): DashboardKpis {
  const today = todayGregorianISO();
  // Build the +7 / +30 day cutoffs from today using plain string compare —
  // YYYY-MM-DD is lexicographically orderable so we can avoid Date math.
  const plusDays = (n: number) => {
    const d = new Date(today + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const in7 = plusDays(7);
  const in30 = plusDays(30);

  let totalOpen = 0,
    executed = 0,
    remaining = 0,
    dueToday = 0,
    due7d = 0,
    due30d = 0,
    overdue = 0,
    checkLinked = 0,
    bankPending = 0,
    executedNotClosed = 0;

  for (const it of items) {
    const a = owed(it);
    totalOpen += a; // everything not cancelled/rejected is "open"
    if (isExecuted(it.execution_status)) executed += a;
    if (isLinked(it.execution_status)) checkLinked += a;
    if (isRemaining(it.execution_status)) {
      remaining += a;
      // Date-based buckets only count toward remaining (you can't be "overdue"
      // on something already executed).
      const d = it.due_date;
      if (d) {
        if (d === today) dueToday += a;
        if (d < today) overdue += a;
        if (d >= today && d <= in7) due7d += a;
        if (d >= today && d <= in30) due30d += a;
      }
      if (it.payment_method === "bank_transfer") bankPending += a;
    }
    // "Executed but not financially closed" — money has gone out (or the
    // payment was made) but no voucher has been posted yet. Voucher posting
    // is owned by another module; the dashboard simply surfaces the gap.
    if (isExecuted(it.execution_status) && !it.voucher_id) executedNotClosed += a;
  }

  return {
    totalOpen,
    executed,
    remaining,
    dueToday,
    due7d,
    due30d,
    overdue,
    checkLinked,
    bankPending,
    executedNotClosed,
  };
}

// -----------------------------------------------------------------------------
// Aggregations consumed by the table sections. All pure, derived from the
// already-loaded universe — no extra round trips.
// -----------------------------------------------------------------------------

/** Group remaining amount by payment_method. */
export function aggregateByMethod(items: DashItem[]) {
  const map = new Map<string, { method: string; amount: number; count: number }>();
  for (const it of items) {
    if (!isRemaining(it.execution_status)) continue;
    const m = it.payment_method ?? "—";
    const cur = map.get(m) ?? { method: m, amount: 0, count: 0 };
    cur.amount += owed(it);
    cur.count += 1;
    map.set(m, cur);
  }
  return Array.from(map.values()).sort((a, b) => b.amount - a.amount);
}

/** Group remaining amount by business category. */
export function aggregateByCategory(items: DashItem[]) {
  const map = new Map<BizCategory, { category: BizCategory; amount: number; count: number }>();
  for (const it of items) {
    if (!isRemaining(it.execution_status)) continue;
    const c = bucketCostCategory(it.cost_category);
    const cur = map.get(c) ?? { category: c, amount: 0, count: 0 };
    cur.amount += owed(it);
    cur.count += 1;
    map.set(c, cur);
  }
  return Array.from(map.values()).sort((a, b) => b.amount - a.amount);
}

/** Top N parties by remaining liability amount. */
export function topLiabilities(items: DashItem[], limit = 10) {
  const map = new Map<string, { party_id: string; party_name: string; amount: number; count: number }>();
  for (const it of items) {
    if (!isRemaining(it.execution_status)) continue;
    const key = it.party_id ?? "—";
    const cur = map.get(key) ?? { party_id: key, party_name: it.party_name ?? "—", amount: 0, count: 0 };
    cur.amount += owed(it);
    cur.count += 1;
    map.set(key, cur);
  }
  return Array.from(map.values())
    .sort((a, b) => b.amount - a.amount)
    .slice(0, limit);
}

/** Top N parties by nearest upcoming due_date (overdue first, then ascending). */
export function nextDueParties(items: DashItem[], limit = 10) {
  const today = todayGregorianISO();
  const map = new Map<
    string,
    { party_id: string; party_name: string; nextDue: string; amount: number; overdue: boolean }
  >();
  for (const it of items) {
    if (!isRemaining(it.execution_status)) continue;
    if (!it.due_date) continue;
    const key = it.party_id ?? "—";
    const cur = map.get(key);
    if (!cur || it.due_date < cur.nextDue) {
      map.set(key, {
        party_id: key,
        party_name: it.party_name ?? "—",
        nextDue: it.due_date,
        amount: owed(it),
        overdue: it.due_date < today,
      });
    } else if (cur && it.due_date === cur.nextDue) {
      // Same date → accumulate amount so the row reflects what's due that day.
      cur.amount += owed(it);
    }
  }
  return Array.from(map.values())
    .sort((a, b) => a.nextDue.localeCompare(b.nextDue))
    .slice(0, limit);
}

/** Items due in the next N days (default 30), sorted ascending. */
export function upcomingObligations(items: DashItem[], days = 30) {
  const today = todayGregorianISO();
  const cutoff = (() => {
    const d = new Date(today + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  })();
  return items
    .filter(
      (it) =>
        isRemaining(it.execution_status) &&
        it.due_date &&
        it.due_date >= today &&
        it.due_date <= cutoff,
    )
    .sort((a, b) => (a.due_date! < b.due_date! ? -1 : 1));
}

/** Daily totals for the calendar — map of YYYY-MM-DD → amount. */
export function calendarBuckets(items: DashItem[]) {
  const map = new Map<string, number>();
  for (const it of items) {
    if (!isRemaining(it.execution_status)) continue;
    if (!it.due_date) continue;
    map.set(it.due_date, (map.get(it.due_date) ?? 0) + owed(it));
  }
  return map;
}

/** Items in a specific business category (used by the freight + feed tables). */
export function itemsInCategory(items: DashItem[], category: BizCategory) {
  return items.filter(
    (it) => isRemaining(it.execution_status) && bucketCostCategory(it.cost_category) === category,
  );
}
