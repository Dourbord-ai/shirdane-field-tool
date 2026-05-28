// =============================================================================
// Edge Function: factor-post-voucher  (REVISED — calls bridge.CreatePaymentRequestVoucher)
// -----------------------------------------------------------------------------
// MVP orchestrator that posts an "approved" factor's accounting voucher.
//
// Pipeline:
//   1. Authenticated caller passes { factor_id }.
//   2. Idempotency pre-check on the Supabase side:
//        if factors.sepidar_voucher_id already exists → return the existing
//        Sepidar voucher and DO NOT call Sepidar again. Same for the linked
//        finance_vouchers.sepidar_voucher_id (mirror back onto factors).
//   3. Call DB RPC `post_approved_factor(factor_id, triggered_by)` to build /
//      reuse the two-line internal voucher.
//   4. Resolve party (sepidar_party_id, party_account_sl_ref, name) and
//      creator id. Compose Description / Description1 / Description2 per the
//      frozen contract.
//   5. Call the existing SQL Server bridge SP `bridge.CreatePaymentRequestVoucher`
//      EXACTLY ONCE using the same mssql client pattern as the finance
//      receive/payment flow. The SP picks the counter account internally
//      based on RequestType (0 = purchase, 1 = sale).
//   6. Mirror returned SepidarVoucherId / SepidarVoucherNumber onto BOTH
//      `finance_vouchers` and `factors` so the next click short-circuits.
//      Advance factor.lifecycle_state to 'posted' on success or
//      'sepidar_failed' on failure (voucher row is preserved → retry button
//      stays visible).
//
// IMPORTANT: bridge.CreatePaymentRequestVoucher is NOT idempotent on any app
// key. The Supabase-side guard above is the only safeguard against duplicate
// Sepidar vouchers — so it must run before every SP call.
// =============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
// Same mssql client used by sepidar-create-payment-voucher / receive flow.
// Re-using it keeps the integration style 1:1 with the existing bridge calls.
import { getSepidarSqlConfig, sql } from "../_shared/sepidarSqlClient.ts";

// ---- CORS ------------------------------------------------------------------
// Kept inline to stay consistent with the other Sepidar-related functions in
// this project (none of them import from a shared cors helper).
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Tiny helper so every response (success OR error) carries CORS headers.
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

type Body = { factor_id?: string | null };

