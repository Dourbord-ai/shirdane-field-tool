// Edge Function: sepidar-post-voucher
// ----------------------------------------------------------------------------
// Posts a finance_vouchers row (with its finance_voucher_items) to Sepidar by
// calling the SQL Server bridge stored procedure. This replaces the
// placeholder `syncVoucherToSepidar` that previously lived in src/lib/finance.ts.
//
// Flow:
//   1. Load the voucher header + items from Postgres using the service role key.
//   2. Build a JSON header + JSON items payload.
//   3. Call the bridge stored procedure (configurable via SEPIDAR_POST_VOUCHER_SP,
//      defaults to `bridge.PostFinanceVoucher`).
//   4. On success → update finance_vouchers.sepidar_sync_status='synced' plus the
//      returned sepidar_* ids.
//   5. On failure → update finance_vouchers.sepidar_sync_status='failed' and
//      save sepidar_error_message.
//
// Env (re-uses the official Sepidar SQL variables — DO NOT rename):
//   SEPIDAR_SQL_SERVER / SEPIDAR_SQL_PORT / SEPIDAR_SQL_DATABASE
//   SEPIDAR_SQL_USER   / SEPIDAR_SQL_PASSWORD
//   SEPIDAR_SQL_ENCRYPT / SEPIDAR_SQL_TRUST_CERT
//   SEPIDAR_POST_VOUCHER_SP   (optional, default `bridge.PostFinanceVoucher`)
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY  (auto-injected by Supabase)

