// =============================================================================
// Edge Function: factor-post-voucher
// -----------------------------------------------------------------------------
// MVP orchestrator that posts an "approved" factor's accounting voucher.
// Pipeline:
//   1. Authenticated caller passes { factor_id }.
//   2. We call the DB RPC `post_approved_factor(factor_id, triggered_by)`.
//      The RPC resolves active rows from `factor_accounting_map`, refuses to
//      proceed if mappings are missing/inactive/TBD-, builds the voucher +
//      items, validates debit=credit, links voucher → factor, and writes one
//      audit row to `factor_posting_attempts`.
//   3. If the RPC returns success AND the resulting voucher_id is present, we
//      attempt to post the voucher to Sepidar by invoking the existing
//      `sepidar-post-voucher` edge function with the same integration pattern
//      used by receive/payment flows. On success we copy the Sepidar voucher
//      id/number back onto `factors` and advance lifecycle_state='posted'.
//      On Sepidar failure we set lifecycle_state='sepidar_failed' and write an
//      audit row — the voucher row is preserved so the operator can retry.
// -----------------------------------------------------------------------------
// IMPORTANT: While `factor_accounting_map` rows are all inactive/TBD- (current
// state at M3r time), the RPC short-circuits at step 'resolve_map'. This edge
// function therefore safely no-ops with a clear Persian error and never
// touches Sepidar. Once real account codes are seeded and rows activated, the
// same code path will start producing real vouchers.
// =============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// CORS headers — keep inline so the function is self-contained and matches the
// pattern used by other Sepidar-related edge functions in this project.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Tiny helper to always emit JSON with CORS headers — saves repetition below.
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

type Body = { factor_id?: string | null };

