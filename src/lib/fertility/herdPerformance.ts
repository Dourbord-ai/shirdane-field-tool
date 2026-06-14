// =============================================================================
// herdPerformance.ts
// -----------------------------------------------------------------------------
// Pure KPI engine for «گزارش عملکرد باروری گله» (Herd Fertility Performance).
//
// Inputs:
//   - cows snapshot (current state from the DB)
//   - fertility events (entire history; we slice per filter window)
//   - cow_syncs (for sync→service attribution)
//   - locations / sync types / sperms reference tables (labels only)
//   - thresholds (VWP, repeat/chronic, sync_to_service_window_days, …)
//   - filter object (window dates, parity, group, sync protocol, semen, mode)
//
// Output:
//   - KPI strip (mode-aware: management vs industry)
//   - Reproductive funnel stages
//   - Open-days distribution histogram
//   - Trend buckets (by chosen granularity)
//   - Parity / Group / Protocol / Semen tables
//
// Everything is pure & synchronous so it can be unit tested with fixtures and
// reused by other surfaces later (mobile widgets, exports, etc.).
// =============================================================================

import type { FertilityEvent } from "@/lib/fertility";
import type { FertilityThresholds } from "@/hooks/useFertilityThresholds";
import {
  classifyTestOutcome,
  isAbortionEvent,
  isCalvingEvent,
  isHeatEvent,
  isInsemination,
  isPregnancyTest,
} from "@/lib/fertility/statusMapping";

// -----------------------------------------------------------------------------
// Minimal cow projection — keeps the engine independent from the full DB row.
// -----------------------------------------------------------------------------
export interface HerdCow {
  id: number;
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
  last_location_id: number | null;
}

export interface HerdCowSync {
  id: number;
  cow_id: number;
  sync_type_id: number | null;
  event_date: string | null;          // sync program start
  inoculation_date_time?: string | null; // end-of-protocol marker
  is_deleted: boolean | null;
}

// Filter object — every field is optional/null = "no filter".
export type CalcMode = "management" | "industry";
export type ParityFilter = "all" | "heifer" | "primiparous" | "multiparous" | "1" | "2" | "3" | "4plus";
export type TrendGranularity = "monthly" | "quarterly" | "yearly";

export interface HerdFilters {
  fromDate: Date;
  toDate: Date;
  groupId?: number | null;       // last_location_id
  parity: ParityFilter;
  syncTypeId?: number | null;
  spermId?: number | null;
  granularity: TrendGranularity;
  mode: CalcMode;
}

// Helpers --------------------------------------------------------------------
// Robust date parse that tolerates ISO strings, dates with time, or null.
function parseDate(v: string | null | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d : null;
}
const DAY_MS = 86_400_000;
const days = (a: Date, b: Date) => Math.floor((b.getTime() - a.getTime()) / DAY_MS);
const inRange = (d: Date | null, from: Date, to: Date) =>
  d != null && d.getTime() >= from.getTime() && d.getTime() <= to.getTime();

// Cow eligibility helpers
function isFemalePresent(c: HerdCow): boolean {
  const female = c.sex === 2 || c.sextype === "ماده" || c.sextype === "female";
  const present = c.existancestatus === 1 || c.presence_status === 1;
  return female && present;
}

// Parity bucket — "heifer" = never calved.
function parityBucket(c: HerdCow): "heifer" | "1" | "2" | "3" | "4plus" {
  const p = c.number_of_births ?? 0;
  if (p <= 0) return "heifer";
  if (p === 1) return "1";
  if (p === 2) return "2";
  if (p === 3) return "3";
  return "4plus";
}

function parityMatches(c: HerdCow, f: ParityFilter): boolean {
  if (f === "all") return true;
  const b = parityBucket(c);
  if (f === "heifer") return b === "heifer";
  if (f === "primiparous") return b === "1";
  if (f === "multiparous") return b === "2" || b === "3" || b === "4plus";
  return b === f;
}

// Eligible for breeding (industry-standard "eligible cow"):
//   Female + present + past VWP (cow or heifer rule) + NOT currently pregnant.
function isEligible(c: HerdCow, thr: FertilityThresholds, asOf: Date): boolean {
  if (!isFemalePresent(c)) return false;
  if (c.is_pregnancy) return false;
  if (c.is_dry) return false;
  const lastBirth = parseDate(c.last_birth_date);
  if (lastBirth) {
    // VWP cow rule: days since calving ≥ vwp_cow_days
    return days(lastBirth, asOf) >= thr.vwp_cow_days;
  }
  // Heifer rule: age days ≥ vwp_heifer_days
  const dob = parseDate(c.date_of_birth);
  if (!dob) return false;
  return days(dob, asOf) >= thr.vwp_heifer_days;
}

