// Edge Function: sepidar-create-payment-voucher
// Calls ONLY bridge.CreatePaymentRequestVoucher.
// TODO (after DEV_ACCESS_MODE off): require permission `finance.sepidar.create_voucher`.
import sql from "npm:mssql@10.0.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Body = {
  paymentRequestId?: string | null;
  paymentRequestItemId?: string | null;
  partyId?: number | string | null;
  amount?: number | string | null;
  paymentType?: string | null;
  description?: string | null;
  voucherDate?: string | null;
};

function persianizeError(raw: string): string {
  const m = (raw || "").toLowerCase();
  if (m.includes("login failed") || m.includes("18456")) return "نام کاربری یا رمز عبور اتصال سپیدار اشتباه است.";
  if (m.includes("etimedout") || m.includes("timeout") || m.includes("econnrefused") || m.includes("enotfound") || m.includes("socket") || m.includes("network"))
    return "ارتباط با سرور سپیدار برقرار نشد.";
  if (m.includes("could not find stored procedure") || m.includes("cannot find") || m.includes("2812"))
    return "پروسیژر ثبت سند پرداخت در سپیدار پیدا نشد.";
  return "خطا در ثبت سند پرداخت سپیدار.";
}

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ success: false, message: "Method not allowed" }, 405);

  let body: Body = {};
  try { body = await req.json(); } catch { return json({ success: false, message: "بدنه درخواست نامعتبر است." }, 400); }

  const partyId = body.partyId != null ? Number(body.partyId) : NaN;
  const amount = body.amount != null ? Number(body.amount) : NaN;
  if (!Number.isFinite(partyId) || partyId <= 0)
    return json({ success: false, message: "شناسه ذینفع سپیدار معتبر نیست." }, 400);
  if (!Number.isFinite(amount) || amount <= 0)
    return json({ success: false, message: "مبلغ سند نامعتبر است." }, 400);

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
    console.log("[sepidar-create-voucher] start", { partyId, amount, paymentType: body.paymentType });
    pool = await new sql.ConnectionPool(config).connect();
    const r = pool.request();
    r.input("PaymentRequestId", sql.NVarChar, body.paymentRequestId ?? null);
    r.input("PaymentRequestItemId", sql.NVarChar, body.paymentRequestItemId ?? null);
    r.input("PartyId", sql.Int, partyId);
    r.input("Amount", sql.Decimal(18, 2), amount);
    r.input("PaymentType", sql.NVarChar, body.paymentType ?? null);
    r.input("Description", sql.NVarChar, body.description ?? null);
    r.input("VoucherDate", sql.NVarChar, body.voucherDate ?? null);
    const result = await r.execute("bridge.CreatePaymentRequestVoucher");
    const rows = (result.recordset as Record<string, unknown>[]) || [];
    const first = rows[0] || {};
    const voucherId = first.VoucherId ?? first.voucherId ?? first.Id ?? null;
    const voucherNumber = first.VoucherNumber ?? first.voucherNumber ?? first.Number ?? null;
    console.log("[sepidar-create-voucher] ok", { voucherId, voucherNumber });
    return json({ success: true, voucherId, voucherNumber, data: first, raw: rows });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[sepidar-create-voucher] error", msg, e);
    return json({ success: false, message: persianizeError(msg), rawError: msg });
  } finally {
    try { if (pool) await pool.close(); } catch (closeErr) { console.warn("pool close", closeErr); }
  }
});
