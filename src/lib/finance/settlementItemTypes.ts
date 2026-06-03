/**
 * Phase 3 — Settlement (درخواست تسویه) item shared types & constants.
 *
 * The database table `finance_payment_request_items` was extended in Phase 3
 * with ten new nullable columns. Supabase's auto-generated `types.ts` already
 * exposes those columns to the rest of the app, so this file does NOT
 * redeclare a Row type. Instead, it centralizes:
 *
 *   1) The allowed string-literal unions for the new whitelist columns, so
 *      Phase-4 forms/editors can be strictly typed without re-reading the
 *      migration.
 *   2) Persian display labels for each value so UI components can render
 *      consistent text everywhere.
 *   3) A tiny `isLegacyItem` helper that the existing PR detail UI can use to
 *      visually mark pre-Phase-3 rows as «روش قدیمی» without forcing the user
 *      to pick a new payment method retroactively.
 *
 * NOTE: This module intentionally contains no runtime logic that touches
 * the database, no business rules, and no accounting/voucher calls — it is
 * pure metadata that helps the UI stay in lock-step with the DB whitelist.
 */

// -----------------------------------------------------------------------------
// 1) Allowed values mirrored from the CHECK constraints in the Phase-3
// migration (chk_fpri_payment_method / chk_fpri_subject_type / etc.). Keep
// these arrays in the SAME order as the migration so a future audit can be
// done visually.
// -----------------------------------------------------------------------------

/** Payment method whitelist. `legacy` flags pre-Phase-3 rows. */
export const PAYMENT_METHODS = [
  "legacy",        // Historical rows where the original method is unknown.
  "bank_transfer", // Money moved between bank accounts.
  "cashbox",       // Cash paid from a physical cashbox (صندوق).
  "check",         // Paper or electronic check.
  "barter",        // Goods/services exchange instead of money (پایاپای).
  "deferred",      // Promised future settlement with no instrument yet.
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** What the settlement item is paying for. */
export const SETTLEMENT_SUBJECT_TYPES = [
  "main_invoice", // The principal invoice amount.
  "freight",      // کرایه حمل
  "waybill",      // بارنامه
  "unloading",    // تخلیه
  "loading",      // بارگیری
  "weighing",     // باسکول/توزین
  "storage",      // انبارداری
  "commission",   // کمیسیون / دلالی
  "service",      // خدمات متفرقه
  "misc",         // سایر
] as const;
export type SettlementSubjectType = (typeof SETTLEMENT_SUBJECT_TYPES)[number];

/** Execution lifecycle (independent of approval status). */
export const EXECUTION_STATUSES = [
  "pending",     // در انتظار اجرا
  "in_progress", // در حال انجام
  "executed",    // انجام شده
  "cancelled",   // لغو شده
] as const;
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];

/** Liquidity-planning priority. Stored as smallint 1..4 in the DB. */
export const EXECUTION_PRIORITIES = [1, 2, 3, 4] as const;
export type ExecutionPriority = (typeof EXECUTION_PRIORITIES)[number];

// -----------------------------------------------------------------------------
// 2) Persian display labels — co-located with the constants so adding a new
// enum value forces the dev to add its label here as well (TypeScript will
// complain about a missing key thanks to the Record<…> type).
// -----------------------------------------------------------------------------

export const PAYMENT_METHOD_LABELS_FA: Record<PaymentMethod, string> = {
  legacy: "روش قدیمی / نامشخص",
  bank_transfer: "انتقال بانکی",
  cashbox: "صندوق",
  check: "چک",
  barter: "پایاپای",
  deferred: "تسویه بعدی",
};

export const SETTLEMENT_SUBJECT_LABELS_FA: Record<SettlementSubjectType, string> = {
  main_invoice: "اصل فاکتور",
  freight: "کرایه حمل",
  waybill: "بارنامه",
  unloading: "تخلیه",
  loading: "بارگیری",
  weighing: "توزین (باسکول)",
  storage: "انبارداری",
  commission: "کمیسیون / دلالی",
  service: "خدمات",
  misc: "سایر",
};

export const EXECUTION_STATUS_LABELS_FA: Record<ExecutionStatus, string> = {
  pending: "در انتظار اجرا",
  in_progress: "در حال انجام",
  executed: "اجرا شده",
  cancelled: "لغو شده",
};

export const EXECUTION_PRIORITY_LABELS_FA: Record<ExecutionPriority, string> = {
  1: "فوری",
  2: "بالا",
  3: "عادی",
  4: "پایین",
};

// -----------------------------------------------------------------------------
// 3) Tiny helpers consumed by the existing settlement detail UI in Phase 3.
// We expose them now so any list/detail component can opt-in immediately
// without waiting for Phase 4.
// -----------------------------------------------------------------------------

/**
 * Returns true when the item was created before Phase 3 (i.e. it carries the
 * `legacy` payment method backfilled via the migration's instant-default).
 *
 * The check is null-safe so brand-new rows that haven't picked a method yet
 * are NOT misclassified as legacy.
 */
export function isLegacyItem(item: { payment_method?: string | null }): boolean {
  return item?.payment_method === "legacy";
}

/**
 * Safe label lookup. Falls back to the raw value if the DB ever returns
 * something not in our whitelist (defensive — the CHECK constraint prevents
 * this for new rows but legacy data could theoretically be anything).
 */
export function labelForPaymentMethod(value: string | null | undefined): string {
  if (!value) return "—";
  return (PAYMENT_METHOD_LABELS_FA as Record<string, string>)[value] ?? value;
}

export function labelForSubjectType(value: string | null | undefined): string {
  if (!value) return "—";
  return (SETTLEMENT_SUBJECT_LABELS_FA as Record<string, string>)[value] ?? value;
}

export function labelForExecutionStatus(value: string | null | undefined): string {
  if (!value) return "—";
  return (EXECUTION_STATUS_LABELS_FA as Record<string, string>)[value] ?? value;
}

export function labelForExecutionPriority(value: number | null | undefined): string {
  if (value == null) return "—";
  return (EXECUTION_PRIORITY_LABELS_FA as Record<number, string>)[value] ?? String(value);
}
