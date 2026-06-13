/**
 * Centralized error handling for the Finance module.
 * Always returns a non-empty Persian message and logs full error to console.
 */

const DEFAULT_MSG =
  "خطایی در انجام عملیات رخ داد. لطفاً دوباره تلاش کنید یا با مدیر سیستم تماس بگیرید.";

const SUPABASE_CODE_MAP: Record<string, string> = {
  "23505": "این رکورد قبلاً ثبت شده است.",
  "23503": "اطلاعات وابسته معتبر نیست یا رکورد مرتبط پیدا نشد.",
  "23502": "یکی از فیلدهای ضروری تکمیل نشده است.",
  "42501": "شما مجوز انجام این عملیات را ندارید.",
  PGRST301: "شما مجوز انجام این عملیات را ندارید.",
};

function pickString(...vals: unknown[]): string | null {
  for (const v of vals) {
    if (typeof v === "string") {
      const t = v.trim();
      if (t) return t;
    }
  }
  return null;
}

export function getReadableFinanceError(error: unknown): string {
  // Always log full error for developers
  // eslint-disable-next-line no-console
  console.error("Finance module error:", error);

  if (error == null) return DEFAULT_MSG;

  if (typeof error === "string") return error.trim() || DEFAULT_MSG;

  const e = error as Record<string, unknown> & {
    response?: Record<string, unknown> & { error?: Record<string, unknown> };
    error?: Record<string, unknown>;
    cause?: unknown;
  };

  // Network / fetch failure
  const msgRaw = typeof e.message === "string" ? e.message : "";
  if (
    /failed to fetch|networkerror|network request failed|load failed|fetch failed/i.test(
      msgRaw,
    ) ||
    (e as { name?: string }).name === "TypeError" && /fetch/i.test(msgRaw)
  ) {
    return "ارتباط با سرور برقرار نشد. اتصال شبکه یا سرور را بررسی کنید.";
  }

  // Supabase error code mapping
  const code = pickString(
    (e as { code?: unknown }).code,
    (e.error as { code?: unknown } | undefined)?.code,
    (e.response?.error as { code?: unknown } | undefined)?.code,
  );
  if (code && SUPABASE_CODE_MAP[code]) return SUPABASE_CODE_MAP[code];

  // Try every readable source in order
  const found = pickString(
    msgRaw,
    (e as { details?: unknown }).details,
    (e as { hint?: unknown }).hint,
    (e.error as { message?: unknown } | undefined)?.message,
    (e.error as { details?: unknown } | undefined)?.details,
    (e.error as { hint?: unknown } | undefined)?.hint,
    (e.response?.error as { message?: unknown } | undefined)?.message,
    (e.response as { message?: unknown } | undefined)?.message,
    (e as { error_message?: unknown }).error_message,
    (e as { statusText?: unknown }).statusText,
  );

  if (found) {
    // Translate common english Supabase phrases
    if (/duplicate key|unique constraint/i.test(found))
      return SUPABASE_CODE_MAP["23505"];
    if (/foreign key/i.test(found)) return SUPABASE_CODE_MAP["23503"];
    if (/null value|not-null/i.test(found)) return SUPABASE_CODE_MAP["23502"];
    if (/permission denied|row-level security|rls/i.test(found))
      return SUPABASE_CODE_MAP["42501"];
    return found;
  }

  return DEFAULT_MSG;
}

/** Toast helper that always shows a non-empty message with title. */
export function toastFinanceError(
  toast: { error: (msg: string, opts?: { description?: string }) => void },
  error: unknown,
) {
  const msg = getReadableFinanceError(error);
  toast.error("خطا در انجام عملیات", { description: msg });
}
