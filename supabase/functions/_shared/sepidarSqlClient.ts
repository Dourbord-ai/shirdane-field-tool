// Shared SQL Server connection helper for all Sepidar Edge Functions.
//
// Do not change Sepidar SQL env variable names. Official env is
// SEPIDAR_SQL_SERVER, not SEPIDAR_SQL_HOST.
//
// Official env variables (read by this helper):
//   SEPIDAR_SQL_SERVER       - SQL Server host/IP  (official name)
//   SEPIDAR_SQL_PORT         - TCP port            (default: 1433)
//   SEPIDAR_SQL_DATABASE     - database name       (e.g. ShirdaneBridge)
//   SEPIDAR_SQL_USER         - SQL Server login
//   SEPIDAR_SQL_PASSWORD     - SQL Server password
//   SEPIDAR_SQL_ENCRYPT      - "true" | "false"    (default: false)
//   SEPIDAR_SQL_TRUST_CERT   - "true" | "false"    (default: true)
//
// Backward-compat ONLY: SEPIDAR_SQL_HOST is read as a fallback when
// SEPIDAR_SQL_SERVER is missing — do not introduce new code using HOST.

import sql from "npm:mssql@10.0.2";

// Re-export the mssql module so call sites can use `sql.Int`, `sql.NVarChar`, etc.
// without importing mssql themselves.
export { sql };
export type { sql as SqlNamespace };

// Shape returned when env validation fails. Edge functions can map this to a
// 500 JSON response with their own Persian message.
export type SepidarSqlConfigError = {
  ok: false;
  missing: string[];
  message: string;
};

export type SepidarSqlConfigOk = {
  ok: true;
  config: sql.config;
  // Useful for logging (avoid logging the password).
  meta: { server: string; port: number; database: string };
};

export type SepidarSqlConfigResult = SepidarSqlConfigOk | SepidarSqlConfigError;

// Read and validate Sepidar SQL env vars. Returns a discriminated result so
// callers can decide how to respond (no throwing — keeps existing handlers).
export function getSepidarSqlConfig(): SepidarSqlConfigResult {
  // Prefer SEPIDAR_SQL_SERVER (official); fall back to SEPIDAR_SQL_HOST only
  // for backward compatibility with older secret setups.
  const server =
    Deno.env.get("SEPIDAR_SQL_SERVER") ||
    Deno.env.get("SEPIDAR_SQL_HOST") ||
    "";
  const portStr = Deno.env.get("SEPIDAR_SQL_PORT") || "1433";
  const database = Deno.env.get("SEPIDAR_SQL_DATABASE") || "";
  const user = Deno.env.get("SEPIDAR_SQL_USER") || "";
  const password = Deno.env.get("SEPIDAR_SQL_PASSWORD") || "";
  const encryptEnv = Deno.env.get("SEPIDAR_SQL_ENCRYPT");
  const trustEnv = Deno.env.get("SEPIDAR_SQL_TRUST_CERT");

  const missing: string[] = [];
  if (!server) missing.push("SEPIDAR_SQL_SERVER");
  if (!database) missing.push("SEPIDAR_SQL_DATABASE");
  if (!user) missing.push("SEPIDAR_SQL_USER");
  if (!password) missing.push("SEPIDAR_SQL_PASSWORD");

  if (missing.length > 0) {
    return {
      ok: false,
      missing,
      message:
        "تنظیمات اتصال به سپیدار کامل نیست. لطفاً متغیرهای محیطی SEPIDAR_SQL_* را تنظیم کنید.",
    };
  }

  const port = Number(portStr) || 1433;
  // Default to SQL Server 2008 friendly settings used by the local working setup:
  // encryption off, trust self-signed certs on.
  const encrypt = encryptEnv === "true";
  const trustServerCertificate = trustEnv ? trustEnv === "true" : true;

  const config: sql.config = {
    server,
    port,
    database,
    user,
    password,
    options: {
      encrypt,
      trustServerCertificate,
      enableArithAbort: true,
    },
    connectionTimeout: 15000,
    requestTimeout: 60000,
    pool: { max: 2, min: 0, idleTimeoutMillis: 10000 },
  };

  return { ok: true, config, meta: { server, port, database } };
}

// Convenience: open a connection pool using the resolved config. Throws if env
// is incomplete — most call sites prefer `getSepidarSqlConfig()` so they can
// return a structured 500 response, but this is handy for one-liners.
export async function connectSepidarSql(): Promise<sql.ConnectionPool> {
  const res = getSepidarSqlConfig();
  if (!res.ok) {
    throw new Error(res.message + " Missing: " + res.missing.join(", "));
  }
  return await new sql.ConnectionPool(res.config).connect();
}
