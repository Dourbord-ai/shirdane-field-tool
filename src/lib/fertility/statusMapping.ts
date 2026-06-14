// =============================================================================
// statusMapping.ts
// -----------------------------------------------------------------------------
// CENTRALIZED fertility outcome mapping. This module is the SINGLE SOURCE OF
// TRUTH for the question "what does this fertility_status_id mean?" and
// "is this event an insemination?".
//
// Why centralized?
//   The `fertility_statuses` table's `pregnancy_state` column is all
//   "unknown" in production data — we cannot rely on it. The actual semantics
//   live in the status IDs themselves (audit-approved). Every report that
//   needs to know "did this cow get pregnant?" MUST go through this module so
//   the day a new status id is added we change one place.
//
// Approved mapping (per audit):
//   Positive pregnancy outcomes: status_id ∈ {4, 8, 18, 20}
//     4  = تست اولیه مثبت
//     8  = آبستن قطعی (تست نهایی مثبت)
//     18 = تست تکمیلی مثبت
//     20 = تست خشکی مثبت
//   Negative pregnancy outcomes: status_id ∈ {6, 7, 17, 19}
//     6  = تست اولیه منفی
//     7  = تست نهایی منفی
//     17 = تست تکمیلی منفی
//     19 = تست خشکی منفی
//   Abortion: status_id = 9 (op 5)
//   Fresh:    status_id = 12 (op 6)
//
// Insemination canonical rule (also approved):
//   fertility_operation_id = 2
//   OR legacy_table_name = 'CowInoculations'
//   OR (fertility_operation_id IS NULL AND metadata.sperm_id present).
// =============================================================================

import type { FertilityEvent } from "@/lib/fertility";

// -----------------------------------------------------------------------------
// Exported constant arrays so callers can spread them into IN-clauses or
// React props (e.g. tooltips listing the membership).
// -----------------------------------------------------------------------------
export const PREGNANCY_POSITIVE_STATUS_IDS = [4, 8, 18, 20] as const;
export const PREGNANCY_NEGATIVE_STATUS_IDS = [6, 7, 17, 19] as const;
export const ABORTION_STATUS_ID = 9;
export const FRESH_STATUS_ID = 12;

// Fertility operation ids the project actually uses. Kept here so future
// reports don't have to hunt around the codebase for them.
export const FERTILITY_OPERATION = {
  HEAT: 1,                    // فحلی
  INSEMINATION: 2,            // تلقیح
  PREGNANCY_TEST_INITIAL: 3,  // تست آبستنی اولیه
  PREGNANCY_TEST_FINAL: 4,    // تست آبستنی نهایی
  ABORTION: 5,                // سقط
  CALVING: 6,                 // زایش
  UTERINE_FLUSH: 8,           // شستشو
  CLEAN_TEST: 10,             // کلین تست
  PREGNANCY_TEST_SUPPL: 11,   // تست آبستنی تکمیلی
  PREGNANCY_TEST_DRY: 12,     // تست آبستنی خشکی
  SYNC: 13,                   // همزمان‌سازی فحلی
} as const;

// All pregnancy-test operation ids in one array (for filtering).
export const PREGNANCY_TEST_OPERATION_IDS = [
  FERTILITY_OPERATION.PREGNANCY_TEST_INITIAL,
  FERTILITY_OPERATION.PREGNANCY_TEST_FINAL,
  FERTILITY_OPERATION.PREGNANCY_TEST_SUPPL,
  FERTILITY_OPERATION.PREGNANCY_TEST_DRY,
] as const;

// -----------------------------------------------------------------------------
// Status predicates. Each accepts a nullable id so callers can pass raw DB
// values without pre-checking.
// -----------------------------------------------------------------------------
export function isPregnancyPositive(statusId: number | null | undefined): boolean {
  // Cast through `as number[]` because TS narrows the readonly tuple too
  // strictly for `.includes` with a possibly-null value.
  return statusId != null && (PREGNANCY_POSITIVE_STATUS_IDS as readonly number[]).includes(statusId);
}

