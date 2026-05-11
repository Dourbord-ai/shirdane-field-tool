// Edge Function: sepidar-beneficiary-balance
// Calls ONLY bridge.GetBeneficiaryBalance(@PartyId).
// Direct Sepidar table access is NOT permitted here.
// TODO (after DEV_ACCESS_MODE off): require permission `finance.sepidar.view_balance`.
import sql from "npm:mssql@10.0.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function persianizeError(raw: string): string {
  const m = (raw || "").toLowerCase();
  if (m.includes("login failed") || m.includes("18456"))
    return "نام کاربری یا رمز عبور اتصال سپیدار اشتباه است.";
  if (m.includes("etimedout") || m.includes("timeout") || m.includes("econnrefused") || m.includes("enotfound") || m.includes("socket") || m.includes("network"))
    return "ارتباط با سرور سپیدار برقرار نشد.";
  if (m.includes("could not find stored procedure") || m.includes("cannot find") || m.includes("2812"))
    return "پروسیژر مانده ذینفع در سپیدار پیدا نشد.";
  return "خطا در واکشی مانده ذینفع از سپیدار.";
}

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ success: false, message: "Method not allowed" }, 405);

  let body: { partyId?: number | string | null } = {};
  try { body = await req.json(); } catch { return json({ success: false, message: "بدنه درخواست نامعتبر است." }, 400); }

  const partyId = body.partyId != null ? Number(body.partyId) : NaN;
  if (!Number.isFinite(partyId) || partyId <= 0)
    return json({ success: false, message: "شناسه ذینفع سپیدار معتبر نیست." }, 400);

  const host = Deno.env.get("SEPIDAR_SQL_HOST");
  const portStr = Deno.env.get("SEPIDAR_SQL_PORT");
  const database = Deno.env.get("SEPIDAR_SQL_DATABASE");
  const user = Deno.env.get("SEPIDAR_SQL_USER");
  const password = Deno.env.get("SEPIDAR_SQL_PASSWORD");
  if (!host || !portStr || !database || !user || !password)
    return json({ success: false, message: "تنظیمات اتصال به سپیدار کامل نیست." }, 500);

  const config: sql.config = {
    server: host, port: Number(portStr), database, user, password,
    options: { encrypt: false, trustServerCertificate: true, enableArithAbort: true },
    connectionTimeout: 15000, requestTimeout: 60000,
    pool: { max: 2, min: 0, idleTimeoutMillis: 10000 },
  };

  let pool: sql.ConnectionPool | null = null;
  try {
    console.log("[sepidar-balance] connecting", { host, port: portStr, database, partyId });
    pool = await new sql.ConnectionPool(config).connect();
    const r = pool.request();
    r.input("PartyId", sql.Int, partyId);
    const result = await r.execute("bridge.GetBeneficiaryBalance");
    const rows = (result.recordset as Record<string, unknown>[]) || [];
    const first = rows[0] || {};
    // Try common column names
    const balanceVal =
      first.Balance ?? first.balance ?? first.RemainBalance ??
      first.RemainCredit ?? first.Credit ?? first.Amount ?? null;
    const balance = Number(balanceVal ?? 0);
    console.log("[sepidar-balance] ok", { partyId, rows: rows.length, balance });
    return json({ success: true, balance, data: first, raw: rows });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[sepidar-balance] error", msg, e);
    return json({ success: false, message: persianizeError(msg), rawError: msg });
  } finally {
    try { if (pool) await pool.close(); } catch (closeErr) { console.warn("[sepidar-balance] pool close error", closeErr); }
  }
});
