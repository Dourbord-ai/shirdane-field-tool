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
export async function checkFertilityOperation(
  payload: FertilityValidationPayload
): Promise<FertilityValidationResult> {
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
