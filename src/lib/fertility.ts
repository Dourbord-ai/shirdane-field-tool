// Fertility domain helpers for livestock profile

export type FertilityEventType =
  | "heat"
  | "insemination"
  | "pregnancy_test"
  | "calving"
  | "abortion"
  | "dry_off"
  | "clean_test"
  | "rinse"
  | "prescription"
  | "synchronization"
  | "sync_detail"
  | "fertility_status";

export type FertilityEvent = {
  id: string;
  livestock_id: number;
  event_type: FertilityEventType | string;
  event_date: string | null;
  status_code: number | null;
  result: string | null;
  operator_user_id: number | null;
  operator_name: string | null;
  notes: string | null;
  metadata: Record<string, unknown> | null;
  legacy_table_name: string | null;
  legacy_record_id: number | null;
  created_at: string;
};

export const FERTILITY_EVENT_LABELS: Record<string, string> = {
  heat: "فحلی",
  insemination: "تلقیح",
  pregnancy_test: "تست آبستنی",
  calving: "زایش",
  abortion: "سقط",
  dry_off: "خشک کردن",
  clean_test: "کلین تست",
  rinse: "شستشو",
  prescription: "درمان / نسخه",
  synchronization: "همزمان‌سازی فحلی",
  sync_detail: "تزریق همزمان‌سازی",
  fertility_status: "تغییر وضعیت باروری",
};

export const fertilityEventLabel = (t: string | null | undefined) =>
  (t && FERTILITY_EVENT_LABELS[t]) || t || "—";

export const LEGACY_TABLE_TO_EVENT: Record<string, FertilityEventType> = {
  CowErotics: "heat",
  CowInoculations: "insemination",
  CowPregnancies: "pregnancy_test",
  CowBirths: "calving",
  CowAbortions: "abortion",
  CowDreis: "dry_off",
  CowCleanTests: "clean_test",
  CowRinses: "rinse",
  CowPrescriptions: "prescription",
  CowSyncs: "synchronization",
  CowSyncDetails: "sync_detail",
  CowFertilityStatuses: "fertility_status",
};

export const eventBadgeClass = (t: string | null | undefined) => {
  switch (t) {
    case "heat":
      return "bg-pink-100 text-pink-700 border-pink-200";
    case "insemination":
      return "bg-blue-100 text-blue-700 border-blue-200";
    case "pregnancy_test":
      return "bg-violet-100 text-violet-700 border-violet-200";
    case "calving":
      return "bg-primary/10 text-primary border-primary/20";
    case "abortion":
      return "bg-destructive/10 text-destructive border-destructive/20";
    case "dry_off":
      return "bg-amber-100 text-amber-700 border-amber-200";
    case "clean_test":
      return "bg-teal-100 text-teal-700 border-teal-200";
    case "rinse":
      return "bg-cyan-100 text-cyan-700 border-cyan-200";
    case "prescription":
      return "bg-orange-100 text-orange-700 border-orange-200";
    case "synchronization":
    case "sync_detail":
      return "bg-indigo-100 text-indigo-700 border-indigo-200";
    case "fertility_status":
      return "bg-muted text-foreground border-border";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
};

export const formatEventDate = (d: string | null | undefined) => {
  if (!d) return "—";
  // event_date is stored as text (Jalali string from legacy or ISO). Pass through if non-ISO.
  const tryDate = new Date(d);
  if (!isNaN(tryDate.getTime()) && /\d{4}-\d{2}-\d{2}/.test(d)) {
    return tryDate.toLocaleDateString("fa-IR");
  }
  return d;
};
