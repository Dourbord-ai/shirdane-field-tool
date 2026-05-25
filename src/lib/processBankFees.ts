// ============================================================================
// Dedicated bank-fee auto-processor.
//
// Triggered by the "شناسایی کارمزد" button on the Bank Transactions tab.
// Independent from the generic auto-process pipeline so the operator can
// run a fee-only sweep without touching deposits / inter-bank transfers.
//
// Pipeline per tx (only withdraws with abs(amount) < FEE_THRESHOLD_IRR):
//   1. Mark assignment_status = 'needs_review',
//      assigned_operation_type = 'bank_fee'.
//   2. Create a finance_payment_request via the atomic
//      `submit_payment_request` RPC, using the configured
//      `default_bank_fee_party_id` from finance_sepidar_settings and
//      amount_type_code = 3 (علی‌الحساب).
//   3. Approve the request (header + items) via approvePaymentRequest().
//   4. Insert a finance_vouchers header pointing at the new request
//      (source_operation_type = 'payment_request') so the existing
//      `sepidar-post-voucher` Edge Function can pick it up.
//   5. Call `sepidar-post-voucher` to push the voucher to Sepidar.
//   6. Mark the transaction as `assigned` (operation_id = pr.id) and
//      stamp the voucher id on it for traceability.
//   7. Write one row to `finance_auto_identification_log` per step so the
//      run is fully auditable.
//
// All work is wrapped in best-effort try/catch — a single bad row never
// aborts the whole sweep. The orchestrator returns a final report shape
// the UI can render as a summary panel.
// ============================================================================

import { supabase } from "@/integrations/supabase/client";
import { approvePaymentRequest } from "@/lib/finance";

// Threshold below which a withdraw is considered a bank fee candidate.
// Mirrors BANK_FEE_THRESHOLD_IRR in autoProcessUnassigned.ts so both
// classifiers stay in lockstep.
export const FEE_THRESHOLD_IRR = 1_000_000;

// We pull a small page at a time so the UI can stream progress and so the
// PostgREST URL stays well under the URI-length cap.
const BATCH_SIZE = 25;

// Console group prefix — every log line is namespaced so DevTools filtering
// (search for "[BankFees]") shows only this run.
const TAG = "[BankFees]";

// ---------------------------------------------------------------------------
// Public progress shape — surfaced into the UI summary panel.
// ---------------------------------------------------------------------------
export interface BankFeesProgress {
  total: number;                 // total unassigned rows fetched
  checked: number;               // rows we actually evaluated
  fee_candidates: number;        // rows that passed the threshold
  payment_requests_created: number;
  sepidar_posted: number;
  failed: number;
  remaining: number;
  lastMessage?: string;
  failures: { txId: string; step: string; message: string }[];
  matched: { txId: string; amount: number; prId: string | null; voucherId: string | null; sepidarVoucherId: string | null }[];
}

export function emptyFeesProgress(): BankFeesProgress {
  return {
    total: 0,
    checked: 0,
    fee_candidates: 0,
    payment_requests_created: 0,
    sepidar_posted: 0,
    failed: 0,
    remaining: 0,
    failures: [],
    matched: [],
  };
}

// ---------------------------------------------------------------------------
// Minimal tx shape we need from the table.
// ---------------------------------------------------------------------------
interface FeeTx {
  id: string;
  bank_id: string | null;
  transaction_type: string | null;
  withdraw_amount: number | null;
  deposit_amount: number | null;
  amount: number | null;
  transaction_datetime: string | null;
  description: string | null;
}

