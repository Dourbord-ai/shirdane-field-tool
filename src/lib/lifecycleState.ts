// ============================================================================
// lifecycleState.ts
// ----------------------------------------------------------------------------
// Calculates the "lifecycle state" (وضعیت چرخه دام) of a cow purely from
// existing fields on public.cows. This is a DISPLAY/derived classification —
// it is never written back to the DB. Callers can call this from lists,
// profiles, and the list-builder so the label is consistent everywhere.
// ============================================================================

// Fields the helper relies on. Anything missing is treated as null.
// We accept a permissive shape so callers can pass a partial cow row.
export type LifecycleCowInput = {
  sex?: number | null;            // 0 = female, 1 = male
  existancestatus?: number | null;// 0/null = in herd, >0 = outside herd
  presence_status?: number | null;// legacy alias (unused but accepted)
  date_of_birth?: string | null;  // ISO or Shamsi-like date string
  is_pregnancy?: boolean | null;
  is_dry?: boolean | null;
  last_birth_date?: string | null;
  last_inoculation_date?: string | null;
  number_of_births?: number | null;
  last_fertility_status?: number | null;
  last_type_id?: number | null;
  last_status_id?: number | null;
};

// Canonical list of lifecycle states. The keys are stable identifiers used
// for filters; the labels are the Persian display strings.
export type LifecycleState =
  | "male_calf_milk"
  | "male_calf_weaned"
  | "male_rearing"
  | "male_fattening"
  | "male_breeding"
  | "male_outside"
  | "female_calf_milk"
  | "female_calf_weaned"
  | "female_rearing"
  | "heifer_immature"
  | "heifer_ready"
  | "heifer_inseminated"
  | "heifer_pregnant"
  | "cow_fresh"
  | "cow_milking"
  | "cow_pregnant_milking"
  | "cow_dry"
  | "cow_close_up"
  | "cow_open"
  | "cow_cull"
  | "female_outside"
  | "unknown";

// Persian labels (single source of truth used by lists, filters, badges).
export const LIFECYCLE_LABELS: Record<LifecycleState, string> = {
  male_calf_milk: "گوساله نر شیری",
  male_calf_weaned: "گوساله نر از شیر گرفته",
  male_rearing: "نر پرورشی",
  male_fattening: "نر پرواری",
  male_breeding: "گاو نر مولد",
  male_outside: "دام نر خارج از گله",
  female_calf_milk: "گوساله ماده شیری",
  female_calf_weaned: "گوساله ماده از شیر گرفته",
  female_rearing: "ماده پرورشی",
  heifer_immature: "تلیسه نابالغ",
  heifer_ready: "تلیسه آماده تلقیح",
  heifer_inseminated: "تلیسه تلقیح شده",
  heifer_pregnant: "تلیسه آبستن",
  cow_fresh: "گاو تازه‌زا",
  cow_milking: "گاو دوشا",
  cow_pregnant_milking: "گاو آبستن دوشا",
  cow_dry: "گاو خشک",
  cow_close_up: "گاو خشک نزدیک‌زا",
  cow_open: "گاو باز / غیرآبستن",
  cow_cull: "گاو حذفی",
  female_outside: "دام ماده خارج از گله",
  unknown: "نامشخص",
};

// Color groups for the badge — semantic-token-friendly Tailwind class strings.
// We deliberately use inline color tokens that already exist across the app so
// new design tokens don't have to be introduced for this feature.
export type LifecycleGroup =
  | "calf" | "heifer" | "milking" | "pregnant" | "dry" | "close_up"
  | "outside" | "male_fattening" | "male_breeding" | "cull" | "unknown";

export const LIFECYCLE_GROUP: Record<LifecycleState, LifecycleGroup> = {
  male_calf_milk: "calf",
  male_calf_weaned: "calf",
  male_rearing: "male_fattening",
  male_fattening: "male_fattening",
  male_breeding: "male_breeding",
  male_outside: "outside",
  female_calf_milk: "calf",
  female_calf_weaned: "calf",
  female_rearing: "heifer",
  heifer_immature: "heifer",
  heifer_ready: "heifer",
  heifer_inseminated: "heifer",
  heifer_pregnant: "pregnant",
  cow_fresh: "milking",
  cow_milking: "milking",
  cow_pregnant_milking: "pregnant",
  cow_dry: "dry",
  cow_close_up: "close_up",
  cow_open: "milking",
  cow_cull: "cull",
  female_outside: "outside",
  unknown: "unknown",
};

