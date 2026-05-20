// =============================================================================
// fertilityRiskEngine.ts
// -----------------------------------------------------------------------------
// Consumes the FertilityTimeline (timeline.ts) and produces the high-level
// FertilitySummary object used by the profile card, tab headers, and (in the
// future) herd-level dashboards.
//
// Pure function on top of the timeline + cow row — no Supabase calls here.
// =============================================================================

import {
  GESTATION_DAYS,
  DRY_OFF_BEFORE_CALVING,
  REPEAT_BREEDER_THRESHOLD,
  VOLUNTARY_WAITING_PERIOD,
  addDays,
  daysBetween,
  daysSince,
  parseEventDate,
} from "./fertilityCalculations";
import type { FertilityTimeline, EnrichedEvent } from "./fertilityTimeline";

// -----------------------------------------------------------------------------
// CowSnapshot — only the cow fields we actually use as fallback / context.
// Kept narrow so unit tests don't need a full Cow row.
// -----------------------------------------------------------------------------
export interface CowSnapshot {
  id: number;
  date_of_birth?: string | null;
  is_dry?: boolean | null;
  is_pregnancy?: boolean | null;
  last_fertility_status?: number | null;
}

// -----------------------------------------------------------------------------
// RiskLevel — colour-coded reproductive risk for the summary badge.
//   green   = healthy / on-track
//   yellow  = mild warning (eg. nearing repeat breeder threshold)
//   red     = active problem (repeat breeder, very long open days, overdue)
//   blue    = informational (eg. dry, fresh cow)
// -----------------------------------------------------------------------------
export type RiskLevel = "green" | "yellow" | "red" | "blue";

export type FertilityStateLabel =
  | "آبستن"
  | "باز"
  | "تلقیح‌شده"
  | "خشکی"
  | "انتظار زایش"
  | "Fresh Cow"
  | "Repeat Breeder"
  | "Synced"
  | "نیازمند بررسی";

export interface FertilitySummary {
  // ---- Headline ----------------------------------------------------------
  currentState: FertilityStateLabel;
  riskLevel: RiskLevel;
  riskReason: string;

  // ---- Pregnancy ---------------------------------------------------------
  isPregnant: boolean;
  daysPregnant: number | null;
  expectedCalvingDate: Date | null;
  daysToCalving: number | null;
  inseminationsThisPregnancy: number;
  lastPregnancyTest: {
    date: Date | null;
    result: string | null;
    stage: string | null;       // اولی/نهایی/تکمیلی/خشکی from metadata
    timing: string | null;      // early / standard / late
    vet: string | null;
    operator: string | null;
  } | null;

  // ---- Insemination -------------------------------------------------------
  totalInseminations: number;
  inseminationsCurrentCycle: number;
  consecutiveFailedAI: number;
  daysSinceLastAI: number | null;
  lastAIDate: Date | null;
  lastSperm: string | null;
  lastInseminator: string | null;

  // ---- Heat ---------------------------------------------------------------
  lastHeatDate: Date | null;
  heatToAIInterval: number | null;          // gap from last heat to last AI (days)
  heatsSinceLastCalving: number;
  lastHeatCycleNormal: boolean | null;

  // ---- Calving ------------------------------------------------------------
  lastCalvingDate: Date | null;
  dim: number | null;                       // Days in milk
  calvingCount: number;                     // Parity
  lastCalvingType: string | null;           // from result text
  prevCalvingInterval: number | null;       // Gap between two most-recent calvings
  predictedDryDate: Date | null;

  // ---- Reproductive performance ------------------------------------------
  openDays: number | null;                  // calving → conception (or today if open)
  ageDays: number | null;

  // ---- Dry period --------------------------------------------------------
  isDry: boolean | null;
  dryDate: Date | null;
  dryDuration: number | null;
  expectedReturnToMilking: Date | null;
}

// -----------------------------------------------------------------------------
// successfulAI — the AI that led to the current pregnancy (if any). Defined as
// the AI inside the current cycle whose enrichment marks it `pregnant`, OR the
// most recent AI if there's a positive pregnancy_test after it.
// -----------------------------------------------------------------------------
function successfulAI(current: EnrichedEvent[]): EnrichedEvent | null {
  const ais = current.filter((e) => e.event.event_type === "insemination");
  // Reverse iterate so we pick the most recent successful AI.
  for (let i = ais.length - 1; i >= 0; i--) {
    if (ais[i].aiOutcome === "pregnant") return ais[i];
  }
  return null;
}

