// =============================================================================
// Check Management — shared types, enums, labels and business helpers.
// -----------------------------------------------------------------------------
// All UI components import these constants instead of hard-coding Persian
// strings or status logic inline. This keeps wording, allowed transitions and
// visual treatment consistent across every checks screen.
// =============================================================================

// ---- Domain enums (mirror the Postgres enums in the migration) -------------
// Direction is the cash-flow side: a check we received vs. a check we issued.
export type CheckDirection = "received" | "payable";

// Category was added in the auto-posting migration. It tells the system
// whether a check is a real financial instrument (operational) or just
// a tracking record (guarantee/cancelled). Only `operational` checks
// generate accounting vouchers.
export type CheckCategory = "operational" | "guarantee" | "cancelled";

// `active`, `returned`, `claimed`, `expired`, `cancelled` are the new statuses
// reserved for guarantee and cancelled checks. Operational checks still use
// the original lifecycle (received/issued/cleared/bounced/voided/lost).
export type CheckStatus =
  | "draft"
  | "received"
  | "in_cashbox"
  | "deposited_to_bank"
  | "transferred_to_party"
  | "issued"
  | "delivered"
  | "cleared"
  | "bounced"
  | "voided"
  | "lost"
  | "active"
  | "returned"
  | "claimed"
  | "expired"
  | "cancelled";

// Events come from the DB enum and include new entries the voucher-posting
// trigger writes (`voucher_posted`, `voucher_reversed`, etc.).
export type CheckEventType =
  | "received"
  | "issued"
  | "deposited_to_bank"
  | "transferred_to_party"
  | "delivered"
  | "cleared"
  | "bounced"
  | "voided"
  | "marked_lost"
  | "party_effect_posted"
  | "bank_effect_posted"
  | "note"
  | "status_change"
  | "voucher_posted"
  | "voucher_reversed"
  | "guarantee_claimed"
  | "guarantee_returned"
  | "cancelled";

export type CheckbookLeafStatus =
  | "available"
  | "issued"
  | "cleared"
  | "bounced"
  | "voided"
  | "lost";

// ---- Persian display labels -------------------------------------------------
// Centralised so every table/badge reads the same wording the form uses.
export const DIRECTION_LABEL: Record<CheckDirection, string> = {
  received: "دریافتی",
  payable: "پرداختی",
};

// Human-readable name for each category — used in headings and detail dialog.
export const CATEGORY_LABEL: Record<CheckCategory, string> = {
  operational: "عملیاتی",
  guarantee: "ضمانتی",
  cancelled: "ابطالی",
};

export const STATUS_LABEL: Record<CheckStatus, string> = {
  draft: "پیش‌نویس",
  received: "دریافت‌شده",
  in_cashbox: "در صندوق",
  deposited_to_bank: "واریز به بانک",
  transferred_to_party: "خرج‌شده به ذینفع",
  issued: "صادر شده",
  delivered: "تحویل شده",
  cleared: "پاس شده",
  bounced: "برگشت خورده",
  voided: "ابطال شده",
  lost: "مفقود",
  // Guarantee / cancelled lifecycle:
  active: "فعال",
  returned: "بازگشتی",
  claimed: "ضبط شده",
  expired: "منقضی",
  cancelled: "ابطال",
};

export const EVENT_LABEL: Record<CheckEventType, string> = {
  received: "ثبت چک دریافتی",
  issued: "صدور چک",
  deposited_to_bank: "واریز به بانک",
  transferred_to_party: "خرج چک به ذینفع",
  delivered: "تحویل به ذینفع",
  cleared: "پاس شدن",
  bounced: "برگشت چک",
  voided: "ابطال",
  marked_lost: "اعلام مفقودی",
  party_effect_posted: "اثر طرف حساب ثبت شد",
  bank_effect_posted: "اثر بانک ثبت شد",
  note: "یادداشت",
  status_change: "تغییر وضعیت",
  voucher_posted: "سند حسابداری صادر شد",
  voucher_reversed: "سند حسابداری معکوس صادر شد",
  guarantee_claimed: "چک ضمانتی ضبط شد",
  guarantee_returned: "چک ضمانتی بازگشت داده شد",
  cancelled: "ثبت ابطال",
};

export const LEAF_STATUS_LABEL: Record<CheckbookLeafStatus, string> = {
  available: "آزاد",
  issued: "صادر شده",
  cleared: "پاس شده",
  bounced: "برگشت خورده",
  voided: "ابطال شده",
  lost: "مفقود",
};

// ---- Status colour tones (Tailwind classes on semantic tokens) -------------
// We keep one mapping for table badges so colours stay consistent. New
// guarantee/cancelled statuses reuse the existing semantic palette so the
// dark theme stays cohesive.
export const STATUS_TONE: Record<CheckStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  received: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  in_cashbox: "bg-indigo-500/15 text-indigo-400 border-indigo-500/30",
  deposited_to_bank: "bg-cyan-500/15 text-cyan-400 border-cyan-500/30",
  transferred_to_party: "bg-violet-500/15 text-violet-400 border-violet-500/30",
  issued: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  delivered: "bg-sky-500/15 text-sky-400 border-sky-500/30",
  cleared: "bg-primary/15 text-primary border-primary/30",
  bounced: "bg-destructive/15 text-destructive border-destructive/30",
  voided: "bg-muted text-muted-foreground border-border",
  lost: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  active: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  returned: "bg-muted text-muted-foreground border-border",
  claimed: "bg-destructive/15 text-destructive border-destructive/30",
  expired: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  cancelled: "bg-destructive/15 text-destructive border-destructive/30",
};

