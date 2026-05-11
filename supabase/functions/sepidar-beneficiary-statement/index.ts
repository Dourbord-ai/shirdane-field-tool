// Edge Function: sepidar-beneficiary-statement
// Reads a beneficiary statement from the SQL Server bridge database by
// invoking ONLY the stored procedure `bridge.GetBeneficiaryStatement`.
// Direct queries against Sepidar01 tables are NOT permitted here.
//
// TODO (after DEV_ACCESS_MODE is disabled): require permission
// `finance.sepidar.view_statement` for the calling user.

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
    return "پروسیژر صورتحساب سپیدار پیدا نشد.";
  }
  return "خطا در واکشی صورتحساب از سپیدار.";
}

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

  const host = Deno.env.get("SEPIDAR_SQL_HOST");
  const portStr = Deno.env.get("SEPIDAR_SQL_PORT");
  const database = Deno.env.get("SEPIDAR_SQL_DATABASE");
  const user = Deno.env.get("SEPIDAR_SQL_USER");
  const password = Deno.env.get("SEPIDAR_SQL_PASSWORD");

  if (!host || !portStr || !database || !user || !password) {
    return json(
      {
        success: false,
        message: "تنظیمات اتصال به سپیدار کامل نیست. لطفاً متغیرهای محیطی SEPIDAR_SQL_* را تنظیم کنید.",
      },
      500,
    );
  }

  const config: sql.config = {
    server: host,
    port: Number(portStr),
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
    console.log("[sepidar-statement] connecting", { host, port: portStr, database, partyId });
    pool = await new sql.ConnectionPool(config).connect();
    console.log("[sepidar-statement] connected in", Date.now() - t0, "ms");

    const request = pool.request();
    request.input("PartyId", sql.Int, partyId);
    if (body.fromDate) request.input("FromDate", sql.NVarChar, body.fromDate);
    else request.input("FromDate", sql.NVarChar, null);
    if (body.toDate) request.input("ToDate", sql.NVarChar, body.toDate);
    else request.input("ToDate", sql.NVarChar, null);

    console.log("[sepidar-statement] executing bridge.GetBeneficiaryStatement");
    const tExec = Date.now();
    const result = await request.execute("bridge.GetBeneficiaryStatement");
    const rows = (result.recordset as Record<string, unknown>[]) || [];
    console.log(
      "[sepidar-statement] executed",
      { rows: rows.length, execMs: Date.now() - tExec, totalMs: Date.now() - t0 },
    );

    return json({ success: true, rowCount: rows.length, data: rows });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[sepidar-statement] error", msg, e);
    return json({
      success: false,
      message: persianizeError(msg),
      rawError: msg,
    }, 200);
  } finally {
    try {
      if (pool) await pool.close();
    } catch (closeErr) {
      console.warn("[sepidar-statement] pool close error", closeErr);
    }
  }
});
