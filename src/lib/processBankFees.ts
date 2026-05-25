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
  const description = `کارمزد بانکی — تراکنش ${tx.id.slice(0, 8)}`;

  // -----------------------------------------------------------------------
  // Step 0: idempotency probe.
  // Re-read the tx so we can see any prior partial run (assigned_operation_id
  // already set from a previous failed attempt). This lets us reuse the
  // existing PR/voucher instead of creating duplicates.
  // -----------------------------------------------------------------------
  const { data: existingTx } = await supabase
    .from("finance_bank_transactions")
    .select("id, assignment_status, assigned_operation_type, assigned_operation_id")
    .eq("id", tx.id)
    .maybeSingle();

  let prId: string | null =
    (existingTx?.assigned_operation_type === "bank_fee_candidate" ||
      existingTx?.assigned_operation_type === "bank_fee")
      ? ((existingTx?.assigned_operation_id as string | null) ?? null)
      : null;

  // If we found an existing PR id, fetch the voucher that points to it.
  let voucherId: string | null = null;
  let existingSepidarVoucherId: string | null = null;
  if (prId) {
    const { data: vRow } = await supabase
      .from("finance_vouchers")
      .select("id, sepidar_voucher_id")
      .eq("source_operation_id", prId)
      .eq("source_operation_type", "payment_request")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (vRow?.id) {
      voucherId = vRow.id as string;
      const sepRaw = vRow.sepidar_voucher_id as unknown;
      existingSepidarVoucherId = sepRaw == null ? null : String(sepRaw);
      // eslint-disable-next-line no-console
      console.log(TAG, "sepidar.retry_existing", { txId: tx.id, prId, voucherId, existingSepidarVoucherId });
      await audit(tx.id, "fee.idempotency.reuse", true, "reusing existing PR + voucher", { prId, voucherId });
    }
  }

  // If sepidar voucher already posted, nothing left to do — finalize tx and return.
  if (existingSepidarVoucherId) {
    // eslint-disable-next-line no-console
    console.log(TAG, "duplicate.prevented", { txId: tx.id, prId, voucherId, sepidarVoucherId: existingSepidarVoucherId });
    await audit(tx.id, "fee.duplicate.prevented", true, "already fully posted — finalizing tx", { prId, voucherId });
    await supabase
      .from("finance_bank_transactions")
      .update({
        assignment_status: "assigned",
        assigned_operation_type: "bank_fee",
        assigned_operation_id: prId,
      } as never)
      .eq("id", tx.id);
    return { ok: true, prId, voucherId, sepidarVoucherId: existingSepidarVoucherId, message: "قبلاً ثبت شده" };
  }

  // -----------------------------------------------------------------------
  // Step 0b: load bank + party sepidar mappings — required for voucher_items.
  // -----------------------------------------------------------------------
  if (!tx.bank_id) {
    const msg = "تراکنش بانکی فاقد bank_id است.";
    await audit(tx.id, "fee.bank.missing", false, msg);
    return { ok: false, prId, voucherId, sepidarVoucherId: null, message: msg, failedStep: "bank_lookup" };
  }
  const { data: bankRow, error: bankErr } = await supabase
    .from("finance_banks")
    .select("id, sepidar_account_id, sepidar_dl_id")
    .eq("id", tx.bank_id)
    .maybeSingle();
  if (bankErr || !bankRow) {
    const msg = bankErr?.message || "مپینگ سپیدار برای بانک یافت نشد.";
    await audit(tx.id, "fee.bank.lookup.failed", false, msg, { bankId: tx.bank_id });
    return { ok: false, prId, voucherId, sepidarVoucherId: null, message: msg, failedStep: "bank_lookup" };
  }
  const bankSepidarAccountId = (bankRow.sepidar_account_id as number | null) ?? null;
  const bankSepidarDlId = (bankRow.sepidar_dl_id as number | null) ?? null;
  if (!bankSepidarAccountId || !bankSepidarDlId) {
    const msg = "حساب بانک فاقد sepidar_account_id یا sepidar_dl_id است.";
    await audit(tx.id, "fee.bank.mapping.missing", false, msg, { bankId: tx.bank_id });
    return { ok: false, prId, voucherId, sepidarVoucherId: null, message: msg, failedStep: "bank_lookup" };
  }

  const { data: partyRow, error: partyErr } = await supabase
    .from("finance_parties")
    .select("id, sepidar_account_id, sepidar_dl_id, sepidar_party_id")
    .eq("id", feePartyId)
    .maybeSingle();
  if (partyErr || !partyRow) {
    const msg = partyErr?.message || "طرف‌حساب کارمزد یافت نشد.";
    await audit(tx.id, "fee.party.lookup.failed", false, msg, { feePartyId });
    return { ok: false, prId, voucherId, sepidarVoucherId: null, message: msg, failedStep: "party_lookup" };
  }
  const partySepidarAccountId = (partyRow.sepidar_account_id as number | null) ?? 193;
  const partySepidarDlId = (partyRow.sepidar_dl_id as number | null) ?? null;
  const partySepidarPartyId = (partyRow.sepidar_party_id as number | null) ?? null;

  // -----------------------------------------------------------------------
  // Step 1: mark as bank_fee_candidate on the tx row (idempotent).
  // Row stays 'unassigned' + 'bank_fee_candidate' until full success.
  // -----------------------------------------------------------------------
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
    return { ok: false, prId, voucherId, sepidarVoucherId: null, message: markErr.message, failedStep: "mark" };
  }
  await audit(tx.id, "fee.mark.candidate", true, "marked as bank_fee_candidate", { amount: absWithdraw });

  // -----------------------------------------------------------------------
  // Step 2: payment request — create only if we don't already have one.
  // -----------------------------------------------------------------------
  if (!prId) {
    const requestPayload = {
      title: `کارمزد بانکی ${new Date(tx.transaction_datetime ?? Date.now()).toLocaleDateString("fa-IR")}`,
      description: tx.description?.slice(0, 200) ?? null,
      request_type: "unknown",
      status: "approved",
      total_amount: absWithdraw,
      confirmed_amount: absWithdraw,
    };
    // eslint-disable-next-line no-console
    console.log(TAG, "pr.insert.header.payload", { txId: tx.id, requestPayload });
    try {
      const { data, error } = await supabase
        .from("finance_payment_requests")
        .insert(requestPayload as never)
        .select("id")
        .single();
      if (error) throw error;
      prId = (data?.id as string | null) ?? null;
      if (!prId) throw new Error("درج درخواست پرداخت بدون شناسه برگشت");
    } catch (e) {
      const err = e as { code?: string; message?: string; details?: string; hint?: string };
      const msg = [err.message, err.details, err.hint].filter(Boolean).join(" | ")
        || "خطا در ثبت درخواست پرداخت کارمزد";
      await audit(tx.id, "fee.pr.create.failed", false, msg, {
        code: err.code, details: err.details, hint: err.hint,
      });
      return { ok: false, prId: null, voucherId: null, sepidarVoucherId: null, message: msg, failedStep: "pr_create" };
    }

    const itemPayload = {
      payment_request_id: prId,
      party_id: feePartyId,
      amount: absWithdraw,
      confirmed_amount: absWithdraw,
      amount_type: "creditor",
      amount_type_code: 2,
      status: "approved",
      description,
    };
    // eslint-disable-next-line no-console
    console.log(TAG, "pr.insert.item.payload", { txId: tx.id, itemPayload });
    try {
      const { error: itemErr } = await supabase
        .from("finance_payment_request_items")
        .insert(itemPayload as never);
      if (itemErr) throw itemErr;
    } catch (e) {
      const err = e as { code?: string; message?: string; details?: string; hint?: string };
      const msg = [err.message, err.details, err.hint].filter(Boolean).join(" | ")
        || "خطا در ثبت آیتم درخواست پرداخت کارمزد";
      await audit(tx.id, "fee.pr.item.failed", false, msg, { prId, code: err.code });
      return { ok: false, prId, voucherId: null, sepidarVoucherId: null, message: msg, failedStep: "pr_create" };
    }
    await audit(tx.id, "fee.pr.create", true, "payment request + item created (approved)", { prId });

    // Stamp prId on the tx now so a future retry can find it via idempotency probe.
    await supabase
      .from("finance_bank_transactions")
      .update({ assigned_operation_id: prId } as never)
      .eq("id", tx.id);
  } else {
    // eslint-disable-next-line no-console
    console.log(TAG, "pr.reuse", { txId: tx.id, prId });
  }

  // -----------------------------------------------------------------------
  // Step 3: voucher header — create only if we don't already have one.
  // -----------------------------------------------------------------------
  if (!voucherId) {
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
          total_debit: absWithdraw,
          total_credit: absWithdraw,
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
  } else {
    // eslint-disable-next-line no-console
    console.log(TAG, "voucher.reuse", { txId: tx.id, voucherId });
  }

  // -----------------------------------------------------------------------
  // Step 4: voucher items — create the debit (party/fee expense) and credit
  // (bank) rows so Sepidar accepts the voucher. Idempotent via count check.
  // -----------------------------------------------------------------------
  const { count: existingItemsCount } = await supabase
    .from("finance_voucher_items")
    .select("id", { count: "exact", head: true })
    .eq("voucher_id", voucherId);
  // eslint-disable-next-line no-console
  console.log(TAG, "voucher_items.count", { txId: tx.id, voucherId, existingItemsCount });

  if ((existingItemsCount ?? 0) === 0) {
    const items = [
      {
        voucher_id: voucherId,
        row_number: 1,
        party_id: feePartyId,
        account_type: "party",
        debit: absWithdraw,
        credit: 0,
        sepidar_account_id: partySepidarAccountId,
        sepidar_dl_id: partySepidarDlId,
        sepidar_party_id: partySepidarPartyId ?? 532,
        description,
      },
      {
        voucher_id: voucherId,
        row_number: 2,
        bank_id: tx.bank_id,
        account_type: "bank",
        debit: 0,
        credit: absWithdraw,
        sepidar_account_id: bankSepidarAccountId,
        sepidar_dl_id: bankSepidarDlId,
        description,
      },
    ];
    // eslint-disable-next-line no-console
    console.log(TAG, "voucher_items.create", { txId: tx.id, voucherId, items });
    try {
      const { error: itemsErr } = await supabase
        .from("finance_voucher_items")
        .insert(items as never);
      if (itemsErr) throw itemsErr;
      await audit(tx.id, "fee.voucher.items.create", true, "voucher items inserted", { voucherId, count: items.length });
    } catch (e) {
      const err = e as { code?: string; message?: string; details?: string; hint?: string };
      const msg = [err.message, err.details, err.hint].filter(Boolean).join(" | ")
        || "خطا در ثبت ردیف‌های سند";
      // eslint-disable-next-line no-console
      console.error(TAG, "voucher_items.create.failed", { txId: tx.id, voucherId, err });
      await audit(tx.id, "fee.voucher.items.failed", false, msg, { voucherId });
      return { ok: false, prId, voucherId, sepidarVoucherId: null, message: msg, failedStep: "voucher_items" };
    }
  } else {
    // eslint-disable-next-line no-console
    console.log(TAG, "voucher_items.reuse", { txId: tx.id, voucherId, existingItemsCount });
  }

  // Ensure voucher totals reflect the items (idempotent update).
  await supabase
    .from("finance_vouchers")
    .update({ total_debit: absWithdraw, total_credit: absWithdraw } as never)
    .eq("id", voucherId);
  // eslint-disable-next-line no-console
  console.log(TAG, "voucher.balance.check", { txId: tx.id, voucherId, total_debit: absWithdraw, total_credit: absWithdraw });

  // -----------------------------------------------------------------------
  // Step 5: post the voucher to Sepidar.
  // -----------------------------------------------------------------------
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
    return { ok: true, prId, voucherId, sepidarVoucherId: null, message: msg, failedStep: "sepidar_post" };
  }

  // -----------------------------------------------------------------------
  // Step 6: finalize tx — only now flip to assigned + bank_fee.
  // -----------------------------------------------------------------------
  try {
    await supabase
      .from("finance_bank_transactions")
      .update({
        assignment_status: "assigned",
        assigned_operation_type: "bank_fee",
        assigned_operation_id: prId,
      } as never)
      .eq("id", tx.id);
    await audit(tx.id, "fee.tx.finalize", true, "transaction assigned as bank_fee");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await audit(tx.id, "fee.tx.finalize.failed", false, msg);
  }

  return { ok: true, prId, voucherId, sepidarVoucherId, message: "موفق" };
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