export function isPregnancyNegative(statusId: number | null | undefined): boolean {
  return statusId != null && (PREGNANCY_NEGATIVE_STATUS_IDS as readonly number[]).includes(statusId);
}

// -----------------------------------------------------------------------------
// Event predicates. These look at the WHOLE event row, not just the status,
// because the source-of-truth for "insemination" is multi-signal (audit).
// -----------------------------------------------------------------------------

// Insemination — the audit-approved canonical rule. Mirrors the one used by
// the Reproductive Action List engine (which now also re-imports this fn).
export function isInsemination(e: FertilityEvent): boolean {
  // Cancelled events never count.
  if (e.is_cancelled) return false;
  // (1) Explicit operation tag.
  if (e.fertility_operation_id === FERTILITY_OPERATION.INSEMINATION) return true;
  // (2) Imported from the legacy table.
  if (e.legacy_table_name === "CowInoculations") return true;
  // (3) Op-id-less events whose metadata clearly identifies a sperm — these
  // are inseminations recorded before the operation taxonomy existed.
  if (
    e.fertility_operation_id == null &&
    e.metadata &&
    typeof e.metadata === "object" &&
    "sperm_id" in (e.metadata as Record<string, unknown>)
  ) {
    return true;
  }
  return false;
}

// Pregnancy test event (any of the 4 op variants OR a legacy CowPregnancies row).
export function isPregnancyTest(e: FertilityEvent): boolean {
  if (e.is_cancelled) return false;
  if (e.fertility_operation_id != null &&
      (PREGNANCY_TEST_OPERATION_IDS as readonly number[]).includes(e.fertility_operation_id)) {
    return true;
  }
  if (e.legacy_table_name === "CowPregnancies") return true;
  if (e.event_type === "pregnancy_test") return true;
  return false;
}

// Heat event.
export function isHeatEvent(e: FertilityEvent): boolean {
  if (e.is_cancelled) return false;
  return (
    e.fertility_operation_id === FERTILITY_OPERATION.HEAT ||
    e.legacy_table_name === "CowErotics" ||
    e.event_type === "heat"
  );
}

// Calving event.
export function isCalvingEvent(e: FertilityEvent): boolean {
  if (e.is_cancelled) return false;
  return (
    e.fertility_operation_id === FERTILITY_OPERATION.CALVING ||
    e.legacy_table_name === "CowBirths" ||
    e.event_type === "calving"
  );
}

// Abortion event — operation id 5 OR fertility_status_id 9 OR legacy/manual.
export function isAbortionEvent(e: FertilityEvent): boolean {
  if (e.is_cancelled) return false;
  if (e.fertility_operation_id === FERTILITY_OPERATION.ABORTION) return true;
  if ((e as { fertility_status_id?: number | null }).fertility_status_id === ABORTION_STATUS_ID) return true;
  if (e.legacy_table_name === "CowAbortions") return true;
  if (e.event_type === "abortion") return true;
  return false;
}

// Classify the *outcome* of a pregnancy-test event into positive/negative/unknown,
// preferring the explicit status_id and falling back to free-text result fields
// (older data did not always set fertility_status_id).
export type PregnancyOutcome = "positive" | "negative" | "unknown";

export function classifyTestOutcome(e: FertilityEvent): PregnancyOutcome {
  const statusId = (e as { fertility_status_id?: number | null }).fertility_status_id ?? null;
  if (isPregnancyPositive(statusId)) return "positive";
  if (isPregnancyNegative(statusId)) return "negative";
  // Fallback to legacy text fields.
  const text = `${e.result ?? ""} ${(e as { result_code?: string | null }).result_code ?? ""}`.toLowerCase();
  if (/(آبستن|مثبت|pos|preg)/i.test(text)) return "positive";
  if (/(منف|neg|empty|open)/i.test(text)) return "negative";
  return "unknown";
}
