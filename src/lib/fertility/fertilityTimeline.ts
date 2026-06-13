// =============================================================================
// fertilityTimeline.ts
// -----------------------------------------------------------------------------
// Turns a raw list of `livestock_fertility_events` rows into a chronologically
// sorted timeline split into reproductive cycles, and computes per-event
// enrichment (cycle #, gap from previous, outcome, linked insemination, etc.)
// that the UI tabs need.
//
// All math operates on parsed Dates from fertilityCalculations.ts. Cached cow
// fields are NEVER read here — this layer is the single source of truth.
// =============================================================================

import { FertilityEvent } from "@/lib/fertility";
import {
  parseEventDate,
  daysBetween,
  classifyHeatCycle,
  classifyPregTestTiming,
  classifyAbortion,
  type PregTestTiming,
  type HeatCycleClass,
  type AbortionClass,
} from "./fertilityCalculations";

// -----------------------------------------------------------------------------
// EnrichedEvent — every event paired with derived per-row data the UI shows.
// `linkedInseminationId` is the most-recent insemination *before* this event
// (used for pregnancy_test/calving/abortion linkage). `aiOutcome` is meaningful
// only for insemination rows.
// -----------------------------------------------------------------------------
export type AIOutcome = "pregnant" | "failed" | "unknown";

export interface EnrichedEvent {
  event: FertilityEvent;
  date: Date | null;                       // Parsed event_date
  cycleIndex: number;                      // 0 = oldest cycle, N = current
  // --- insemination-specific ---
  aiNumberInCycle?: number;                // 1-based position among AIs in the cycle
  daysFromPrevAI?: number | null;          // Gap from the previous AI in same cycle
  aiOutcome?: AIOutcome;                   // Derived from following events
  // --- pregnancy_test / calving / abortion linkage ---
  linkedInseminationId?: string | null;    // FK to insemination event id
  linkedInseminationDate?: Date | null;
  daysAfterLinkedAI?: number | null;       // For test timing badge / gestation length
  pregTestTiming?: PregTestTiming;
  abortionFollowed?: boolean;              // For pregnancy_test rows: did a سقط follow?
  abortionClass?: AbortionClass;           // For abortion rows
  // --- heat-specific ---
  heatNumberInCycle?: number;
  daysFromPrevHeat?: number | null;
  heatCycleClass?: HeatCycleClass;
  daysToNextAI?: number | null;
}

// -----------------------------------------------------------------------------
// Cycle — a contiguous segment of the reproductive timeline. Cycle boundaries
// are calving (operation 6) and abortion (operation 5). The *current* cycle is
// always the last one in the array.
// -----------------------------------------------------------------------------
export interface Cycle {
  startDate: Date | null;                  // Date of the calving/abortion that opened the cycle (null for first cycle)
  startEventType: string | null;           // "calving" | "abortion" | null
  events: EnrichedEvent[];                 // In ascending date order
}

export interface FertilityTimeline {
  /** All events in ASCENDING date order, fully enriched. */
  all: EnrichedEvent[];
  /** Cycles split at calving/abortion boundaries. */
  cycles: Cycle[];
  /** Convenience: the active cycle (the last entry of `cycles`). */
  current: Cycle | null;
  /** Reverse-chronological list of calving events (for parity counts). */
  calvings: EnrichedEvent[];
}

// -----------------------------------------------------------------------------
// sortAscending — newest-first arrives from the DB; we re-sort to ascending
// because every cycle/linkage calculation walks forward through history.
// Falls back to event_time, then created_at for tie-breaking.
// -----------------------------------------------------------------------------
function sortAscending(events: FertilityEvent[]): FertilityEvent[] {
  return [...events].sort((a, b) => {
    const ad = parseEventDate(a.event_date)?.getTime() ?? 0;
    const bd = parseEventDate(b.event_date)?.getTime() ?? 0;
    if (ad !== bd) return ad - bd;
    const at = (a as any).event_time ?? "";
    const bt = (b as any).event_time ?? "";
    if (at !== bt) return at < bt ? -1 : 1;
    return (a.created_at ?? "").localeCompare(b.created_at ?? "");
  });
}

