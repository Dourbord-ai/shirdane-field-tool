// Edge Function: sepidar-beneficiary-balance
// Do not change Sepidar SQL env variable names. Official env is SEPIDAR_SQL_SERVER, not SEPIDAR_SQL_HOST.
// Calls ONLY bridge.GetBeneficiaryBalance(@PartyId).
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

  let body: { partyId?: number | string | null } = {};
  try { body = await req.json(); } catch { return json({ success: false, message: "بدنه درخواست نامعتبر است." }, 400); }

  const partyId = body.partyId != null ? Number(body.partyId) : NaN;
  if (!Number.isFinite(partyId) || partyId <= 0)
    return json({ success: false, message: "شناسه ذینفع سپیدار معتبر نیست." }, 400);

  // Centralized env validation + config — see _shared/sepidarSqlClient.ts.
  const cfg = getSepidarSqlConfig();
  if (!cfg.ok) return json({ success: false, message: cfg.message }, 500);

  let pool: sql.ConnectionPool | null = null;
  try {
    console.log("[sepidar-balance] connecting", { ...cfg.meta, partyId });
    pool = await new sql.ConnectionPool(cfg.config).connect();
    const r = pool.request();
    r.input("PartyId", sql.Int, partyId);
    const result = await r.execute("bridge.GetBeneficiaryBalance");
    const rows = (result.recordset as Record<string, unknown>[]) || [];
    const first = rows[0] || {};
    console.log("[sepidar-balance] ok", { partyId, rows: rows.length });
    return json({
      success: true,
      message: "مانده ذینفع با موفقیت دریافت شد.",
      data: first,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[sepidar-balance] error", msg, e);
    return json({
      success: false,
      message: "مانده ذینفع سپیدار قابل واکشی نیست.",
      rawError: msg,
    });
  } finally {
    try { if (pool) await pool.close(); } catch (closeErr) { console.warn("[sepidar-balance] pool close error", closeErr); }
  }
});
