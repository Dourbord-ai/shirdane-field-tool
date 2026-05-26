// ============================================================================
// Dedicated bank-fee auto-processor (ORCHESTRATOR ONLY).
//
// Triggered by the "شناسایی کارمزد" button on the Bank Transactions tab.
//
// IMPORTANT — architectural rule:
//   This module does NOT recreate any accounting payloads. It exists solely
//   to detect bank-fee transactions and "drive" the SAME helpers that the
//   manual PaymentRequestsTab UI calls. The manual flow is the single source
//   of truth for payment-request / voucher / Sepidar payloads:
//
//     1. submit_payment_request RPC  → create PR + items (pending_approval)
//        (used by PaymentRequestsTab "New request" form)
//     2. approvePaymentRequest(prId) → flip header + items to approved
//        (used by PaymentRequestsTab approve button)
//     3. createPaymentAllocation({…})→ allocation + voucher + Sepidar post
//        (used by PaymentRequestsTab "link bank transaction" button)
//
//   Step (3) is the only place that ever builds voucher/voucher_items
//   payloads — that logic stays centralised in src/lib/finance.ts so future
//   accounting changes automatically affect both manual and automatic flows.
//
//   If we ever discover the manual UI bypasses these helpers with inline
//   logic, the fix is to extract THAT logic into the shared helper — not to
//   duplicate it here.
//
// Pipeline per fee tx:
//   1. Idempotency probe — if this tx is already linked to a synced
//      allocation, just finalise and exit.
//   2. Create PR via the same RPC the manual form calls.
//   3. Approve PR via the same helper the manual approve button calls.
//   4. Link the bank tx to the new PR item via createPaymentAllocation —
//      the helper internally creates the voucher and posts to Sepidar.
//   5. createPaymentAllocation flips assignment_status to assigned on
//      success, so finalisation is free.
//
// Every step logs an audit row to finance_auto_identification_log and
// emits a `[BankFees] manual-helper.*` console line so a DevTools filter
// for "[BankFees]" shows the whole run.
// ============================================================================

import { supabase } from "@/integrations/supabase/client";
// The three canonical helpers used by the manual UI. We import them by name
// so the orchestrator literally "clicks the buttons" the user would click.
import {
  approvePaymentRequest,
  createPaymentAllocation,
} from "@/lib/finance";

// Threshold below which a withdraw is treated as a bank-fee candidate.
// Mirrors BANK_FEE_THRESHOLD_IRR in autoProcessUnassigned.ts so the two
// classifiers stay in lockstep.
export const FEE_THRESHOLD_IRR = 1_000_000;

// Small page so the UI can stream progress and the PostgREST URL stays
// well under the URI-length cap.
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
  matched: {
    txId: string;
    amount: number;
    prId: string | null;
    voucherId: string | null;
    sepidarVoucherId: string | null;
  }[];
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
// Idempotency probe — when a previous run created a PR/voucher for this tx
// but failed somewhere downstream, we want to RESUME instead of duplicating.
//
// Strategy: a successful allocation already flips assignment_status to
// 'assigned' with assigned_operation_type='payment_allocation'. So if we see
// that, we're fully done and just need to normalise the bank-fee tags.
//
// If we see 'bank_fee_candidate', a PR id is stamped on assigned_operation_id
// from a prior partial run — return it so the orchestrator can skip the
// create-PR step and jump straight to approve/allocate.
// ---------------------------------------------------------------------------
async function probeExisting(txId: string): Promise<{
  alreadyDone: boolean;
  existingPrId: string | null;
  existingAllocationId: string | null;
  existingVoucherId: string | null;
  existingSepidarVoucherId: string | null;
}> {
  const { data: txRow } = await supabase
    .from("finance_bank_transactions")
    .select("assignment_status, assigned_operation_type, assigned_operation_id")
    .eq("id", txId)
    .maybeSingle();

  // Helper: look up any allocation against this tx so we can recover the
  // voucher id even if the tx is not yet flagged assigned.
  const { data: allocRow } = await supabase
    .from("finance_payment_allocations")
    .select("id, payment_request_id, voucher_id, status, sepidar_sync_status")
    .eq("bank_transaction_id", txId)
    .eq("is_deleted", false)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Get the sepidar voucher id (if any) from the linked voucher row.
  let existingSepidarVoucherId: string | null = null;
  if (allocRow?.voucher_id) {
    const { data: vRow } = await supabase
      .from("finance_vouchers")
      .select("sepidar_voucher_id")
      .eq("id", allocRow.voucher_id)
      .maybeSingle();
    const raw = vRow?.sepidar_voucher_id as unknown;
    existingSepidarVoucherId = raw == null ? null : String(raw);
  }

  // Fully done iff the linked allocation is synced AND we have a Sepidar id.
  const alreadyDone =
    !!allocRow &&
    allocRow.status === "synced" &&
    allocRow.sepidar_sync_status === "synced" &&
    !!existingSepidarVoucherId;

  // Prefer the PR id from the allocation; otherwise fall back to the
  // assigned_operation_id stamped during a previous create-PR-only attempt.
  const existingPrId =
    (allocRow?.payment_request_id as string | null) ??
    ((txRow?.assigned_operation_type === "bank_fee_candidate" ||
      txRow?.assigned_operation_type === "bank_fee")
      ? ((txRow?.assigned_operation_id as string | null) ?? null)
      : null);

  return {
    alreadyDone,
    existingPrId,
    existingAllocationId: (allocRow?.id as string | null) ?? null,
    existingVoucherId: (allocRow?.voucher_id as string | null) ?? null,
    existingSepidarVoucherId,
  };
}

