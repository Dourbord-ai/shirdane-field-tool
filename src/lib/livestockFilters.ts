// Single source of truth for livestock list filters.
// Used by both quick chips and advanced dropdowns so they always
// produce the same query.

import { PRESENCE_STATUS_LABELS, FERTILITY_STATUS_LABELS } from "@/lib/livestock";
import { IN_HERD_OR_STRING } from "@/lib/cowPresence";

export type FilterCategory = "presence" | "milking" | "fertility" | "sex";

export type FilterOption = {
  id: string;            // unique chip id, e.g. "presence:in_herd"
  category: FilterCategory;
  label: string;         // Persian display label
  // mutation applied to a supabase query; the same function is used
  // whether the user picked it from a quick chip or the advanced dropdown.
  apply: (q: any) => any;
};

// Single source of truth: cows.existancestatus.
//   0 (or NULL) → in herd; 1 sold, 2 died, 3 slaughtered, 4 other.
const IN_HERD_OR = IN_HERD_OR_STRING;

// --- builders ---------------------------------------------------------------

const presenceOpt = (key: string, label: string, apply: FilterOption["apply"]): FilterOption => ({
  id: `presence:${key}`,
  category: "presence",
  label,
  apply,
});

export const PRESENCE_OPTIONS: FilterOption[] = [
  presenceOpt("in_herd", PRESENCE_STATUS_LABELS[0], (q) => q.or(IN_HERD_OR)),
  presenceOpt("sold", PRESENCE_STATUS_LABELS[1], (q) => q.eq("existancestatus", 1)),
  presenceOpt("died", PRESENCE_STATUS_LABELS[2], (q) => q.eq("existancestatus", 2)),
  presenceOpt("slaughtered", PRESENCE_STATUS_LABELS[3], (q) => q.eq("existancestatus", 3)),
  presenceOpt("other_exit", PRESENCE_STATUS_LABELS[4], (q) => q.eq("existancestatus", 4)),
];

// Milking / دوشا = female (sex=0) AND is_dry=false AND has calved at least once
//   (last_birth_date NOT NULL OR number_of_births > 0).
// Dry / خشک  = female (sex=0) AND is_dry=true.
// Heifer / تلیسه (non-milking female) = female AND is_dry=false AND never calved.
// We use sex (canonical) instead of sextype because sextype is null for many rows.
export const MILKING_OPTIONS: FilterOption[] = [
  {
    id: "milking:wet",
    category: "milking",
    label: "دوشا",
    apply: (q) =>
      q.eq("sex", 0).eq("is_dry", false).or(
        "last_birth_date.not.is.null,number_of_births.gt.0",
      ),
  },
  {
    id: "milking:dry",
    category: "milking",
    label: "خشک",
    apply: (q) => q.eq("sex", 0).eq("is_dry", true),
  },
  {
    id: "milking:heifer",
    category: "milking",
    label: "تلیسه (نزاییده)",
    apply: (q) =>
      q
        .eq("sex", 0)
        .eq("is_dry", false)
        .is("last_birth_date", null)
        .or("number_of_births.is.null,number_of_births.eq.0"),
  },
];

export const SEX_OPTIONS: FilterOption[] = [
  { id: "sex:female", category: "sex", label: "ماده", apply: (q) => q.eq("sex", 0) },
  { id: "sex:male", category: "sex", label: "نر", apply: (q) => q.eq("sex", 1) },
];

// Curated fertility shortcuts (the most-used statuses); the advanced dropdown
// exposes the full list via fertilityOptionFromId().
export const FERTILITY_QUICK_IDS = [8, 3, 12] as const;

export const FERTILITY_OPTIONS: FilterOption[] = Object.entries(FERTILITY_STATUS_LABELS).map(
  ([id, label]) => ({
    id: `fertility:${id}`,
    category: "fertility",
    label,
    apply: (q: any) => q.eq("last_fertility_status", Number(id)),
  }),
);

export const ALL_OPTIONS: FilterOption[] = [
  ...PRESENCE_OPTIONS,
  ...MILKING_OPTIONS,
  ...FERTILITY_OPTIONS,
  ...SEX_OPTIONS,
];

const OPTION_BY_ID = new Map(ALL_OPTIONS.map((o) => [o.id, o]));
export const getOption = (id: string) => OPTION_BY_ID.get(id);

// Quick chips shown above the list (multi-select).
// Friendly labels override the raw status labels where useful.
export const QUICK_CHIPS: FilterOption[] = [
  { ...PRESENCE_OPTIONS[0], label: "موجود در گله" },
  ...MILKING_OPTIONS,
  ...FERTILITY_QUICK_IDS.map(
    (id) => OPTION_BY_ID.get(`fertility:${id}`)!,
  ),
  ...SEX_OPTIONS,
];

// --- query builder ----------------------------------------------------------

/**
 * Apply a set of selected filter ids to a supabase query.
 * Rules:
 *  - Same category → OR (combined into a single .or() clause where possible)
 *  - Different categories → AND (chained)
 *
 * Implementation note: PostgREST .or() applied multiple times to the same
 * query is AND-of-ORs. So per category we build one combined or-string.
 */
export function applyFilters(q: any, selectedIds: Iterable<string>) {
  const byCategory = new Map<FilterCategory, FilterOption[]>();
  for (const id of selectedIds) {
    const opt = OPTION_BY_ID.get(id);
    if (!opt) continue;
    const list = byCategory.get(opt.category) ?? [];
    list.push(opt);
    byCategory.set(opt.category, list);
  }

  for (const [, opts] of byCategory) {
    if (opts.length === 1) {
      q = opts[0].apply(q);
    } else {
      // combine via a single .or() — extract each option's predicate
      const orParts = opts.flatMap(optToOrParts);
      q = q.or(orParts.join(","));
    }
  }
  return q;
}

// Convert a known option into PostgREST or() fragments.
// Keeps the logic centralized so the chip and advanced filter agree.
function optToOrParts(opt: FilterOption): string[] {
  switch (opt.id) {
    case "presence:in_herd":
      return ["existancestatus.is.null", "existancestatus.eq.0"];
    case "presence:sold":
      return ["existancestatus.eq.1"];
    case "presence:died":
      return ["existancestatus.eq.2"];
    case "presence:slaughtered":
      return ["existancestatus.eq.3"];
    case "presence:other_exit":
      return ["existancestatus.eq.4"];
    case "milking:wet":
      // Approximation for OR-combination: matches the dominant condition.
      // For exact semantics, select milking:wet alone (single-category path).
      return ["is_dry.eq.false"];
    case "milking:dry":
      return ["is_dry.eq.true"];
    case "milking:heifer":
      return ["is_dry.eq.false"];
    case "sex:female":
      return ["sex.eq.0"];
    case "sex:male":
      return ["sex.eq.1"];
    default:
      if (opt.id.startsWith("fertility:")) {
        return [`last_fertility_status.eq.${opt.id.split(":")[1]}`];
      }
      return [];
  }
}

// Helpers for the advanced dropdowns -----------------------------------------

export function presenceIdFromStatus(status: string): string | null {
  switch (status) {
    case "0": return "presence:in_herd";
    case "1": return "presence:sold";
    case "2": return "presence:died";
    case "3": return "presence:slaughtered";
    case "4": return "presence:other_exit";
    default: return null;
  }
}

export const fertilityIdFromStatus = (status: string) => `fertility:${status}`;
