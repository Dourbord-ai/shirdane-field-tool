// Edge Function: sepidar-financial-document-details
// Do not change Sepidar SQL env variable names. Official env is SEPIDAR_SQL_SERVER, not SEPIDAR_SQL_HOST.
// Calls ONLY bridge.GetFinancialDocumentDetails(@VoucherRef, @VoucherNumber).
// Direct Sepidar table access is NOT permitted here.
import { getSepidarSqlConfig, sql } from "../_shared/sepidarSqlClient.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ success: false, message: "Method not allowed" }, 405);

  let body: { voucherRef?: number | string | null; voucherNumber?: number | string | null } = {};
  try { body = await req.json(); } catch { return json({ success: false, message: "بدنه درخواست نامعتبر است." }, 400); }

  // Validate that at least one of voucherRef or voucherNumber is provided and numeric.
  const voucherRef = body.voucherRef != null ? Number(body.voucherRef) : NaN;
  const voucherNumber = body.voucherNumber != null ? Number(body.voucherNumber) : NaN;
  const hasRef = Number.isFinite(voucherRef) && voucherRef > 0;
  const hasNumber = Number.isFinite(voucherNumber) && voucherNumber > 0;
  if (!hasRef && !hasNumber)
    return json({ success: false, message: "حداقل یکی از شماره سند یا مرجع سند سپیدار معتبر نیست." }, 400);

  // Centralized env validation + config — see _shared/sepidarSqlClient.ts.
  const cfg = getSepidarSqlConfig();
  if (!cfg.ok) return json({ success: false, message: cfg.message }, 500);

  let pool: sql.ConnectionPool | null = null;
  try {
    console.log("[sepidar-financial-document-details] start", { ...cfg.meta, voucherRef, voucherNumber });
    pool = await new sql.ConnectionPool(cfg.config).connect();
    const r = pool.request();
    r.input("VoucherRef", sql.Int, hasRef ? voucherRef : null);
    r.input("VoucherNumber", sql.Int, hasNumber ? voucherNumber : null);
    const result = await r.execute("bridge.GetFinancialDocumentDetails");
    const rows = (result.recordset as Record<string, unknown>[]) || [];
    console.log("[sepidar-financial-document-details] ok rows=", rows.length);
    return json({
      success: true,
      message: "جزئیات سند مالی سپیدار با موفقیت دریافت شد.",
      data: rows,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[sepidar-financial-document-details] error", msg, e);
    return json({
      success: false,
      message: "جزئیات سند مالی سپیدار قابل واکشی نیست.",
      rawError: msg,
    });
  } finally {
    try { if (pool) await pool.close(); } catch (closeErr) { console.warn("pool close", closeErr); }
  }
});