Deno.serve(async (req) => {
  // ---- CORS preflight --------------------------------------------------------
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ success: false, message: "Method not allowed" }, 405);

  // ---- Parse + validate body -------------------------------------------------
  let body: Body = {};
  try { body = await req.json(); } catch {
    return json({ success: false, message: "بدنه درخواست نامعتبر است." }, 400);
  }
  const factorId = (body.factor_id ?? "").toString().trim();
  if (!factorId) return json({ success: false, message: "factor_id الزامی است." }, 400);

  // ---- Identify caller via JWT (best-effort — RPC accepts NULL) -------------
  // We pull the bearer token off the incoming request, ask Supabase who it
  // belongs to, and forward that user's UUID into the RPC as `triggered_by`
  // for audit attribution. If anything fails we just pass NULL — the RPC
  // tolerates it.
  const authHeader = req.headers.get("Authorization") || "";
  const url = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!url || !serviceKey) {
    return json({ success: false, message: "تنظیمات Supabase در Edge Function ناقص است." }, 500);
  }
  const sb = createClient(url, serviceKey);

  let triggeredBy: string | null = null;
  if (authHeader.toLowerCase().startsWith("bearer ")) {
    try {
      const token = authHeader.slice(7).trim();
      const { data } = await sb.auth.getUser(token);
      triggeredBy = data?.user?.id ?? null;
    } catch {
      // Non-fatal — proceed without attribution.
      triggeredBy = null;
    }
  }

  // ---- Step 1: call the voucher-building RPC --------------------------------
  // We rely on the RPC's structured jsonb result to drive the next step.
  const { data: rpcRes, error: rpcErr } = await sb.rpc("post_approved_factor", {
    p_factor_id: factorId,
    p_triggered_by: triggeredBy,
  });

  if (rpcErr) {
    // Hard failure — RPC threw or DB connection broke.
    return json({
      success: false,
      step: "rpc_call",
      message: "ساخت سند مالی با خطا مواجه شد.",
      raw_error: rpcErr.message,
    }, 500);
  }

  const result = (rpcRes ?? {}) as Record<string, unknown>;
  const ok = Boolean(result.success);
  const voucherId = (result.voucher_id as string | null) ?? null;

  // If the RPC refused to build the voucher (TBD, no mapping, imbalance, …),
  // surface the Persian message directly. The RPC has already written an
  // audit row and updated factor.lifecycle_state to 'voucher_failed'.
  if (!ok || !voucherId) {
    return json({ ...result, sepidar_attempted: false });
  }

  // ---- Step 2: post the new voucher to Sepidar ------------------------------
  // Re-use the existing `sepidar-post-voucher` edge function so we share the
  // exact integration code path used by receive_identification / payment_
  // allocation / bank_transfer / party_transfer. The downstream function reads
  // finance_vouchers.voucher_type to choose the bridge SP. For the new
  // buy_livestock / sell_livestock voucher types it will currently fail with
  // "نوع سند برای ثبت در سپیدار پشتیبانی نمی‌شود" — that's expected until the
  // Sepidar SP branch for factor postings is added in a later phase.
  let sepidarOk = false;
  let sepidarMessage = "";
  let sepidarRaw: unknown = null;

  try {
    const { data: spData, error: spErr } = await sb.functions.invoke(
      "sepidar-post-voucher",
      { body: { voucher_id: voucherId } },
    );
    if (spErr) {
      sepidarMessage = "فراخوانی ثبت سند در سپیدار ناموفق بود.";
      sepidarRaw = spErr.message;
    } else {
      // The downstream function returns { success, message, ... }.
      const spRes = (spData ?? {}) as Record<string, unknown>;
      sepidarOk = Boolean(spRes.success);
      sepidarMessage = (spRes.message as string) || (sepidarOk
        ? "سند در سپیدار ثبت شد."
        : "ثبت سند در سپیدار با خطا مواجه شد.");
      sepidarRaw = spRes;
    }
  } catch (e) {
    sepidarMessage = "ارتباط با تابع ثبت سپیدار برقرار نشد.";
    sepidarRaw = (e as Error).message;
  }

  // ---- Step 3: persist Sepidar outcome on the factor row --------------------
  // On Sepidar success the downstream function has already written
  // sepidar_voucher_id / sepidar_voucher_number onto finance_vouchers. We mirror
  // those onto factors and advance lifecycle_state='posted'. On failure we
  // mark lifecycle_state='sepidar_failed' so the retry button stays visible.
  if (sepidarOk) {
    const { data: v } = await sb.from("finance_vouchers")
      .select("sepidar_voucher_id, sepidar_voucher_number")
      .eq("id", voucherId).maybeSingle();

    await sb.from("factors").update({
      lifecycle_state: "posted",
      sepidar_voucher_id: v?.sepidar_voucher_id != null ? String(v.sepidar_voucher_id) : null,
      sepidar_voucher_number: v?.sepidar_voucher_number != null ? String(v.sepidar_voucher_number) : null,
      last_posting_error: null,
      last_posting_attempted_at: new Date().toISOString(),
    }).eq("id", factorId);

    // Audit row — best effort, do not block the response.
    await sb.from("factor_posting_attempts").insert({
      factor_id: factorId,
      voucher_id: voucherId,
      success: true,
      error_code: "sepidar_posted",
      request_payload: { step: "sepidar_post", attempt_number: result.attempt_number ?? null } as never,
      response_payload: { message: sepidarMessage } as never,
    } as never);
  } else {
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
      request_payload: { step: "sepidar_post", attempt_number: result.attempt_number ?? null } as never,
      response_payload: { message: sepidarMessage, raw_error: sepidarRaw } as never,
    } as never);
  }

  return json({
    success: sepidarOk,
    step: sepidarOk ? "posted" : "sepidar_post",
    voucher_id: voucherId,
    attempt_number: result.attempt_number ?? null,
    posted_lines: result.posted_lines ?? null,
    message: sepidarOk
      ? "سند مالی ساخته و در سپیدار ثبت شد."
      : `سند مالی ساخته شد ولی ثبت در سپیدار ناموفق بود. ${sepidarMessage}`,
    sepidar_attempted: true,
    sepidar_raw: sepidarRaw,
  });
});
