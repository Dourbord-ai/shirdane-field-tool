// ============================================================================
// Diagnostic logger for the "تشخیص و ثبت اتوماتیک تراکنش‌های تخصیص‌نشده" pipeline.
//
// Verbose logs are gated by:
//   - localStorage.financeAutoProcessDebug === "true"
//   - or VITE_FINANCE_AUTO_PROCESS_DEBUG === "true" (build-time)
//
// Final summary + FATAL errors are ALWAYS logged regardless of the flag so the
// operator can copy/paste a clean report from the console even without enabling
// debug mode.
//
// Two helpers in window:
//   window.enableFinanceAutoProcessDebug()
//   window.disableFinanceAutoProcessDebug()
//
// No business logic. Purely visibility.
// ============================================================================

// ---------------------------------------------------------------------------
// Flag check. Runs on every call — cheap. We re-read each time so toggling
// the flag in DevTools takes effect without a page reload.
// ---------------------------------------------------------------------------
export function isDebugOn(): boolean {
  try {
    if (typeof localStorage !== "undefined" && localStorage.getItem("financeAutoProcessDebug") === "true") {
      return true;
    }
  } catch {
    // localStorage may throw in private mode — treat as "off".
  }
  // Vite injects import.meta.env at build time; falls back gracefully.
  // We use a non-DOM access pattern that survives SSR/test environments.
  const env = (import.meta as unknown as { env?: Record<string, string> }).env;
  return env?.VITE_FINANCE_AUTO_PROCESS_DEBUG === "true";
}

// ---------------------------------------------------------------------------
// Tagged loggers. Each one prefixes "[AutoProcess]" so it's easy to filter
// in DevTools. `dlogAlways` ignores the flag — used for fatal errors and the
// final summary.
// ---------------------------------------------------------------------------
const TAG = "[AutoProcess]";

export function dlog(...args: unknown[]): void {
  if (!isDebugOn()) return;
  // eslint-disable-next-line no-console
  console.log(TAG, ...args);
}

export function dwarn(...args: unknown[]): void {
  if (!isDebugOn()) return;
  // eslint-disable-next-line no-console
  console.warn(TAG, ...args);
}

export function derror(...args: unknown[]): void {
  // ALWAYS log errors — silent failures are the bug we are debugging.
  // eslint-disable-next-line no-console
  console.error(TAG, ...args);
}

export function dlogAlways(...args: unknown[]): void {
  // eslint-disable-next-line no-console
  console.log(TAG, ...args);
}

export function dgroup(label: string): void {
  if (!isDebugOn()) return;
  // eslint-disable-next-line no-console
  console.group(`${TAG} ${label}`);
}

export function dgroupEnd(): void {
  if (!isDebugOn()) return;
  // eslint-disable-next-line no-console
  console.groupEnd();
}

export function dtable(data: unknown): void {
  // ALWAYS show the final table — that's the whole point of the report.
  // eslint-disable-next-line no-console
  console.table(data);
}

// ---------------------------------------------------------------------------
// Wrap a Supabase/edge-function call with timing + structured error logging.
// The fn is responsible for returning whatever it wants; we just observe.
//
// Logs:
//   - operationName
//   - payload preview (truncated to keep console readable)
//   - startedAt, duration
//   - success/error
//   - returned count when present
//   - full PostgrestError fields (code, message, details, hint) on failure
// ---------------------------------------------------------------------------
export interface DebugCallMeta {
  table?: string;
  rpc?: string;
  func?: string;
  payload?: unknown;
}

function preview(value: unknown, max = 400): string {
  try {
    const s = typeof value === "string" ? value : JSON.stringify(value);
    if (!s) return String(value);
    return s.length > max ? s.slice(0, max) + "…" : s;
  } catch {
    return String(value);
  }
}

export async function debugSupabaseCall<T>(
  operationName: string,
  meta: DebugCallMeta,
  fn: () => Promise<T>,
): Promise<T> {
  const startedAt = performance.now();
  if (isDebugOn()) {
    dlog("→", operationName, {
      table: meta.table,
      rpc: meta.rpc,
      func: meta.func,
      payloadPreview: preview(meta.payload),
    });
  }
  try {
    const result = (await fn()) as T & {
      error?: { code?: string; message?: string; details?: string; hint?: string } | null;
      data?: unknown;
      count?: number | null;
    };
    const duration = Math.round(performance.now() - startedAt);

    // Supabase responses follow { data, error, count } shape — best effort.
    const err = result?.error ?? null;
    if (err) {
      derror("✕", operationName, {
        duration,
        code: err.code,
        message: err.message,
        details: err.details,
        hint: err.hint,
      });
    } else if (isDebugOn()) {
      const data = result?.data;
      const returnedCount = Array.isArray(data) ? data.length : data == null ? 0 : 1;
      dlog("✓", operationName, {
        duration,
        returnedCount,
        countHeader: result?.count ?? null,
        dataPreview: preview(data),
      });
    }
    return result;
  } catch (e) {
    const duration = Math.round(performance.now() - startedAt);
    derror("✕ THROW", operationName, {
      duration,
      error: e,
      message: e instanceof Error ? e.message : String(e),
      stack: e instanceof Error ? e.stack : undefined,
    });
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Register window helpers in browser environments so a power-user can flip
// the flag from DevTools without grepping for the key name.
// ---------------------------------------------------------------------------
if (typeof window !== "undefined") {
  const w = window as unknown as {
    enableFinanceAutoProcessDebug?: () => void;
    disableFinanceAutoProcessDebug?: () => void;
  };
  w.enableFinanceAutoProcessDebug = () => {
    try {
      localStorage.setItem("financeAutoProcessDebug", "true");
      // eslint-disable-next-line no-console
      console.log(TAG, "verbose logging ENABLED");
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(TAG, "failed to enable", e);
    }
  };
  w.disableFinanceAutoProcessDebug = () => {
    try {
      localStorage.removeItem("financeAutoProcessDebug");
      // eslint-disable-next-line no-console
      console.log(TAG, "verbose logging DISABLED");
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(TAG, "failed to disable", e);
    }
  };
}
