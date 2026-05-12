// =============================================================================
// dateDisplay.ts — Universal Shamsi (Jalali) date formatter for the entire app
// -----------------------------------------------------------------------------
// WHY THIS FILE EXISTS:
//   The codebase mixes several date storage formats across tables:
//     1. ISO datetime strings   →  "2025-05-12T08:30:00.000Z"
//     2. ISO date strings       →  "2025-05-12"
//     3. Pre-formatted Shamsi   →  "1404/02/22"
//     4. Pre-formatted Shamsi w/ Persian digits →  "۱۴۰۴/۰۲/۲۲"
//     5. Native JS Date objects
//     6. Numeric epoch ms
//
//   Different pages used to call different helpers (or `toLocaleDateString`,
//   or just dump the raw value). That meant some screens showed Gregorian
//   dates, some showed Latin digits, some showed "—". This module unifies
//   everything behind ONE function so we can guarantee Shamsi everywhere.
// =============================================================================

import {
  gregorianToJalali,
  formatJalali,
  toPersianDigits,
} from "./jalali";

// ---------------------------------------------------------------------------
// Detection helpers
// ---------------------------------------------------------------------------
// A value already in Shamsi looks like 13xx/14xx years (Jalali years are
// always > 1000 and < 1500 in practice). We use a loose regex that also
// accepts Persian digits and either "/" or "-" separators.
// ---------------------------------------------------------------------------
const SHAMSI_LIKE = /^[۰-۹0-9]{4}[\\/\\-][۰-۹0-9]{1,2}[\\/\\-][۰-۹0-9]{1,2}/;

// Convert any Persian/Arabic digit characters back to ASCII so Number()/parseInt
// understand them. Used when normalizing pre-stored Shamsi strings.
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

// Treat a year between 1300 and 1500 as Shamsi; outside that range as Gregorian.
// This guards against rare inputs like "1404-05-12" being interpreted as ISO.
function looksLikeShamsiYear(y: number): boolean {
  return y >= 1300 && y <= 1500;
}

// ---------------------------------------------------------------------------
// formatShamsi — main entry point
// ---------------------------------------------------------------------------
// Accepts any of the supported input shapes and returns a Persian-digit
// Shamsi string ("۱۴۰۴/۰۲/۲۲"). Optional `withTime` appends "HH:MM".
// If the input is null/undefined/invalid, returns the placeholder ("—").
// ---------------------------------------------------------------------------
export function formatShamsi(
  value: string | number | Date | null | undefined,
  withTime: boolean = false,
  fallback: string = "—",
): string {
  // Fast-path for empty values so callers don't need their own null checks.
  if (value === null || value === undefined || value === "") return fallback;

  // ---- Case A: input is already a Shamsi-looking string -------------------
  // We just normalize separators ("-" → "/"), pad to 2 digits, and convert
  // digits to Persian. We do NOT round-trip through Gregorian (would lose
  // precision and risk timezone bugs).
  if (typeof value === "string" && SHAMSI_LIKE.test(value)) {
    const ascii = toAsciiDigits(value).replace(/-/g, "/");
    const m = ascii.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})(.*)$/);
    if (m && looksLikeShamsiYear(Number(m[1]))) {
      const [_, y, mo, d, rest] = m;
      const head = `${y}/${mo.padStart(2, "0")}/${d.padStart(2, "0")}`;
      // If a time component follows (e.g. " 14:30:00") and caller asked for
      // it, keep just HH:MM. Otherwise drop the rest entirely.
      let tail = "";
      if (withTime) {
        const t = rest.match(/(\d{1,2}):(\d{1,2})/);
        if (t) tail = ` ${t[1].padStart(2, "0")}:${t[2].padStart(2, "0")}`;
      }
      return toPersianDigits(head + tail);
    }
  }

  // ---- Case B: parseable as a JS Date (ISO string, epoch, Date) -----------
  // We construct a Date and convert via the project's gregorianToJalali util.
  const d =
    value instanceof Date
      ? value
      : typeof value === "number"
      ? new Date(value)
      : new Date(String(value));
  if (isNaN(d.getTime())) return fallback;

  const j = gregorianToJalali(d.getFullYear(), d.getMonth() + 1, d.getDate());
  let out = formatJalali(j);
  if (withTime) {
    // Pad both pieces so the layout stays aligned in tables.
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    out += ` ${hh}:${mm}`;
  }
  return toPersianDigits(out);
}

// Convenience aliases for legibility at call sites.
export const fmtShamsi = formatShamsi;
export const fmtShamsiDateTime = (v: Parameters<typeof formatShamsi>[0]) =>
  formatShamsi(v, true);