// ---------------------------------------------------------------------------
// Audit helper — writes a single finance_auto_identification_log row.
// Logging is best-effort: failure to log never breaks the main flow.
// ---------------------------------------------------------------------------
async function audit(
  bankTransactionId: string,
  step: string,
  success: boolean,
  message?: string,
  extras?: Record<string, unknown>,
) {
  try {
    await supabase.from("finance_auto_identification_log").insert({
      bank_transaction_id: bankTransactionId,
      step,
      success,
      message: message ?? null,
      candidates: (extras ?? null) as never,
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(TAG, "audit insert failed", { bankTransactionId, step, e });
  }
}

// ---------------------------------------------------------------------------
// Read the configured default bank-fee party once per run.
// Without it we cannot create a valid payment request, so the whole run
// aborts with a clear Persian message.
// ---------------------------------------------------------------------------
async function loadFeeConfig(): Promise<{ partyId: string | null; settingsId: string | null }> {
  const { data, error } = await supabase
    .from("finance_sepidar_settings")
    .select("id, default_bank_fee_party_id")
    .limit(1)
    .maybeSingle();
  if (error) {
    // eslint-disable-next-line no-console
    console.error(TAG, "loadFeeConfig failed", error);
    return { partyId: null, settingsId: null };
  }
  return {
    partyId: (data?.default_bank_fee_party_id as string | null) ?? null,
    settingsId: (data?.id as string | null) ?? null,
  };
}

// ---------------------------------------------------------------------------
// Core per-tx routine. Returns the outcome so the caller can tally.
// ---------------------------------------------------------------------------
async function processOneFeeTx(
  tx: FeeTx,
  feePartyId: string,
): Promise<{
  ok: boolean;
  prId: string | null;
  voucherId: string | null;
  sepidarVoucherId: string | null;
  message: string;
  failedStep?: string;
}> {
  const absWithdraw = Math.abs(Number(tx.withdraw_amount) || Number(tx.amount) || 0);

  // --- Step 1: mark as bank_fee_candidate on the tx row ------------------
  // Per spec, allowed assignment_status values are ONLY:
  //   unassigned, assigning, assigned, rejected, cancelled, partially_assigned
  // (no "needs_review"). The row stays 'unassigned' with the
  // 'bank_fee_candidate' marker while we work. It flips to
  // 'assigned' + 'bank_fee' only after the full pipeline succeeds, and
  // remains 'unassigned' + 'bank_fee_candidate' on any failure so the
  // operator can safely retry.
  const markPayload = {
    assignment_status: "unassigned",
    assigned_operation_type: "bank_fee_candidate",
  };
  // eslint-disable-next-line no-console
  console.log(TAG, "tx.mark.candidate", { txId: tx.id, amount: absWithdraw, markPayload });
  const { error: markErr } = await supabase
    .from("finance_bank_transactions")
    .update(markPayload)
    .eq("id", tx.id)
    .eq("assignment_status", "unassigned");
  if (markErr) {
    await audit(tx.id, "fee.mark.failed", false, markErr.message, { amount: absWithdraw });
    return { ok: false, prId: null, voucherId: null, sepidarVoucherId: null, message: markErr.message, failedStep: "mark" };
  }
  await audit(tx.id, "fee.mark.candidate", true, "marked as bank_fee_candidate", { amount: absWithdraw });

  // --- Step 2: create the payment request via the atomic RPC --------------
  // amount_type_code = 3 (علی‌الحساب) — bank fees aren't paid against a
  // creditor balance, so on-account is the safe default. legacy code = 1
  // (general payment) keeps Sepidar mapping intact.
  const requestPayload = {
    title: `کارمزد بانکی ${new Date(tx.transaction_datetime ?? Date.now()).toLocaleDateString("fa-IR")}`,
    description: tx.description?.slice(0, 200) ?? null,
    request_type: "general",
    legacy_request_type_code: 1,
    status: "pending_approval",
  };
  const itemsPayload = [{
    party_id: feePartyId,
    amount: absWithdraw,
    amount_type_code: 3,
    amount_type: "on_account",
    description: `کارمزد بانکی — تراکنش ${tx.id.slice(0, 8)}`,
    status: "pending_approval",
  }];
  // eslint-disable-next-line no-console
  console.log(TAG, "pr.submit", { txId: tx.id, requestPayload, itemsPayload });

  let prId: string | null = null;
  try {
    const { data, error } = await supabase.rpc(
      "submit_payment_request" as never,
      { p_request: requestPayload, p_items: itemsPayload } as never,
    );
    if (error) throw error;
    prId = (data as unknown as string) || null;
    if (!prId) throw new Error("RPC بدون شناسه برگشت");
  } catch (e) {
    const msg = e instanceof Error ? e.message : "خطای ناشناخته در ثبت درخواست";
    await audit(tx.id, "fee.pr.create.failed", false, msg);
    return { ok: false, prId: null, voucherId: null, sepidarVoucherId: null, message: msg, failedStep: "pr_create" };
  }
  await audit(tx.id, "fee.pr.create", true, "payment request created", { prId });

  // --- Step 3: auto-approve the request -----------------------------------
  // approvePaymentRequest flips header + items to 'approved' and lets the
  // recalc trigger fill confirmed_amount + remaining_amount.
  try {
    await approvePaymentRequest(prId);
    await audit(tx.id, "fee.pr.approve", true, "payment request approved", { prId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "خطای ناشناخته در تأیید درخواست";
    await audit(tx.id, "fee.pr.approve.failed", false, msg, { prId });
    return { ok: false, prId, voucherId: null, sepidarVoucherId: null, message: msg, failedStep: "pr_approve" };
  }

  // --- Step 4: create a finance_voucher header pointing at the PR ---------
  // sepidar-post-voucher resolves branch via voucher_type/source_operation_type.
  // Setting both to 'payment_request' is the safest combo for the existing
  // mapping in DEFAULT_SP.
  let voucherId: string | null = null;
  try {
    const { data: v, error: vErr } = await supabase
      .from("finance_vouchers")
      .insert({
        voucher_type: "payment_request",
        source_operation_type: "payment_request",
        source_operation_id: prId,
        voucher_date: tx.transaction_datetime ?? new Date().toISOString(),
        title: `سند کارمزد بانکی — ${absWithdraw.toLocaleString("fa-IR")} ریال`,
        description: tx.description?.slice(0, 200) ?? null,
        status: "draft",
        sepidar_sync_status: "pending",
      } as never)
      .select("id")
      .single();
    if (vErr) throw vErr;
    voucherId = (v?.id as string | null) ?? null;
    if (!voucherId) throw new Error("درج سند مالی بدون شناسه برگشت");
    await audit(tx.id, "fee.voucher.create", true, "voucher row inserted", { prId, voucherId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "خطای ناشناخته در ایجاد سند مالی";
    await audit(tx.id, "fee.voucher.create.failed", false, msg, { prId });
    return { ok: false, prId, voucherId: null, sepidarVoucherId: null, message: msg, failedStep: "voucher_create" };
  }

  // --- Step 5: post the voucher to Sepidar --------------------------------
  let sepidarVoucherId: string | null = null;
  try {
    const { data, error } = await supabase.functions.invoke("sepidar-post-voucher", {
      body: { voucher_id: voucherId },
    });
    if (error) throw error;
    const ok = (data as { success?: boolean } | null)?.success === true;
    if (!ok) {
      const msg = (data as { message?: string } | null)?.message ?? "ثبت سند در سپیدار ناموفق بود.";
      throw new Error(msg);
    }
    // Re-read the voucher row to pick up the Sepidar id stamped by the SP.
    const { data: vRow } = await supabase
      .from("finance_vouchers")
      .select("sepidar_voucher_id")
      .eq("id", voucherId)
      .maybeSingle();
    const sepRaw = vRow?.sepidar_voucher_id as unknown;
    sepidarVoucherId = sepRaw == null ? null : String(sepRaw);
    await audit(tx.id, "fee.sepidar.post", true, "voucher posted to Sepidar", { voucherId, sepidarVoucherId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "خطای ناشناخته در ارسال به سپیدار";
    await audit(tx.id, "fee.sepidar.post.failed", false, msg, { prId, voucherId });
    // PR was still created — partial success. We return ok=true so the
    // counter increments payment_requests_created, but record the failure
    // step so the UI shows it under "ناموفق در سپیدار".
    return { ok: true, prId, voucherId, sepidarVoucherId: null, message: msg, failedStep: "sepidar_post" };
  }

  // --- Step 6: finalize transaction → assigned ----------------------------
  try {
    await supabase
      .from("finance_bank_transactions")
      .update({
        assignment_status: "assigned",
        assigned_operation_id: prId,
      } as never)
      .eq("id", tx.id);
    await audit(tx.id, "fee.tx.finalize", true, "transaction assigned");
  } catch (e) {
    // Non-fatal — the PR + voucher are already done.
    const msg = e instanceof Error ? e.message : String(e);
    await audit(tx.id, "fee.tx.finalize.failed", false, msg);
  }

  return {
    ok: true,
    prId,
    voucherId,
    sepidarVoucherId,
    message: "موفق",
  };
}

// ---------------------------------------------------------------------------
// Public entry point. Iterates over unassigned rows in BATCH_SIZE chunks,
// applies the fee pipeline, and streams progress to the caller.
// ---------------------------------------------------------------------------
export async function processBankFees(
  onProgress: (p: BankFeesProgress) => void,
): Promise<BankFeesProgress> {
  // eslint-disable-next-line no-console
  console.group(`${TAG} run start`);
  const progress = emptyFeesProgress();

  // Load the configured fee party up-front. Abort cleanly if missing.
  const cfg = await loadFeeConfig();
  if (!cfg.partyId) {
    const msg = "طرف‌حساب پیش‌فرض کارمزد بانکی در تنظیمات سپیدار مشخص نشده است.";
    progress.lastMessage = msg;
    progress.failures.push({ txId: "—", step: "config", message: msg });
    // eslint-disable-next-line no-console
    console.warn(TAG, msg);
    onProgress({ ...progress });
    // eslint-disable-next-line no-console
    console.groupEnd();
    return progress;
  }

  // Pull all candidate rows in one query so we know the total up-front for
  // the progress bar. Filtering on assignment_status + is_deleted + withdraw
  // type matches the user's spec exactly.
  const { data: rows, error } = await supabase
    .from("finance_bank_transactions")
    .select("id, bank_id, transaction_type, withdraw_amount, deposit_amount, amount, transaction_datetime, description")
    .eq("assignment_status", "unassigned")
    .eq("is_deleted", false)
    .order("transaction_datetime", { ascending: true });
  if (error) {
    progress.lastMessage = error.message;
    progress.failures.push({ txId: "—", step: "fetch", message: error.message });
    onProgress({ ...progress });
    // eslint-disable-next-line no-console
    console.error(TAG, "fetch failed", error);
    // eslint-disable-next-line no-console
    console.groupEnd();
    return progress;
  }

  const all = (rows ?? []) as FeeTx[];
  progress.total = all.length;
  progress.remaining = all.length;
  onProgress({ ...progress });
  // eslint-disable-next-line no-console
  console.log(TAG, "fetched", { total: all.length, threshold: FEE_THRESHOLD_IRR });

  // Process in BATCH_SIZE chunks. We yield to the UI between batches via
  // setTimeout(0) so React can repaint the progress panel.
  for (let i = 0; i < all.length; i += BATCH_SIZE) {
    const batch = all.slice(i, i + BATCH_SIZE);
    // eslint-disable-next-line no-console
    console.log(TAG, "batch", { index: i / BATCH_SIZE, size: batch.length });

    for (const tx of batch) {
      progress.checked++;
      progress.remaining = all.length - progress.checked;

      // ---- Threshold check (the only acceptance rule) -------------------
      const withdrawAmount = Number(tx.withdraw_amount) || 0;
      const fallback = Math.abs(Number(tx.amount) || 0);
      const absWithdraw = Math.abs(withdrawAmount) || fallback;
      const isWithdraw = tx.transaction_type === "withdraw" || withdrawAmount > 0;

      if (!isWithdraw) {
        // eslint-disable-next-line no-console
        console.log(TAG, "tx.skip.not_withdraw", { txId: tx.id });
        onProgress({ ...progress });
        continue;
      }
      if (absWithdraw <= 0) {
        // eslint-disable-next-line no-console
        console.log(TAG, "tx.skip.zero_amount", { txId: tx.id });
        onProgress({ ...progress });
        continue;
      }
      if (absWithdraw >= FEE_THRESHOLD_IRR) {
        // eslint-disable-next-line no-console
        console.log(TAG, "tx.skip.over_threshold", { txId: tx.id, amount: absWithdraw, threshold: FEE_THRESHOLD_IRR });
        onProgress({ ...progress });
        continue;
      }

      progress.fee_candidates++;
      progress.lastMessage = `پردازش تراکنش ${tx.id.slice(0, 8)} — ${absWithdraw.toLocaleString("fa-IR")} ریال`;
      onProgress({ ...progress });

      const result = await processOneFeeTx(tx, cfg.partyId);

      if (result.prId) progress.payment_requests_created++;
      if (result.sepidarVoucherId) progress.sepidar_posted++;
      if (!result.ok || result.failedStep === "sepidar_post") {
        progress.failed++;
        progress.failures.push({
          txId: tx.id,
          step: result.failedStep ?? "unknown",
          message: result.message,
        });
      }
      progress.matched.push({
        txId: tx.id,
        amount: absWithdraw,
        prId: result.prId,
        voucherId: result.voucherId,
        sepidarVoucherId: result.sepidarVoucherId,
      });
      // eslint-disable-next-line no-console
      console.log(TAG, "tx.done", { txId: tx.id, ...result });
      onProgress({ ...progress });
    }

    // Yield to the event loop so the UI can repaint between batches.
    await new Promise((r) => setTimeout(r, 0));
  }

  progress.lastMessage = `پایان: ${progress.payment_requests_created} درخواست ساخته شد، ${progress.sepidar_posted} در سپیدار ثبت شد، ${progress.failed} ناموفق.`;
  // eslint-disable-next-line no-console
  console.log(TAG, "final", progress);
  // eslint-disable-next-line no-console
  console.groupEnd();
  onProgress({ ...progress });
  return progress;
}