// Tailwind class strings per group. Using sky/violet/green/teal/amber/orange/
// gray/stone palettes so the visual differentiation is obvious without needing
// new design tokens. All colors are subtle (bg/10, text-shade, border/30).
export const LIFECYCLE_BADGE_CLASS: Record<LifecycleGroup, string> = {
  calf:           "bg-sky-500/15 text-sky-300 border-sky-500/30",
  heifer:         "bg-violet-500/15 text-violet-300 border-violet-500/30",
  milking:        "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  pregnant:       "bg-teal-500/15 text-teal-300 border-teal-500/30",
  dry:            "bg-amber-500/15 text-amber-300 border-amber-500/30",
  close_up:       "bg-orange-500/15 text-orange-300 border-orange-500/30",
  outside:        "bg-muted text-muted-foreground border-border",
  male_fattening: "bg-stone-500/15 text-stone-300 border-stone-500/30",
  male_breeding:  "bg-indigo-500/15 text-indigo-300 border-indigo-500/30",
  cull:           "bg-destructive/15 text-destructive border-destructive/30",
  unknown:        "bg-muted text-muted-foreground border-border",
};

// ----------------------------------------------------------------------------
// Date helpers
// ----------------------------------------------------------------------------
// The DB stores dates in a few shapes (ISO YYYY-MM-DD, Date, epoch ms, and
// sometimes Shamsi). For lifecycle classification we only need a Gregorian
// Date — so we accept ISO-ish input and ignore unparseable values.
function parseDateLoose(v: string | number | Date | null | undefined): Date | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if (typeof v === "number") {
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }
  // String: try native Date.parse first (handles ISO).
  const d = new Date(v);
  if (!isNaN(d.getTime())) return d;
  return null;
}

function ageInMonths(dob: string | null | undefined, now: Date = new Date()): number | null {
  const d = parseDateLoose(dob);
  if (!d) return null;
  const months = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
  // Adjust if today is before the day-of-month of birth.
  return now.getDate() < d.getDate() ? Math.max(0, months - 1) : Math.max(0, months);
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((a.getTime() - b.getTime()) / 86_400_000);
}

// ----------------------------------------------------------------------------
// Main calculation
// ----------------------------------------------------------------------------
export type LifecycleResult = {
  state: LifecycleState;
  label: string;
  group: LifecycleGroup;
  badgeClass: string;
  // Human-readable explanation used in tooltips.
  reason: string;
  debug: {
    sex: number | null;
    presence_status: number | null;
    age_months: number | null;
    is_pregnancy: boolean | null;
    is_dry: boolean | null;
    last_birth_date: string | null;
    last_inoculation_date: string | null;
    number_of_births: number | null;
    days_since_calving: number | null;
    days_to_expected_calving: number | null;
  };
};