// -----------------------------------------------------------------------------
// buildTimeline — main entry point. Given a cow's full event history, returns
// the structured FertilityTimeline used by every UI surface and the risk
// engine. Cancelled events are filtered out — they do not affect reproductive
// state.
// -----------------------------------------------------------------------------
export function buildTimeline(rawEvents: FertilityEvent[]): FertilityTimeline {
  // 1) Drop cancelled rows and sort oldest-first so we can walk forward.
  const active = sortAscending(rawEvents.filter((e) => !e.is_cancelled));

  // 2) Wrap each row in an EnrichedEvent shell — cycleIndex filled below.
  const enriched: EnrichedEvent[] = active.map((event) => ({
    event,
    date: parseEventDate(event.event_date),
    cycleIndex: 0,
  }));

  // 3) Split into cycles. A calving or abortion CLOSES the current cycle and
  //    OPENS a new one anchored at that event date. The first cycle starts
  //    open (no anchor) until the first calving/abortion appears.
  const cycles: Cycle[] = [{ startDate: null, startEventType: null, events: [] }];
  for (const ee of enriched) {
    const idx = cycles.length - 1;
    ee.cycleIndex = idx;
    cycles[idx].events.push(ee);
    if (ee.event.event_type === "calving" || ee.event.event_type === "abortion") {
      // Open the next cycle anchored at this terminator.
      cycles.push({
        startDate: ee.date,
        startEventType: ee.event.event_type,
        events: [],
      });
    }
  }

  // 4) Per-row enrichment within each cycle.
  for (const cycle of cycles) {
    const ais = cycle.events.filter((e) => e.event.event_type === "insemination");
    const heats = cycle.events.filter((e) => e.event.event_type === "heat");

    // ---- Inseminations: number, gap from prev, outcome ----------------------
    ais.forEach((ai, i) => {
      ai.aiNumberInCycle = i + 1;
      ai.daysFromPrevAI = i === 0 ? null : daysBetween(ais[i - 1].date, ai.date);

      // Outcome derivation: look at events that come AFTER this AI within the
      // same cycle. If a subsequent pregnancy_test marks آبستن, OR the cycle
      // ends in calving — this AI succeeded. If a later AI exists in the same
      // cycle, this one is failed. Otherwise unknown.
      const afterIdx = cycle.events.indexOf(ai) + 1;
      const after = cycle.events.slice(afterIdx);
      let outcome: AIOutcome = "unknown";
      const laterAI = after.find((x) => x.event.event_type === "insemination");
      const positiveTest = after.find(
        (x) =>
          x.event.event_type === "pregnancy_test" &&
          // result text or result_code hinting at positive pregnancy
          (/(آبستن|مثبت|pos|preg)/i.test(x.event.result ?? "") ||
            /(pos|preg|1)/i.test(((x.event as any).result_code ?? "") + ""))
      );
      // Cycle terminator: if THIS cycle ended in calving the *last* AI before
      // it is the one that led to calving.
      const isLastAIBeforeTerminator =
        ai === ais[ais.length - 1] &&
        (cycle === cycles[cycles.length - 1] ? false : true);

      if (positiveTest || isLastAIBeforeTerminator) outcome = "pregnant";
      else if (laterAI) outcome = "failed";
      ai.aiOutcome = outcome;
    });

    // ---- Heats: number, gap from prev, cycle class, days to next AI ---------
    heats.forEach((heat, i) => {
      heat.heatNumberInCycle = i + 1;
      heat.daysFromPrevHeat = i === 0 ? null : daysBetween(heats[i - 1].date, heat.date);
      heat.heatCycleClass = classifyHeatCycle(heat.daysFromPrevHeat);
      // Next AI in this cycle after this heat
      const nextAI = ais.find((a) => (a.date?.getTime() ?? 0) > (heat.date?.getTime() ?? 0));
      heat.daysToNextAI = nextAI ? daysBetween(heat.date, nextAI.date) : null;
    });

    // ---- Linkage for pregnancy_test / calving / abortion --------------------
    cycle.events.forEach((ee) => {
      if (!["pregnancy_test", "calving", "abortion"].includes(ee.event.event_type)) return;
      // Most recent AI strictly before this event.
      const prevAI = [...ais]
        .reverse()
        .find((a) => (a.date?.getTime() ?? 0) <= (ee.date?.getTime() ?? 0));
      ee.linkedInseminationId = prevAI?.event.id ?? null;
      ee.linkedInseminationDate = prevAI?.date ?? null;
      ee.daysAfterLinkedAI = daysBetween(prevAI?.date ?? null, ee.date);
      if (ee.event.event_type === "pregnancy_test") {
        ee.pregTestTiming = classifyPregTestTiming(ee.daysAfterLinkedAI ?? null);
        // Did an abortion follow this test within the same cycle?
        const afterIdx = cycle.events.indexOf(ee) + 1;
        ee.abortionFollowed = cycle.events
          .slice(afterIdx)
          .some((x) => x.event.event_type === "abortion");
      }
      if (ee.event.event_type === "abortion") {
        ee.abortionClass = classifyAbortion(ee.daysAfterLinkedAI ?? null);
      }
    });
  }

  // 5) Final convenience selectors.
  const calvings = enriched
    .filter((e) => e.event.event_type === "calving")
    .reverse();

  return {
    all: enriched,
    cycles,
    current: cycles[cycles.length - 1] ?? null,
    calvings,
  };
}
