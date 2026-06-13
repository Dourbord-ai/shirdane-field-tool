// Edge Function: sepidar-financial-documents
// Do not change Sepidar SQL env variable names. Official env is SEPIDAR_SQL_SERVER, not SEPIDAR_SQL_HOST.
// Calls ONLY bridge.GetFinancialDocuments(@FromDate, @ToDate, @VoucherState, @TopCount).
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

  let body: {
    fromDate?: string | null;
    toDate?: string | null;
    voucherState?: number | null;
    topCount?: number | null;
  } = {};
  try { body = await req.json(); } catch { return json({ success: false, message: "بدنه درخواست نامعتبر است." }, 400); }

  // Validate topCount
  let topCount = body.topCount != null ? Number(body.topCount) : 200;
  if (Number.isNaN(topCount) || topCount <= 0) topCount = 200;
  if (topCount > 1000) topCount = 1000;

  // Validate voucherState
  const voucherState = body.voucherState != null ? Number(body.voucherState) : null;
  const hasVoucherState = voucherState != null && Number.isFinite(voucherState);

  // Parse dates if provided
  const fromDate = body.fromDate ? new Date(body.fromDate) : null;
  const toDate = body.toDate ? new Date(body.toDate) : null;

  // Centralized env validation + config — see _shared/sepidarSqlClient.ts.
  const cfg = getSepidarSqlConfig();
  if (!cfg.ok) return json({ success: false, message: cfg.message }, 500);

  let pool: sql.ConnectionPool | null = null;
  try {
    console.log("[sepidar-financial-docs] start", { fromDate: body.fromDate, toDate: body.toDate, voucherState, topCount });
    pool = await new sql.ConnectionPool(cfg.config).connect();
    const r = pool.request();
    r.input("FromDate", sql.DateTime, fromDate);
    r.input("ToDate", sql.DateTime, toDate);
    r.input("VoucherState", sql.Int, hasVoucherState ? voucherState : null);
    r.input("TopCount", sql.Int, topCount);
    const result = await r.execute("bridge.GetFinancialDocuments");
    const rows = (result.recordset as Record<string, unknown>[]) || [];
    console.log("[sepidar-financial-docs] ok rows=", rows.length);
    return json({
      success: true,
      message: "لیست اسناد مالی سپیدار با موفقیت دریافت شد.",
      data: rows,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[sepidar-financial-docs] error", msg);
    return json({
      success: false,
      message: "لیست اسناد مالی سپیدار قابل واکشی نیست.",
      rawError: msg,
    });
  } finally {
    try { if (pool) await pool.close(); } catch (closeErr) { console.warn("[sepidar-financial-docs] pool close", closeErr); }
  }
});
