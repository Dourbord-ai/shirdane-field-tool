// Edge Function: sepidar-create-interbank-transfer-voucher
//
// Do not change Sepidar SQL env variable names. Official env is
// SEPIDAR_SQL_SERVER, not SEPIDAR_SQL_HOST.
//
// Calls ONLY the stored procedure bridge.CreateSimpleInterBankTransferVoucher,
// which writes a minimal safe inter-bank transfer voucher into:
//   - ACC.Voucher
//   - ACC.VoucherItem
//   - FMK.ExtraData
// (No RPA PaymentHeader/ReceiptHeader integration yet — intentional.)
//
// Inputs accepted from the caller (frontend / business logic):
//   fromBankAccountSLRef -> @FromBankAccountSLRef
//   fromBankDLRef        -> @FromBankDLRef
//   toBankAccountSLRef   -> @ToBankAccountSLRef
//   toBankDLRef          -> @ToBankDLRef
//   amount               -> @Amount
//   voucherDate          -> @VoucherDate (Jalali / SP-accepted string)
//   description          -> @Description
//   creator              -> @Creator
//
// Lifecycle contract (mirrors sepidar-create-payment-voucher):
//   - On SP success: caller MUST save the returned sepidar_* / voucher_* refs
//     onto BOTH related bank transactions and promote their assignment_status
//     from `assigning` to `assigned`.
//   - On SP error or Edge Function error: caller MUST keep assignment_status
//     as `assigning` so the user can retry or manually cancel.
//
// Frontend must never query Sepidar directly — only this Edge Function.

import { getSepidarSqlConfig, sql } from "../_shared/sepidarSqlClient.ts";

// Standard CORS headers — kept inline for parity with sibling Sepidar functions
// that predate the shared cors helper.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Body = {
  fromBankAccountSLRef?: number | string | null;
  fromBankDLRef?: number | string | null;
  toBankAccountSLRef?: number | string | null;
  toBankDLRef?: number | string | null;
  amount?: number | string | null;
  voucherDate?: string | null;
  description?: string | null;
  creator?: number | string | null;
};

