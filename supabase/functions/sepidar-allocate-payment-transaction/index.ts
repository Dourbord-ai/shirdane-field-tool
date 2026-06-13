// Edge Function: sepidar-allocate-payment-transaction
// Do not change Sepidar SQL env variable names. Official env is SEPIDAR_SQL_SERVER, not SEPIDAR_SQL_HOST.
// Calls ONLY bridge.AllocatePaymentTransaction.
// TODO (after DEV_ACCESS_MODE off): require permission `finance.sepidar.allocate_transaction`.
import { getSepidarSqlConfig, sql } from "../_shared/sepidarSqlClient.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Body = {
  paymentRequestItemId?: string | null;
  transactionId?: string | number | null;
  amount?: number | string | null;
  voucherId?: string | number | null;
};

function persianizeError(raw: string): string {
  const m = (raw || "").toLowerCase();
  if (m.includes("login failed") || m.includes("18456")) return "نام کاربری یا رمز عبور اتصال سپیدار اشتباه است.";
  if (m.includes("etimedout") || m.includes("timeout") || m.includes("econnrefused") || m.includes("enotfound") || m.includes("socket") || m.includes("network"))
    return "ارتباط با سرور سپیدار برقرار نشد.";
  if (m.includes("could not find stored procedure") || m.includes("cannot find") || m.includes("2812"))
    return "پروسیژر اتصال تراکنش به سند سپیدار پیدا نشد.";
  return "خطا در اتصال تراکنش به سند سپیدار.";
}

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ success: false, message: "Method not allowed" }, 405);

  let body: Body = {};
  try { body = await req.json(); } catch { return json({ success: false, message: "بدنه درخواست نامعتبر است." }, 400); }

  const amount = body.amount != null ? Number(body.amount) : NaN;
  if (!Number.isFinite(amount) || amount <= 0)
    return json({ success: false, message: "مبلغ تخصیص نامعتبر است." }, 400);

  // Centralized env validation + config — see _shared/sepidarSqlClient.ts.
  const cfg = getSepidarSqlConfig();
  if (!cfg.ok) return json({ success: false, message: cfg.message }, 500);

  let pool: sql.ConnectionPool | null = null;
  try {
    console.log("[sepidar-allocate] start", body);
    pool = await new sql.ConnectionPool(cfg.config).connect();
    const r = pool.request();
    r.input("PaymentRequestItemId", sql.NVarChar, body.paymentRequestItemId ?? null);
    r.input("TransactionId", sql.NVarChar, body.transactionId != null ? String(body.transactionId) : null);
    r.input("Amount", sql.Decimal(18, 2), amount);
    r.input("VoucherId", sql.NVarChar, body.voucherId != null ? String(body.voucherId) : null);
    const result = await r.execute("bridge.AllocatePaymentTransaction");
    const rows = (result.recordset as Record<string, unknown>[]) || [];
    const first = rows[0] || {};
    const allocationId = first.AllocationId ?? first.allocationId ?? first.Id ?? null;
    console.log("[sepidar-allocate] ok", { allocationId });
    return json({ success: true, allocationId, data: first, raw: rows });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[sepidar-allocate] error", msg, e);
    return json({ success: false, message: persianizeError(msg), rawError: msg });
  } finally {
    try { if (pool) await pool.close(); } catch (closeErr) { console.warn("pool close", closeErr); }
  }
});