// -----------------------------------------------------------------------------
// metadataString — safely pull a string field out of the JSONB metadata blob.
// -----------------------------------------------------------------------------
function meta(ee: EnrichedEvent | null | undefined, key: string): string | null {
  if (!ee) return null;
  const m = (ee.event.metadata ?? {}) as Record<string, unknown>;
  const v = m[key];
  return typeof v === "string" && v.trim() ? v : null;
}

// -----------------------------------------------------------------------------
// deriveFertilitySummary — main API consumed by useFertilitySummary hook.
// -----------------------------------------------------------------------------
// -----------------------------------------------------------------------------
// ChartViewRow — minimal subset of `analytics_fertility_legacy_chart` we use
// to override the timeline-derived numbers. The view is the same source the
// reports bar chart reads from, so passing it here keeps the FertilitySummary
// card 1:1 with the chart (آبستنی، خشکی، پیش‌بینی زایش، روزهای باز …).
// -----------------------------------------------------------------------------
export interface ChartViewRow {
  is_pregnancy?: boolean | null;
  is_dry?: boolean | null;
  pregnancy_days?: number | null;
  prediction_of_birth_date_days?: number | null;
  last_inoculation_date_g?: string | null;
  prediction_of_birth_date_g?: string | null;
  last_birth_date_g?: string | null;
  last_dry_date_g?: string | null;
  last_erotic_date_g?: string | null;
  dry_days?: number | null;
  last_birth_to_pregnancy_days?: number | null;
  number_of_births?: number | null;
  chart_status?: string | null;
}

