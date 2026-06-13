// Shared types & helpers for the breeding workflow module.

export const WORKFLOW_CATEGORIES: { id: number; label: string }[] = [
  { id: 0, label: "همه دام‌ها" },
  { id: 1, label: "گاو شیری" },
  { id: 2, label: "تلیسه" },
  { id: 3, label: "نر" },
];

export const categoryLabel = (id: number | null | undefined) =>
  WORKFLOW_CATEGORIES.find((c) => c.id === id)?.label ?? "—";

export type ConditionType =
  | "Weight"
  | "MilkRecord"
  | "PregnancyDays"
  | "FertilityStatus"
  | "Sync"
  | "Erotic"
  | "Inoculation"
  | "Birth"
  | "DateOfBirth"
  | "DateOfPregnancy"
  | "IsPregnancy"
  | "IsDry";

export const CONDITION_TYPES: { type: ConditionType; label: string; kind: "range" | "bool" | "fertilityStatus" | "milkRecord" | "days" }[] = [
  { type: "Weight", label: "وزن (کیلوگرم)", kind: "range" },
  { type: "MilkRecord", label: "رکورد شیر", kind: "milkRecord" },
  { type: "PregnancyDays", label: "روزهای آبستنی", kind: "range" },
  { type: "FertilityStatus", label: "وضعیت باروری", kind: "fertilityStatus" },
  { type: "Sync", label: "همزمان‌سازی فحلی", kind: "bool" },
  { type: "Erotic", label: "فحلی (روز از آخرین)", kind: "days" },
  { type: "Inoculation", label: "تلقیح (روز از آخرین)", kind: "days" },
  { type: "Birth", label: "زایش (روز از آخرین)", kind: "days" },
  { type: "DateOfBirth", label: "تاریخ تولد (روز)", kind: "range" },
  { type: "DateOfPregnancy", label: "تاریخ آبستنی (روز)", kind: "range" },
  { type: "IsPregnancy", label: "آبستن است", kind: "bool" },
  { type: "IsDry", label: "خشک است", kind: "bool" },
];

export const conditionLabel = (t: string) =>
  CONDITION_TYPES.find((c) => c.type === t)?.label ?? t;

export const PREGNANCY_STATE_BADGE: Record<string, { label: string; cls: string }> = {
  pregnant: { label: "آبستن", cls: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  open: { label: "باز", cls: "bg-rose-100 text-rose-700 border-rose-200" },
  suspect: { label: "مشکوک", cls: "bg-amber-100 text-amber-700 border-amber-200" },
  unknown: { label: "نامشخص", cls: "bg-muted text-muted-foreground border-border" },
};

export const MILKING_STATE_BADGE: Record<string, { label: string; cls: string }> = {
  dry: { label: "خشک", cls: "bg-amber-100 text-amber-700 border-amber-200" },
  milking: { label: "شیرده", cls: "bg-blue-100 text-blue-700 border-blue-200" },
  unknown: { label: "نامشخص", cls: "bg-muted text-muted-foreground border-border" },
};

export const ALERT_STATUS_LABEL: Record<string, string> = {
  open: "باز",
  done: "انجام‌شده",
  cancelled: "لغو شده",
  expired: "منقضی",
};
