// Single source of truth for "cow is present in herd".
//
// DB reality (verified): the canonical column is cows.existancestatus.
//   0 (or NULL) → موجود در گله
//   1 → فروش
//   2 → تلفات
//   3 → کشتار
//   4 → سایر
//
// The legacy `presence_status` column is unused (always NULL) and must NOT
// be used for business logic.

export type CowPresenceFields = {
  existancestatus?: number | null;
};

export const IN_HERD_EXISTANCE_VALUES = [0, null] as const;

export function isCowPresentInHerd(cow: CowPresenceFields | null | undefined): boolean {
  if (!cow) return false;
  const v = cow.existancestatus;
  return v == null || v === 0;
}

// PostgREST .or() fragments for "in herd" — use everywhere we filter cows.
export const IN_HERD_OR_PARTS = [
  "existancestatus.is.null",
  "existancestatus.eq.0",
] as const;

export const IN_HERD_OR_STRING = IN_HERD_OR_PARTS.join(",");

// Map an existancestatus value to a Persian label (display only).
export const EXISTANCE_LABELS: Record<number, string> = {
  0: "موجود در گله",
  1: "خارج شده (فروش)",
  2: "خارج شده (تلفات)",
  3: "خارج شده (کشتار)",
  4: "خارج شده (سایر)",
};

export const existanceLabel = (v: number | null | undefined) =>
  v == null ? "موجود در گله" : EXISTANCE_LABELS[v] ?? "نامشخص";
