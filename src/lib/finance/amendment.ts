// =============================================================================
// lib/finance/amendment.ts
// -----------------------------------------------------------------------------
// Types, constants and pure helpers for the Factor Amendment (اصلاح فاکتور) flow.
// =============================================================================

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export type AmendmentStatus =
  | "draft"      // پیش‌نویس — در حال ویرایش
  | "review"     // ارسال شده — در انتظار بررسی مدیر
  | "approved"   // تأیید شده
  | "rejected";  // رد شده

export const AMENDMENT_STATUS_LABEL: Record<AmendmentStatus, string> = {
  draft:    "پیش‌نویس",
  review:   "در انتظار بررسی",
  approved: "تأیید شده",
  rejected: "رد شده",
};

export const AMENDMENT_STATUS_COLOR: Record<AmendmentStatus, string> = {
  draft:    "bg-gray-100 text-gray-700",
  review:   "bg-yellow-100 text-yellow-700",
  approved: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
};

// ---------------------------------------------------------------------------
// Row Interfaces
// ---------------------------------------------------------------------------

export interface AmendmentItemRow {
  id: string;
  amendment_id: string;
  factor_item_id: string | null;   // null = آیتم جدید
  action: "keep" | "update" | "delete" | "add";
  product_type: string;
  quantity: number;
  unit: string | null;
  unit_price: number;
  discount_amount: number;
  tax_amount: number;
  total_amount: number;
  description: string | null;
  account_code: string | null;
  cost_center: string | null;
  // مقادیر قبل از اصلاح (فقط برای action=update)
  original_quantity: number | null;
  original_unit_price: number | null;
  original_total_amount: number | null;
}

export interface AmendmentRow {
  id: string;
  factor_id: string;
  status: AmendmentStatus;
  reason: string;
  requested_by: string | null;
  requested_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  rejection_reason: string | null;
  reversal_voucher_id: string | null;
  new_voucher_id: string | null;
  created_at: string;
  updated_at: string;
  // JOIN
  items?: AmendmentItemRow[];
  factor?: {
    invoice_number: string | null;
    invoice_type: string;
    total_amount: number | null;
    lifecycle_state: string | null;
  } | null;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** محاسبه مجموع مبلغ آیتم‌های اصلاح‌شده */
export function calcAmendmentTotal(items: AmendmentItemRow[]): number {
  return items
    .filter((i) => i.action !== "delete")
    .reduce((sum, i) => sum + i.total_amount, 0);
}

/** اختلاف مبلغ بین فاکتور اصلی و نسخه اصلاح‌شده */
export function calcAmendmentDiff(
  originalTotal: number,
  items: AmendmentItemRow[]
): number {
  return calcAmendmentTotal(items) - originalTotal;
}

/** آیا این فاکتور قابل اصلاح است؟ */
export function canAmend(lifecycleState: string | null): boolean {
  return lifecycleState === "approved";
}