// --------------------------------------------------------------------------
// Persian Jalali date helper (no external dep). We need "YYYY/MM/DD" for the
// Description, NOT for the SP call itself — the SP receives a SQL DATETIME.
// --------------------------------------------------------------------------
function toJalali(date: Date): string {
  // Classic Birashk algorithm. Inputs come from `factors.invoice_date`
  // (timestamptz stored in UTC). We convert to Tehran wall-clock first so the
  // displayed Jalali day matches what the operator sees in the UI.
  const tehran = new Date(date.toLocaleString("en-US", { timeZone: "Asia/Tehran" }));
  let gy = tehran.getFullYear();
  let gm = tehran.getMonth() + 1;
  let gd = tehran.getDate();
  const g_d_m = [0, 31, (gy % 4 === 0 && gy % 100 !== 0) || gy % 400 === 0 ? 29 : 28,
    31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let gy2 = (gm > 2) ? (gy + 1) : gy;
  let days = 355666 + (365 * gy) + Math.floor((gy2 + 3) / 4)
    - Math.floor((gy2 + 99) / 100) + Math.floor((gy2 + 399) / 400) + gd;
  for (let i = 0; i < gm; i++) days += g_d_m[i];
  let jy = -1595 + (33 * Math.floor(days / 12053));
  days %= 12053;
  jy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) { jy += Math.floor((days - 1) / 365); days = (days - 1) % 365; }
  const jm = (days < 186) ? 1 + Math.floor(days / 31) : 7 + Math.floor((days - 186) / 30);
  const jd = 1 + ((days < 186) ? (days % 31) : ((days - 186) % 30));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${jy}/${pad(jm)}/${pad(jd)}`;
}

// --------------------------------------------------------------------------
// Resolve the finance_parties row used for the factor.
// After the M5 unification factors store the selected counterparty directly
// on `factors.finance_party_id` (uuid → finance_parties.id). For older rows
// we fall back to the legacy legacy_id lookup:
//   - purchase factor (factor_type_id = 1) → shopping_center_id → finance_parties.legacy_id
//   - sale factor     (factor_type_id = 2) → buyer_user_id      → finance_parties.legacy_id
// Returns null if no match (caller surfaces Persian error and aborts).
// --------------------------------------------------------------------------
// Version marker — bumped any time the party resolution contract changes so
// logs/responses can prove which build is live.
const FACTOR_POST_VOUCHER_VERSION = "finance_party_id_v3_direct_party_lookup";

type ResolvePartyResult =
  | {
      ok: true;
      matched_by: "finance_party_id" | "legacy_shopping_center_id" | "legacy_buyer_user_id";
      party: {
        id: string;
        sepidar_party_id: number;
        sepidar_account_id: number | null;
        name: string;
      };
      debug: Record<string, unknown>;
    }
  | {
      ok: false;
      error_code:
        | "no_party_link"
        | "finance_party_row_missing"
        | "finance_party_query_error"
        | "sepidar_party_id_missing"
        | "party_account_missing";
      message: string;
      debug: Record<string, unknown>;
    };


async function resolveParty(
  sb: ReturnType<typeof createClient>,
  factor: Record<string, unknown>,
): Promise<ResolvePartyResult> {
  // Columns that actually exist in this project's finance_parties schema.
  // NOTE: party_account_sl_ref does NOT exist locally — use sepidar_account_id.
  const cols =
    "id, sepidar_party_id, sepidar_account_id, sepidar_dl_id, sepidar_dl_code, sepidar_full_name, first_name, last_name, company_name";

  const rawFinancePartyId = factor.finance_party_id;
  const fpid = rawFinancePartyId == null ? null : String(rawFinancePartyId).trim() || null;
  const shoppingCenterId = Number(factor.shopping_center_id ?? 0);
  const buyerUserId = Number(factor.buyer_user_id ?? 0);

  const debug: Record<string, unknown> = {
    factor_id: factor.id,
    finance_party_id: fpid,
    finance_party_id_value: rawFinancePartyId,
    finance_party_id_type: rawFinancePartyId === null ? "null" : typeof rawFinancePartyId,
    query_column_used: null as "id" | "legacy_id" | null,
    matched_party_id: null as string | null,
    shopping_center_id: shoppingCenterId || null,
    buyer_user_id: buyerUserId || null,
    matched_by: null as string | null,
    party_found: false,
    sepidar_party_id: null as number | null,
    sepidar_account_id: null as number | null,
  };

  let row: Record<string, unknown> | null = null;
  type MatchedBy = "finance_party_id" | "legacy_shopping_center_id" | "legacy_buyer_user_id";
  let matchedBy: MatchedBy = "finance_party_id";

  // 1) Preferred: direct uuid link on factors.finance_party_id (post-M5).
  if (fpid) {
    debug.query_column_used = "id";
    const { data, error } = await sb
      .from("finance_parties")
      .select(cols)
      .eq("id", fpid)
      .maybeSingle();

    debug.matched_party_id = (data?.id as string | undefined) ?? null;
    if (error) debug.finance_party_lookup_error = error.message;
    console.log(
      "[factor-post-voucher:finance_party_id_lookup]",
      JSON.stringify({
        version: FACTOR_POST_VOUCHER_VERSION,
        factor_id: factor.id,
        finance_party_id_value: rawFinancePartyId,
        finance_party_id_type: rawFinancePartyId === null ? "null" : typeof rawFinancePartyId,
        query_column_used: "id",
        matched_party_id: debug.matched_party_id,
        query_error: error?.message ?? null,
      }),
    );
    if (error) {
      // Real query error (e.g. missing column) — surface distinctly so we don't
      // mis-report it as "finance_party_row_missing".
      debug.matched_by = "finance_party_id";
      return {
        ok: false,
        error_code: "finance_party_query_error",
        message: `خطا در واکشی ذینفع از پایگاه داده: ${error.message}`,
        debug,
      };
    }
    if (data) {
      row = data as Record<string, unknown>;
      matchedBy = "finance_party_id";
    } else {
      debug.matched_by = "finance_party_id";
      return {
        ok: false,
        error_code: "finance_party_row_missing",
        message: "ذینفع انتخاب‌شده در جدول مالی یافت نشد.",
        debug,
      };
    }
  }

  // 2) Legacy fallback: shopping_center_id / buyer_user_id → legacy_id.
  if (!row) {
    const factorType = Number(factor.factor_type_id);
    const legacyId = factorType === 1 ? shoppingCenterId : buyerUserId;
    if (Number.isFinite(legacyId) && legacyId > 0) {
      debug.query_column_used = "legacy_id";
      const { data } = await sb
        .from("finance_parties")
        .select(cols)
        .eq("legacy_id", legacyId)
        .limit(1)
        .maybeSingle();
      if (data) {
        row = data as Record<string, unknown>;
        matchedBy = factorType === 1 ? "legacy_shopping_center_id" : "legacy_buyer_user_id";
      }
    }
  }

  if (!row) {
    return {
      ok: false,
      error_code: "no_party_link",
      message: "ذینفع فاکتور مشخص نشده است. ابتدا ذینفع را انتخاب و ذخیره کنید.",
      debug,
    };
  }

  debug.party_found = true;
  debug.matched_by = matchedBy;
  debug.sepidar_party_id = (row.sepidar_party_id as number | null) ?? null;
  debug.sepidar_account_id = (row.sepidar_account_id as number | null) ?? null;

  const sepidarId = Number(row.sepidar_party_id);
  if (!Number.isFinite(sepidarId) || sepidarId <= 0) {
    return {
      ok: false,
      error_code: "sepidar_party_id_missing",
      message: "شناسه سپیدار ذینفع تنظیم نشده است.",
      debug,
    };
  }

  const name =
    (row.sepidar_full_name as string | null) ||
    [row.first_name, row.last_name].filter(Boolean).join(" ").trim() ||
    (row.company_name as string | null) ||
    "ذینفع";

  return {
    ok: true,
    matched_by: matchedBy,
    party: {
      id: row.id as string,
      sepidar_party_id: sepidarId,
      sepidar_account_id: (row.sepidar_account_id as number | null) ?? null,
      name,
    },
    debug,
  };
}




// NOTE: No hardcoded fallback for factor posting. Unlike the receive/payment
// flow, factor vouchers MUST resolve PartyAccountSLRef from a configured
// source (per-party value, or the explicit factor setting). Falling back to
// a guessed SL ref can post the voucher to the wrong accounting account.


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ success: false, message: "Method not allowed" }, 405);

  // ---- Parse + validate body ------------------------------------------------
  let body: Body = {};
  try { body = await req.json(); } catch {
    return json({ success: false, message: "بدنه درخواست نامعتبر است." }, 400);
  }
  const factorId = (body.factor_id ?? "").toString().trim();
  if (!factorId) return json({ success: false, version: FACTOR_POST_VOUCHER_VERSION, message: "factor_id الزامی است." }, 400);

  // ---- Supabase service client (used for RPC + reads + writes) -------------
  const url = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!url || !serviceKey) {
    return json({ success: false, message: "تنظیمات Supabase در Edge Function ناقص است." }, 500);
  }
  const sb = createClient(url, serviceKey);

  // ---- Identify caller via JWT (for audit attribution only) ----------------
  let triggeredBy: string | null = null;
  const authHeader = req.headers.get("Authorization") || "";
  if (authHeader.toLowerCase().startsWith("bearer ")) {
    try {
      const { data } = await sb.auth.getUser(authHeader.slice(7).trim());
      triggeredBy = data?.user?.id ?? null;
    } catch { /* non-fatal — proceed without attribution */ }
  }

  // =========================================================================
  // STEP A: SUPABASE-SIDE IDEMPOTENCY GUARD (BEFORE building any voucher)
  // -------------------------------------------------------------------------
  // If this factor already carries a Sepidar voucher id, return it verbatim
  // and skip every downstream step. This is the ONLY thing protecting us
  // from duplicate Sepidar vouchers because bridge.CreatePaymentRequestVoucher
  // is not idempotent on any app key.
  // =========================================================================
  const { data: existingFactor } = await sb
    .from("factors")
    .select("id, sepidar_voucher_id, sepidar_voucher_number, voucher_id")
    .eq("id", factorId)
    .maybeSingle();

  if (!existingFactor) {
    console.log(
      "[factor-post-voucher:factor_lookup]",
      JSON.stringify({
        version: FACTOR_POST_VOUCHER_VERSION,
        factor_id: factorId,
        factor_found: false,
      }),
    );
    return json({ success: false, version: FACTOR_POST_VOUCHER_VERSION, message: "فاکتور یافت نشد." }, 404);
  }

  if (existingFactor.sepidar_voucher_id) {
    // Already posted on a previous attempt — short-circuit, do NOT touch SQL.
    return json({
      success: true,
      step: "already_posted",
      voucher_id: existingFactor.voucher_id,
      sepidar_voucher_id: existingFactor.sepidar_voucher_id,
      sepidar_voucher_number: existingFactor.sepidar_voucher_number,
      message: "این فاکتور قبلاً در سپیدار ثبت شده است.",
    });
  }

  // Secondary guard: voucher row may already carry a sepidar id from a
  // previous partial run (factor row not yet mirrored). Mirror it back and
  // skip the SP call.
  if (existingFactor.voucher_id) {
    const { data: v } = await sb
      .from("finance_vouchers")
      .select("sepidar_voucher_id, sepidar_voucher_number")
      .eq("id", existingFactor.voucher_id)
      .maybeSingle();
    if (v?.sepidar_voucher_id) {
      await sb.from("factors").update({
        sepidar_voucher_id: String(v.sepidar_voucher_id),
        sepidar_voucher_number: v.sepidar_voucher_number ? String(v.sepidar_voucher_number) : null,
        lifecycle_state: "posted",
        last_posting_error: null,
        last_posting_attempted_at: new Date().toISOString(),
      }).eq("id", factorId);
      return json({
        success: true,
        step: "already_posted",
        voucher_id: existingFactor.voucher_id,
        sepidar_voucher_id: v.sepidar_voucher_id,
        sepidar_voucher_number: v.sepidar_voucher_number,
        message: "این فاکتور قبلاً در سپیدار ثبت شده است.",
      });
    }
  }

  // =========================================================================
  // STEP B: build (or reuse) the internal finance_vouchers row via RPC.
  // =========================================================================
  const { data: rpcRes, error: rpcErr } = await sb.rpc("post_approved_factor", {
    p_factor_id: factorId,
    p_triggered_by: triggeredBy,
  });

  if (rpcErr) {
    return json({
      success: false,
      step: "rpc_call",
      message: "ساخت سند مالی با خطا مواجه شد.",
      raw_error: rpcErr.message,
    }, 500);
  }

  const result = (rpcRes ?? {}) as Record<string, unknown>;
  const rpcOk = Boolean(result.success);
  const voucherId = (result.voucher_id as string | null) ?? null;

  // If the RPC refused (TBD mapping, imbalance, …) surface its Persian
  // message and skip Sepidar. The RPC has already updated lifecycle_state.
  if (!rpcOk || !voucherId) {
    return json({ ...result, sepidar_attempted: false });
  }

  // =========================================================================
  // STEP C: load full factor row (we now need fields the RPC didn't return)
  // =========================================================================
  const { data: factorRow, error: factorErr } = await sb
    .from("factors")
    .select(
      "id, factor_type_id, invoice_date, payable_amount, shopping_center_id, buyer_user_id, finance_party_id",
    )
    .eq("id", factorId)
    .maybeSingle();

  if (factorErr || !factorRow) {
    return json({ success: false, step: "load_factor", message: "بارگذاری فاکتور با خطا مواجه شد." }, 500);
  }

  // Pre-check: distinguish "no party link at all" from "party link but no
  // Sepidar mirror". The first case requires the operator to assign a party
  // on the factor; the second requires syncing the party with Sepidar.
  const hasPartyLink = !!factorRow.finance_party_id ||
    Number(factorRow.shopping_center_id ?? 0) > 0 ||
    Number(factorRow.buyer_user_id ?? 0) > 0;
  if (!hasPartyLink) {
    await sb.from("factors").update({
      lifecycle_state: "sepidar_failed",
      last_posting_error: "ذینفع فاکتور مشخص نشده است.",
      last_posting_attempted_at: new Date().toISOString(),
    }).eq("id", factorId);
    return json({
      success: false,
      step: "resolve_party",
      voucher_id: voucherId,
      message: "ذینفع فاکتور مشخص نشده است. ابتدا ذینفع را انتخاب و ذخیره کنید.",
    });
  }


  const factorTypeId = Number(factorRow.factor_type_id);
  if (factorTypeId !== 1 && factorTypeId !== 2) {
    return json({
      success: false,
      step: "classify",
      voucher_id: voucherId,
      message: "نوع فاکتور (خرید/فروش) مشخص نیست.",
    });
  }
  // Contract: 0 for purchase factor, 1 for sale factor.
  const requestType = factorTypeId === 1 ? 0 : 1;
  // Persian display name used inside the Description string.
  const factorName = factorTypeId === 1 ? "خرید دام" : "فروش دام";

  const payable = Number(factorRow.payable_amount);
  if (!Number.isFinite(payable) || payable <= 0) {
    return json({
      success: false,
      step: "validate_amount",
      voucher_id: voucherId,
      message: "مبلغ قابل پرداخت فاکتور نامعتبر است.",
    });
  }

  // =========================================================================
  // STEP D: resolve party + creator (discriminated result → precise errors)
  // =========================================================================
  const partyRes = await resolveParty(sb, factorRow as Record<string, unknown>);
  // Always log the structured resolution outcome so we can prove which branch
  // ran in production without re-deploying instrumentation later.
  console.log(
    "[factor-post-voucher]",
    JSON.stringify({
      version: FACTOR_POST_VOUCHER_VERSION,
      factor_id: factorId,
      party_resolution: partyRes.ok
        ? { ok: true, matched_by: partyRes.matched_by, ...partyRes.debug }
        : { ok: false, error_code: partyRes.error_code, ...partyRes.debug },
    }),
  );

  if (!partyRes.ok) {
    await sb.from("factors").update({
      lifecycle_state: "sepidar_failed",
      last_posting_error: partyRes.message,
      last_posting_attempted_at: new Date().toISOString(),
    }).eq("id", factorId);
    return json({
      success: false,
      step: "resolve_party",
      version: FACTOR_POST_VOUCHER_VERSION,
      voucher_id: voucherId,
      error_code: partyRes.error_code,
      debug: partyRes.debug,
      message: partyRes.message,
    });
  }

  const party = partyRes.party;

  // PartyAccountSLRef resolution — STRICT, no silent fallback.
  // Priority for factor posting (local schema — party_account_sl_ref column
  // does NOT exist on finance_parties, so it is not consulted):
  //   1) finance_parties.sepidar_account_id (per-party Sepidar account id)
  //   2) finance_sepidar_settings.sepidar_party_account_sl_ref (optional global)
  let partyAccountSLRef = 0;
  const acctId = Number(party.sepidar_account_id ?? 0);
  if (Number.isFinite(acctId) && acctId > 0) {
    partyAccountSLRef = acctId;
  }

  if (!partyAccountSLRef || partyAccountSLRef <= 0) {
    const { data: settingsRow } = await sb
      .from("finance_sepidar_settings")
      .select("sepidar_party_account_sl_ref")
      .limit(1).maybeSingle();
    const sv = (settingsRow as { sepidar_party_account_sl_ref?: number | null } | null)
      ?.sepidar_party_account_sl_ref;
    partyAccountSLRef = (sv != null && Number(sv) > 0) ? Number(sv) : 0;
  }
  if (!partyAccountSLRef || partyAccountSLRef <= 0) {
    const msg = "حساب معین سپیدار ذینفع تنظیم نشده است.";
    await sb.from("factors").update({
      lifecycle_state: "sepidar_failed",
      last_posting_error: msg,
      last_posting_attempted_at: new Date().toISOString(),
    }).eq("id", factorId);
    await sb.from("factor_posting_attempts").insert({
      factor_id: factorId,
      voucher_id: voucherId,
      success: false,
      error_code: "party_account_missing",
      request_payload: { party_id: party.sepidar_party_id } as never,
      response_payload: { message: msg } as never,
    } as never);
    return json({
      success: false,
      step: "resolve_party_account_sl_ref",
      version: FACTOR_POST_VOUCHER_VERSION,
      voucher_id: voucherId,
      error_code: "party_account_missing",
      message: msg,
    });
  }




  // Creator: same resolution as sepidar-post-voucher (receive/payment posting).
  // That function reads SEPIDAR_CREATOR_ID with a hardcoded fallback of "1".
  // We mirror that exactly so factor posting works in any environment where
  // receive/payment posting already works — no new env or settings required.
  const creatorRaw = Deno.env.get("SEPIDAR_CREATOR_ID") || "1";
  const creatorEnv = Number(creatorRaw);
  if (!Number.isInteger(creatorEnv) || creatorEnv <= 0) {
    return json({
      success: false,
      step: "resolve_creator",
      voucher_id: voucherId,
      message: "SEPIDAR_CREATOR_ID باید عدد صحیح معتبر باشد.",
    });
  }


  // =========================================================================
  // STEP E: compose Description / Description1 / Description2 per contract.
  // =========================================================================
  const invoiceDate = factorRow.invoice_date ? new Date(factorRow.invoice_date as string) : new Date();
  const persianDate = toJalali(invoiceDate);
  // Contract format: "بابت فاکتور کد {FactorId} تاریخ {PersianDate} نوع {factorname}"
  const baseDescription =
    `بابت فاکتور کد ${factorId} تاریخ ${persianDate} نوع ${factorName}`;
  // Description2 adds the party with a direction-aware preposition:
  //   purchase (RequestType=0) → " از " + party  (we bought FROM them)
  //   sale     (RequestType=1) → " به " + party  (we sold TO them)
  const description2 =
    baseDescription + (requestType === 1 ? " به " : " از ") + party.name;

  // =========================================================================
  // STEP F: call bridge.CreatePaymentRequestVoucher (single SP call).
  // =========================================================================
  const cfg = getSepidarSqlConfig();
  if (!cfg.ok) {
    // Treat config errors as sepidar_failed so the retry button stays.
    await sb.from("factors").update({
      lifecycle_state: "sepidar_failed",
      last_posting_error: cfg.message,
      last_posting_attempted_at: new Date().toISOString(),
    }).eq("id", factorId);
    return json({ success: false, step: "sepidar_config", voucher_id: voucherId, message: cfg.message });
  }

  let pool: sql.ConnectionPool | null = null;
  let sepidarOk = false;
  let sepidarMessage = "";
  let sepidarVoucherId: string | null = null;
  let sepidarVoucherNumber: string | null = null;
  let rawError: unknown = null;

  try {
    console.log("[factor-post-voucher] SP call", {
      factorId, voucherId, partyId: party.sepidar_party_id,
      partyAccountSLRef, requestType, amount: payable, creator: creatorEnv,
    });

    pool = await new sql.ConnectionPool(cfg.config).connect();
    const r = pool.request();

    // Explicit typed bindings — bridge.CreatePaymentRequestVoucher expects:
    //   @PartyId INT, @PartyAccountSLRef INT, @RequestType TINYINT,
    //   @Amount DECIMAL(18,2), @VoucherDate DATETIME,
    //   @Description / @Description1 / @Description2 NVARCHAR(MAX), @Creator INT
    r.input("PartyId",           sql.Int,            party.sepidar_party_id);
    r.input("PartyAccountSLRef", sql.Int,            partyAccountSLRef);
    r.input("RequestType",       sql.TinyInt,        requestType);
    r.input("Amount",            sql.Decimal(18, 2), payable);
    // Per contract: VoucherDate goes as SQL DATETIME (not a Jalali string).
    r.input("VoucherDate",       sql.DateTime,       invoiceDate);
    r.input("Description",       sql.NVarChar(sql.MAX), baseDescription);
    r.input("Description1",      sql.NVarChar(sql.MAX), baseDescription);
    r.input("Description2",      sql.NVarChar(sql.MAX), description2);
    r.input("Creator",           sql.Int,            creatorEnv);

    const spRes = await r.execute("bridge.CreatePaymentRequestVoucher");
    const rows = (spRes.recordset as Record<string, unknown>[]) || [];
    const row = rows[0] || {};

    // The SP follows the project-wide convention: success=1 on OK, success=0
    // with error_message on failure. Some variants use SepidarVoucherId/Number
    // and others use snake_case — accept both for safety.
    const successFlag = Number(
      (row as Record<string, unknown>).success ?? (row as Record<string, unknown>).Success ?? 1,
    );
    if (successFlag === 0) {
      sepidarMessage = String(
        (row as Record<string, unknown>).error_message ??
        (row as Record<string, unknown>).ErrorMessage ??
        "ثبت سند در سپیدار ناموفق بود.",
      );
      rawError = row;
    } else {
      const id = (row as Record<string, unknown>).SepidarVoucherId ??
                 (row as Record<string, unknown>).sepidar_voucher_id ?? null;
      const num = (row as Record<string, unknown>).SepidarVoucherNumber ??
                  (row as Record<string, unknown>).sepidar_voucher_number ?? null;
      if (id == null) {
        sepidarMessage = "پاسخ سپیدار شامل شناسه سند نبود.";
        rawError = row;
      } else {
        sepidarOk = true;
        sepidarVoucherId = String(id);
        sepidarVoucherNumber = num != null ? String(num) : null;
        sepidarMessage = "سند در سپیدار با موفقیت ثبت شد.";
      }
    }
  } catch (e) {
    sepidarMessage = "ارتباط با سپیدار با خطا مواجه شد.";
    rawError = e instanceof Error ? e.message : String(e);
    console.error("[factor-post-voucher] SP error", rawError);
  } finally {
    // Always close the pool — leaking connections eventually exhausts SQL Server.
    try { if (pool) await pool.close(); } catch (closeErr) { console.warn("pool close", closeErr); }
  }

  // =========================================================================
  // STEP G: success / failure mapping → Supabase rows
  // -------------------------------------------------------------------------
  // IMPORTANT ORDER: write finance_vouchers FIRST, then factors. If the second
  // update fails for any reason, the next retry's idempotency guard (Step A
  // secondary branch) reads finance_vouchers and mirrors it back — no
  // duplicate Sepidar call.
  // =========================================================================
  if (sepidarOk) {
    await sb.from("finance_vouchers").update({
      sepidar_voucher_id: sepidarVoucherId,
      sepidar_voucher_number: sepidarVoucherNumber,
      sepidar_sync_status: "synced",
      sepidar_synced_at: new Date().toISOString(),
      sepidar_error_message: null,
    }).eq("id", voucherId);

    await sb.from("factors").update({
      sepidar_voucher_id: sepidarVoucherId,
      sepidar_voucher_number: sepidarVoucherNumber,
      lifecycle_state: "posted",
      last_posting_error: null,
      last_posting_attempted_at: new Date().toISOString(),
    }).eq("id", factorId);

    // Audit row — best effort.
    await sb.from("factor_posting_attempts").insert({
      factor_id: factorId,
      voucher_id: voucherId,
      success: true,
      error_code: "sepidar_posted",
      request_payload: {
        sp: "bridge.CreatePaymentRequestVoucher",
        request_type: requestType,
        party_id: party.sepidar_party_id,
        party_account_sl_ref: partyAccountSLRef,
        amount: payable,
      } as never,
      response_payload: {
        sepidar_voucher_id: sepidarVoucherId,
        sepidar_voucher_number: sepidarVoucherNumber,
      } as never,
    } as never);
  } else {
    await sb.from("finance_vouchers").update({
      sepidar_sync_status: "failed",
      sepidar_error_message: sepidarMessage,
    }).eq("id", voucherId);

    await sb.from("factors").update({
      lifecycle_state: "sepidar_failed",
      last_posting_error: sepidarMessage,
      last_posting_attempted_at: new Date().toISOString(),
    }).eq("id", factorId);

    await sb.from("factor_posting_attempts").insert({
      factor_id: factorId,
      voucher_id: voucherId,
      success: false,
      error_code: "sepidar_post",
      request_payload: {
        sp: "bridge.CreatePaymentRequestVoucher",
        request_type: requestType,
        party_id: party.sepidar_party_id,
        amount: payable,
      } as never,
      response_payload: { message: sepidarMessage, raw_error: rawError } as never,
    } as never);
  }

  return json({
    success: sepidarOk,
    step: sepidarOk ? "posted" : "sepidar_post",
    voucher_id: voucherId,
    sepidar_voucher_id: sepidarVoucherId,
    sepidar_voucher_number: sepidarVoucherNumber,
    attempt_number: result.attempt_number ?? null,
    posted_lines: result.posted_lines ?? null,
    message: sepidarOk
      ? "سند مالی ساخته و در سپیدار ثبت شد."
      : `سند مالی ساخته شد ولی ثبت در سپیدار ناموفق بود. ${sepidarMessage}`,
    sepidar_attempted: true,
  });
});
