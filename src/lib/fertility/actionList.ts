// =============================================================================
// actionList.ts
// -----------------------------------------------------------------------------
// Core engine for the «گاوهای نیازمند اقدام تولیدمثلی» (Reproductive Action
// List) report. Takes raw cow rows, fertility events, sync records, and
// the configurable thresholds and returns:
//
//   - One classified row per cow (section + every column the table renders).
//   - Top-line KPI counts for the cards above the table.
//
// The engine is intentionally pure (no React, no Supabase) so it can be unit
// tested and reused by future surfaces (Mobile widgets, scheduled exports).
//
// IMPORTANT — mutual exclusivity:
//   Each cow lands in exactly ONE section, chosen by the approved priority
//   order:
//     1) Chronic Breeders
//     2) Repeat Breeders
//     3) High Risk Open
//     4) Pregnancy Check Due
//     5) Recheck Due
//     6) Veterinary Visit Required
//     7) Synchronization Due
//     8) Close To Calving
//     9) Ready For Breeding
//   "None" means the cow is not actionable today (e.g. pregnant + mid-gestation
//   + already tested) and is excluded from the worklist.
//
// IMPORTANT — insemination source of truth (per audit):
//   A row in livestock_fertility_events is an insemination iff
//     fertility_operation_id = 2
//     OR legacy_table_name = 'CowInoculations'
//     OR (fertility_operation_id IS NULL AND metadata.sperm_id is present).
//   `cows.father_sperm_id` is a CACHE, never the source.
// =============================================================================

import type { FertilityEvent } from "@/lib/fertility";
import { parseEventDate, daysBetween, daysSince } from "@/lib/fertility/fertilityCalculations";
import type { FertilityThresholds } from "@/hooks/useFertilityThresholds";

// -----------------------------------------------------------------------------
// Section keys — the nine mutually-exclusive buckets a cow can land in. The
// `"none"` value means "no action required today; do not show on the list".
// -----------------------------------------------------------------------------
export type ActionSection =
  | "chronic_breeder"
  | "repeat_breeder"
  | "high_risk_open"
  | "pregnancy_check_due"
  | "recheck_due"
  | "vet_visit_required"
  | "sync_due"
  | "close_to_calving"
  | "ready_for_breeding"
  | "none";

// User-facing Persian labels for each section.
export const SECTION_LABELS: Record<Exclude<ActionSection, "none">, string> = {
  chronic_breeder: "Chronic Breeders (پرتکرار شدید)",
  repeat_breeder: "Repeat Breeders (پرتکرار)",
  high_risk_open: "دام‌های پرریسک تولیدمثلی",
  pregnancy_check_due: "نیازمند تست آبستنی",
  recheck_due: "نیازمند تست مجدد",
  vet_visit_required: "نیازمند ویزیت دامپزشک",
  sync_due: "نیازمند همزمان‌سازی",
  close_to_calving: "نزدیک زایش",
  ready_for_breeding: "آماده تلقیح",
};

// Priority order — earlier wins. Used both for classification and for the
// rendered section ordering.
export const SECTION_PRIORITY: Exclude<ActionSection, "none">[] = [
  "chronic_breeder",
  "repeat_breeder",
  "high_risk_open",
  "pregnancy_check_due",
  "recheck_due",
  "vet_visit_required",
  "sync_due",
  "close_to_calving",
  "ready_for_breeding",
];

// -----------------------------------------------------------------------------
// Input shapes — minimal projections of the DB rows we need. Keeping these
// narrow makes the engine easier to test with fixture data.
// -----------------------------------------------------------------------------
export interface CowRow {
  id: number;
  bodynumber: number | null;
  earnumber: number | null;
  tag_number: string | null;
  sex: number | null;
  sextype: string | null;
  existancestatus: number | null;
  presence_status: number | null;
  is_dry: boolean | null;
  is_pregnancy: boolean | null;
  number_of_births: number | null;
  date_of_birth: string | null;
  last_birth_date: string | null;
  last_pregnancy_date: string | null;
  last_abortion_date: string | null;
  last_fertility_status: number | null;
  last_location_id: number | null;
  last_sync_date: string | null;
}

export interface CowSyncRow {
  id: number;
  cow_id: number;
  sync_type_id: number | null;
  event_date: string | null;
  status: string | null;
  is_deleted: boolean | null;
}

