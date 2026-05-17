// Edge Function: sepidar-beneficiaries
// Do not change Sepidar SQL env variable names. Official env is SEPIDAR_SQL_SERVER, not SEPIDAR_SQL_HOST.
// Reads beneficiary/party data from the SQL Server bridge database by
// invoking ONLY the stored procedure `bridge.GetBeneficiaries`.
// Direct queries against Sepidar01 tables are NOT permitted here.
//
// TODO (after DEV_ACCESS_MODE is disabled): require permission
// `finance.sepidar.view_beneficiaries` for the calling user.

import { getSepidarSqlConfig, sql } from "../_shared/sepidarSqlClient.ts";

// --- CORS: allow the SPA + supabase-js fetch to call this function freely ---
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Map raw SQL Server errors to Persian, user-friendly messages.
// Anything technical (driver text, stack) stays only in console logs.
function persianizeError(raw: string): string {
  const m = (raw || "").toLowerCase();
  if (m.includes("login failed") || m.includes("18456")) {
    return "نام کاربری یا رمز عبور اتصال سپیدار اشتباه است.";
  }
  if (
    m.includes("etimedout") ||
    m.includes("timeout") ||
    m.includes("econnrefused") ||
    m.includes("enotfound") ||
    m.includes("socket") ||
    m.includes("network")
  ) {
    return "ارتباط با سرور سپیدار برقرار نشد.";
  }
  if (m.includes("could not find stored procedure") || m.includes("cannot find") || m.includes("2812")) {
    return "پروسیژر ذینفعان سپیدار پیدا نشد.";
  }
  return "خطا در واکشی ذینفعان از سپیدار.";
}

// Small helper to keep response shape consistent across all branches.
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Normalize a single recordset row (Sepidar uses PascalCase column names
// from vwParty) into the snake_case shape the frontend expects.
// We accept multiple plausible source names so changes in the bridge SP
// don't immediately break the UI.
function normalizeRow(r: Record<string, unknown>) {
  const pick = (...keys: string[]) => {
    for (const k of keys) {
      if (r[k] !== undefined && r[k] !== null) return r[k];
    }
    return null;
  };
  const num = (v: unknown) => {
    if (v === null || v === undefined || v === "") return null;
    const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  };
  const bool = (v: unknown) => {
    if (v === null || v === undefined || v === "") return null;
    if (typeof v === "boolean") return v;
    if (typeof v === "number") return v !== 0;
    const s = String(v).toLowerCase().trim();
    return s === "1" || s === "true" || s === "yes" || s === "y";
  };

  return {
    beneficiary_id: pick("beneficiary_id", "BeneficiaryId", "PartyId", "Id"),
    dl_ref: pick("dl_ref", "DLRef", "DlRef"),
    dl_code: pick("dl_code", "DLCode", "DlCode", "Code"),
    beneficiary_name: pick("beneficiary_name", "BeneficiaryName", "PartyName", "Name", "Title"),
    national_code: pick("national_code", "NationalCode", "NationalId"),
    phone: pick("phone", "Phone", "Mobile", "TelNo", "Tel"),
    balance: num(pick("balance", "Balance", "Amount")),
    is_vendor: bool(pick("is_vendor", "IsVendor", "Vendor")),
    is_customer: bool(pick("is_customer", "IsCustomer", "Customer")),
    is_employee: bool(pick("is_employee", "IsEmployee", "Employee")),
    full_address: pick("full_address", "FullAddress", "Address"),
    beneficiary_type: pick("beneficiary_type", "BeneficiaryType", "PartyType", "Type"),
  };
}

Deno.serve(async (req) => {
  // Preflight: browser will fire OPTIONS before the actual POST.
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ success: false, message: "Method not allowed", data: [] }, 405);

  // Pull the SQL Server connection settings from project-level secrets.
  // The canonical name is SEPIDAR_SQL_SERVER (matches supabase/functions/.env);
  // SEPIDAR_SQL_HOST is kept as a fallback for older deployments.
  const host =
    Deno.env.get("SEPIDAR_SQL_SERVER") ||
    Deno.env.get("SEPIDAR_SQL_HOST");
  // Default to the standard SQL Server port if none is configured.
  const port = Number(Deno.env.get("SEPIDAR_SQL_PORT") || "1433");
  const database = Deno.env.get("SEPIDAR_SQL_DATABASE");
  const user = Deno.env.get("SEPIDAR_SQL_USER");
  const password = Deno.env.get("SEPIDAR_SQL_PASSWORD");
  // Optional toggles — fall back to safe defaults compatible with SQL Server 2008.
  const encrypt = Deno.env.get("SEPIDAR_SQL_ENCRYPT") === "true";
  const trustServerCertificate = (Deno.env.get("SEPIDAR_SQL_TRUST_CERT") ?? "true") === "true";

  if (!host || !database || !user || !password) {
    return json(
      {
        success: false,
        message: "تنظیمات اتصال به سپیدار کامل نیست. لطفاً متغیرهای محیطی SEPIDAR_SQL_* را تنظیم کنید.",
        data: [],
      },
      500,
    );
  }

  // mssql connection config — mirror the working sepidar-beneficiary-statement.
  const config: sql.config = {
    server: host,
    port,
    database,
    user,
    password,
    options: {
      encrypt,
      trustServerCertificate,
      enableArithAbort: true,
    },
    database,
    user,
    password,
    options: {
      encrypt: false,
      trustServerCertificate: true,
      enableArithAbort: true,
    },
    connectionTimeout: 15000,
    requestTimeout: 60000,
    pool: { max: 2, min: 0, idleTimeoutMillis: 10000 },
  };

  const t0 = Date.now();
  let pool: sql.ConnectionPool | null = null;
  try {
    console.log("[sepidar-beneficiaries] connecting", { host, port, database });
    pool = await new sql.ConnectionPool(config).connect();
    console.log("[sepidar-beneficiaries] connected in", Date.now() - t0, "ms");

    // The bridge SP takes no parameters — it returns the full beneficiary view.
    const request = pool.request();
    console.log("[sepidar-beneficiaries] executing bridge.GetBeneficiaries");
    const tExec = Date.now();
    const result = await request.execute("bridge.GetBeneficiaries");
    const raw = (result.recordset as Record<string, unknown>[]) || [];
    const rows = raw.map(normalizeRow);
    console.log(
      "[sepidar-beneficiaries] executed",
      { rows: rows.length, execMs: Date.now() - tExec, totalMs: Date.now() - t0 },
    );

    return json({
      success: true,
      message: "لیست ذینفعان با موفقیت دریافت شد.",
      data: rows,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[sepidar-beneficiaries] error", msg, e);
    // Persian-friendly to the user; raw text only for devs/logs.
    return json({
      success: false,
      message: persianizeError(msg),
      data: [],
      rawError: msg,
    }, 200);
  } finally {
    try {
      if (pool) await pool.close();
    } catch (closeErr) {
      console.warn("[sepidar-beneficiaries] pool close error", closeErr);
    }
  }
});
