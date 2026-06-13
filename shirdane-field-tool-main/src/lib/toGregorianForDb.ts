// ============================================================
// toGregorianForDb
// ------------------------------------------------------------
// Purpose: every fertility-operation form in the app lets the
// user pick a date with a Jalali (Shamsi) date picker. The user
// asked that whatever they pick must land in Supabase as a real
// میلادی (Gregorian) date string.
//
// This tiny helper centralises that conversion so all dialogs
// share the exact same output format and we don't accidentally
// store mixed formats in `event_date`.
//
// Output format: "YYYY-MM-DD HH:MM"
//   - matches ISO Gregorian date with a space-separated time
//   - is understood by Postgres' to_date / to_timestamp and by
//     our existing safe_text_to_date() SQL helper
// ============================================================

import { JalaliDate, jalaliToGregorian } from "@/lib/jalali";

// Pads a number to 2 digits, e.g. 5 -> "05".  Pure helper, no
// side effects.  Kept inline because it's only used here.
const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * Convert a Jalali date + "HH:MM" time string into a Gregorian
 * "YYYY-MM-DD HH:MM" string ready to be inserted into Supabase.
 *
 * @param jDate Jalali date object from the date picker
 * @param time  optional "HH:MM" string from a <input type="time">.
 *              When omitted (or empty) we return just the date part.
 */
export function toGregorianForDb(jDate: JalaliDate, time?: string | null): string {
  // 1) Convert Jalali -> Gregorian using the existing project util.
  //    jalaliToGregorian returns { year, month, day } in Gregorian.
  const g = jalaliToGregorian(jDate.year, jDate.month, jDate.day);

  // 2) Build the ISO-style date portion: "YYYY-MM-DD".
  const datePart = `${g.year}-${pad2(g.month)}-${pad2(g.day)}`;

  // 3) Append the time portion only when caller supplied one.
  //    Most fertility dialogs DO include a time; a couple (rinse,
  //    clean-test) might not — be defensive either way.
  const t = (time ?? "").trim();
  return t ? `${datePart} ${t}` : datePart;
}
