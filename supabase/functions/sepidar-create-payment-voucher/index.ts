// Edge Function: sepidar-create-payment-voucher
// Do not change Sepidar SQL env variable names. Official env is SEPIDAR_SQL_SERVER, not SEPIDAR_SQL_HOST.
// Calls ONLY bridge.CreatePaymentRequestVoucher.
import { getSepidarSqlConfig, sql } from "../_shared/sepidarSqlClient.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Body = {
  partyId?: number | string | null;
  requestType?: number | string | null;
  amount?: number | string | null;
  voucherDate?: string | null;
  description?: string | null;
  description1?: string | null;
  description2?: string | null;
  creator?: number | string | null;
  partyAccountSLRef?: number | string | null;
};

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// Documented fallback — used ONLY when neither the party row nor the global
// setting has a value. In the legacy working system, PartyAccountSLRef
// happened to be 193 for every party; the new architecture stores the
// real value per-party in finance_parties.party_account_sl_ref.
const FALLBACK_PARTY_ACCOUNT_SL_REF = 193;

// Source identifier — used purely for logs/debug so we can see where the
// final PartyAccountSLRef came from. Never returned to the client as the
// authoritative value.
type SLRefSource = "request" | "party" | "settings" | "fallback";

// Resolve PartyAccountSLRef in the documented priority order:
//   1) caller-provided body.partyAccountSLRef
//   2) finance_parties.party_account_sl_ref for the matching sepidar_party_id
//   3) finance_sepidar_settings.sepidar_party_account_sl_ref (global default)
//   4) hardcoded fallback 193 (temporary, kept only for safety)
async function resolvePartyAccountSLRef(
  sepidarPartyId: number,
): Promise<{ value: number; source: SLRefSource }> {
  // Build a service-role client. If env is missing (very unlikely) we fall
  // straight through to the documented constant so the call still works.
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !serviceKey) {
    return { value: FALLBACK_PARTY_ACCOUNT_SL_REF, source: "fallback" };
  }
  const sb = createClient(supabaseUrl, serviceKey);

  // Step 2 — party-specific value. We look up by sepidar_party_id (the same
  // numeric id we send to the SP as @PartyId) so the FE never needs to know
  // about Supabase row UUIDs.
  try {
    const { data: partyRow } = await sb
      .from("finance_parties")
      .select("party_account_sl_ref")
      .eq("sepidar_party_id", sepidarPartyId)
      .limit(1)
      .maybeSingle();
    const pv = (partyRow as { party_account_sl_ref?: number | null } | null)?.party_account_sl_ref;
    if (pv != null && Number.isFinite(Number(pv)) && Number(pv) > 0) {
      return { value: Number(pv), source: "party" };
    }
  } catch (e) {
    console.warn("[sepidar-create-voucher] party lookup failed", e);
  }

  // Step 3 — global setting fallback.
  try {
    const { data: settingsRow } = await sb
      .from("finance_sepidar_settings")
      .select("sepidar_party_account_sl_ref")
      .limit(1)
      .maybeSingle();
    const sv = (settingsRow as { sepidar_party_account_sl_ref?: number | null } | null)
      ?.sepidar_party_account_sl_ref;
    if (sv != null && Number.isFinite(Number(sv)) && Number(sv) > 0) {
      return { value: Number(sv), source: "settings" };
    }
  } catch (e) {
    console.warn("[sepidar-create-voucher] settings lookup failed", e);
  }

  // Step 4 — last-resort constant.
  return { value: FALLBACK_PARTY_ACCOUNT_SL_REF, source: "fallback" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ success: false, message: "Method not allowed" }, 405);

  let body: Body = {};
  try { body = await req.json(); } catch { return json({ success: false, message: "بدنه درخواست نامعتبر است." }, 400); }

  // ---- Validate required inputs --------------------------------------------------
  const partyId = body.partyId != null ? Number(body.partyId) : NaN;
  const requestType = body.requestType != null ? Number(body.requestType) : NaN;
  const amount = body.amount != null ? Number(body.amount) : NaN;
  const creator = body.creator != null ? Number(body.creator) : NaN;
  const voucherDate = (body.voucherDate ?? "").toString().trim();

  if (!Number.isFinite(partyId) || partyId <= 0)
    return json({ success: false, message: "شناسه ذینفع سپیدار معتبر نیست." }, 400);
  if (!Number.isFinite(requestType) || (requestType !== 0 && requestType !== 1))
    return json({ success: false, message: "نوع درخواست (requestType) باید 0 یا 1 باشد." }, 400);
  if (!Number.isFinite(amount) || amount <= 0)
    return json({ success: false, message: "مبلغ سند نامعتبر است." }, 400);
  if (!voucherDate)
    return json({ success: false, message: "تاریخ سند الزامی است." }, 400);
  if (!Number.isFinite(creator) || creator <= 0)
    return json({ success: false, message: "شناسه ثبت‌کننده (creator) الزامی است." }, 400);

  // ---- Resolve PartyAccountSLRef -------------------------------------------------
  // Prefer caller-provided value; otherwise load from Supabase setting; else fallback 193.
  let partyAccountSLRef: number;
  let slRefSource: "request" | "settings" | "fallback" = "request";
  if (body.partyAccountSLRef != null && `${body.partyAccountSLRef}`.trim() !== "") {
    const v = Number(body.partyAccountSLRef);
    if (!Number.isFinite(v) || v <= 0)
      return json({ success: false, message: "partyAccountSLRef نامعتبر است." }, 400);
    partyAccountSLRef = v;
  } else {
    const loaded = await loadConfiguredPartyAccountSLRef();
    partyAccountSLRef = loaded.value;
    slRefSource = loaded.isFallback ? "fallback" : "settings";
  }

  // ---- Sepidar SQL config --------------------------------------------------------
  const cfg = getSepidarSqlConfig();
  if (!cfg.ok) return json({ success: false, message: cfg.message }, 500);

  let pool: sql.ConnectionPool | null = null;
  try {
    console.log("[sepidar-create-voucher] start", {
      ...cfg.meta, partyId, requestType, amount, voucherDate, creator, partyAccountSLRef, slRefSource,
    });
    pool = await new sql.ConnectionPool(cfg.config).connect();
    const r = pool.request();
    r.input("PartyId", sql.Int, partyId);
    r.input("PartyAccountSLRef", sql.Int, partyAccountSLRef);
    r.input("RequestType", sql.Int, requestType);
    r.input("Amount", sql.Decimal(18, 2), amount);
    r.input("VoucherDate", sql.NVarChar, voucherDate);
    r.input("Description", sql.NVarChar, body.description ?? null);
    r.input("Description1", sql.NVarChar, body.description1 ?? null);
    r.input("Description2", sql.NVarChar, body.description2 ?? null);
    r.input("Creator", sql.Int, creator);

    const result = await r.execute("bridge.CreatePaymentRequestVoucher");
    const rows = (result.recordset as Record<string, unknown>[]) || [];
    const row = rows[0] || {};

    // SP returns success = 0/1. Treat 0 as a business failure.
    const successFlag = Number((row as any).success ?? (row as any).Success ?? 1);
    if (successFlag === 0) {
      const errMsg = (row as any).error_message ?? (row as any).ErrorMessage ?? "unknown SP failure";
      console.error("[sepidar-create-voucher] SP returned success=0", errMsg, row);
      return json({
        success: false,
        message: "ثبت سند پرداخت در سپیدار ناموفق بود.",
        rawError: String(errMsg),
      });
    }

    console.log("[sepidar-create-voucher] ok", row);
    return json({
      success: true,
      message: "سند پرداخت سپیدار با موفقیت ثبت شد.",
      data: row,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[sepidar-create-voucher] error", msg, e);
    return json({
      success: false,
      message: "ثبت سند پرداخت سپیدار قابل انجام نیست.",
      rawError: msg,
    });
  } finally {
    try { if (pool) await pool.close(); } catch (closeErr) { console.warn("pool close", closeErr); }
  }
});