// -----------------------------------------------------------------------------
// Output shape — one row per cow rendered in the report table.
// -----------------------------------------------------------------------------
export interface ActionListRow {
  cow: CowRow;
  section: ActionSection;
  // Display fields ----------------------------------------------------------
  cowLabel: string;             // "بدنه 1234 / گوش 5678"
  parity: number | null;
  dim: number | null;           // null when dry / never calved
  openDays: number | null;      // days since last calving for open cows
  currentCycleNumber: number;   // 1-based cycle counter
  pregnancyStatus: "pregnant" | "open" | "dry" | "unknown";
  lastHeatDate: Date | null;
  lastServiceDate: Date | null;
  daysSinceLastHeat: number | null;
  daysSinceLastService: number | null;
  servicesInCycle: number;
  heatsInCycle: number;
  pregnancyTestCount: number;
  uterineFlushCount: number;
  reproductiveVisitCount: number;
  lastSyncProtocolId: number | null;
  assignedVet: string | null;
  assignedTechnician: string | null;
  groupLabel: string | null;    // proxy via last_location_id → livestock_locations.name
  reproductiveCostToDate: number | null; // Always null until cost ledger lands
}

// -----------------------------------------------------------------------------
// Insemination source-of-truth — sourced from the centralized statusMapping
// module so every report agrees on the rule. We import and re-export the
// same symbol to preserve existing callers' `import { isInsemination } from
// "@/lib/fertility/actionList"` paths.
// -----------------------------------------------------------------------------
import { isInsemination } from "@/lib/fertility/statusMapping";
export { isInsemination };

// Heat = op 1 OR legacy CowErotics OR event_type === "heat".
function isHeat(e: FertilityEvent): boolean {
  if (e.is_cancelled) return false;
  return (
    e.fertility_operation_id === 1 ||
    e.legacy_table_name === "CowErotics" ||
    e.event_type === "heat"
  );
}

// Pregnancy test = ops 3,4,11,12 OR legacy CowPregnancies OR event_type.
function isPregnancyTest(e: FertilityEvent): boolean {
  if (e.is_cancelled) return false;
  if ([3, 4, 11, 12].includes(e.fertility_operation_id ?? -1)) return true;
  if (e.legacy_table_name === "CowPregnancies") return true;
  if (e.event_type === "pregnancy_test") return true;
  return false;
}

// Calving = op 6 / event_type "calving" / legacy CowBirths.
function isCalving(e: FertilityEvent): boolean {
  if (e.is_cancelled) return false;
  return (
    e.fertility_operation_id === 6 ||
    e.legacy_table_name === "CowBirths" ||
    e.event_type === "calving"
  );
}

// Abortion = op 5 / event_type "abortion" / legacy CowAbortions.
function isAbortion(e: FertilityEvent): boolean {
  if (e.is_cancelled) return false;
  return (
    e.fertility_operation_id === 5 ||
    e.legacy_table_name === "CowAbortions" ||
    e.event_type === "abortion"
  );
}

// -----------------------------------------------------------------------------
// buildCowLabel — readable identifier ("بدنه 1234 / گوش 5678 (TAG)").
// -----------------------------------------------------------------------------
function buildCowLabel(c: CowRow): string {
  const parts: string[] = [];
  if (c.bodynumber != null) parts.push(`بدنه ${c.bodynumber}`);
  if (c.earnumber != null) parts.push(`گوش ${c.earnumber}`);
  let s = parts.join(" / ");
  if (c.tag_number) s += ` (${c.tag_number})`;
  return s || `#${c.id}`;
}

// -----------------------------------------------------------------------------
// pickName — pull a doctor/vet name string out of an event's metadata. The
// dialogs historically wrote any of these keys.
// -----------------------------------------------------------------------------
function pickDoctorName(e: FertilityEvent): string | null {
  const m = (e.metadata ?? {}) as Record<string, unknown>;
  return (
    (m.Vet as string) || (m.vet_name as string) || (m.doctor_name as string) || null
  );
}

// =============================================================================
// classifyCow — given a cow plus its sorted timeline + thresholds + sync info,
// returns the section it belongs to plus all computed display fields.
// =============================================================================
export interface ClassifyContext {
  cow: CowRow;
  events: FertilityEvent[];          // Already filtered to this cow, any order
  syncRecord: CowSyncRow | null;     // Latest active sync for this cow (or null)
  thresholds: FertilityThresholds;
  groupLabel: string | null;
  resolveUserName?: (v: number | string | null | undefined) => string | null;
}

