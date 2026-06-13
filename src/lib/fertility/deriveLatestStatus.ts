// =============================================================================
// deriveLatestStatus
// -----------------------------------------------------------------------------
// Computes "آخرین وضعیت باروری" (the most recent fertility status id) directly
// from a cow's `livestock_fertility_events` rows, instead of trusting the
// cached `cows.last_fertility_status` field — which is frequently stale or
// NULL for animals whose events were imported without `fertility_operation_id`.
//
// Strategy (mirrors the SQL `rebuild_cow_fertility_cache` function so the
// derived value matches what the backend would compute if its cache were
// rebuilt right now):
//   1. Walk events newest → oldest (caller is expected to pre-sort).
//   2. Prefer the explicit `fertility_status_id` on the paired status row.
//   3. For pregnancy_test rows with no paired status, infer from the result
//      text (مثبت اولیه / تکمیلی / نهایی, منفی, مشکوک).
//   4. Otherwise fall back to an implied status keyed by event_type (heat→2,
//      insemination→3, abortion→9, calving→12 …).
//   5. If nothing matches, return the supplied `fallback` (cached cow row).
// =============================================================================

import type { FertilityEvent } from "@/lib/fertility";

// Result returned to the caller — `event` is null when we had to use the
// fallback cached value (so the UI can hide the "date of status" line).
export interface DerivedLatestStatus {
  id: number;
  event: FertilityEvent | null;
}

// Implied status mapping by event_type. Kept in sync with the CASE expression
// inside `rebuild_cow_fertility_cache` (Postgres function defined in this
// project) so the frontend stays consistent with the backend cache rebuild.
const IMPLIED_STATUS: Record<string, number> = {
  heat: 2,
  insemination: 3,
  abortion: 9,
  calving: 12,
  dry_off: 10,
  rinse: 14,
  clean_test: 15,
  synchronization: 21,
  sync_detail: 21,
};

// Heuristic mapping from a pregnancy_test result string → fertility status id.
// Pregnancy tests are sometimes imported without the paired status row, so we
// recover the status from the human-readable result field where possible.
function inferFromPregnancyResult(result: string): number | null {
  // Order matters: more specific phrases first so "تکمیلی مثبت" doesn't get
  // shadowed by the generic "مثبت" branch below.
  if (/تکمیلی.*مثبت/.test(result)) return 18;
  if (/تکمیلی.*منفی/.test(result)) return 17;
  if (/نهایی.*مثبت|آبستن قطعی/.test(result)) return 8;
  if (/نهایی.*منفی/.test(result)) return 7;
  if (/خشکی.*مثبت/.test(result)) return 20;
  if (/خشکی.*منفی/.test(result)) return 19;
  if (/مشکوک/.test(result)) return 5;
  if (/اولیه.*مثبت|مثبت/.test(result)) return 4;
  if (/اولیه.*منفی|منفی/.test(result)) return 6;
  return null;
}

/**
 * Walk a chronologically sorted (newest first) array of fertility events and
 * return the freshest fertility status id, or `null` if neither the events
 * nor the cached `fallback` yielded anything usable.
 */
export function deriveLatestStatus(
  events: FertilityEvent[],
  fallback?: number | null,
): DerivedLatestStatus | null {
  for (const e of events) {
    // 1) Explicit status id on the paired `fertility_status` row — this is the
    //    authoritative value when present and always wins.
    const explicit =
      (e as any).fertility_status_id ?? (e as any).status_code ?? null;
    if (explicit != null) return { id: explicit as number, event: e };

    // 2) pregnancy_test rows often have NULL status; infer from result text.
    //    Note: the importer aliases `pregnancy_check` → `pregnancy_test`, so
    //    callers should normalise event_type before calling this helper.
    if (e.event_type === "pregnancy_test") {
      const r = (e.result ?? "").toString();
      const inferred = inferFromPregnancyResult(r);
      if (inferred != null) return { id: inferred, event: e };
      // Couldn't infer (e.g. result is a numeric code like "1"); don't fall
      // back to "implied" since pregnancy_test has no sensible implied status.
      // Skip to the next older event instead.
      continue;
    }

    // 3) Implied status from event type (heat→فحل شده, insemination→تلقیح شده…)
    const implied = IMPLIED_STATUS[e.event_type as string];
    if (implied != null) return { id: implied, event: e };
  }

  // 4) Final fallback to the cached cows.last_fertility_status value.
  if (fallback != null) return { id: fallback, event: null };
  return null;
}
