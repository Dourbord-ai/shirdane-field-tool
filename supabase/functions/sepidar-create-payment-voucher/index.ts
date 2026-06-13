// Edge Function: sepidar-create-payment-voucher
// Do not change Sepidar SQL env variable names. Official env is SEPIDAR_SQL_SERVER, not SEPIDAR_SQL_HOST.
//
// Calls ONLY the final stored procedure bridge.CreateBankVoucher.
// (Replaces the earlier temporary bridge.CreatePaymentRequestVoucher.)
//
// Inputs accepted from the caller (frontend / business logic):
//   bankAccountSLRef  -> @BankAccountSLRef  (Sepidar SL ref of the selected bank account)
//   bankDLRef         -> @BankDLRef         (Sepidar DL ref of the selected bank account)
//   partyId           -> @PartyId           (Sepidar party/beneficiary id)
//   partyAccountSLRef -> @PartyAccountSLRef (resolved server-side if missing — see priority below)
//   requestType       -> @RequestType       (0 = receipt/شناسایی دریافت, 1..7 = payment/پرداخت)
//   amount            -> @Amount
//   voucherDate       -> @VoucherDate       (Jalali / SP-accepted string)
//   description       -> @Description
//   description1      -> @Description1
//   description2      -> @Description2
//   creator           -> @Creator
//
// partyDLRef is NOT sent — the SP resolves it from @PartyId.
//
// PartyAccountSLRef resolution priority:
//   1) caller-provided body.partyAccountSLRef
//   2) finance_parties.party_account_sl_ref (lookup by sepidar_party_id)
//   3) finance_sepidar_settings.sepidar_party_account_sl_ref (global default)
//   4) hardcoded fallback 193 (last-resort safety net only)
import { getSepidarSqlConfig, sql } from "../_shared/sepidarSqlClient.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// Standard CORS headers — kept inline because this function predates the
// shared cors helper used by newer functions.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Body = {
  // Bank coordinates (from finance_banks.sepidar_account_id / sepidar_dl_id of the
  // bank the user selected). Frontend MUST pass these — the SP needs both.
  bankAccountSLRef?: number | string | null;
  bankDLRef?: number | string | null;

  // Party coordinates — only PartyId is required; PartyAccountSLRef is resolved
  // server-side unless explicitly provided.
  partyId?: number | string | null;
  partyAccountSLRef?: number | string | null;

  // Voucher data
  requestType?: number | string | null;
  amount?: number | string | null;
  voucherDate?: string | null;
  description?: string | null;
  description1?: string | null;
  description2?: string | null;
  creator?: number | string | null;
};