// ---- Allowed transitions ----------------------------------------------------
// Mirrors the DB guard so the UI only shows action buttons that will succeed.
// Keys are current status. Values list possible next statuses for that
// direction. The action button labels rely on this map to render only the
// valid set per row.
type Transition = { to: CheckStatus; action: CheckAction; label: string };

export type CheckAction =
  | "deposit"
  | "transfer_to_party"
  | "clear"
  | "bounce"
  | "void"
  | "mark_lost"
  | "deliver"
  | "return_guarantee"
  | "claim_guarantee"
  | "expire_guarantee";

const RECEIVED_TX: Partial<Record<CheckStatus, Transition[]>> = {
  received: [
    { to: "in_cashbox", action: "deposit", label: "انتقال به صندوق" },
    { to: "deposited_to_bank", action: "deposit", label: "واریز به بانک" },
    { to: "transferred_to_party", action: "transfer_to_party", label: "خرج به ذینفع" },
    { to: "cleared", action: "clear", label: "ثبت پاس شدن" },
    { to: "bounced", action: "bounce", label: "ثبت برگشت" },
    { to: "voided", action: "void", label: "ابطال" },
  ],
  in_cashbox: [
    { to: "deposited_to_bank", action: "deposit", label: "واریز به بانک" },
    { to: "transferred_to_party", action: "transfer_to_party", label: "خرج به ذینفع" },
    { to: "voided", action: "void", label: "ابطال" },
  ],
  deposited_to_bank: [
    { to: "cleared", action: "clear", label: "ثبت پاس شدن" },
    { to: "bounced", action: "bounce", label: "ثبت برگشت" },
  ],
  transferred_to_party: [
    { to: "cleared", action: "clear", label: "ثبت پاس شدن" },
    { to: "bounced", action: "bounce", label: "ثبت برگشت" },
  ],
};

const PAYABLE_TX: Partial<Record<CheckStatus, Transition[]>> = {
  draft: [
    { to: "issued", action: "deliver", label: "صدور چک" },
    { to: "voided", action: "void", label: "ابطال" },
  ],
  issued: [
    { to: "delivered", action: "deliver", label: "تحویل به ذینفع" },
    { to: "cleared", action: "clear", label: "ثبت پاس شدن" },
    { to: "bounced", action: "bounce", label: "ثبت برگشت" },
    { to: "voided", action: "void", label: "ابطال" },
    { to: "lost", action: "mark_lost", label: "اعلام مفقودی" },
  ],
  delivered: [
    { to: "cleared", action: "clear", label: "ثبت پاس شدن" },
    { to: "bounced", action: "bounce", label: "ثبت برگشت" },
    { to: "lost", action: "mark_lost", label: "اعلام مفقودی" },
  ],
};

// Guarantee checks share the same transitions for received and payable —
// their lifecycle is independent of direction.
const GUARANTEE_TX: Partial<Record<CheckStatus, Transition[]>> = {
  active: [
    { to: "returned", action: "return_guarantee", label: "بازگشت ضمانت" },
    { to: "claimed", action: "claim_guarantee", label: "ضبط ضمانت" },
    { to: "expired", action: "expire_guarantee", label: "ثبت انقضا" },
    { to: "voided", action: "void", label: "ابطال" },
  ],
  returned: [
    { to: "voided", action: "void", label: "ابطال" },
  ],
};

export function allowedTransitions(
  direction: CheckDirection,
  status: CheckStatus,
  category: CheckCategory = "operational",
): Transition[] {
  // Cancelled checks are immutable; guarantee checks have their own map.
  if (category === "cancelled") return [];
  if (category === "guarantee") return GUARANTEE_TX[status] ?? [];
  const map = direction === "received" ? RECEIVED_TX : PAYABLE_TX;
  return map[status] ?? [];
}

// Terminal statuses can't be acted on further — used to disable buttons.
// We include the new guarantee/cancelled terminal states so detail dialog
// hides actions automatically.
export const TERMINAL_STATUSES: CheckStatus[] = [
  "cleared", "voided", "lost",
  "claimed", "expired", "cancelled",
];

// ---- Cancellation reasons ---------------------------------------------------
// Mirrors the DB CHECK constraint on finance_checks.cancel_reason. The label
// is shown in dropdowns and the detail dialog.
export const CANCEL_REASONS = [
  { value: "wrong_entry", label: "اشتباه در ثبت" },
  { value: "wrong_amount", label: "اشتباه در مبلغ" },
  { value: "wrong_beneficiary", label: "اشتباه در ذینفع" },
  { value: "damaged", label: "چک مخدوش" },
  { value: "lost", label: "چک مفقودی" },
  { value: "replaced", label: "جایگزینی با چک جدید" },
  { value: "other", label: "سایر" },
] as const;

export type CancelReason = (typeof CANCEL_REASONS)[number]["value"];

export const CANCEL_REASON_LABEL: Record<CancelReason, string> =
  Object.fromEntries(CANCEL_REASONS.map((r) => [r.value, r.label])) as Record<CancelReason, string>;

// ---- Party / bank label helpers --------------------------------------------
// Small pure functions so every screen formats parties and banks identically.
export function partyLabel(p?: {
  first_name?: string | null;
  last_name?: string | null;
  company_name?: string | null;
} | null): string {
  if (!p) return "—";
  // Company name takes precedence for legal entities; otherwise full name.
  if (p.company_name) return p.company_name;
  const full = `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim();
  return full || "—";
}

export function bankLabel(b?: { title?: string | null; bank_name?: string | null } | null): string {
  if (!b) return "—";
  return b.title || b.bank_name || "—";
}
