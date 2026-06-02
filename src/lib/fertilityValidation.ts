import { supabase } from "@/integrations/supabase/client";

export type FertilityValidationPayload = {
  livestock_id: number;
  fertility_operation_id: number;
  event_date: string;
  event_time?: string | null;
  result_code?: string | null;
  fertility_status_id?: number | null;
};

export type FertilityValidationResult = {
  ok: boolean;
  allowed: boolean;
  messages: string[];
  matched_rule_id: string | number | null;
  failed_rules: any[];
  raw?: any;
};

/**
 * Always call this BEFORE inserting into livestock_fertility_events.
 * Returns ok=false if validation failed or the operation is not allowed.
 */
// ============================================================
// TEMPORARY FEATURE FLAG — DISABLE_FERTILITY_VALIDATION
// While true, checkFertilityOperation() short-circuits and
// always returns ok=true so that ALL fertility forms (Heat,
// Insemination, Pregnancy Check, Calving, Abortion, Dry Off,
// Rinse, Sync, etc.) save without invoking the
// check-fertility-operation Edge Function.
//
// Re-enable validation by setting VITE_DISABLE_FERTILITY_VALIDATION
// to "false" (or removing it) — the validation architecture and
// Edge Function are intentionally preserved.
// ============================================================
export const DISABLE_FERTILITY_VALIDATION =
  (import.meta.env.VITE_DISABLE_FERTILITY_VALIDATION ?? "true") !== "false";

export async function checkFertilityOperation(
  payload: FertilityValidationPayload
): Promise<FertilityValidationResult> {
  // Temporary bypass — see DISABLE_FERTILITY_VALIDATION above.
  if (DISABLE_FERTILITY_VALIDATION) {
    console.warn(
      "[fertilityValidation] BYPASSED — DISABLE_FERTILITY_VALIDATION flag is ON. " +
        "check-fertility-operation Edge Function was NOT called.",
      payload
    );
    return {
      ok: true,
      allowed: true,
      messages: [],
      matched_rule_id: null,
      failed_rules: [],
      raw: { bypassed: true },
    };
  }

  const validationPayload = {
    livestock_id: payload.livestock_id,
    fertility_operation_id: payload.fertility_operation_id,
    event_date: payload.event_date,
    event_time: payload.event_time ?? null,
    result_code: payload.result_code ?? null,
    fertility_status_id: payload.fertility_status_id ?? null,
    mode: "insert" as const,
    debug: true,
  };

  console.log("checking fertility operation", validationPayload);

  const { data: validation, error: validationError } = await supabase.functions.invoke(
    "check-fertility-operation",
    { body: validationPayload }
  );

  console.log("fertility validation response", validation, validationError);

  if (validationError) {
    return {
      ok: false,
      allowed: false,
      messages: ["خطا در اعتبارسنجی عملیات باروری"],
      matched_rule_id: null,
      failed_rules: [],
      raw: validationError,
    };
  }

  const messages: string[] = Array.isArray(validation?.messages) ? validation.messages : [];

  if (!validation || validation.allowed !== true) {
    return {
      ok: false,
      allowed: false,
      messages: messages.length ? messages : ["این عملیات طبق قواعد باروری مجاز نیست."],
      matched_rule_id: validation?.matched_rule_id ?? null,
      failed_rules: validation?.failed_rules ?? [],
      raw: validation,
    };
  }

  return {
    ok: true,
    allowed: true,
    messages,
    matched_rule_id: validation.matched_rule_id ?? null,
    failed_rules: [],
    raw: validation,
  };
}

// ============================================================
// NEW — simple validation per current spec.
// Only this validation should gate fertility operation submission.
// Old `checkFertilityOperation` above is kept (bypassed) for
// backward source compatibility but does nothing.
// ============================================================

import { jalaliToGregorian } from "@/lib/jalali";

// Union of supported operation types — Persian names kept exactly per spec.
export type FertilityOperationType =
  | "تلقیح"
  | "فحلی"
  | "سقط"
  | "زایش"
  | "جذب"
  | "تست آبستنی";

// Pregnancy-test stages — Persian names kept exactly per spec.
export type PregnancyTestStage = "اولی" | "نهایی" | "تکمیلی" | "خشکی";

// Minimum days after آخرین تلقیح for each pregnancy-test stage.
// Centralised so a future tweak is a one-line change.
export const PREGNANCY_TEST_MIN_DAYS: Record<PregnancyTestStage, number> = {
  اولی: 28,
  نهایی: 50,
  تکمیلی: 90,
  خشکی: 180,
};

// Status-id treated as «فحلی» — derived from fertility_statuses table:
// id 2 = «فحل شده» (pregnancy_state = 'open').
const HEAT_STATUS_ID = 2;

// Helper: convert a Jalali string "YYYY/MM/DD" to a JS Date (Gregorian midnight).
// Returns null if the input is missing or malformed.
function jalaliStringToDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  // Accept either "YYYY/MM/DD" or "YYYY/MM/DD HH:mm" (dialogs sometimes append time).
  const head = String(s).trim().split(/\s+/)[0];
  const m = head.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (!m) return null;
  const g = jalaliToGregorian(+m[1], +m[2], +m[3]);
  return new Date(g.year, g.month - 1, g.day);
}