// Tiny JSON helper that always includes CORS headers (including on errors).
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), {
    status: s,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// Numeric coercion guard — accepts strings like "12" coming from form inputs.
const posInt = (v: unknown): number => {
  const n = v == null ? NaN : Number(v);
  return Number.isFinite(n) ? n : NaN;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST")
    return json({ success: false, message: "Method not allowed" }, 405);

  // ---- Parse body --------------------------------------------------------------
  let body: Body = {};
  try {
    body = await req.json();
  } catch {
    return json({ success: false, message: "بدنه درخواست نامعتبر است." }, 400);
  }

  // ---- Coerce + validate required inputs --------------------------------------
  const fromBankAccountSLRef = posInt(body.fromBankAccountSLRef);
  const fromBankDLRef = posInt(body.fromBankDLRef);
  const toBankAccountSLRef = posInt(body.toBankAccountSLRef);
  const toBankDLRef = posInt(body.toBankDLRef);
  const amount = posInt(body.amount);
  const creator = posInt(body.creator);
  const voucherDate = (body.voucherDate ?? "").toString().trim();
  const description = (body.description ?? "").toString();

  if (!Number.isFinite(fromBankAccountSLRef) || fromBankAccountSLRef <= 0)
    return json(
      { success: false, message: "حساب بانکی مبدأ سپیدار (fromBankAccountSLRef) معتبر نیست." },
      400,
    );
  if (!Number.isFinite(fromBankDLRef) || fromBankDLRef <= 0)
    return json(
      { success: false, message: "تفصیلی بانک مبدأ سپیدار (fromBankDLRef) معتبر نیست." },
      400,
    );
  if (!Number.isFinite(toBankAccountSLRef) || toBankAccountSLRef <= 0)
    return json(
      { success: false, message: "حساب بانکی مقصد سپیدار (toBankAccountSLRef) معتبر نیست." },
      400,
    );
  if (!Number.isFinite(toBankDLRef) || toBankDLRef <= 0)
    return json(
      { success: false, message: "تفصیلی بانک مقصد سپیدار (toBankDLRef) معتبر نیست." },
      400,
    );
  if (!Number.isFinite(amount) || amount <= 0)
    return json({ success: false, message: "مبلغ سند نامعتبر است." }, 400);
  if (!voucherDate)
    return json({ success: false, message: "تاریخ سند الزامی است." }, 400);
  if (!Number.isFinite(creator) || creator <= 0)
    return json({ success: false, message: "شناسه ثبت‌کننده (creator) الزامی است." }, 400);

  // ---- Sepidar SQL config -----------------------------------------------------
  const cfg = getSepidarSqlConfig();
  if (!cfg.ok) return json({ success: false, message: cfg.message }, 500);

  let pool: sql.ConnectionPool | null = null;
  try {
    console.log("[sepidar-create-interbank-transfer-voucher] start", {
      ...cfg.meta,
      fromBankAccountSLRef,
      fromBankDLRef,
      toBankAccountSLRef,
      toBankDLRef,
      amount,
      voucherDate,
      creator,
    });

    pool = await new sql.ConnectionPool(cfg.config).connect();
    const r = pool.request();

    // Bind every SP parameter explicitly with the right SQL type. mssql is
    // strict about type matching, especially Decimal precision/scale.
    r.input("FromBankAccountSLRef", sql.Int, fromBankAccountSLRef);
    r.input("FromBankDLRef", sql.Int, fromBankDLRef);
    r.input("ToBankAccountSLRef", sql.Int, toBankAccountSLRef);
    r.input("ToBankDLRef", sql.Int, toBankDLRef);
    r.input("Amount", sql.Decimal(18, 2), amount);
    r.input("VoucherDate", sql.NVarChar, voucherDate);
    r.input("Description", sql.NVarChar, description);
    r.input("Creator", sql.Int, creator);

    const result = await r.execute("bridge.CreateSimpleInterBankTransferVoucher");
    const rows = (result.recordset as Record<string, unknown>[]) || [];
    const row = rows[0] || {};

    // SP convention: returns success = 0 (failure) or 1 (success). Treat 0 as a
    // business failure and surface the SP-provided error message verbatim.
    const successFlag = Number((row as any).success ?? (row as any).Success ?? 1);
    if (successFlag === 0) {
      const errMsg =
        (row as any).error_message ?? (row as any).ErrorMessage ?? "unknown SP failure";
      console.error(
        "[sepidar-create-interbank-transfer-voucher] SP returned success=0",
        errMsg,
        row,
      );
      // Caller MUST keep both transactions in `assigning` on this path.
      return json({
        success: false,
        message: "ثبت سند انتقال بین بانکی ناموفق بود.",
        rawError: String(errMsg),
      });
    }

    console.log("[sepidar-create-interbank-transfer-voucher] ok", row);
    // On success the caller is expected to:
    //  1) save the returned refs (sepidar_voucher_id, voucher_number,
    //     voucher_reference_number, voucher_item_id_1, voucher_item_id_2,
    //     fiscal_year_ref, sepidar_posted_at) onto BOTH bank transactions,
    //  2) promote assignment_status from `assigning` to `assigned` on both.
    return json({
      success: true,
      message: "سند انتقال بین بانکی سپیدار با موفقیت ثبت شد.",
      data: row,
    });
  } catch (e) {
    // Network / SQL / driver error — leave both transactions in `assigning`.
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[sepidar-create-interbank-transfer-voucher] error", msg, e);
    return json({
      success: false,
      message: "ثبت سند انتقال بین بانکی سپیدار قابل انجام نیست.",
      rawError: msg,
    });
  } finally {
    try {
      if (pool) await pool.close();
    } catch (closeErr) {
      console.warn("pool close", closeErr);
    }
  }
});
