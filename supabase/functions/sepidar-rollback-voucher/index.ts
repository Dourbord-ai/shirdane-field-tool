// ============================================================================
// Edge Function: sepidar-rollback-voucher
// ----------------------------------------------------------------------------
// Calls the SQL Server stored procedure `bridge.RollbackSepidarVoucher` to
// hard-delete a Sepidar voucher together with its dependent RPA / FMK rows.
//
// Contract:
//   POST body: { sepidarVoucherId: number, extraDataId?: number|null,
//                deleteRpaHeaders?: boolean }
//   Response : { success, result_code, message, sepidar_voucher_id, rawError? }
//
// IMPORTANT — architecture rule:
//   ShirdaneBridge owns NO Supabase tables. This function is intentionally
//   limited to invoking the SP. ALL Supabase mutations (audit log, lifecycle
//   updates, balance recompute) live in the application orchestrator
//   `src/lib/finance/rollback.ts` and run AFTER this function returns success.
//
// Idempotency:
//   result_code === 2  ⇒  voucher already deleted / not found. The orchestrator
//   treats this as success and continues its Supabase cleanup. This lets
//   partially-failed rollbacks be retried safely.
// ============================================================================

import { getSepidarSqlConfig, sql } from "../_shared/sepidarSqlClient.ts";

// Inline CORS headers — mirrors the convention used by the existing Sepidar
// edge functions in this project (no shared helper).
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Small JSON helper — every response (success OR error) must include CORS
// headers so the browser does not strip the body.
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), {
    status: s,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

type Body = {
  // ACC.Voucher.VoucherId — REQUIRED, validated below.
  sepidarVoucherId?: number | string | null;
  // Optional explicit FMK.ExtraData PK. The SP also cleans by EntityRef so this
  // is just a hint when the application happens to know the exact row.
  extraDataId?: number | string | null;
  // Whether to also delete the RPA "intent" headers. Defaults to true because
  // every voucher currently created by this app has a corresponding RPA row.
  deleteRpaHeaders?: boolean | null;
};

Deno.serve(async (req) => {
  // Browsers send a preflight OPTIONS before any POST with custom headers.
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST")
    return json({ success: false, message: "Only POST is supported." }, 405);

  // ---- Parse + validate input -----------------------------------------------
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return json({ success: false, message: "Invalid JSON body." }, 400);
  }

  const sepidarVoucherId = Number(body.sepidarVoucherId);
  if (!Number.isFinite(sepidarVoucherId) || sepidarVoucherId <= 0) {
    return json(
      { success: false, message: "شناسه سند سپیدار (sepidarVoucherId) نامعتبر است." },
      400,
    );
  }

  // extraDataId is optional — only validate when actually provided.
  let extraDataId: number | null = null;
  if (body.extraDataId != null && `${body.extraDataId}`.trim() !== "") {
    const v = Number(body.extraDataId);
    if (!Number.isFinite(v) || v <= 0)
      return json({ success: false, message: "extraDataId نامعتبر است." }, 400);
    extraDataId = v;
  }

  // Default deleteRpaHeaders to true (matches current app usage).
  const deleteRpaHeaders =
    body.deleteRpaHeaders == null ? true : Boolean(body.deleteRpaHeaders);

  // ---- Sepidar SQL config ---------------------------------------------------
  const cfg = getSepidarSqlConfig();
  if (!cfg.ok) return json({ success: false, message: cfg.message }, 500);

  let pool: sql.ConnectionPool | null = null;
  try {
    console.log("[sepidar-rollback-voucher] start", {
      ...cfg.meta,
      sepidarVoucherId,
      extraDataId,
      deleteRpaHeaders,
    });

    pool = await new sql.ConnectionPool(cfg.config).connect();
    const r = pool.request();

    // Bind every parameter with an explicit SQL type — mssql is strict about
    // type coercion (especially BIT vs INT).
    r.input("SepidarVoucherId", sql.Int, sepidarVoucherId);
    r.input("ExtraDataId", sql.Int, extraDataId);
    r.input("DeleteRpaHeaders", sql.Bit, deleteRpaHeaders ? 1 : 0);

    const result = await r.execute("bridge.RollbackSepidarVoucher");
    const rows = (result.recordset as Record<string, unknown>[]) || [];
    const row = rows[0] || {};

    // The SP returns success as a BIT (mssql surfaces this as boolean OR 0/1).
    const successFlag =
      typeof row.success === "boolean"
        ? row.success
        : Number(row.success ?? row.Success ?? 0) === 1;
    const resultCode = Number(row.result_code ?? row.ResultCode ?? -1);
    const message =
      (row.message as string | undefined) ||
      (row.Message as string | undefined) ||
      "";

    console.log("[sepidar-rollback-voucher] ok", { successFlag, resultCode, message });

    // Surface the SP result verbatim so the orchestrator can branch on
    // result_code (0 = deleted, 2 = already gone, -1 = failure).
    return json({
      success: successFlag,
      result_code: resultCode,
      message,
      sepidar_voucher_id: sepidarVoucherId,
      data: row,
    });
  } catch (e) {
    // Any driver / network / SP error. We do NOT mutate Supabase here — the
    // orchestrator must see success=false and abort the Supabase cleanup.
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[sepidar-rollback-voucher] error", msg, e);
    return json({
      success: false,
      result_code: -1,
      message: "حذف سند سپیدار قابل انجام نیست.",
      sepidar_voucher_id: sepidarVoucherId,
      rawError: msg,
    });
  } finally {
    // Always close the pool — long-running edge runtimes exhaust SQL Server
    // connections if pools are leaked.
    try {
      if (pool) await pool.close();
    } catch (closeErr) {
      console.warn("[sepidar-rollback-voucher] pool close", closeErr);
    }
  }
});