// =============================================================================
// Main engine — single entry point returning every section the page needs.
// =============================================================================
export interface HerdPerformanceResult {
  kpis: HerdKpis;
  funnel: FunnelStages;
  openDaysDistribution: { bucket: string; count: number }[];
  trend: { period: string; pregnancyRate: number; conceptionRate: number; heatDetectionRate: number; services: number; pregnancies: number; abortions: number }[];
  parityRows: SegmentRow[];
  groupRows: SegmentRow[];
  protocolRows: ProtocolRow[];
  semenRows: SemenRow[];
}

export interface HerdKpis {
  // Common
  eligibleCows: number;
  pregnantCows: number;
  openCows: number;
  averageOpenDays: number | null;
  daysToFirstService: number | null;
  daysToConception: number | null;
  averageServicesPerConception: number | null;
  repeatBreederRate: number | null;
  chronicBreederRate: number | null;
  pregnancyLossRate: number | null;
  abortionRate: number | null;
  // Mode-dependent
  pregnancyRate: number | null;
  conceptionRate: number | null;
  heatDetectionRate: number | null;
  serviceRate: number | null;
  firstServiceConceptionRate: number | null;
}

export interface FunnelStages {
  eligible: number;
  heat: number;
  service: number;
  pregnancyTest: number;
  pregnant: number;
}

export interface SegmentRow {
  key: string;
  label: string;
  cowCount: number;
  pregnancyRate: number | null;
  conceptionRate: number | null;
  servicesPerConception: number | null;
  averageOpenDays: number | null;
  daysToFirstService: number | null;
  daysToConception: number | null;
  repeatBreederPct: number | null;
  chronicBreederPct: number | null;
}

export interface ProtocolRow {
  key: string;
  label: string;
  syncCount: number;
  resultingServices: number;
  serviceRate: number | null;        // services / sync
  conceptionRate: number | null;
  servicesPerConception: number | null;
  avgDaysSyncToService: number | null;
}

export interface SemenRow {
  key: string;
  label: string;
  inseminations: number;
  conceptionRate: number | null;
  firstServiceCR: number | null;
  servicesPerConception: number | null;
  pregnancyLossRate: number | null;
  // Future-proof columns — currently always null/"—"
  daughterCount: number | null;
  femaleCalfPct: number | null;
  maleCalfPct: number | null;
  abortionPct: number | null;
}