export function deriveFertilitySummary(
  cow: CowSnapshot,
  timeline: FertilityTimeline,
  chartRow?: ChartViewRow | null,
): FertilitySummary {
  const current = timeline.current?.events ?? [];


  // ---- Last events of each type ------------------------------------------
  const lastOf = (type: string): EnrichedEvent | null => {
    for (let i = timeline.all.length - 1; i >= 0; i--) {
      if (timeline.all[i].event.event_type === type) return timeline.all[i];
    }
    return null;
  };
  const lastAI = lastOf("insemination");
  const lastHeat = lastOf("heat");
  const lastCalving = lastOf("calving");
  const lastDryOff = lastOf("dry_off");
  const lastPregTest = lastOf("pregnancy_test");

  // ---- Pregnancy state (real data, not cached field) ----------------------
  // The most recent terminator (calving/abortion) closes any prior pregnancy.
  // If a pregnancy_test in the current cycle is positive, OR there's an AI in
  // the current cycle that we marked `pregnant`, the cow is pregnant.
  const conceptionAI = successfulAI(current);
  const positiveTestInCycle = current.find(
    (e) =>
      e.event.event_type === "pregnancy_test" &&
      /(آبستن|مثبت|pos|preg)/i.test(e.event.result ?? ""),
  );
  const isPregnant = !!(conceptionAI || positiveTestInCycle);

  // ---- Pregnancy math ----------------------------------------------------
  const conceptionDate = conceptionAI?.date ?? null;
  const daysPregnant = conceptionDate ? daysSince(conceptionDate) : null;
  const expectedCalvingDate = conceptionDate
    ? addDays(conceptionDate, GESTATION_DAYS)
    : null;
  const daysToCalving = expectedCalvingDate ? daysSince(expectedCalvingDate) === null ? null : -daysSince(expectedCalvingDate)! : null;

  // ---- AI stats ----------------------------------------------------------
  const allAIs = timeline.all.filter((e) => e.event.event_type === "insemination");
  const currentAIs = current.filter((e) => e.event.event_type === "insemination");
  // Consecutive failed AIs at the tail of the current cycle (no terminator yet).
  let consecutiveFailed = 0;
  for (let i = currentAIs.length - 1; i >= 0; i--) {
    if (currentAIs[i].aiOutcome === "failed") consecutiveFailed++;
    else break;
  }

  // ---- Heat stats --------------------------------------------------------
  const currentHeats = current.filter((e) => e.event.event_type === "heat");
  const heatsSinceLastCalving = lastCalving
    ? timeline.all.filter(
        (e) =>
          e.event.event_type === "heat" &&
          (e.date?.getTime() ?? 0) > (lastCalving.date?.getTime() ?? 0),
      ).length
    : currentHeats.length;
  const heatToAI =
    lastHeat && lastAI ? daysBetween(lastHeat.date, lastAI.date) : null;

  // ---- Calving stats -----------------------------------------------------
  const calvingCount = timeline.calvings.length;
  const prevCalvingInterval =
    timeline.calvings.length >= 2
      ? daysBetween(timeline.calvings[1].date, timeline.calvings[0].date)
      : null;
  const dim = lastCalving ? daysSince(lastCalving.date) : null;
  // Predicted dry-off date: pregnancy known → expected calving - 60. Otherwise null.
  const predictedDryDate = expectedCalvingDate
    ? addDays(expectedCalvingDate, -DRY_OFF_BEFORE_CALVING)
    : null;

  // ---- Open days ---------------------------------------------------------
  // calving → conception. If still open, calving → today.
  const openDays = lastCalving
    ? conceptionDate
      ? daysBetween(lastCalving.date, conceptionDate)
      : daysSince(lastCalving.date)
    : null;

  // ---- Dry period --------------------------------------------------------
  // We treat the cow as dry if the most recent terminator-style event in the
  // current cycle (or just before) is a dry_off AND no calving has happened
  // since. Fall back to cached cow.is_dry as last resort.
  const dryAfterCalving =
    lastDryOff &&
    (!lastCalving ||
      (lastDryOff.date?.getTime() ?? 0) > (lastCalving.date?.getTime() ?? 0));
  const isDry = dryAfterCalving ? true : cow.is_dry ?? null;
  const dryDate = dryAfterCalving ? lastDryOff!.date : null;
  const dryDuration = dryDate ? daysSince(dryDate) : null;
  const expectedReturnToMilking = expectedCalvingDate; // returns to milking at next calving

  // ---- Vet / operator on last pregnancy test ------------------------------
  const vet =
    meta(lastPregTest, "Vet") ||
    meta(lastPregTest, "vet_name") ||
    meta(lastPregTest, "doctor_name") ||
    lastPregTest?.event.operator_name ||
    null;

  // ---- Risk classification -----------------------------------------------
  let riskLevel: RiskLevel = "green";
  let riskReason = "وضعیت طبیعی";
  const isFreshCow = lastCalving && (dim ?? Infinity) <= 30;
  const isRepeatBreeder = consecutiveFailed >= REPEAT_BREEDER_THRESHOLD;
  if (isRepeatBreeder) {
    riskLevel = "red";
    riskReason = `${consecutiveFailed} تلقیح ناموفق پشت سر هم (Repeat Breeder)`;
  } else if (consecutiveFailed === 2) {
    riskLevel = "yellow";
    riskReason = "۲ تلقیح ناموفق پشت سر هم — مراقب باشید";
  } else if (lastCalving && !isPregnant && (openDays ?? 0) > 150) {
    riskLevel = "red";
    riskReason = `روزهای باز ${openDays} روز — بسیار طولانی`;
  } else if (lastCalving && !isPregnant && (openDays ?? 0) > 100) {
    riskLevel = "yellow";
    riskReason = `روزهای باز ${openDays} روز — تحت نظر`;
  } else if (isDry) {
    riskLevel = "blue";
    riskReason = "در دوره خشکی";
  } else if (isFreshCow) {
    riskLevel = "blue";
    riskReason = "Fresh Cow — کمتر از ۳۰ روز از زایش";
  } else if (isPregnant) {
    riskLevel = "green";
    riskReason = "آبستن";
  }

  // ---- Current state label ----------------------------------------------
  let state: FertilityStateLabel = "نیازمند بررسی";
  if (isDry) state = "خشکی";
  else if (isPregnant && (daysToCalving ?? Infinity) <= 14) state = "انتظار زایش";
  else if (isPregnant) state = "آبستن";
  else if (isRepeatBreeder) state = "Repeat Breeder";
  else if (isFreshCow) state = "Fresh Cow";
  else if (lastAI && current.includes(lastAI) && !isPregnant) state = "تلقیح‌شده";
  else if (lastCalving) state = "باز";

  // ---- Age ---------------------------------------------------------------
  const ageDays = cow.date_of_birth
    ? daysSince(parseEventDate(cow.date_of_birth))
    : null;

  // ---- Chart-view overrides ----------------------------------------------
  // The reports bar chart (`analytics_fertility_legacy_chart`) is the
  // single source of truth for the high-level fertility numbers. When the
  // view has a value, we PREFER it over the timeline-derived value so the
  // profile card displays exactly what the chart shows. Falls back to the
  // timeline-derived value when the view doesn't have data.
  const cr = chartRow ?? {};
  // Parse helper — view returns ISO YYYY-MM-DD or null.
  const pDate = (s?: string | null) => (s ? parseEventDate(s) : null);

  const vIsPregnant = cr.is_pregnancy ?? null;
  const vIsDry = cr.is_dry ?? null;
  const vLastAI = pDate(cr.last_inoculation_date_g);
  const vExpCalving = pDate(cr.prediction_of_birth_date_g);
  const vLastCalving = pDate(cr.last_birth_date_g);
  const vDryDate = pDate(cr.last_dry_date_g);
  const vLastHeat = pDate(cr.last_erotic_date_g);

  const finalIsPregnant = vIsPregnant ?? isPregnant;
  const finalDaysPregnant = cr.pregnancy_days ?? daysPregnant;
  const finalExpCalving = vExpCalving ?? expectedCalvingDate;
  const finalDaysToCalving =
    cr.prediction_of_birth_date_days ?? daysToCalving;
  const finalLastAI = vLastAI ?? lastAI?.date ?? null;
  const finalDaysSinceLastAI = finalLastAI ? daysSince(finalLastAI) : null;
  const finalLastCalving = vLastCalving ?? lastCalving?.date ?? null;
  const finalDim = finalLastCalving ? daysSince(finalLastCalving) : dim;
  const finalIsDry = vIsDry ?? isDry;
  const finalDryDate = vDryDate ?? dryDate;
  const finalDryDuration = finalDryDate ? daysSince(finalDryDate) : dryDuration;
  const finalOpenDays = cr.last_birth_to_pregnancy_days ?? openDays;
  const finalCalvingCount = cr.number_of_births ?? calvingCount;
  const finalLastHeat = vLastHeat ?? lastHeat?.date ?? null;
  const finalPredictedDry = finalExpCalving
    ? addDays(finalExpCalving, -DRY_OFF_BEFORE_CALVING)
    : predictedDryDate;

  return {
    currentState: state,
    riskLevel,
    riskReason,

    isPregnant: !!finalIsPregnant,
    daysPregnant: finalDaysPregnant,
    expectedCalvingDate: finalExpCalving,
    daysToCalving: finalDaysToCalving,
    inseminationsThisPregnancy: conceptionAI
      ? currentAIs.filter(
          (a) => (a.date?.getTime() ?? 0) <= (conceptionAI.date?.getTime() ?? 0),
        ).length
      : 0,
    lastPregnancyTest: lastPregTest
      ? {
          date: lastPregTest.date,
          result: lastPregTest.event.result,
          stage:
            meta(lastPregTest, "stage") ||
            meta(lastPregTest, "test_stage") ||
            meta(lastPregTest, "pregnancy_stage"),
          timing: lastPregTest.pregTestTiming ?? null,
          vet,
          operator: lastPregTest.event.operator_name ?? null,
        }
      : null,

    totalInseminations: allAIs.length,
    inseminationsCurrentCycle: currentAIs.length,
    consecutiveFailedAI: consecutiveFailed,
    daysSinceLastAI: finalDaysSinceLastAI,
    lastAIDate: finalLastAI,
    lastSperm:
      meta(lastAI, "sperm_name") ||
      meta(lastAI, "sperm") ||
      meta(lastAI, "Sperm") ||
      null,
    lastInseminator: lastAI?.event.operator_name ?? null,

    lastHeatDate: finalLastHeat,
    heatToAIInterval: heatToAI,
    heatsSinceLastCalving,
    lastHeatCycleNormal:
      lastHeat?.heatCycleClass === "normal"
        ? true
        : lastHeat?.heatCycleClass === "abnormal"
        ? false
        : null,

    lastCalvingDate: finalLastCalving,
    dim: finalDim,
    calvingCount: finalCalvingCount,
    lastCalvingType: lastCalving?.event.result ?? null,
    prevCalvingInterval,
    predictedDryDate: finalPredictedDry,

    openDays: finalOpenDays,
    ageDays,

    isDry: finalIsDry,
    dryDate: finalDryDate,
    dryDuration: finalDryDuration,
    expectedReturnToMilking: finalExpCalving,
  };
}

// Re-export VOLUNTARY_WAITING_PERIOD so consumers (eg. tab headers) can show
// whether the cow has passed the post-calving waiting window.
export { VOLUNTARY_WAITING_PERIOD };
