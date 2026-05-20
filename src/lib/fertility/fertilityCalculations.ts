// =============================================================================
// fertilityCalculations.ts
// -----------------------------------------------------------------------------
// Low-level, pure date/number helpers used by the fertility derivation engine.
// Everything here is framework-free so it can be unit-tested and reused later
// for herd-wide KPI dashboards or scoring models.
// =============================================================================

import { jalaliToGregorian } from "@/lib/jalali";

// -----------------------------------------------------------------------------
// Reproductive constants — single source of truth so future tuning is one line.
// Values follow NASem-style dairy management defaults.
// -----------------------------------------------------------------------------
export const GESTATION_DAYS = 283;          // Holstein average gestation length
export const DRY_OFF_BEFORE_CALVING = 60;   // Standard dry period before next calving
export const HEAT_CYCLE_MIN = 18;           // Normal estrus cycle lower bound (days)
export const HEAT_CYCLE_MAX = 24;           // Normal estrus cycle upper bound (days)
export const REPEAT_BREEDER_THRESHOLD = 3;  // ≥3 unsuccessful AIs flags repeat breeder
export const PREG_TEST_EARLY = 28;          // <28d after AI = early test
export const PREG_TEST_LATE = 45;           // >45d after AI = late test
export const VOLUNTARY_WAITING_PERIOD = 50; // Days post-calving before first AI
export const ABORTION_EARLY = 90;           // <90d gestation = early abortion
export const ABORTION_LATE = 180;           // >180d gestation = late abortion

// -----------------------------------------------------------------------------
// parseEventDate
// -----------------------------------------------------------------------------
// `livestock_fertility_events.event_date` is a TEXT column historically storing
// either Jalali ("1404/02/22") or Gregorian ("2025-05-12") values. We need a
// single parser so calculations work regardless of which format a row uses.
// Returns a JS Date at LOCAL midnight (time-of-day is intentionally dropped —
// we measure whole-day intervals for reproductive math).
// -----------------------------------------------------------------------------
export function parseEventDate(text: string | null | undefined): Date | null {
  if (!text) return null;
  // Strip any trailing time component the dialogs sometimes append.
  const head = String(text).trim().split(/[\sT]/)[0];

  // Jalali pattern: 4-digit year with `/` separator, year ≤ 1500.
  const j = head.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (j) {
    const y = +j[1];
    // Years > 1700 with slashes are almost certainly Gregorian-with-slashes.
    if (y <= 1500) {
      const g = jalaliToGregorian(y, +j[2], +j[3]);
      return new Date(g.year, g.month - 1, g.day);
    }
    return new Date(y, +j[2] - 1, +j[3]);
  }

  // Gregorian ISO pattern: "YYYY-MM-DD".
  const g = head.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (g) return new Date(+g[1], +g[2] - 1, +g[3]);

  // Last resort — let JS try (handles full ISO datetimes).
  const d = new Date(head);
  return isNaN(d.getTime()) ? null : d;
}

// -----------------------------------------------------------------------------
// daysBetween — whole-day delta (b - a). Negative if b is before a.
// We zero-out the time component on both sides so DST changes never shift
// a result by ±1 day.
// -----------------------------------------------------------------------------
export function daysBetween(a: Date | null, b: Date | null): number | null {
  if (!a || !b) return null;
  const a0 = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
  const b0 = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();
  return Math.round((b0 - a0) / 86_400_000);
}

// -----------------------------------------------------------------------------
// daysSince — convenience for "days from date X to today".
// -----------------------------------------------------------------------------
export function daysSince(d: Date | null): number | null {
  return daysBetween(d, new Date());
}

// -----------------------------------------------------------------------------
// addDays — produce a new Date offset by N days. Used for predicted calving /
// predicted dry-off / predicted return-to-milking calculations.
// -----------------------------------------------------------------------------
export function addDays(d: Date, n: number): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  out.setDate(out.getDate() + n);
  return out;
}

// -----------------------------------------------------------------------------
// formatGregorianAsJalaliText — used when we compute a *predicted* date in JS
// and need to feed it to the existing `formatShamsi` display helper, which
// already knows how to render Gregorian Dates as Persian-digit Shamsi.
// We simply return the JS Date — callers pass it to formatShamsi directly.
// (Helper exposed for parity with future codepaths that want a string.)
// -----------------------------------------------------------------------------
export function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// -----------------------------------------------------------------------------
// classifyPregTestTiming — bucket a pregnancy test against the days elapsed
// since the linked insemination. Used both in the رویداد row badges and the
// summary header.
// -----------------------------------------------------------------------------
export type PregTestTiming = "early" | "standard" | "late" | "unknown";
export function classifyPregTestTiming(daysAfterAI: number | null): PregTestTiming {
  if (daysAfterAI == null) return "unknown";
  if (daysAfterAI < PREG_TEST_EARLY) return "early";
  if (daysAfterAI > PREG_TEST_LATE) return "late";
  return "standard";
}

// -----------------------------------------------------------------------------
// classifyHeatCycle — given the gap between two consecutive heats, decide
// whether the estrus cycle length is biologically normal (18-24 days).
// -----------------------------------------------------------------------------
export type HeatCycleClass = "normal" | "abnormal" | "unknown";
export function classifyHeatCycle(gapDays: number | null): HeatCycleClass {
  if (gapDays == null) return "unknown";
  if (gapDays >= HEAT_CYCLE_MIN && gapDays <= HEAT_CYCLE_MAX) return "normal";
  return "abnormal";
}

// -----------------------------------------------------------------------------
// classifyAbortion — pregnancy-age based bucket for an abortion event.
// -----------------------------------------------------------------------------
export type AbortionClass = "early" | "mid" | "late" | "unknown";
export function classifyAbortion(pregnancyAgeDays: number | null): AbortionClass {
  if (pregnancyAgeDays == null) return "unknown";
  if (pregnancyAgeDays < ABORTION_EARLY) return "early";
  if (pregnancyAgeDays > ABORTION_LATE) return "late";
  return "mid";
}