import { getSepidarSqlConfig, sql } from "../_shared/sepidarSqlClient.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// Inline CORS headers — keeps the function self-contained.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// JSON helper that always includes CORS headers, even on errors.
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), {
    status: s,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

type Body = { voucher_id?: string | null };

// Translate raw SQL Server driver errors into Persian, user-friendly messages.
// The raw message is still returned in `rawError` for debugging.
function persianizeError(raw: string): string {
  const m = (raw || "").toLowerCase();
  if (m.includes("login failed") || m.includes("18456"))
    return "نام کاربری یا رمز عبور اتصال سپیدار اشتباه است.";
  if (
    m.includes("etimedout") ||
    m.includes("timeout") ||
    m.includes("econnrefused") ||
    m.includes("enotfound") ||
    m.includes("socket") ||
    m.includes("network")
  )
    return "ارتباط با سرور سپیدار برقرار نشد.";
  if (
    m.includes("could not find stored procedure") ||
    m.includes("cannot find") ||
    m.includes("2812")
  )
    return "پروسیژر ثبت سند سپیدار پیدا نشد.";
  return "ثبت سند در سپیدار با خطا مواجه شد.";
}

// Mark the voucher as failed and log the error message. Best-effort — never
// throws because we're already inside a failure handler.
async function markFailed(
  sb: ReturnType<typeof createClient>,
  voucherId: string,
  message: string,
  attempts: number,
) {
  try {
    await sb
      .from("finance_vouchers")
      .update({
        sepidar_sync_status: "failed",
        sepidar_error_message: message,
        sepidar_sync_attempts: attempts,
      })
      .eq("id", voucherId);
    await sb.from("finance_sepidar_sync_logs").insert({
      voucher_id: voucherId,
      operation_type: "post_voucher",
      status: "failed",
      error_message: message,
    } as never);
  } catch (e) {
    console.warn("[sepidar-post-voucher] markFailed log failed", e);
  }
}

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
  const voucherId = (body.voucher_id ?? "").toString().trim();
  if (!voucherId)
    return json({ success: false, message: "voucher_id الزامی است." }, 400);

  // ---- Supabase service-role client -------------------------------------------
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !serviceKey)
    return json(
      { success: false, message: "تنظیمات Supabase در Edge Function ناقص است." },
      500,
    );
  const sb = createClient(supabaseUrl, serviceKey);

  // ---- Load voucher header + items --------------------------------------------
  const { data: voucher, error: vErr } = await sb
    .from("finance_vouchers")
    .select("*")
    .eq("id", voucherId)
    .maybeSingle();
  if (vErr || !voucher) {
    return json(
      {
        success: false,
        message: "سند مالی یافت نشد.",
        rawError: vErr?.message ?? null,
      },
      404,
    );
  }

  const attempts =
    Number((voucher as { sepidar_sync_attempts?: number }).sepidar_sync_attempts ?? 0) + 1;

  const { data: items, error: iErr } = await sb
    .from("finance_voucher_items")
    .select("*")
    .eq("voucher_id", voucherId)
    .order("row_number", { ascending: true });
  if (iErr) {
    await markFailed(sb, voucherId, "بارگذاری ردیف‌های سند با خطا مواجه شد.", attempts);
    return json(
      { success: false, message: "بارگذاری ردیف‌های سند ناموفق بود.", rawError: iErr.message },
      500,
    );
  }
  if (!items || items.length === 0) {
    await markFailed(sb, voucherId, "سند هیچ ردیفی ندارد.", attempts);
    return json({ success: false, message: "سند هیچ ردیفی ندارد." }, 400);
  }

  // Optimistic UI marker — flips back to failed below on any error.
  await sb
    .from("finance_vouchers")
    .update({ sepidar_sync_status: "syncing", sepidar_sync_attempts: attempts })
    .eq("id", voucherId);

  // ---- Sepidar SQL config ------------------------------------------------------
  const cfg = getSepidarSqlConfig();
  if (!cfg.ok) {
    await markFailed(sb, voucherId, cfg.message, attempts);
    return json({ success: false, message: cfg.message }, 500);
  }

  // The bridge SP name is configurable so DBAs can rename without a redeploy.
  const spName =
    Deno.env.get("SEPIDAR_POST_VOUCHER_SP") || "bridge.PostFinanceVoucher";

  // Build JSON payloads. We keep this generic so the SP can pick the fields it
  // needs without us hard-coding every column shape.
  const headerJson = JSON.stringify(voucher);
  const itemsJson = JSON.stringify(items);

  let pool: sql.ConnectionPool | null = null;
  try {
    console.log("[sepidar-post-voucher] start", {
      ...cfg.meta,
      voucherId,
      itemCount: items.length,
      spName,
    });

    pool = await new sql.ConnectionPool(cfg.config).connect();
    const r = pool.request();
    r.input("VoucherId", sql.NVarChar, voucherId);
    r.input("VoucherHeader", sql.NVarChar(sql.MAX), headerJson);
    r.input("VoucherItems", sql.NVarChar(sql.MAX), itemsJson);

    const result = await r.execute(spName);
    const row = ((result.recordset as Record<string, unknown>[]) || [])[0] || {};

    // SP contract: success = 0 (failure) or 1 (success). Same as the other
    // bridge SPs in this project.
    const successFlag = Number(
      (row as Record<string, unknown>).success ??
        (row as Record<string, unknown>).Success ??
        1,
    );
    if (successFlag === 0) {
      const errMsg = String(
        (row as Record<string, unknown>).error_message ??
          (row as Record<string, unknown>).ErrorMessage ??
          "unknown SP failure",
      );
      console.error("[sepidar-post-voucher] SP returned success=0", errMsg, row);
      await markFailed(sb, voucherId, errMsg, attempts);
      return json({
        success: false,
        message: "ثبت سند در سپیدار ناموفق بود.",
        rawError: errMsg,
      });
    }

    // Extract Sepidar ids if the SP returned them. All optional — we only
    // persist the ones present so we don't overwrite good data with NULL.
    const pick = (...keys: string[]) => {
      for (const k of keys) {
        const v = (row as Record<string, unknown>)[k];
        if (v != null && v !== "") return v;
      }
      return null;
    };
    const update: Record<string, unknown> = {
      sepidar_sync_status: "synced",
      sepidar_synced_at: new Date().toISOString(),
      sepidar_error_message: null,
      status: "posted",
    };
    const sepidarVoucherId = pick("sepidar_voucher_id", "SepidarVoucherId", "VoucherId");
    const sepidarVoucherNumber = pick("sepidar_voucher_number", "VoucherNumber");
    const sepidarReference = pick("sepidar_reference_number", "ReferenceNumber");
    const sepidarDaily = pick("sepidar_daily_number", "DailyNumber");
    if (sepidarVoucherId != null) update.sepidar_voucher_id = Number(sepidarVoucherId);
    if (sepidarVoucherNumber != null)
      update.sepidar_voucher_number = Number(sepidarVoucherNumber);
    if (sepidarReference != null)
      update.sepidar_reference_number = Number(sepidarReference);
    if (sepidarDaily != null) update.sepidar_daily_number = Number(sepidarDaily);

    await sb.from("finance_vouchers").update(update).eq("id", voucherId);
    await sb.from("finance_sepidar_sync_logs").insert({
      voucher_id: voucherId,
      operation_type: "post_voucher",
      status: "success",
      response_payload: row as never,
    } as never);

    console.log("[sepidar-post-voucher] ok", row);
    return json({ success: true, message: "سند با موفقیت در سپیدار ثبت شد.", data: row });
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    const message = persianizeError(raw);
    console.error("[sepidar-post-voucher] error", raw, e);
    await markFailed(sb, voucherId, message, attempts);
    return json({ success: false, message, rawError: raw }, 500);
  } finally {
    try {
      if (pool) await pool.close();
    } catch (closeErr) {
      console.warn("pool close", closeErr);
    }
  }
});
