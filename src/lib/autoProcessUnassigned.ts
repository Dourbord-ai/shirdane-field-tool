// ============================================================================
// Manual auto-processing pipeline for already-imported bank transactions.
//
// This module is intentionally DECOUPLED from the Excel upload flow.
// Excel upload now only parses, dedupes and inserts rows. The user then
// clicks the "تشخیص و ثبت اتوماتیک تراکنش‌های تخصیص‌نشده" button to run this
// pipeline over all unassigned rows.
//
// Three classifier paths, evaluated in priority order per transaction:
//
//   1. Bank fee  (withdraw, abs(amount) < 1,000,000 IRR)
//      Classify, write audit log, mark assignment_status='needs_review' with
//      assigned_operation_type='bank_fee_candidate'. Actual Sepidar posting
//      of bank-fee payment requests is intentionally deferred — it clones
//      the manual approve→post flow exactly and must be wired by a follow-up
//      that owns the existing PaymentRequestsTab logic. Counting it here as
//      "bank_fees_classified" keeps the operator's expectations honest.
//
//   2. Internal inter-bank transfer
//      Re-uses the existing `autoMatchBankTransfer` helper, which already
//      includes the Sepidar auto-post path behind a feature flag. Safe to
//      call here because the helper is idempotent (partial unique indexes).
//
//   3. Known-beneficiary deposit
//      Re-uses the existing `autoIdentifyTransaction` helper. We re-extract
//      identifiers from the row's description (the parser is pure) so we
//      don't depend on any in-memory state from the original import. If the
//      row already has identifier rows, we skip the helper to avoid the
//      duplicate-insert path inside it.
//
// Design rules:
//   - Process one tx at a time inside small batches (BATCH_SIZE = 25).
//   - One failure NEVER blocks the rest — every per-tx step is try/catch'd.
//   - Progress is reported via a callback so the UI can render a live panel.
//   - Audit logs go to `finance_auto_identification_log` (shared table).
// ============================================================================

import { supabase } from "@/integrations/supabase/client";
import { extractIdentifiers } from "@/lib/bankImport";
import { autoIdentifyTransaction } from "@/lib/autoIdentify";
import { autoMatchBankTransfer } from "@/lib/autoBankTransfer";

// Bank-fee threshold per legacy rule. Withdrawals strictly below this amount
// (in IRR) are treated as bank fees / کارمزد.
const BANK_FEE_THRESHOLD_IRR = 1_000_000;

// Page size for the unassigned-tx scan. Small on purpose so a single batch
// never overflows the Nginx URL cap on any follow-up `.in()` queries the
// downstream helpers might do.
const BATCH_SIZE = 25;

export interface AutoProcessProgress {
  total: number;
  processed: number;
  beneficiary_identified: number;
  bank_fees_classified: number;
  bank_transfers_matched: number;
  sepidar_posted: number;
  failed: number;
  remaining: number;
  // Last per-row note — useful for debugging in the UI footer.
  lastMessage?: string;
}

export function emptyProgress(): AutoProcessProgress {
  return {
    total: 0,
    processed: 0,
    beneficiary_identified: 0,
    bank_fees_classified: 0,
    bank_transfers_matched: 0,
    sepidar_posted: 0,
    failed: 0,
    remaining: 0,
  };
}

// Internal shape — only the columns we need for classification.
interface UnassignedTx {
  id: string;
  bank_id: string | null;
  transaction_type: "deposit" | "withdraw" | null;
  deposit_amount: number | null;
  withdraw_amount: number | null;
  amount: number | null;
  transaction_datetime: string | null;
  description: string | null;
}

// Best-effort audit log writer. Never throws — a missing log line is annoying,
// not fatal (mirrors the convention used inside autoIdentify.ts).
async function logAudit(
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
  } catch {
    // Swallow — see comment above.
  }
}

/**
 * Classify a withdraw row as a bank fee when its absolute amount is below the
 * legacy threshold. Marks the transaction with `assignment_status='needs_review'`
 * and `assigned_operation_type='bank_fee_candidate'` so the operator can see
 * the candidates in the existing filter chips and complete the manual
 * payment-request flow.
 *
 * NOTE: auto-creating and Sepidar-posting the corresponding payment request is
 * intentionally NOT done here yet — see the module-level header. We only flag
 * + audit-log so the import never silently mass-posts vouchers.
 */
async function classifyBankFee(tx: UnassignedTx): Promise<boolean> {
  const absWithdraw = Math.abs(
    Number(tx.withdraw_amount) || Math.abs(Number(tx.amount) || 0),
  );
  if (absWithdraw <= 0 || absWithdraw >= BANK_FEE_THRESHOLD_IRR) return false;

  const { error } = await supabase
    .from("finance_bank_transactions")
    .update({
      assignment_status: "needs_review",
      assigned_operation_type: "bank_fee_candidate",
    })
    .eq("id", tx.id)
    // Only flag rows still unassigned — never overwrite a manual decision.
    .eq("assignment_status", "unassigned");

  await logAudit(tx.id, "bank_fee_classify", !error, error?.message, {
    amount: absWithdraw,
    threshold: BANK_FEE_THRESHOLD_IRR,
    note: "Auto-creation of payment request + Sepidar posting deferred to manual review.",
  });

  return !error;
}

/**
 * Try the inter-bank transfer matcher for a deposit row. Returns the helper's
 * outcome state so the caller can update progress counters precisely.
 */
