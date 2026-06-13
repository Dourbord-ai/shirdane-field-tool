// =============================================================================
// dateUtils.ts — Single source of truth for Jalali ⇄ Gregorian conversions.
// -----------------------------------------------------------------------------
// WHY THIS FILE EXISTS:
//   The product rule is simple but strict:
//     • Users ALWAYS see / select / filter Jalali (Shamsi) dates.
//     • The database ALWAYS stores Gregorian ISO dates / timestamptz.
//
//   Across the codebase, conversions used to be done ad-hoc with `new Date()`,
//   `toISOString().slice(0,10)`, or scattered helpers. That allowed subtle
//   timezone bugs (e.g. midnight Tehran becoming the previous day in UTC) and
//   meant every form had its own opinion about the format. This module
//   centralises every conversion so that:
//
//     1. Every Jalali "YYYY/MM/DD" string entered by the user is converted to
//        the **same Gregorian ISO calendar day** (no TZ drift). We do this by
//        building the ISO string from integers, never via `Date`.
//
//     2. Every Gregorian value coming from the DB is converted back to Jalali
//        for display using the project's existing `gregorianToJalali` util.
//
//     3. Range filters always expand to inclusive [startOfDay, endOfDay] so
//        Supabase `gte/lte` queries cover the full selected Jalali day.
//
//   Display-side formatting still lives in `dateDisplay.ts` (which already
//   handles mixed legacy storage formats). This module is for INPUT/OUTPUT
//   conversions at the form ⇄ DB boundary.
// =============================================================================

import {
  gregorianToJalali,
  jalaliToGregorian,
  formatJalali,
  toPersianDigits,
  type JalaliDate,
} from "./jalali";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
// We use plain strings at the boundary so values are JSON-safe and Supabase-
// safe without needing a Date object (which carries timezone baggage).
export type GregorianISODate = string;       // "YYYY-MM-DD"
export type GregorianISODateTime = string;   // "YYYY-MM-DDTHH:mm:ss.sssZ"
export type JalaliString = string;           // "YYYY/MM/DD" (Jalali year)

// ---------------------------------------------------------------------------
// pad2 — small helper so we never accidentally emit "2025-3-9" which breaks
// Postgres `date` parsing on some drivers.
// ---------------------------------------------------------------------------
const pad2 = (n: number) => String(n).padStart(2, "0");

// ---------------------------------------------------------------------------
// jalaliToGregorianDate
// ---------------------------------------------------------------------------
// Takes a Jalali "YYYY/MM/DD" string (ASCII or Persian digits accepted) and
// returns a Gregorian ISO date "YYYY-MM-DD" ready to write into a Supabase
// `date` column. Returns null for empty/invalid input so callers can treat
// "no date" uniformly.
//
// We intentionally build the result from integers (NOT via `new Date(...)`)
// because constructing a Date and calling toISOString() can shift the day
// backwards/forwards depending on the browser timezone.
// ---------------------------------------------------------------------------
export function jalaliToGregorianDate(jalali: JalaliString | null | undefined): GregorianISODate | null {
  if (!jalali) return null;
  // Normalise Persian/Arabic digits to ASCII before regex matching.
  const ascii = toAsciiDigits(jalali);
  const m = ascii.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (!m) return null;
  const jy = Number(m[1]);
  const jm = Number(m[2]);
  const jd = Number(m[3]);
  // Guard against obviously wrong years (we only support Jalali 1300–1500).
  if (jy < 1300 || jy > 1500 || jm < 1 || jm > 12 || jd < 1 || jd > 31) return null;
  const g = jalaliToGregorian(jy, jm, jd);
  return `${g.year}-${pad2(g.month)}-${pad2(g.day)}`;
}

// ---------------------------------------------------------------------------
// jalaliToGregorianTimestamp
// ---------------------------------------------------------------------------
// Variant that also accepts an "HH:mm" string and produces an ISO timestamp
// anchored at Tehran local time (UTC+03:30 — Iran no longer observes DST as
// of 2022). We hardcode the offset so the stored timestamp ALWAYS represents
// the wall-clock moment the user picked, regardless of where their browser is.
// ---------------------------------------------------------------------------
export function jalaliToGregorianTimestamp(
  jalaliDate: JalaliString | null | undefined,
  time: string = "00:00",
): GregorianISODateTime | null {
  const isoDate = jalaliToGregorianDate(jalaliDate);
  if (!isoDate) return null;
  // Sanitize time: accept "HH:mm" or "HH:mm:ss"; default to midnight.
  const tMatch = toAsciiDigits(time || "").match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/);
  const hh = tMatch ? pad2(Math.min(23, Number(tMatch[1]))) : "00";
  const mm = tMatch ? pad2(Math.min(59, Number(tMatch[2]))) : "00";
  const ss = tMatch && tMatch[3] ? pad2(Math.min(59, Number(tMatch[3]))) : "00";
  // Fixed Iran offset (+03:30). Postgres `timestamptz` will normalise this
  // to UTC internally, but the original wall-clock moment is preserved.
  return `${isoDate}T${hh}:${mm}:${ss}+03:30`;
}

