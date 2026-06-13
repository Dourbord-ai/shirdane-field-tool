// ============================================================================
// Hoshyar Structured Logger
// ----------------------------------------------------------------------------
// Shared logger used by all Edge Functions to write structured rows into the
// external `hoshyar_logs` table. Failures are swallowed so logging never
// breaks the main business flow.
// ============================================================================

const HOSHYAR_SUPABASE_URL = "http://192.168.4.215:8000";
const HOSHYAR_SERVICE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoic3VwYWJhc2UiLCJpYXQiOjE3ODA4NDIxODMsImV4cCI6MTkzODUyMjE4M30.GPQCC2WdQmX3jfKUzZn2DvY32wZoftZGqkoci_djwec";

interface LogEntry {
  source: string;
  function_name?: string;
  step?: string;
  level: "info" | "warn" | "error";
  message: string;
  metadata?: Record<string, unknown>;
  user_id?: string;
  record_id?: string;
  duration_ms?: number;
}

// Fire-and-forget write. We intentionally do NOT await fetch errors at the
// call sites — the catch here ensures a failed log never propagates.
async function writeLog(entry: LogEntry): Promise<void> {
  try {
    await fetch(`${HOSHYAR_SUPABASE_URL}/rest/v1/hoshyar_logs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": HOSHYAR_SERVICE_KEY,
        "Authorization": `Bearer ${HOSHYAR_SERVICE_KEY}`,
        "Prefer": "return=minimal",
      },
      body: JSON.stringify(entry),
    });
  } catch {
    // Never let logging crash the main function.
  }
}

export class Logger {
  private functionName: string;
  private startTime: number;
  private userId?: string;
  private recordId?: string;

  constructor(functionName: string, userId?: string, recordId?: string) {
    this.functionName = functionName;
    this.startTime = Date.now();
    this.userId = userId;
    this.recordId = recordId;
  }

  info(step: string, message: string, metadata?: Record<string, unknown>) {
    console.log(`[${this.functionName}:${step}] ${message}`);
    writeLog({
      source: "edge_function",
      function_name: this.functionName,
      step,
      level: "info",
      message,
      metadata: metadata || {},
      user_id: this.userId,
      record_id: this.recordId,
      duration_ms: Date.now() - this.startTime,
    });
  }

  warn(step: string, message: string, metadata?: Record<string, unknown>) {
    console.warn(`[${this.functionName}:${step}] WARN: ${message}`);
    writeLog({
      source: "edge_function",
      function_name: this.functionName,
      step,
      level: "warn",
      message,
      metadata: metadata || {},
      user_id: this.userId,
      record_id: this.recordId,
      duration_ms: Date.now() - this.startTime,
    });
  }

  error(step: string, message: string, metadata?: Record<string, unknown>) {
    console.error(`[${this.functionName}:${step}] ERROR: ${message}`);
    writeLog({
      source: "edge_function",
      function_name: this.functionName,
      step,
      level: "error",
      message,
      metadata: metadata || {},
      user_id: this.userId,
      record_id: this.recordId,
      duration_ms: Date.now() - this.startTime,
    });
  }

  setRecord(recordId: string) {
    this.recordId = recordId;
  }
  setUser(userId: string) {
    this.userId = userId;
  }
  duration(): number {
    return Date.now() - this.startTime;
  }
}

export function createLogger(
  functionName: string,
  userId?: string,
  recordId?: string,
): Logger {
  return new Logger(functionName, userId, recordId);
}
