// Edge Function: sepidar-beneficiary-statement
// Calls SQL Server stored procedure `bridge.GetBeneficiaryStatement` via the
// Sepidar bridge database and returns the recordset to the caller.

import sql from "npm:mssql@10.0.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Body = {
  partyId?: number | string | null;
  fromDate?: string | null;
  toDate?: string | null;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ success: false, message: "Method not allowed" }, 405);

  let body: Body = {};
  try {
    body = (await req.json()) as Body;
  } catch {
    return json({ success: false, message: "بدنه درخواست نامعتبر است." }, 400);
  }

  const partyId = body.partyId != null ? Number(body.partyId) : NaN;
  if (!Number.isFinite(partyId) || partyId <= 0) {
    return json({ success: false, message: "شناسه ذینفع سپیدار معتبر نیست." }, 400);
  }

  // Accept both SEPIDAR_SQL_SERVER (preferred) and legacy SEPIDAR_SQL_HOST
  const server = Deno.env.get("SEPIDAR_SQL_SERVER") || Deno.env.get("SEPIDAR_SQL_HOST");
  const portStr = Deno.env.get("SEPIDAR_SQL_PORT");
  const database = Deno.env.get("SEPIDAR_SQL_DATABASE");
  const user = Deno.env.get("SEPIDAR_SQL_USER");
  const password = Deno.env.get("SEPIDAR_SQL_PASSWORD");
  const encryptEnv = Deno.env.get("SEPIDAR_SQL_ENCRYPT");
  const trustEnv = Deno.env.get("SEPIDAR_SQL_TRUST_CERT");

  if (!server || !portStr || !database || !user || !password) {
    return json({
      success: false,
      message: "تنظیمات اتصال به سپیدار کامل نیست. لطفاً متغیرهای محیطی SEPIDAR_SQL_* را تنظیم کنید.",
    }, 500);
  }

  const config: sql.config = {
    server,
    port: Number(portStr),
    database,
    user,
    password,
    options: {
      // default to false/true (matching local working setup) when env not set
      encrypt: encryptEnv === "true",
      trustServerCertificate: trustEnv ? trustEnv === "true" : true,
      enableArithAbort: true,
    },
    connectionTimeout: 15000,
    requestTimeout: 60000,
    pool: { max: 2, min: 0, idleTimeoutMillis: 10000 },
  };

  let pool: sql.ConnectionPool | null = null;
  try {
    console.log("[sepidar-statement] connecting", { server, port: portStr, database, partyId });
    pool = await new sql.ConnectionPool(config).connect();

    const request = pool.request();
    request.input("PartyId", sql.Int, partyId);
    request.input("FromDate", sql.DateTime, body.fromDate ? new Date(body.fromDate) : null);
    request.input("ToDate", sql.DateTime, body.toDate ? new Date(body.toDate) : null);

    const result = await request.execute("bridge.GetBeneficiaryStatement");
    const rows = (result.recordset as Record<string, unknown>[]) || [];
    console.log("[sepidar-statement] ok rows=", rows.length);

    return json({
      success: true,
      message: "صورت‌حساب ذینفع با موفقیت دریافت شد.",
      rowCount: rows.length,
      data: rows,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[sepidar-statement] error", msg);
    return json({
      success: false,
      message: "صورت‌حساب سپیدار قابل واکشی نیست.",
      rawError: msg,
    });
  } finally {
    try {
      if (pool) await pool.close();
    } catch (closeErr) {
      console.warn("[sepidar-statement] pool close error", closeErr);
    }
  }
});