export function classifyCow(ctx: ClassifyContext): ActionListRow {
  const { cow, events, syncRecord, thresholds, groupLabel } = ctx;
  const today = new Date();

  // -- Sort events ascending so cycle walking is straightforward --------------
  const active = events
    .filter((e) => !e.is_cancelled)
    .map((e) => ({ e, d: parseEventDate(e.event_date) }))
    .sort((a, b) => (a.d?.getTime() ?? 0) - (b.d?.getTime() ?? 0));

  // -- Walk forward to find cycle boundaries (calving / abortion) -------------
  // The "current cycle" is everything AFTER the most recent calving OR
  // abortion. cycleCount counts how many distinct cycles the cow has had
  // (1-based: a cow with no calvings is on cycle 1).
  let cycleCount = 1;
  let cycleStart: Date | null = null;
  for (const { e, d } of active) {
    if (isCalving(e) || isAbortion(e)) {
      cycleCount += 1;
      cycleStart = d;
    }
  }

  // Restrict event subset to "current cycle" (strictly after cycleStart).
  const currentCycle = cycleStart
    ? active.filter((x) => (x.d?.getTime() ?? 0) > cycleStart!.getTime())
    : active;

  // -- Per-cycle counts -------------------------------------------------------
  const cycleAIs = currentCycle.filter((x) => isInsemination(x.e));
  const cycleHeats = currentCycle.filter((x) => isHeat(x.e));
  const cyclePregTests = currentCycle.filter((x) => isPregnancyTest(x.e));

  // -- Lifetime / per-cow counts (used in some columns) -----------------------
  const allPregTests = active.filter((x) => isPregnancyTest(x.e)).length;
  // op 8 = شستشو (uterine flush); we use the same legacy fallback shape.
  const uterineFlushCount = active.filter(
    (x) => x.e.fertility_operation_id === 8 || x.e.legacy_table_name === "CowRinses",
  ).length;
  // Reproductive visit ≈ prescription / treatment / clean test (op 10).
  const reproductiveVisitCount = active.filter(
    (x) =>
      x.e.fertility_operation_id === 10 ||
      x.e.event_type === "prescription" ||
      x.e.event_type === "clean_test",
  ).length;

  // -- Last-of-kind dates -----------------------------------------------------
  const lastHeat = [...cycleHeats].pop()?.d ?? null;
  const lastService = [...cycleAIs].pop()?.d ?? null;
  const lastPregTest = [...cyclePregTests].pop();

  // -- Pregnancy status -------------------------------------------------------
  // Prefer the cached `is_pregnancy` flag; fall back to "last positive test
  // after last insemination" for safety.
  const pregnancyStatus: ActionListRow["pregnancyStatus"] = cow.is_dry
    ? "dry"
    : cow.is_pregnancy
      ? "pregnant"
      : "open";

  // -- DIM (days in milk) -----------------------------------------------------
  // DIM is undefined for dry cows by definition.
  const lastBirthDate = parseEventDate(cow.last_birth_date);
  const dim = pregnancyStatus === "dry" ? null : daysSince(lastBirthDate);

  // -- Open days --------------------------------------------------------------
  // Open days = days since last calving for cows that are NOT yet confirmed
  // pregnant. For pregnant cows we still expose the count (calving → conception
  // window). null when there's no last_birth_date (heifers).
  const openDays = daysSince(lastBirthDate);

  // -- Gestation days (used for Close To Calving) ----------------------------
  // Per spec, Close To Calving is gestation-based, NOT DIM-based:
  //   days since cows.last_pregnancy_date >= close_to_calving_days.
  const gestationDays = daysSince(parseEventDate(cow.last_pregnancy_date));

  // -- Last days-since values for badges --------------------------------------
  const daysSinceLastHeat = lastHeat ? daysBetween(lastHeat, today) : null;
  const daysSinceLastService = lastService ? daysBetween(lastService, today) : null;

  // -- Vet / technician (most recent reproductive event with a name) ----------
  // We walk newest-first and pick the first one with a doctor or operator name.
  let assignedVet: string | null = null;
  let assignedTechnician: string | null = null;
  for (let i = active.length - 1; i >= 0; i--) {
    const e = active[i].e;
    if (!assignedVet) assignedVet = pickDoctorName(e);
    if (!assignedTechnician) {
      assignedTechnician =
        e.operator_name ||
        (ctx.resolveUserName ? ctx.resolveUserName(e.operator_user_id) : null);
    }
    if (assignedVet && assignedTechnician) break;
  }

  // -- AGE-based VWP for heifers (no calving yet) -----------------------------
  const isHeifer = (cow.number_of_births ?? 0) === 0;
  const ageDays = daysSince(parseEventDate(cow.date_of_birth));
  const eligibleByVWP = isHeifer
    ? (ageDays ?? 0) >= thresholds.vwp_heifer_days
    : (dim ?? 0) >= thresholds.vwp_cow_days;

  // =========================================================================
  // SECTION CLASSIFICATION — apply rules in priority order; FIRST match wins.
  // Each branch must be self-contained to preserve mutual exclusivity.
  // =========================================================================
  let section: ActionSection = "none";

  // Only female animals participate in the action list.
  const isFemale = cow.sex === 2 || cow.sextype === "ماده" || cow.sextype === "female";

  // existancestatus 1 typically means alive/in-herd; 0/null are excluded.
  const isPresent = cow.existancestatus === 1 || cow.presence_status === 1;

  if (isFemale && isPresent) {
    // ----- 1) Chronic Breeders -------------------------------------------------
    // Open cow with >= chronic_breeder_services inseminations this cycle.
    if (
      pregnancyStatus === "open" &&
      cycleAIs.length >= thresholds.chronic_breeder_services
    ) {
      section = "chronic_breeder";
    }
    // ----- 2) Repeat Breeders --------------------------------------------------
    else if (
      pregnancyStatus === "open" &&
      cycleAIs.length >= thresholds.repeat_breeder_services
    ) {
      section = "repeat_breeder";
    }
    // ----- 3) High Risk Open ---------------------------------------------------
    // Open + (DIM > threshold OR heats >= threshold). Service-count branches
    // were already absorbed by repeat/chronic above.
    else if (
      pregnancyStatus === "open" &&
      ((dim != null && dim > thresholds.high_risk_dim) ||
        cycleHeats.length >= thresholds.high_risk_heats)
    ) {
      section = "high_risk_open";
    }
    // ----- 4) Pregnancy Check Due ---------------------------------------------
    // An insemination exists in this cycle, [min, max] days have passed since
    // it, and NO pregnancy test was recorded after that insemination.
    else if (lastService) {
      const daysSinceAI = daysSince(lastService) ?? 0;
      const testAfterAI = cyclePregTests.find(
        (t) => (t.d?.getTime() ?? 0) > lastService.getTime(),
      );
      if (
        !testAfterAI &&
        daysSinceAI >= thresholds.preg_check_window_min &&
        daysSinceAI <= thresholds.preg_check_window_max + 30 // grace window
      ) {
        section = "pregnancy_check_due";
      }
    }

    // ----- 5) Recheck Due ------------------------------------------------------
    // A POSITIVE pregnancy test was recorded, and [recheck_min, recheck_max]
    // days have passed without a follow-up test.
    if (section === "none" && lastPregTest && lastPregTest.d) {
      const result = (lastPregTest.e.result ?? "") + "";
      const code = (lastPregTest.e as any).result_code ?? "";
      const positive = /(آبستن|مثبت|pos|preg)/i.test(result) || /(pos|preg|1)/i.test(code + "");
      if (positive) {
        const daysSinceTest = daysSince(lastPregTest.d) ?? 0;
        // Find any test AFTER this one (already there means no recheck needed).
        const laterTest = cyclePregTests.find(
          (t) => (t.d?.getTime() ?? 0) > lastPregTest.d!.getTime(),
        );
        if (
          !laterTest &&
          daysSinceTest >= thresholds.recheck_window_min &&
          daysSinceTest <= thresholds.recheck_window_max + 30
        ) {
          section = "recheck_due";
        }
      }
    }

    // ----- 6) Veterinary Visit Required ---------------------------------------
    if (section === "none") {
      // (a) last_fertility_status = 16 (تحت درمان)
      // (b) abortion in the last 21 days
      // (c) most recent pregnancy test was NEGATIVE
      const recentAbortion = active
        .filter((x) => isAbortion(x.e))
        .map((x) => x.d)
        .pop();
      const recentAbortionDays = recentAbortion ? daysSince(recentAbortion) : null;
      const negativeTest = lastPregTest
        ? /(غیر ?آبستن|منفی|neg|empty)/i.test((lastPregTest.e.result ?? "") + "")
        : false;
      if (
        cow.last_fertility_status === 16 ||
        (recentAbortionDays != null && recentAbortionDays <= 21) ||
        (pregnancyStatus === "open" && negativeTest)
      ) {
        section = "vet_visit_required";
      }
    }

    // ----- 7) Synchronization Due ---------------------------------------------
    // Cow has an active sync record AND last sync activity was within the
    // configured recheck window (i.e. due for the next step).
    if (section === "none" && syncRecord && syncRecord.status === "active") {
      const lastSync = parseEventDate(cow.last_sync_date) ?? parseEventDate(syncRecord.event_date);
      const ds = lastSync ? daysSince(lastSync) ?? 0 : 0;
      if (ds >= 0 && ds <= thresholds.sync_due_recheck_days) {
        section = "sync_due";
      }
    }

    // ----- 8) Close To Calving ------------------------------------------------
    // GESTATION-based (NOT DIM): pregnant cow with gestation_days >= threshold.
    if (
      section === "none" &&
      pregnancyStatus === "pregnant" &&
      gestationDays != null &&
      gestationDays >= thresholds.close_to_calving_days
    ) {
      section = "close_to_calving";
    }

    // ----- 9) Ready For Breeding ----------------------------------------------
    // Open (or dry) cow past VWP, with no recent insemination to wait on.
    if (
      section === "none" &&
      pregnancyStatus !== "pregnant" &&
      eligibleByVWP &&
      // Avoid showing if a recent AI is still in its pregnancy-test window.
      (!lastService || (daysSinceLastService ?? 0) > thresholds.preg_check_window_max)
    ) {
      section = "ready_for_breeding";
    }
  }

  return {
    cow,
    section,
    cowLabel: buildCowLabel(cow),
    parity: cow.number_of_births ?? 0,
    dim,
    openDays,
    currentCycleNumber: cycleCount,
    pregnancyStatus,
    lastHeatDate: lastHeat,
    lastServiceDate: lastService,
    daysSinceLastHeat,
    daysSinceLastService,
    servicesInCycle: cycleAIs.length,
    heatsInCycle: cycleHeats.length,
    pregnancyTestCount: allPregTests,
    uterineFlushCount,
    reproductiveVisitCount,
    lastSyncProtocolId: syncRecord?.sync_type_id ?? null,
    assignedVet,
    assignedTechnician,
    groupLabel,
    reproductiveCostToDate: null, // Not wired yet — UI renders "—".
  };
}

