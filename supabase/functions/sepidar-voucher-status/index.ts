// Edge Function: sepidar-voucher-status
// Calls ONLY bridge.GetVoucherStatus(@VoucherId).
// TODO (after DEV_ACCESS_MODE off): require permission `finance.sepidar.view_voucher_status`.
import sql from "npm:mssql@10.0.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function persianizeError(raw: string): string {
  const m = (raw || "").toLowerCase();
  if (m.includes("login failed") || m.includes("18456")) return "نام کاربری یا رمز عبور اتصال سپیدار اشتباه است.";
  if (m.includes("etimedout") || m.includes("timeout") || m.includes("econnrefused") || m.includes("enotfound") || m.includes("socket") || m.includes("network"))
    return "ارتباط با سرور سپیدار برقرار نشد.";
  if (m.includes("could not find stored procedure") || m.includes("cannot find") || m.includes("2812"))
    return "پروسیژر وضعیت سند سپیدار پیدا نشد.";
  return "خطا در دریافت وضعیت سند سپیدار.";
}

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ success: false, message: "Method not allowed" }, 405);

  let body: { voucherId?: string | number | null } = {};
  try { body = await req.json(); } catch { return json({ success: false, message: "بدنه درخواست نامعتبر است." }, 400); }

  const voucherId = body.voucherId != null ? Number(body.voucherId) : NaN;
  if (!Number.isFinite(voucherId) || voucherId <= 0)
    return json({ success: false, message: "شناسه سند سپیدار معتبر نیست." }, 400);

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
    console.log("[sepidar-voucher-status] start", { voucherId });
    pool = await new sql.ConnectionPool(config).connect();
    const r = pool.request();
    r.input("VoucherId", sql.Int, voucherId);
    const result = await r.execute("bridge.GetVoucherStatus");
    const rows = (result.recordset as Record<string, unknown>[]) || [];
    const first = rows[0] || {};
    const status = first.Status ?? first.status ?? first.VoucherStatus ?? null;
    console.log("[sepidar-voucher-status] ok", { voucherId, status });
    return json({ success: true, status, data: first, raw: rows });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[sepidar-voucher-status] error", msg, e);
    return json({ success: false, message: persianizeError(msg), rawError: msg });
  } finally {
    try { if (pool) await pool.close(); } catch (closeErr) { console.warn("pool close", closeErr); }
  }
});
