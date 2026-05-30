// Fertility domain helpers for livestock profile
import { formatShamsi } from "@/lib/dateDisplay";

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
  // Optional vet/doctor name. For pregnancy_test events this is sourced from
  // metadata.Vet / metadata.vet_name / metadata.doctor_name, or — for legacy
  // rows imported from CowPregnancies — falls back to operator_name (which the
  // old pregnancy dialog historically used for the vet field).
  doctor_name?: string | null;
  // Structured business key for the specific operation (e.g. for pregnancy
  // tests: 3=initial, 4=final, 11=extra, 12=dry). Preferred source of truth
  // over metadata.test_type for classification in reports/lists.
  fertility_operation_id?: number | null;
  notes: string | null;
  metadata: Record<string, unknown> | null;
  legacy_table_name: string | null;
  legacy_record_id: number | null;
  created_at: string;
  updated_at?: string | null;
  is_cancelled?: boolean | null;
  cancelled_at?: string | null;
  cancelled_by_user_id?: string | null;
  cancel_reason?: string | null;
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

// Unified Shamsi formatter — handles ISO, Shamsi-like, Date, epoch.
export const formatEventDate = (d: string | number | Date | null | undefined) => {
  return formatShamsi(d);
};

/**
 * Derive { operator_name, doctor_name } display values for a fertility event.
 *
 * - doctor_name: only for pregnancy_test events.
 *   Pulled from metadata keys (Vet, vet_name, doctor_name) when present
 *   (this is how legacy CowPregnancies.Vet survives the import), and as a
 *   fallback uses operator_name — because the current pregnancy dialog
 *   historically writes the selected vet into the operator_name column.
 * - operator_name: shown for all event types except pregnancy_test rows
 *   where the operator_name field is actually the vet (avoids double-print).
 */
export function deriveEventPeople(
  e: FertilityEvent,
  // Optional resolver — supplied by callers that have access to the
  // useLegacyUserNames hook. Maps legacy numeric IDs (e.g. "2") to a real
  // display name (e.g. "محمد فرهمند"). Falls through to the raw value when
  // no resolver is supplied so existing callers don't break.
  resolveName?: (v: number | string | null | undefined) => string | null,
): {
  operator_name: string | null;
  doctor_name: string | null;
} {
  // metadata may be null or any object — coerce safely so this never throws.
  const meta = (e.metadata ?? {}) as Record<string, unknown>;
  const metaVet =
    (meta.Vet as string) ||
    (meta.vet_name as string) ||
    (meta.doctor_name as string) ||
    null;

  const isPregnancy = e.event_type === "pregnancy_test";
  // Prefer the explicit metadata vet field; otherwise reuse legacy operator_name.
  const rawDoctor = isPregnancy ? metaVet || e.operator_name || null : null;
  // If the operator slot was actually used for the vet, don't repeat it.
  // operator_user_id is the canonical numeric ID; fall back to operator_name
  // (which the importer sometimes filled with a number-as-string).
  const rawOperator =
    isPregnancy && !metaVet && e.operator_name === rawDoctor
      ? null
      : e.operator_name ?? null;
  const opSource = rawOperator ?? e.operator_user_id ?? null;

  // Resolve numeric IDs → real names when we have a resolver; otherwise
  // return the raw string unchanged.
  const operator = resolveName ? resolveName(opSource) : (rawOperator as string | null);
  const doctor = resolveName ? resolveName(rawDoctor) : (rawDoctor as string | null);

  return { operator_name: operator, doctor_name: doctor };
}

