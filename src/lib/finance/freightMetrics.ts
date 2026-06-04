// ---------------------------------------------------------------------------
// Task 5 — Freight cost reference metrics (client-side only).
//
// Why a dedicated module:
//   - We need to derive the same three reference numbers (cost/km, cost/kg,
//     cost/ton) in three different display sites (the row editor, the row
//     summary in the invoice detail view, and the pre-save review dialog).
//     Centralizing the math + the fallback string guarantees those three
//     places never drift from each other.
//   - Pure functions, no React, no supabase, no I/O — trivially unit-testable
//     and safe to call inside render without effects.
//   - Stored fields used as input only. We deliberately DO NOT persist these
//     metrics; recomputing is cheap, and storing would force a migration +
//     backfill every time the formula evolves.
//
// Scope guard: this module is informational only. It does not validate,
// block saves, or change settlement / voucher / bank logic.
// ---------------------------------------------------------------------------

/** Persian fallback string shown wherever a metric cannot be computed. */
export const INSUFFICIENT_FREIGHT_DATA = "اطلاعات کافی نیست";

/**
 * Inputs we accept. Each field is permissive (number | string | null |
 * undefined) because the row editor stores numeric state as `number | ""`
 * for empty inputs, while the DB row exposes `number | null`. Normalizing
 * here means callers don't have to pre-coerce.
 */
export interface FreightMetricInput {
  amount: number | string | null | undefined;             // total invoice/cost amount in Rial
  route_distance_km: number | string | null | undefined;  // manual distance entry
  cargo_weight: number | string | null | undefined;       // in kilograms
}

/**
 * Output shape. Each metric is `null` whenever its inputs are missing,
 * non-numeric, or non-positive. Callers branch on `null` to decide whether
 * to render the value or the INSUFFICIENT_FREIGHT_DATA fallback.
 *
 * `hasDistance` / `hasWeight` are surfaced so a caller can decide, for
 * example, to suppress the entire compact summary line when no metric can
 * be shown (the compact summary in `RelatedCostsSection` does this).
 */
export interface FreightMetrics {
  cost_per_km: number | null;
  cost_per_kg: number | null;
  cost_per_ton: number | null;
  hasDistance: boolean;
  hasWeight: boolean;
}

/**
 * Coerce a possibly-empty value to a positive finite number, or `null`.
 * We treat 0, negative, NaN, "" and null all as "missing" so the formulas
 * never divide by zero or produce Infinity.
 */
function toPositiveNumber(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/**
 * Core calculator. See module header for formula source-of-truth.
 *
 *   cost_per_km  = amount / distance_km
 *   cost_per_kg  = amount / cargo_weight_kg
 *   cost_per_ton = amount / (cargo_weight_kg / 1000)
 *
 * Note: cost_per_ton is intentionally derived from kg (not stored as its
 * own field) so the relationship cost_per_ton = cost_per_kg * 1000 always
 * holds — no rounding drift between the two displayed numbers.
 */
export function computeFreightMetrics(input: FreightMetricInput): FreightMetrics {
  const amount = toPositiveNumber(input.amount);
  const distance = toPositiveNumber(input.route_distance_km);
  const weightKg = toPositiveNumber(input.cargo_weight);

  // Distance / weight presence is reported independently of `amount` so the
  // UI can still indicate "missing distance" even if the amount is zero.
  const hasDistance = distance !== null;
  const hasWeight = weightKg !== null;

  // All three metrics require a usable amount AND the relevant denominator.
  const cost_per_km = amount !== null && distance !== null ? amount / distance : null;
  const cost_per_kg = amount !== null && weightKg !== null ? amount / weightKg : null;
  // For ton: weight in tons = kg / 1000. Equivalent to amount * 1000 / kg.
  const cost_per_ton = amount !== null && weightKg !== null ? (amount / (weightKg / 1000)) : null;

  return { cost_per_km, cost_per_kg, cost_per_ton, hasDistance, hasWeight };
}

// ---------------------------------------------------------------------------
// Formatters
//
// We keep formatting next to the math so every consumer renders numbers in
// the same Persian style. Rial is the canonical unit project-wide; the per-
// unit suffix is the caller's responsibility via `formatPerUnit`.
// ---------------------------------------------------------------------------

/** ASCII → Persian digits, used by all formatters below. */
function toPersianDigits(s: string): string {
  const fa = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"];
  return s.replace(/\d/g, (d) => fa[Number(d)]);
}

/**
 * Round to integer Rial and format with thousands separators in Persian
 * digits. We round (not floor) to avoid systematically under-reporting the
 * cost when distance/weight have decimals.
 */
export function formatRial(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) {
    return INSUFFICIENT_FREIGHT_DATA;
  }
  const rounded = Math.round(Number(n));
  return toPersianDigits(rounded.toLocaleString("en-US")) + " ریال";
}

/**
 * Format a metric as "<number> ریال/<unit>". When `value` is null we return
 * the standardized fallback string so callers don't have to branch.
 *
 * Examples:
 *   formatPerUnit(125000, "کیلومتر") -> "۱۲۵٬۰۰۰ ریال/کیلومتر"
 *   formatPerUnit(null,   "تن")      -> "اطلاعات کافی نیست"
 */
export function formatPerUnit(value: number | null, unit: string): string {
  if (value === null) return INSUFFICIENT_FREIGHT_DATA;
  return `${formatRial(value)}/${unit}`;
}