async function tryInterBankTransfer(tx: UnassignedTx) {
  // The helper is itself idempotent + feature-flag-gated; safe to call.
  return autoMatchBankTransfer({
    id: tx.id,
    bank_id: tx.bank_id,
    transaction_type: tx.transaction_type,
    deposit_amount: tx.deposit_amount,
    transaction_datetime: tx.transaction_datetime,
  });
}

/**
 * Re-extract identifiers from the description and call autoIdentifyTransaction.
 * If identifier rows already exist for this tx (i.e. it was processed before),
 * we skip to avoid the inner insert-with-conflict path.
 */
async function tryBeneficiaryDeposit(tx: UnassignedTx) {
  if (tx.transaction_type !== "deposit") {
    return { state: "no_identifier" as const, message: "تراکنش واریز نیست" };
  }

  // Skip if identifiers were already persisted for this tx — implies a
  // previous run already extracted + verified them. Re-running would just
  // hit the unique constraint inside autoIdentifyTransaction.
  const { count } = await supabase
    .from("finance_bank_tx_identifiers")
    .select("id", { count: "exact", head: true })
    .eq("bank_transaction_id", tx.id);
  if ((count ?? 0) > 0) {
    return { state: "needs_review" as const, message: "شناسه قبلاً استخراج شده" };
  }

  const idents = extractIdentifiers(tx.description || "");
  return autoIdentifyTransaction(tx.id, tx.transaction_type, idents);
}

/**
 * Public entry — orchestrates the full scan. The `onProgress` callback fires
 * after each individual transaction so the UI can render a live counter.
 */
export async function autoProcessUnassigned(
  onProgress: (p: AutoProcessProgress) => void,
  // Hard ceiling so a runaway run can't melt the DB. Operator can re-click.
  hardLimit = 5000,
): Promise<AutoProcessProgress> {
  const progress = emptyProgress();

  // 1. Count total so the UI can show "remaining". Done in one cheap HEAD.
  {
    const { count } = await supabase
      .from("finance_bank_transactions")
      .select("id", { count: "exact", head: true })
      .eq("is_deleted", false)
      .eq("assignment_status", "unassigned");
    progress.total = Math.min(count ?? 0, hardLimit);
    progress.remaining = progress.total;
    onProgress({ ...progress });
  }

  // 2. Process in pages of BATCH_SIZE. We always re-query page 0 because each
  //    successful classification flips a row OUT of the unassigned bucket —
  //    pagination by OFFSET would skip rows otherwise.
  let safetyGuard = 0;
  while (progress.processed < progress.total && safetyGuard < hardLimit) {
    safetyGuard += BATCH_SIZE;

    const { data, error } = await supabase
      .from("finance_bank_transactions")
      .select(
        "id,bank_id,transaction_type,deposit_amount,withdraw_amount,amount,transaction_datetime,description",
      )
      .eq("is_deleted", false)
      .eq("assignment_status", "unassigned")
      .order("transaction_datetime", { ascending: true })
      .limit(BATCH_SIZE);

    if (error || !data || data.length === 0) {
      // No more rows or transient failure — stop the loop. Operator can retry.
      progress.lastMessage = error?.message ?? "هیچ تراکنش تخصیص‌نشده‌ای باقی نماند";
      onProgress({ ...progress });
      break;
    }

    for (const tx of data as UnassignedTx[]) {
      try {
        // --- PATH 1: withdraw → bank fee classifier ----------------------
        if (
          tx.transaction_type === "withdraw" ||
          (Number(tx.withdraw_amount) || 0) > 0
        ) {
          const classified = await classifyBankFee(tx);
          if (classified) {
            progress.bank_fees_classified++;
            progress.lastMessage = "کارمزد بانکی شناسایی شد";
          } else {
            // Withdraw above the threshold — not a fee. Leave unassigned for
            // manual handling (payment allocation flow).
            await logAudit(tx.id, "withdraw_above_fee_threshold", true, "بالاتر از سقف کارمزد");
          }
        } else if (tx.transaction_type === "deposit") {
          // --- PATH 2: try inter-bank transfer first (cheap exact match) ---
          const xfer = await tryInterBankTransfer(tx);
          if (
            xfer.state === "auto_bank_transfer_matched" ||
            xfer.state === "auto_bank_transfer_posted" ||
            xfer.state === "auto_bank_transfer_failed"
          ) {
            progress.bank_transfers_matched++;
            if (xfer.state === "auto_bank_transfer_posted") progress.sepidar_posted++;
            progress.lastMessage = "انتقال بین بانکی شناسایی شد";
          } else {
            // --- PATH 3: known-beneficiary deposit ------------------------
            const ident = await tryBeneficiaryDeposit(tx);
            if (ident.state === "auto_identified" || ident.state === "sepidar_posted") {
              progress.beneficiary_identified++;
              if (ident.state === "sepidar_posted") progress.sepidar_posted++;
              progress.lastMessage = "ذینفع شناخته‌شده تطبیق داده شد";
            } else {
              progress.lastMessage = ident.message || "نیازمند بازبینی دستی";
            }
          }
        }
      } catch (e) {
        // Per-row crash — log and keep going.
        progress.failed++;
        const msg = e instanceof Error ? e.message : String(e);
        progress.lastMessage = msg;
        await logAudit(tx.id, "auto_process_crash", false, msg);
      }

      progress.processed++;
      progress.remaining = Math.max(0, progress.total - progress.processed);
      onProgress({ ...progress });
    }
  }

  return progress;
}