// =============================================================================
// computeKPIs — KPI card counts. Includes the average-open-days metric over
// open (non-pregnant, non-dry) cows currently in the worklist.
// =============================================================================
export interface ActionListKPIs {
  readyForBreeding: number;
  pregnancyCheckDue: number;
  recheckDue: number;
  vetVisitRequired: number;
  highRiskOpen: number;
  closeToCalving: number;
  syncDue: number;
  repeatBreeders: number;
  chronicBreeders: number;
  averageOpenDays: number | null;
}

export function computeKPIs(rows: ActionListRow[]): ActionListKPIs {
  // Sum each section. Cows in section "none" do not contribute.
  const count = (s: ActionSection) => rows.filter((r) => r.section === s).length;

  // Average Open Days — over OPEN cows only (exclude pregnant/dry, exclude
  // cows that have never calved → openDays = null).
  const openDaysSamples = rows
    .filter((r) => r.pregnancyStatus === "open" && r.openDays != null)
    .map((r) => r.openDays as number);
  const averageOpenDays =
    openDaysSamples.length === 0
      ? null
      : Math.round(openDaysSamples.reduce((a, b) => a + b, 0) / openDaysSamples.length);

  return {
    readyForBreeding: count("ready_for_breeding"),
    pregnancyCheckDue: count("pregnancy_check_due"),
    recheckDue: count("recheck_due"),
    vetVisitRequired: count("vet_visit_required"),
    highRiskOpen: count("high_risk_open"),
    closeToCalving: count("close_to_calving"),
    syncDue: count("sync_due"),
    repeatBreeders: count("repeat_breeder"),
    chronicBreeders: count("chronic_breeder"),
    averageOpenDays,
  };
}