// ---------------------------------------------------------------------------
// Core per-tx orchestration. Returns the outcome so the caller can tally.
//
// NOTE: the heavy lifting (PR creation, voucher build, Sepidar post) lives
// inside the shared helpers — this function is just glue.
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
  const absWithdraw =
    Math.abs(Number(tx.withdraw_amount) || Number(tx.amount) || 0);
  const description = `کارمزد بانکی — تراکنش ${tx.id.slice(0, 8)}`;

  // -----------------------------------------------------------------------
  // Step 0: idempotency probe.
  // -----------------------------------------------------------------------
  const probe = await probeExisting(tx.id);
  if (probe.alreadyDone) {
    // eslint-disable-next-line no-console
    console.log(TAG, "duplicate.prevented", {
      txId: tx.id,
      prId: probe.existingPrId,
      voucherId: probe.existingVoucherId,
      sepidarVoucherId: probe.existingSepidarVoucherId,
    });
    await audit(tx.id, "fee.duplicate.prevented", true, "already fully posted — skipping", {
      prId: probe.existingPrId,
      voucherId: probe.existingVoucherId,
    });
    // Normalise the bank-fee tags on the tx for consistency.
    await supabase
      .from("finance_bank_transactions")
      .update({
        assigned_operation_type: "bank_fee",
        assigned_operation_id: probe.existingPrId,
      } as never)
      .eq("id", tx.id);
    return {
      ok: true,
      prId: probe.existingPrId,
      voucherId: probe.existingVoucherId,
      sepidarVoucherId: probe.existingSepidarVoucherId,
      message: "قبلاً ثبت شده",
    };
  }

  // -----------------------------------------------------------------------
  // Step 1: mark tx as bank_fee_candidate. Row stays 'unassigned' so the
  // DB allocation-guard accepts it later (the guard only rejects rows that
  // are 'assigned' to a non-rejected workflow).
  // -----------------------------------------------------------------------
  const { error: markErr } = await supabase
    .from("finance_bank_transactions")
    .update({
      assignment_status: "unassigned",
      assigned_operation_type: "bank_fee_candidate",
    } as never)
    .eq("id", tx.id)
    .eq("assignment_status", "unassigned");
  if (markErr) {
    await audit(tx.id, "fee.mark.failed", false, markErr.message, { amount: absWithdraw });
    return {
      ok: false, prId: probe.existingPrId, voucherId: null, sepidarVoucherId: null,
      message: markErr.message, failedStep: "mark",
    };
  }
  await audit(tx.id, "fee.mark.candidate", true, "marked as bank_fee_candidate", { amount: absWithdraw });

  // -----------------------------------------------------------------------
  // Step 2: create PR via the SAME RPC the manual UI uses.
  // We re-use the exact payload shape from PaymentRequestsTab so behaviour
  // (validation, defaults, RLS) matches the manual flow byte-for-byte.
  // -----------------------------------------------------------------------
  let prId: string | null = probe.existingPrId;
  let prItemId: string | null = null;

  if (!prId) {
    // requestPayload mirrors the manual form payload:
    // - request_type 'unknown'           (matches legacy bank-fee PRs)
    // - legacy_request_type_code null    (no fixed catalogue code yet)
    // - status pending_approval          (RPC default — approve step flips it)
    const requestPayload = {
      title: `کارمزد بانکی ${new Date(tx.transaction_datetime ?? Date.now()).toLocaleDateString("fa-IR")}`,
      description: tx.description?.slice(0, 200) ?? null,
      request_type: "unknown",
      // Send the legacy code as a string so the RPC's NULLIF→::int cast works.
      legacy_request_type_code: "",
      status: "pending_approval",
    };
    // itemPayload mirrors the manual form: creditor (amount_type_code=2)
    // bank-fee party, exact withdraw amount, descriptive note.
    const itemPayload = [{
      party_id: feePartyId,
      amount: absWithdraw,
      amount_type_code: 2,
      amount_type: "creditor",
      description,
      status: "pending_approval",
    }];

    // eslint-disable-next-line no-console
    console.log(TAG, "manual-helper.createPR", { txId: tx.id, requestPayload, itemPayload });

    try {
      // Cast to `never` because the generated DB types don't yet include
      // this RPC — exactly the same cast the manual UI uses.
      const { data: newId, error } = await supabase.rpc(
        "submit_payment_request" as never,
        { p_request: requestPayload, p_items: itemPayload } as never,
      );
      if (error) throw error;
      if (!newId) throw new Error("ثبت درخواست ناموفق بود");
      prId = newId as unknown as string;
    } catch (e) {
      const err = e as { code?: string; message?: string; details?: string; hint?: string };
      const msg =
        [err.message, err.details, err.hint].filter(Boolean).join(" | ") ||
        "خطا در ثبت درخواست پرداخت کارمزد";
      await audit(tx.id, "fee.pr.create.failed", false, msg, {
        code: err.code, details: err.details, hint: err.hint,
      });
      return {
        ok: false, prId: null, voucherId: null, sepidarVoucherId: null,
        message: msg, failedStep: "pr_create",
      };
    }

    await audit(tx.id, "fee.pr.create", true, "payment request + item created (pending_approval)", { prId });

    // Stamp prId on the tx now so a future retry can find it via idempotency probe.
    await supabase
      .from("finance_bank_transactions")
      .update({ assigned_operation_id: prId } as never)
      .eq("id", tx.id);
  } else {
    // eslint-disable-next-line no-console
    console.log(TAG, "manual-helper.createPR.skip (reusing existing)", { txId: tx.id, prId });
  }

  // -----------------------------------------------------------------------
  // Step 3: approve via the SAME helper the manual UI uses.
  // approvePaymentRequest flips request.status → approved AND promotes
  // pending items → approved. It is idempotent (no-op when already approved).
  // -----------------------------------------------------------------------
  try {
    // eslint-disable-next-line no-console
    console.log(TAG, "manual-helper.approvePR", { txId: tx.id, prId });
    await approvePaymentRequest(prId!);
    await audit(tx.id, "fee.pr.approve", true, "approvePaymentRequest() returned", { prId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "خطای ناشناخته در تأیید درخواست";
    await audit(tx.id, "fee.pr.approve.failed", false, msg, { prId });
    return {
      ok: false, prId, voucherId: null, sepidarVoucherId: null,
      message: msg, failedStep: "pr_approve",
    };
  }

  // -----------------------------------------------------------------------
  // Step 3b: look up the (single) approved item id for this PR.
  // createPaymentAllocation needs both payment_request_id AND the item id.
  // -----------------------------------------------------------------------
  {
    const { data: items, error: itemsErr } = await supabase
      .from("finance_payment_request_items")
      .select("id, party_id, amount, confirmed_amount, status")
      .eq("payment_request_id", prId!)
      .eq("is_deleted", false)
      .order("created_at", { ascending: true })
      .limit(1);
    if (itemsErr || !items || items.length === 0) {
      const msg = itemsErr?.message || "آیتم درخواست پرداخت پیدا نشد.";
      await audit(tx.id, "fee.pr.item.lookup.failed", false, msg, { prId });
      return {
        ok: false, prId, voucherId: null, sepidarVoucherId: null,
        message: msg, failedStep: "pr_item_lookup",
      };
    }
    prItemId = (items[0].id as string | null) ?? null;
  }

  // -----------------------------------------------------------------------
  // Step 4: link the bank tx to the PR item via the SAME helper the
  // manual UI's "Link bank transaction" button calls. This helper
  // internally:
  //   • creates the finance_payment_allocations row
  //   • marks the tx assignment_status='assigning'
  //   • builds the voucher header + 2 voucher_items (debit party, credit bank)
  //     using createVoucher() — the ONE canonical accounting builder
  //   • posts the voucher to Sepidar via syncVoucherToSepidar()
  //     (sepidar-post-voucher Edge Function)
  //   • on success, flips tx assignment_status='assigned' and updates the
  //     party balance / paid totals
  //
  // So the two requested log lines map naturally to one call:
  //   [BankFees] manual-helper.createVoucher   (entering the helper)
  //   [BankFees] manual-helper.postSepidar     (after voucher creation)
  // -----------------------------------------------------------------------
  let allocId: string | null = null;
  let voucherId: string | null = null;
  let sepidarVoucherId: string | null = null;
  try {
    // eslint-disable-next-line no-console
    console.log(TAG, "manual-helper.createVoucher", { txId: tx.id, prId, prItemId, amount: absWithdraw });
    // eslint-disable-next-line no-console
    console.log(TAG, "manual-helper.postSepidar", { txId: tx.id, prId, prItemId });

    const allocResult = await createPaymentAllocation({
      payment_request_id: prId!,
      payment_request_item_id: prItemId!,
      bank_transaction_id: tx.id,
      amount: absWithdraw,
    });

    allocId = allocResult.id;

    // After createPaymentAllocation returns, the allocation row holds the
    // voucher_id and the voucher row holds the sepidar_voucher_id (when
    // posting succeeded). Read them back for the progress report.
    if (allocId) {
      const { data: a } = await supabase
        .from("finance_payment_allocations")
        .select("voucher_id, status, sepidar_error_message")
        .eq("id", allocId)
        .maybeSingle();
      voucherId = (a?.voucher_id as string | null) ?? null;
      if (voucherId) {
        const { data: v } = await supabase
          .from("finance_vouchers")
          .select("sepidar_voucher_id")
          .eq("id", voucherId)
          .maybeSingle();
        const raw = v?.sepidar_voucher_id as unknown;
        sepidarVoucherId = raw == null ? null : String(raw);
      }
      // createPaymentAllocation returns ok=false when Sepidar posting failed;
      // the allocation/voucher rows exist so a manual retry can finish them.
      if (!allocResult.ok) {
        const msg = allocResult.error || "ثبت سند در سپیدار ناموفق بود.";
        await audit(tx.id, "fee.sepidar.post.failed", false, msg, { prId, voucherId, allocId });
        return {
          // PR + voucher exist, but Sepidar leg failed — mark as failed so
          // the user can retry from the regular Vouchers tab.
          ok: false, prId, voucherId, sepidarVoucherId: null,
          message: msg, failedStep: "sepidar_post",
        };
      }
    }
    await audit(tx.id, "fee.allocation.create", true, "createPaymentAllocation() succeeded", {
      prId, voucherId, allocId, sepidarVoucherId,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "خطای ناشناخته در ساخت تخصیص پرداخت";
    await audit(tx.id, "fee.allocation.create.failed", false, msg, { prId, prItemId });
    return {
      ok: false, prId, voucherId: null, sepidarVoucherId: null,
      message: msg, failedStep: "voucher_create",
    };
  }

  // -----------------------------------------------------------------------
  // Step 5: stamp the bank-fee identity on the tx. createPaymentAllocation
  // already set assignment_status='assigned' (with assigned_operation_type=
  // 'payment_allocation'), but for bank fees we want the more specific
  // 'bank_fee' tag plus the PR id so the UI can show it as a fee row.
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
    await audit(tx.id, "fee.tx.finalize", true, "transaction tagged as bank_fee");
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

  progress.lastMessage =
    `پایان: ${progress.payment_requests_created} درخواست ساخته شد، ` +
    `${progress.sepidar_posted} در سپیدار ثبت شد، ${progress.failed} ناموفق.`;
  // eslint-disable-next-line no-console
  console.log(TAG, "final", progress);
  // eslint-disable-next-line no-console
  console.groupEnd();
  onProgress({ ...progress });
  return progress;
}