// ---------------------------------------------------------------------------
// gregorianDateToJalali
// ---------------------------------------------------------------------------
// Takes a Gregorian ISO date ("YYYY-MM-DD" or full ISO timestamp) and returns
// a plain Jalali "YYYY/MM/DD" string (ASCII digits — call `toPersianDigits`
// if you want Persian glyphs). Returns null on invalid input.
//
// We parse the ISO date by string-splitting instead of `new Date()` so that a
// user in (say) Los Angeles still sees the same calendar day that Postgres
// stored. For full timestamps we DO use Date because the user expects local
// time for the clock portion.
// ---------------------------------------------------------------------------
export function gregorianDateToJalali(iso: string | null | undefined): JalaliString | null {
  if (!iso) return null;
  // Date-only fast path: split YYYY-MM-DD without timezone math.
  const dateOnly = iso.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (dateOnly) {
    const j = gregorianToJalali(Number(dateOnly[1]), Number(dateOnly[2]), Number(dateOnly[3]));
    return formatJalali(j);
  }
  // Otherwise treat as a timestamp; allow Date to handle TZ → local wall clock.
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const j = gregorianToJalali(d.getFullYear(), d.getMonth() + 1, d.getDate());
  return formatJalali(j);
}

// ---------------------------------------------------------------------------
// formatGregorianToJalali — display-friendly wrapper that returns Persian
// digits, optionally with HH:mm appended. Use in tables and read-only views.
// ---------------------------------------------------------------------------
export function formatGregorianToJalali(
  iso: string | null | undefined,
  withTime = false,
  fallback = "—",
): string {
  if (!iso) return fallback;
  // Date-only input: never append time even if requested (no info available).
  const dateOnly = typeof iso === "string" && /^\d{4}-\d{1,2}-\d{1,2}$/.test(iso);
  const jalali = gregorianDateToJalali(iso);
  if (!jalali) return fallback;
  if (!withTime || dateOnly) return toPersianDigits(jalali);
  const d = new Date(iso);
  const hh = pad2(d.getHours());
  const mm = pad2(d.getMinutes());
  return toPersianDigits(`${jalali} - ${hh}:${mm}`);
}

// Convenience alias matching the name from the spec.
export const formatGregorianTimestampToJalaliDateTime = (iso: string | null | undefined) =>
  formatGregorianToJalali(iso, true);

// ---------------------------------------------------------------------------
// jalaliRangeToGregorianRange
// ---------------------------------------------------------------------------
// Converts a Jalali date range (inclusive) into a Gregorian ISO timestamp
// range suitable for Supabase `.gte/.lte` filters. The end-of-day boundary
// is set to 23:59:59.999 +03:30 so the query covers the FULL last day.
// ---------------------------------------------------------------------------
export function jalaliRangeToGregorianRange(
  fromJalali: JalaliString | null | undefined,
  toJalali: JalaliString | null | undefined,
): { from: GregorianISODateTime | null; to: GregorianISODateTime | null } {
  const from = jalaliToGregorianTimestamp(fromJalali, "00:00:00");
  // For the upper bound we want INCLUSIVE end of day — Postgres-friendly.
  const toDate = jalaliToGregorianDate(toJalali);
  const to = toDate ? `${toDate}T23:59:59.999+03:30` : null;
  return { from, to };
}

// ---------------------------------------------------------------------------
// todayGregorianISO — default value for "create" forms so we don't have to
// repeat the conversion dance in every component.
// ---------------------------------------------------------------------------
export function todayGregorianISO(): GregorianISODate {
  const now = new Date();
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

// ---------------------------------------------------------------------------
// Internal: digit normaliser. Duplicated (intentionally) from dateDisplay.ts
// so dateUtils.ts has zero downstream deps beyond `jalali.ts`.
// ---------------------------------------------------------------------------
function toAsciiDigits(s: string): string {
  const fa = "۰۱۲۳۴۵۶۷۸۹";
  const ar = "٠١٢٣٤٥٦٧٨٩";
  let out = s;
  for (let i = 0; i < 10; i++) {
    out = out.replace(new RegExp(fa[i], "g"), String(i));
    out = out.replace(new RegExp(ar[i], "g"), String(i));
  }
  return out;
}

// Re-export the JalaliDate type so consumers don't need two imports.
export type { JalaliDate };