/**
 * New simple fertility validator.
 * Rules:
 *  - تلقیح  : current status must be «فحلی»  (status id = 2)
 *  - فحلی   : current status must be «عدم آبستن» (pregnancy_state = 'open')
 *  - سقط / زایش / جذب : current status must be «آبستن» (pregnancy_state = 'pregnant')
 *  - تست آبستنی : N days must have elapsed since آخرین تلقیح
 *      اولی=28, نهایی=50, تکمیلی=90, خشکی=180
 */
export async function validateFertilityOperation(
  cowId: number,
  operationType: FertilityOperationType,
  testStage?: PregnancyTestStage,
  operationDate?: string // Jalali "YYYY/MM/DD"; defaults to today
): Promise<{ isValid: boolean; message: string }> {
  // 1) Fetch the cow's current fertility status + last insemination date.
  //    We only need the two cache columns that the DB triggers maintain.
  const { data: cow, error: cowErr } = await supabase
    .from("cows")
    .select("last_fertility_status, last_inoculation_date")
    .eq("id", cowId)
    .maybeSingle();

  if (cowErr || !cow) {
    return { isValid: false, message: "اطلاعات وضعیت باروری دام در دسترس نیست." };
  }

  // 2) Resolve the status row (we need pregnancy_state).
  let pregnancyState: string | null = null;
  if (cow.last_fertility_status != null) {
    const { data: st } = await supabase
      .from("fertility_statuses")
      .select("pregnancy_state")
      .eq("id", cow.last_fertility_status)
      .maybeSingle();
    pregnancyState = (st?.pregnancy_state as string | null) ?? null;
  }

  const statusId = cow.last_fertility_status as number | null;

  // 3) Apply per-operation rules.
  switch (operationType) {
    case "تلقیح":
      // Must be «فحلی» — i.e. status id 2 (فحل شده).
      if (statusId !== HEAT_STATUS_ID) {
        return {
          isValid: false,
          message: "برای ثبت تلقیح، وضعیت دام باید «فحلی» باشد.",
        };
      }
      return { isValid: true, message: "" };

    case "فحلی":
      // Per updated business rule: ثبت فحلی باید همیشه مجاز باشد
      // (حتی برای دام‌های تلقیح‌شده یا با تست آبستنی اولیه مثبت).
      // هیچ بلاک‌کنندهٔ سختی برای فحلی اعمال نمی‌کنیم؛ در صورت نیاز
      // فقط هشدار غیرمسدودکننده در UI نمایش داده می‌شود.
      return { isValid: true, message: "" };


    case "زایش":
      // Per updated business rule (request from user):
      // اگر در کارت «خلاصه باروری» مقدار «آبستن؟» برابر «بله» باشد،
      // کاربر باید بتواند ثبت زایش را انجام دهد. منطق summary's
      // isPregnant بر اساس آخرین تلقیح موفق یا تست آبستنی مثبت محاسبه
      // می‌شود و گاهی با ستون cache «last_fertility_status» همخوانی
      // ندارد. برای جلوگیری از بلاک شدن ناخواستهٔ ثبت زایش، این
      // عملیات همیشه مجاز شمرده می‌شود (هیچ بلاک سختی اعمال نمی‌شود).
      // در صورت نیاز، هشدار غیرمسدودکننده در UI نمایش داده می‌شود.
      return { isValid: true, message: "" };

    case "سقط":
    case "جذب":
      // Must be «آبستن» — pregnancy_state = 'pregnant'.
      if (pregnancyState !== "pregnant") {
        return {
          isValid: false,
          message: "برای ثبت سقط یا جذب، وضعیت دام باید «آبستن» باشد.",
        };
      }
      return { isValid: true, message: "" };

    case "تست آبستنی": {
      // Day-gap rule against آخرین تلقیح.
      if (!testStage) {
        return { isValid: false, message: "مرحله تست آبستنی مشخص نشده است." };
      }
      const lastInsemDate = jalaliStringToDate(cow.last_inoculation_date as string | null);
      if (!lastInsemDate) {
        return {
          isValid: false,
          message: "آخرین تاریخ تلقیح برای این دام ثبت نشده است.",
        };
      }
      const opDate = jalaliStringToDate(operationDate) ?? new Date();
      // Round to whole days (ignore time component to keep this simple).
      const ms = opDate.getTime() - lastInsemDate.getTime();
      const days = Math.floor(ms / (1000 * 60 * 60 * 24));
      const minDays = PREGNANCY_TEST_MIN_DAYS[testStage];
      if (days < minDays) {
        // Persian label table per spec.
        const stageLabel: Record<PregnancyTestStage, string> = {
          اولی: "تست آبستنی اولی",
          نهایی: "تست آبستنی نهایی",
          تکمیلی: "تست آبستنی تکمیلی",
          خشکی: "تست آبستنی خشکی",
        };
        return {
          isValid: false,
          message: `${stageLabel[testStage]} فقط از ${minDays} روز بعد از آخرین تلقیح قابل ثبت است.`,
        };
      }
      return { isValid: true, message: "" };
    }
  }
}