export function calculateLifecycleState(cow: LifecycleCowInput | null | undefined): LifecycleResult {
  // Normalize all the inputs once so the branching below stays readable.
  const sex = cow?.sex ?? null;
  // presence: existancestatus is the canonical column; presence_status is legacy.
  const presence = cow?.existancestatus ?? cow?.presence_status ?? 0;
  const inHerd = presence == null || presence === 0;
  const age = ageInMonths(cow?.date_of_birth);
  const isPreg = cow?.is_pregnancy ?? null;
  const isDry = cow?.is_dry ?? null;
  const lastBirth = parseDateLoose(cow?.last_birth_date);
  const lastInoc = parseDateLoose(cow?.last_inoculation_date);
  const births = cow?.number_of_births ?? null;
  const now = new Date();

  const daysSinceCalving = lastBirth ? daysBetween(now, lastBirth) : null;
  // Expected calving = last insemination + 280 days (standard gestation).
  const expectedCalving = lastInoc ? new Date(lastInoc.getTime() + 280 * 86_400_000) : null;
  const daysToExpected = expectedCalving ? daysBetween(expectedCalving, now) : null;

  const debug = {
    sex,
    presence_status: presence,
    age_months: age,
    is_pregnancy: isPreg,
    is_dry: isDry,
    last_birth_date: cow?.last_birth_date ?? null,
    last_inoculation_date: cow?.last_inoculation_date ?? null,
    number_of_births: births,
    days_since_calving: daysSinceCalving,
    days_to_expected_calving: daysToExpected,
  };

  // Helper to wrap a state into the full result (with class + reason).
  const make = (state: LifecycleState, reason: string): LifecycleResult => ({
    state,
    label: LIFECYCLE_LABELS[state],
    group: LIFECYCLE_GROUP[state],
    badgeClass: LIFECYCLE_BADGE_CLASS[LIFECYCLE_GROUP[state]],
    reason,
    debug,
  });

  // ─── Outside-herd short-circuits ───────────────────────────────────────────
  if (!inHerd) {
    if (sex === 1) return make("male_outside", `خارج از گله (presence=${presence})`);
    return make("female_outside", `خارج از گله (presence=${presence})`);
  }

  // ─── Male branch ───────────────────────────────────────────────────────────
  if (sex === 1) {
    if (age != null && age <= 3) return make("male_calf_milk", `سن ${age} ماه`);
    if (age != null && age <= 6) return make("male_calf_weaned", `سن ${age} ماه`);
    if (age != null && age <= 15) return make("male_rearing", `سن ${age} ماه`);
    // No explicit breeding-bull flag in cows; treat known "مولد" type/status as such.
    // last_type_id / last_status_id semantics vary per farm — leave as fattening
    // by default. Callers can extend this rule later.
    return make("male_fattening", age != null ? `سن ${age} ماه` : "بزرگسال نر");
  }

  // ─── Female branch ─────────────────────────────────────────────────────────
  // (sex === 0, sex === null both fall here — we assume female when unknown
  //  since the female state set is richer and ambiguous animals are usually
  //  treated as females in this dairy CRM.)

  if (age != null && age <= 3) return make("female_calf_milk", `سن ${age} ماه`);
  if (age != null && age <= 6) return make("female_calf_weaned", `سن ${age} ماه`);
  if (age != null && age < 12) return make("female_rearing", `سن ${age} ماه`);

  // Determine whether this female has ever calved.
  const hasCalved = (births != null && births > 0) || !!lastBirth;

  if (!hasCalved) {
    // Heifer track — no calving yet.
    if (isPreg === true) return make("heifer_pregnant", "آبستن، بدون سابقهٔ زایش");
    if (lastInoc && !lastBirth) return make("heifer_inseminated", "تلقیح شده، بدون سابقهٔ زایش");
    if (age != null && age >= 15) return make("heifer_ready", `سن ${age} ماه، آماده تلقیح`);
    return make("heifer_immature", age != null ? `سن ${age} ماه` : "تلیسه نابالغ");
  }

  // Cow track — has calved at least once.
  // Fresh-cow rule takes priority: calved within last 21 days.
  if (daysSinceCalving != null && daysSinceCalving >= 0 && daysSinceCalving <= 21) {
    return make("cow_fresh", `${daysSinceCalving} روز از زایش گذشته`);
  }

  if (isDry === true) {
    // Close-up if expected calving is within 21 days.
    if (daysToExpected != null && daysToExpected >= 0 && daysToExpected <= 21) {
      return make("cow_close_up", `${daysToExpected} روز تا زایش پیش‌بینی شده`);
    }
    return make("cow_dry", "خشک");
  }

  // Not dry from here on.
  if (isPreg === true) return make("cow_pregnant_milking", "آبستن و دوشا");
  if (isPreg === false) {
    // Distinguish "open / غیرآبستن" from generic milking using the explicit
    // is_pregnancy=false signal.
    if (isDry === false) return make("cow_open", "غیرآبستن (باز)");
  }
  if (isDry === false) return make("cow_milking", "دوشا");
  return make("cow_open", "گاو بالغ — وضعیت دقیق نامشخص");
}

// Convenience: list of all states for filter UIs (in display order).
export const ALL_LIFECYCLE_STATES: LifecycleState[] = [
  "male_calf_milk", "female_calf_milk",
  "male_calf_weaned", "female_calf_weaned",
  "male_rearing", "female_rearing",
  "heifer_immature", "heifer_ready", "heifer_inseminated", "heifer_pregnant",
  "cow_fresh", "cow_milking", "cow_pregnant_milking",
  "cow_dry", "cow_close_up", "cow_open",
  "male_fattening", "male_breeding",
  "cow_cull",
  "male_outside", "female_outside",
];
