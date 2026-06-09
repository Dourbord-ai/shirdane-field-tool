import { supabase } from "@/integrations/supabase/client";

type LogLevel = "info" | "warn" | "error";

interface LogEntry {
  source: string;
  function_name?: string;
  step?: string;
  level: LogLevel;
  message: string;
  metadata?: Record<string, unknown>;
  user_id?: string;
  record_id?: string;
  duration_ms?: number;
}

async function writeLog(entry: LogEntry): Promise<void> {
  try {
    await (supabase as any).from("hoshyar_logs").insert(entry);
  } catch {
    // Never let logging crash the app
  }
}

export const logger = {
  info: (step: string, message: string, metadata?: Record<string, unknown>) =>
    writeLog({ source: "frontend", step, level: "info", message, metadata }),

  warn: (step: string, message: string, metadata?: Record<string, unknown>) =>
    writeLog({ source: "frontend", step, level: "warn", message, metadata }),

  error: (step: string, message: string, metadata?: Record<string, unknown>, recordId?: string) =>
    writeLog({ source: "frontend", step, level: "error", message, metadata, record_id: recordId }),
};

export function logSupabaseError(operation: string, error: Error | unknown, context?: Record<string, unknown>) {
  const message = error instanceof Error ? error.message : String(error);
  writeLog({
    source: "frontend",
    function_name: "supabase_call",
    step: operation,
    level: "error",
    message,
    metadata: context || {}
  });
}

export function initGlobalErrorLogger() {
  window.addEventListener("error", (event) => {
    writeLog({
      source: "frontend",
      function_name: "global_error",
      step: "unhandled",
      level: "error",
      message: event.message,
      metadata: {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        stack: event.error?.stack?.slice(0, 500)
      }
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    writeLog({
      source: "frontend",
      function_name: "global_error",
      step: "unhandled_promise",
      level: "error",
      message: String(event.reason),
      metadata: {
        stack: event.reason?.stack?.slice(0, 500)
      }
    });
  });
}