// -----------------------------------------------------------------------------
// computeHerdPerformance — the engine. Heavy but linear in cow & event counts.
// -----------------------------------------------------------------------------
export function computeHerdPerformance(args: {
  cows: HerdCow[];
  events: FertilityEvent[];
  syncs: HerdCowSync[];
  thresholds: FertilityThresholds;
  filters: HerdFilters;
  locationName: (id: number) => string | null;
  syncTypeName: (id: number) => string | null;
  spermName: (id: number) => string | null;
}): HerdPerformanceResult {
  const { cows, events, syncs, thresholds, filters, locationName, syncTypeName, spermName } = args;
  const { fromDate, toDate, mode } = filters;
  const asOf = toDate;

  // ---- Pre-filter cows by group/parity (cheap; applied everywhere) ---------
  const cowPool = cows.filter((c) => {
    if (!isFemalePresent(c)) return false;
    if (filters.groupId != null && c.last_location_id !== filters.groupId) return false;
    if (!parityMatches(c, filters.parity)) return false;
    return true;
  });
  const cowById = new Map(cowPool.map((c) => [c.id, c]));

  // ---- Pre-index events per cow (sorted ascending) -------------------------
  // Using one pass we both filter to events whose owning cow is in cowPool
  // and group them by cow id.
  const eventsByCow = new Map<number, FertilityEvent[]>();
  for (const e of events) {
    if (e.is_cancelled) continue;
    if (!cowById.has(e.livestock_id)) continue;
    const arr = eventsByCow.get(e.livestock_id);
    if (arr) arr.push(e);
    else eventsByCow.set(e.livestock_id, [e]);
  }
  for (const arr of eventsByCow.values()) {
    arr.sort((a, b) => (parseDate(a.event_date)?.getTime() ?? 0) - (parseDate(b.event_date)?.getTime() ?? 0));
  }

  // ---- Period-scoped event arrays (used for rate numerators) ---------------
  // Heats / services / preg-tests / abortions inside [from,to].
  const periodHeats: { cowId: number; date: Date }[] = [];
  const periodServices: { cowId: number; date: Date; e: FertilityEvent }[] = [];
  const periodPregTests: { cowId: number; date: Date; e: FertilityEvent }[] = [];
  const periodAbortions: { cowId: number; date: Date }[] = [];
  // Spermid filter applied below.
  for (const [cowId, arr] of eventsByCow) {
    for (const e of arr) {
      const d = parseDate(e.event_date);
      if (!d) continue;
      if (!inRange(d, fromDate, toDate)) continue;
      if (isHeatEvent(e)) periodHeats.push({ cowId, date: d });
      else if (isInsemination(e)) {
        // Apply sperm filter at the insemination level so KPI rates respect it.
        if (filters.spermId != null) {
          const sid = (e.metadata as Record<string, unknown> | null)?.sperm_id;
          if (sid !== filters.spermId) continue;
        }
        periodServices.push({ cowId, date: d, e });
      } else if (isPregnancyTest(e)) periodPregTests.push({ cowId, date: d, e });
      else if (isAbortionEvent(e)) periodAbortions.push({ cowId, date: d });
    }
  }

  // Confirmed pregnancies in period = positive preg tests in [from,to].
  const periodPositiveTests = periodPregTests.filter((t) => classifyTestOutcome(t.e) === "positive");
  const periodKnownTests = periodPregTests.filter((t) => classifyTestOutcome(t.e) !== "unknown");

  // ---- Eligible cow set (as of period end) ---------------------------------
  const eligibleCows = cowPool.filter((c) => isEligible(c, thresholds, asOf));
  const pregnantCows = cowPool.filter((c) => c.is_pregnancy && isFemalePresent(c));
  const openCows = cowPool.filter((c) => !c.is_pregnancy && !c.is_dry && isFemalePresent(c));

  // ---- KPI: eligible cow-days denominator (used by industry mode rates) ---
  // Sum of days each currently-eligible cow is eligible across the window.
  // Approximation: any day the cow was past VWP + not pregnant counts.
  let eligibleCowDays = 0;
  for (const c of cowPool) {
    const lastBirth = parseDate(c.last_birth_date);
    const dob = parseDate(c.date_of_birth);
    // Determine VWP start (cow vs heifer rule).
    let vwpStart: Date | null = null;
    if (lastBirth) vwpStart = new Date(lastBirth.getTime() + thresholds.vwp_cow_days * DAY_MS);
    else if (dob) vwpStart = new Date(dob.getTime() + thresholds.vwp_heifer_days * DAY_MS);
    if (!vwpStart) continue;
    // Cow is no longer eligible once pregnant. We use cows.last_pregnancy_date
    // as the end-of-eligibility marker; if still open today the cow is eligible
    // up to `asOf`.
    const lastPreg = parseDate(c.last_pregnancy_date);
    const endEligible = lastPreg && lastPreg.getTime() > (lastBirth?.getTime() ?? 0) ? lastPreg : asOf;
    const start = vwpStart.getTime() > fromDate.getTime() ? vwpStart : fromDate;
    const end = endEligible.getTime() < toDate.getTime() ? endEligible : toDate;
    const d = Math.max(0, Math.floor((end.getTime() - start.getTime()) / DAY_MS));
    eligibleCowDays += d;
  }
  const eligibleCowPeriods = eligibleCowDays / 21; // industry 21-day-cycle basis

  // ---- Per-cow lifetime metrics needed for averages ------------------------
  // For each cow in pool, walk events to derive: current-cycle services count,
  // current-cycle heats count, open days, DTFS / DTC.
  let sumOpenDays = 0; let nOpenDays = 0;
  let sumDTFS = 0; let nDTFS = 0;
  let sumDTC = 0; let nDTC = 0;
  let sumServicesPerConception = 0; let nServicesPerConception = 0;
  let repeatCount = 0; let chronicCount = 0;
  let firstServiceCRPos = 0; let firstServiceCRTotal = 0;
  let pregLossNumerator = 0; let pregLossDenominator = 0;
  const openDaysBuckets = [0, 0, 0, 0, 0, 0]; // 0-60, 61-90, 91-120, 121-150, 151-180, 180+

  for (const c of cowPool) {
    const events = eventsByCow.get(c.id) ?? [];
    const lastBirth = parseDate(c.last_birth_date);

    // Current-cycle service & heat counts (between last calving and today).
    let cycleServices: { date: Date; e: FertilityEvent }[] = [];
    for (const e of events) {
      const d = parseDate(e.event_date);
      if (!d) continue;
      if (lastBirth && d.getTime() <= lastBirth.getTime()) continue;
      if (isInsemination(e)) cycleServices.push({ date: d, e });
    }
    if (!c.is_pregnancy && !c.is_dry) {
      if (cycleServices.length >= thresholds.chronic_breeder_services) chronicCount++;
      else if (cycleServices.length >= thresholds.repeat_breeder_services) repeatCount++;
    }

    // Open days: for open cows = days since calving; for confirmed-pregnant
    // = (last_pregnancy_date - last_birth_date).
    if (lastBirth) {
      let od: number | null = null;
      if (c.is_pregnancy) {
        const preg = parseDate(c.last_pregnancy_date);
        if (preg && preg.getTime() > lastBirth.getTime()) od = days(lastBirth, preg);
      } else if (!c.is_dry) {
        od = days(lastBirth, asOf);
      }
      if (od != null && od >= 0) {
        sumOpenDays += od; nOpenDays++;
        if (od <= 60) openDaysBuckets[0]++;
        else if (od <= 90) openDaysBuckets[1]++;
        else if (od <= 120) openDaysBuckets[2]++;
        else if (od <= 150) openDaysBuckets[3]++;
        else if (od <= 180) openDaysBuckets[4]++;
        else openDaysBuckets[5]++;
      }

      // DTFS — for cows that calved in or before window, first service after.
      const firstSvc = cycleServices[0]?.date ?? null;
      if (firstSvc && firstSvc.getTime() > lastBirth.getTime()) {
        sumDTFS += days(lastBirth, firstSvc); nDTFS++;
      }

      // DTC + services per conception — only for confirmed-pregnant cows
      // whose conception falls inside the period.
      const preg = parseDate(c.last_pregnancy_date);
      if (c.is_pregnancy && preg && inRange(preg, fromDate, toDate)) {
        sumDTC += days(lastBirth, preg); nDTC++;
        const svcCount = cycleServices.filter((s) => s.date.getTime() <= preg.getTime()).length;
        if (svcCount > 0) { sumServicesPerConception += svcCount; nServicesPerConception++; }
        if (cycleServices[0] && days(cycleServices[0].date, preg) <= 21) firstServiceCRPos++;
      }
      if (cycleServices.length > 0 && lastBirth) firstServiceCRTotal++;
    }

    // Pregnancy loss: cow had a positive test followed by a negative test or
    // an abortion in the same cycle, where the positive test occurred in
    // the window.
    let lastPositiveInWindow: Date | null = null;
    for (const e of events) {
      if (!isPregnancyTest(e)) continue;
      const d = parseDate(e.event_date);
      if (!d) continue;
      const outcome = classifyTestOutcome(e);
      if (outcome === "positive" && inRange(d, fromDate, toDate)) {
        lastPositiveInWindow = d;
        pregLossDenominator++;
      } else if (lastPositiveInWindow && outcome === "negative" && d.getTime() > lastPositiveInWindow.getTime()) {
        pregLossNumerator++;
        lastPositiveInWindow = null;
      }
    }
    if (lastPositiveInWindow) {
      // Check abortions after the positive
      for (const a of events) {
        if (!isAbortionEvent(a)) continue;
        const d = parseDate(a.event_date);
        if (d && d.getTime() > lastPositiveInWindow.getTime()) { pregLossNumerator++; break; }
      }
    }
  }

  // ---- Funnel --------------------------------------------------------------
  const eligibleSet = new Set(eligibleCows.map((c) => c.id));
  const heatSet = new Set<number>();
  for (const h of periodHeats) if (eligibleSet.has(h.cowId)) heatSet.add(h.cowId);
  const serviceSet = new Set<number>();
  for (const s of periodServices) if (eligibleSet.has(s.cowId)) serviceSet.add(s.cowId);
  const testSet = new Set<number>();
  for (const t of periodPregTests) if (serviceSet.has(t.cowId)) testSet.add(t.cowId);
  const pregnantSet = new Set<number>();
  for (const t of periodPositiveTests) if (serviceSet.has(t.cowId)) pregnantSet.add(t.cowId);

  // ---- KPI rates -----------------------------------------------------------
  // Industry: confirmed pregnancies in period / eligible cow-periods.
  // Management: confirmed pregnancies in period / eligible cows count.
  const pregnancyRateIndustry = eligibleCowPeriods > 0
    ? (periodPositiveTests.length / eligibleCowPeriods) * 100 : null;
  const pregnancyRateMgmt = eligibleCows.length > 0
    ? (pregnantSet.size / eligibleCows.length) * 100 : null;
  const heatRateIndustry = eligibleCowPeriods > 0
    ? (periodHeats.length / eligibleCowPeriods) * 100 : null;
  const heatRateMgmt = eligibleCows.length > 0
    ? (heatSet.size / eligibleCows.length) * 100 : null;
  const serviceRateIndustry = eligibleCowPeriods > 0
    ? (periodServices.length / eligibleCowPeriods) * 100 : null;
  const serviceRateMgmt = eligibleCows.length > 0
    ? (serviceSet.size / eligibleCows.length) * 100 : null;
  const conceptionRate = periodKnownTests.length > 0
    ? (periodPositiveTests.length / periodKnownTests.length) * 100 : null;
  const firstServiceCR = firstServiceCRTotal > 0
    ? (firstServiceCRPos / firstServiceCRTotal) * 100 : null;
  const abortionRate = pregnantCows.length > 0
    ? (periodAbortions.length / pregnantCows.length) * 100 : null;
  const pregnancyLossRate = pregLossDenominator > 0
    ? (pregLossNumerator / pregLossDenominator) * 100 : null;

  const kpis: HerdKpis = {
    eligibleCows: eligibleCows.length,
    pregnantCows: pregnantCows.length,
    openCows: openCows.length,
    averageOpenDays: nOpenDays > 0 ? sumOpenDays / nOpenDays : null,
    daysToFirstService: nDTFS > 0 ? sumDTFS / nDTFS : null,
    daysToConception: nDTC > 0 ? sumDTC / nDTC : null,
    averageServicesPerConception: nServicesPerConception > 0 ? sumServicesPerConception / nServicesPerConception : null,
    repeatBreederRate: openCows.length > 0 ? (repeatCount / openCows.length) * 100 : null,
    chronicBreederRate: openCows.length > 0 ? (chronicCount / openCows.length) * 100 : null,
    pregnancyLossRate,
    abortionRate,
    pregnancyRate: mode === "industry" ? pregnancyRateIndustry : pregnancyRateMgmt,
    conceptionRate,
    heatDetectionRate: mode === "industry" ? heatRateIndustry : heatRateMgmt,
    serviceRate: mode === "industry" ? serviceRateIndustry : serviceRateMgmt,
    firstServiceConceptionRate: firstServiceCR,
  };

  // ---- Open-days distribution ---------------------------------------------
  const openDaysDistribution = [
    { bucket: "0-60", count: openDaysBuckets[0] },
    { bucket: "61-90", count: openDaysBuckets[1] },
    { bucket: "91-120", count: openDaysBuckets[2] },
    { bucket: "121-150", count: openDaysBuckets[3] },
    { bucket: "151-180", count: openDaysBuckets[4] },
    { bucket: "180+", count: openDaysBuckets[5] },
  ];

  // ---- Trend buckets -------------------------------------------------------
  // Bucket every period event by month/quarter/year and compute simple rates.
  const trendMap = new Map<string, { services: number; pregnancies: number; abortions: number; heats: number; knownTests: number }>();
  const labelFor = (d: Date): string => {
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    if (filters.granularity === "yearly") return `${y}`;
    if (filters.granularity === "quarterly") return `${y}-Q${Math.floor((m - 1) / 3) + 1}`;
    return `${y}-${String(m).padStart(2, "0")}`;
  };
  const bump = (k: string, field: keyof NonNullable<ReturnType<typeof trendMap.get>>) => {
    const v = trendMap.get(k) ?? { services: 0, pregnancies: 0, abortions: 0, heats: 0, knownTests: 0 };
    v[field]++;
    trendMap.set(k, v);
  };
  for (const s of periodServices) bump(labelFor(s.date), "services");
  for (const t of periodPositiveTests) bump(labelFor(t.date), "pregnancies");
  for (const a of periodAbortions) bump(labelFor(a.date), "abortions");
  for (const h of periodHeats) bump(labelFor(h.date), "heats");
  for (const t of periodKnownTests) bump(labelFor(t.date), "knownTests");
  const trend = [...trendMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([period, v]) => ({
      period,
      pregnancyRate: eligibleCows.length > 0 ? (v.pregnancies / eligibleCows.length) * 100 : 0,
      conceptionRate: v.knownTests > 0 ? (v.pregnancies / v.knownTests) * 100 : 0,
      heatDetectionRate: eligibleCows.length > 0 ? (v.heats / eligibleCows.length) * 100 : 0,
      services: v.services,
      pregnancies: v.pregnancies,
      abortions: v.abortions,
    }));

  // ---- Segment helper ------------------------------------------------------
  // Given a subset of cows, compute a SegmentRow. Re-uses the period-scoped
  // arrays via filtering by membership in `cowIds`.
  function segmentRow(key: string, label: string, subset: HerdCow[]): SegmentRow {
    const ids = new Set(subset.map((c) => c.id));
    const subEligible = subset.filter((c) => isEligible(c, thresholds, asOf));
    const subOpen = subset.filter((c) => !c.is_pregnancy && !c.is_dry);
    const subServices = periodServices.filter((s) => ids.has(s.cowId));
    const subTests = periodPregTests.filter((t) => ids.has(t.cowId));
    const subKnown = subTests.filter((t) => classifyTestOutcome(t.e) !== "unknown");
    const subPositives = subTests.filter((t) => classifyTestOutcome(t.e) === "positive");
    // Lifetime aggregates for sub.
    let od = 0, nod = 0, dtfs = 0, ndtfs = 0, dtc = 0, ndtc = 0, spc = 0, nspc = 0;
    let rep = 0, chr = 0;
    for (const c of subset) {
      const events = eventsByCow.get(c.id) ?? [];
      const lastBirth = parseDate(c.last_birth_date);
      const svcs = events.filter((e) => {
        const d = parseDate(e.event_date);
        return d && (!lastBirth || d.getTime() > lastBirth.getTime()) && isInsemination(e);
      }).map((e) => parseDate(e.event_date)!).filter(Boolean);
      if (!c.is_pregnancy && !c.is_dry) {
        if (svcs.length >= thresholds.chronic_breeder_services) chr++;
        else if (svcs.length >= thresholds.repeat_breeder_services) rep++;
      }
      if (lastBirth) {
        if (c.is_pregnancy) {
          const preg = parseDate(c.last_pregnancy_date);
          if (preg && preg.getTime() > lastBirth.getTime()) { od += days(lastBirth, preg); nod++; }
        } else if (!c.is_dry) { od += days(lastBirth, asOf); nod++; }
        const fs = svcs[0];
        if (fs && fs.getTime() > lastBirth.getTime()) { dtfs += days(lastBirth, fs); ndtfs++; }
        const preg = parseDate(c.last_pregnancy_date);
        if (c.is_pregnancy && preg && inRange(preg, fromDate, toDate)) {
          dtc += days(lastBirth, preg); ndtc++;
          const n = svcs.filter((s) => s.getTime() <= preg.getTime()).length;
          if (n > 0) { spc += n; nspc++; }
        }
      }
    }
    return {
      key, label,
      cowCount: subset.length,
      pregnancyRate: subEligible.length > 0 ? (subPositives.length / subEligible.length) * 100 : null,
      conceptionRate: subKnown.length > 0 ? (subPositives.length / subKnown.length) * 100 : null,
      servicesPerConception: nspc > 0 ? spc / nspc : null,
      averageOpenDays: nod > 0 ? od / nod : null,
      daysToFirstService: ndtfs > 0 ? dtfs / ndtfs : null,
      daysToConception: ndtc > 0 ? dtc / ndtc : null,
      repeatBreederPct: subOpen.length > 0 ? (rep / subOpen.length) * 100 : null,
      chronicBreederPct: subOpen.length > 0 ? (chr / subOpen.length) * 100 : null,
    };
  }

  // ---- Parity rows ---------------------------------------------------------
  const parityRows: SegmentRow[] = [
    segmentRow("heifer", "تلیسه", cowPool.filter((c) => parityBucket(c) === "heifer")),
    segmentRow("primiparous", "Primiparous (شکم ۱)", cowPool.filter((c) => parityBucket(c) === "1")),
    segmentRow("multiparous", "Multiparous (شکم ۲+)", cowPool.filter((c) => ["2", "3", "4plus"].includes(parityBucket(c)))),
    segmentRow("p1", "شکم ۱", cowPool.filter((c) => parityBucket(c) === "1")),
    segmentRow("p2", "شکم ۲", cowPool.filter((c) => parityBucket(c) === "2")),
    segmentRow("p3", "شکم ۳", cowPool.filter((c) => parityBucket(c) === "3")),
    segmentRow("p4plus", "شکم ۴+", cowPool.filter((c) => parityBucket(c) === "4plus")),
  ];

  // ---- Group rows (top 20 by cow count) ------------------------------------
  const byLocation = new Map<number, HerdCow[]>();
  for (const c of cowPool) {
    if (c.last_location_id == null) continue;
    const arr = byLocation.get(c.last_location_id) ?? [];
    arr.push(c); byLocation.set(c.last_location_id, arr);
  }
  const groupRowsAll: SegmentRow[] = [...byLocation.entries()].map(([id, subset]) =>
    segmentRow(`loc-${id}`, locationName(id) ?? `#${id}`, subset),
  );
  groupRowsAll.sort((a, b) => b.cowCount - a.cowCount);
  const groupRows = groupRowsAll.slice(0, 20);

  // ---- Protocol comparison -------------------------------------------------
  // For each (cow, sync) we look for the next insemination by that cow within
  // the configurable window after the sync's inoculation/end date.
  const protocolMap = new Map<number, { syncCount: number; services: number; sumDays: number; positives: number; knownTests: number }>();
  // Track services attributed to a protocol so "بدون پروتکل" can be derived.
  const attributedServiceKeys = new Set<string>();
  const windowDays = thresholds.sync_to_service_window_days ?? 14;
  for (const s of syncs) {
    if (s.is_deleted) continue;
    if (!cowById.has(s.cow_id)) continue;
    if (filters.syncTypeId != null && s.sync_type_id !== filters.syncTypeId) continue;
    const syncEnd = parseDate(s.inoculation_date_time ?? null) ?? parseDate(s.event_date);
    if (!syncEnd) continue;
    if (!inRange(syncEnd, fromDate, toDate)) continue;
    const stid = s.sync_type_id ?? -1;
    const slot = protocolMap.get(stid) ?? { syncCount: 0, services: 0, sumDays: 0, positives: 0, knownTests: 0 };
    slot.syncCount++;
    // Find next service from this cow within window.
    const events = eventsByCow.get(s.cow_id) ?? [];
    for (const e of events) {
      const d = parseDate(e.event_date);
      if (!d) continue;
      if (!isInsemination(e)) continue;
      const delta = days(syncEnd, d);
      if (delta < 0 || delta > windowDays) continue;
      slot.services++;
      slot.sumDays += delta;
      attributedServiceKeys.add(`${s.cow_id}-${e.id}`);
      // Was there a known outcome test after this service in the cycle?
      const lastBirth = parseDate(cowById.get(s.cow_id)!.last_birth_date);
      const followingTests = events.filter((t) => {
        const td = parseDate(t.event_date);
        return isPregnancyTest(t) && td && td.getTime() > d.getTime() && (!lastBirth || td.getTime() > lastBirth.getTime());
      });
      const known = followingTests.find((t) => classifyTestOutcome(t) !== "unknown");
      if (known) {
        slot.knownTests++;
        if (classifyTestOutcome(known) === "positive") slot.positives++;
      }
      break; // first service after sync only
    }
    protocolMap.set(stid, slot);
  }
  const protocolRows: ProtocolRow[] = [...protocolMap.entries()].map(([stid, v]) => ({
    key: `st-${stid}`,
    label: stid === -1 ? "بدون پروتکل مشخص" : syncTypeName(stid) ?? `#${stid}`,
    syncCount: v.syncCount,
    resultingServices: v.services,
    serviceRate: v.syncCount > 0 ? (v.services / v.syncCount) * 100 : null,
    conceptionRate: v.knownTests > 0 ? (v.positives / v.knownTests) * 100 : null,
    servicesPerConception: v.positives > 0 ? v.services / v.positives : null,
    avgDaysSyncToService: v.services > 0 ? v.sumDays / v.services : null,
  })).sort((a, b) => b.syncCount - a.syncCount);

  // Unattributed services row (only when not filtering by a specific protocol).
  if (filters.syncTypeId == null) {
    const unattributed = periodServices.filter((s) => {
      // Re-derive key the same way we set it above.
      return ![...attributedServiceKeys].some((k) => k.endsWith(`-${s.e.id}`));
    });
    if (unattributed.length > 0) {
      protocolRows.push({
        key: "no-protocol",
        label: "بدون پروتکل (تلقیح‌های بدون انتساب)",
        syncCount: 0,
        resultingServices: unattributed.length,
        serviceRate: null,
        conceptionRate: null,
        servicesPerConception: null,
        avgDaysSyncToService: null,
      });
    }
  }

  // ---- Semen rows (top 15 by insemination volume) --------------------------
  const semenMap = new Map<number, { count: number; positives: number; known: number; firstSvcPos: number; firstSvcTotal: number; loss: number; lossDen: number }>();
  // Build per-cow first-service flag and outcome lookup once.
  for (const s of periodServices) {
    const sid = (s.e.metadata as Record<string, unknown> | null)?.sperm_id;
    if (typeof sid !== "number") continue;
    const slot = semenMap.get(sid) ?? { count: 0, positives: 0, known: 0, firstSvcPos: 0, firstSvcTotal: 0, loss: 0, lossDen: 0 };
    slot.count++;
    // Find outcome test after this service.
    const events = eventsByCow.get(s.cowId) ?? [];
    const tests = events.filter((e) => isPregnancyTest(e) && (parseDate(e.event_date)?.getTime() ?? 0) > s.date.getTime());
    const knownT = tests.find((t) => classifyTestOutcome(t) !== "unknown");
    if (knownT) {
      slot.known++;
      if (classifyTestOutcome(knownT) === "positive") slot.positives++;
    }
    // Is this the cow's first service in current cycle?
    const cow = cowById.get(s.cowId)!;
    const lastBirth = parseDate(cow.last_birth_date);
    const allSvcs = events.filter((e) => isInsemination(e) && (!lastBirth || (parseDate(e.event_date)?.getTime() ?? 0) > lastBirth.getTime()));
    if (allSvcs[0]?.id === s.e.id) {
      slot.firstSvcTotal++;
      if (knownT && classifyTestOutcome(knownT) === "positive") slot.firstSvcPos++;
    }
    // Pregnancy loss attributable to this semen.
    if (knownT && classifyTestOutcome(knownT) === "positive") {
      slot.lossDen++;
      // Later negative test or abortion?
      const after = events.find((e) => {
        const d = parseDate(e.event_date)?.getTime() ?? 0;
        return d > (parseDate(knownT.event_date)?.getTime() ?? 0) &&
          (isAbortionEvent(e) || (isPregnancyTest(e) && classifyTestOutcome(e) === "negative"));
      });
      if (after) slot.loss++;
    }
    semenMap.set(sid, slot);
  }
  const semenRowsAll: SemenRow[] = [...semenMap.entries()].map(([sid, v]) => ({
    key: `sperm-${sid}`,
    label: spermName(sid) ?? `#${sid}`,
    inseminations: v.count,
    conceptionRate: v.known > 0 ? (v.positives / v.known) * 100 : null,
    firstServiceCR: v.firstSvcTotal > 0 ? (v.firstSvcPos / v.firstSvcTotal) * 100 : null,
    servicesPerConception: v.positives > 0 ? v.count / v.positives : null,
    pregnancyLossRate: v.lossDen > 0 ? (v.loss / v.lossDen) * 100 : null,
    // Future-proof columns — no data source yet.
    daughterCount: null,
    femaleCalfPct: null,
    maleCalfPct: null,
    abortionPct: null,
  }));
  semenRowsAll.sort((a, b) => b.inseminations - a.inseminations);
  const semenRows = semenRowsAll.slice(0, 15);

  return {
    kpis,
    funnel: {
      eligible: eligibleSet.size,
      heat: heatSet.size,
      service: serviceSet.size,
      pregnancyTest: testSet.size,
      pregnant: pregnantSet.size,
    },
    openDaysDistribution,
    trend,
    parityRows,
    groupRows,
    protocolRows,
    semenRows,
  };
}