// Tiny JSON helper that always includes CORS headers (including on errors).
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), {
    status: s,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// Documented last-resort fallback. In the legacy working system PartyAccountSLRef
// happened to be 193 for every party; the new architecture stores the real value
// per-party in finance_parties.party_account_sl_ref. We keep 193 only to avoid
// hard failures if both the party row AND the global setting are missing.
const FALLBACK_PARTY_ACCOUNT_SL_REF = 193;

// Debug-only marker so logs show where the final PartyAccountSLRef came from.
type SLRefSource = "request" | "party" | "settings" | "fallback";

// Resolve PartyAccountSLRef in the documented priority order (see header).
async function resolvePartyAccountSLRef(
  sepidarPartyId: number,
): Promise<{ value: number; source: SLRefSource }> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  // If service-role env is missing (very unlikely on hosted runtime) fall back
  // to the documented constant so the SP call still succeeds.
  if (!supabaseUrl || !serviceKey) {
    return { value: FALLBACK_PARTY_ACCOUNT_SL_REF, source: "fallback" };
  }
  const sb = createClient(supabaseUrl, serviceKey);

  // Step 2 — per-party value stored on finance_parties.
  try {
    const { data: partyRow } = await sb
      .from("finance_parties")
      .select("party_account_sl_ref")
      .eq("sepidar_party_id", sepidarPartyId)
      .limit(1)
      .maybeSingle();
    const pv = (partyRow as { party_account_sl_ref?: number | null } | null)
      ?.party_account_sl_ref;
    if (pv != null && Number.isFinite(Number(pv)) && Number(pv) > 0) {
      return { value: Number(pv), source: "party" };
    }
  } catch (e) {
    console.warn("[sepidar-create-voucher] party lookup failed", e);
  }

  // Step 3 — global setting on finance_sepidar_settings.
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

  // Step 4 — last-resort constant. Logged via slRefSource so misconfiguration
  // is easy to spot in production.
  return { value: FALLBACK_PARTY_ACCOUNT_SL_REF, source: "fallback" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST")
    return json({ success: false, message: "Method not allowed" }, 405);

  // ---- Parse body ----------------------------------------------------------------
  let body: Body = {};
  try {
    body = await req.json();
  } catch {
    return json({ success: false, message: "بدنه درخواست نامعتبر است." }, 400);
  }

  // ---- Coerce + validate required inputs -----------------------------------------
  // Numeric coercion is done up-front so every validation branch can rely on
  // Number.isFinite(x). Strings like "12" coming from form inputs are accepted.
  const bankAccountSLRef =
    body.bankAccountSLRef != null ? Number(body.bankAccountSLRef) : NaN;
  const bankDLRef = body.bankDLRef != null ? Number(body.bankDLRef) : NaN;
  const partyId = body.partyId != null ? Number(body.partyId) : NaN;
  const requestType = body.requestType != null ? Number(body.requestType) : NaN;
  const amount = body.amount != null ? Number(body.amount) : NaN;
  const creator = body.creator != null ? Number(body.creator) : NaN;
  const voucherDate = (body.voucherDate ?? "").toString().trim();

  if (!Number.isFinite(bankAccountSLRef) || bankAccountSLRef <= 0)
    return json(
      { success: false, message: "حساب بانکی سپیدار (bankAccountSLRef) معتبر نیست." },
      400,
    );
  if (!Number.isFinite(bankDLRef) || bankDLRef <= 0)
    return json(
      { success: false, message: "تفصیلی بانک سپیدار (bankDLRef) معتبر نیست." },
      400,
    );
  if (!Number.isFinite(partyId) || partyId <= 0)
    return json({ success: false, message: "شناسه ذینفع سپیدار معتبر نیست." }, 400);

  // requestType: 0 = receipt (شناسایی دریافت), 1..7 = payment (پرداخت).
  // Anything outside 0..7 is rejected — keeps the SP from receiving garbage.
  if (
    !Number.isFinite(requestType) ||
    !Number.isInteger(requestType) ||
    requestType < 0 ||
    requestType > 7
  ) {
    return json(
      {
        success: false,
        message: "نوع درخواست (requestType) باید 0 (دریافت) یا 1..7 (پرداخت) باشد.",
      },
      400,
    );
  }

  if (!Number.isFinite(amount) || amount <= 0)
    return json({ success: false, message: "مبلغ سند نامعتبر است." }, 400);
  if (!voucherDate)
    return json({ success: false, message: "تاریخ سند الزامی است." }, 400);
  if (!Number.isFinite(creator) || creator <= 0)
    return json(
      { success: false, message: "شناسه ثبت‌کننده (creator) الزامی است." },
      400,
    );

  // ---- Resolve PartyAccountSLRef -------------------------------------------------
  let partyAccountSLRef: number;
  let slRefSource: SLRefSource = "request";
  if (body.partyAccountSLRef != null && `${body.partyAccountSLRef}`.trim() !== "") {
    // Caller explicitly forced a value (power-user / migration path).
    const v = Number(body.partyAccountSLRef);
    if (!Number.isFinite(v) || v <= 0)
      return json({ success: false, message: "partyAccountSLRef نامعتبر است." }, 400);
    partyAccountSLRef = v;
  } else {
    const resolved = await resolvePartyAccountSLRef(partyId);
    partyAccountSLRef = resolved.value;
    slRefSource = resolved.source;
  }

  // ---- Sepidar SQL config --------------------------------------------------------
  const cfg = getSepidarSqlConfig();
  if (!cfg.ok) return json({ success: false, message: cfg.message }, 500);

  let pool: sql.ConnectionPool | null = null;
  try {
    console.log("[sepidar-create-voucher] start", {
      ...cfg.meta,
      bankAccountSLRef,
      bankDLRef,
      partyId,
      partyAccountSLRef,
      slRefSource,
      requestType,
      amount,
      voucherDate,
      creator,
    });

    pool = await new sql.ConnectionPool(cfg.config).connect();
    const r = pool.request();

    // Bind every SP parameter explicitly with the right SQL type. mssql is strict
    // about type matching, especially Decimal precision/scale.
    r.input("BankAccountSLRef", sql.Int, bankAccountSLRef);
    r.input("BankDLRef", sql.Int, bankDLRef);
    r.input("PartyId", sql.Int, partyId);
    r.input("PartyAccountSLRef", sql.Int, partyAccountSLRef);
    r.input("RequestType", sql.Int, requestType);
    r.input("Amount", sql.Decimal(18, 2), amount);
    r.input("VoucherDate", sql.NVarChar, voucherDate);
    r.input("Description", sql.NVarChar, body.description ?? null);
    r.input("Description1", sql.NVarChar, body.description1 ?? null);
    r.input("Description2", sql.NVarChar, body.description2 ?? null);
    r.input("Creator", sql.Int, creator);

    // Call the FINAL stored procedure (bridge.CreateBankVoucher). The earlier
    // bridge.CreatePaymentRequestVoucher is no longer used by this function.
    const result = await r.execute("bridge.CreateBankVoucher");
    const rows = (result.recordset as Record<string, unknown>[]) || [];
    const row = rows[0] || {};

    // SP convention: returns success = 0 (failure) or 1 (success). Treat 0 as a
    // business failure and surface the SP-provided error message verbatim.
    const successFlag = Number((row as any).success ?? (row as any).Success ?? 1);
    if (successFlag === 0) {
      const errMsg =
        (row as any).error_message ?? (row as any).ErrorMessage ?? "unknown SP failure";
      console.error("[sepidar-create-voucher] SP returned success=0", errMsg, row);
      // NOTE: caller (frontend) must NOT mark the transaction/request as assigned
      // on this path — it stays in `assigning` so the user can retry or cancel.
      return json({
        success: false,
        message: "ثبت سند بانکی در سپیدار ناموفق بود.",
        rawError: String(errMsg),
      });
    }

    console.log("[sepidar-create-voucher] ok", row);
    // On success the caller is expected to:
    //  1) save the returned sepidar_* / voucher_* refs onto the request/transaction,
    //  2) promote assignment_status from `assigning` to `assigned`.
    return json({
      success: true,
      message: "سند بانکی سپیدار با موفقیت ثبت شد.",
      data: row,
    });
  } catch (e) {
    // Any network / SQL / driver error lands here. Same rule as above:
    // do NOT mark the transaction assigned — leave it in `assigning`.
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[sepidar-create-voucher] error", msg, e);
    return json({
      success: false,
      message: "ثبت سند بانکی سپیدار قابل انجام نیست.",
      rawError: msg,
    });
  } finally {
    // Always close the pool — leaking connections eventually exhausts SQL Server.
    try {
      if (pool) await pool.close();
    } catch (closeErr) {
      console.warn("pool close", closeErr);
    }
  }
});
