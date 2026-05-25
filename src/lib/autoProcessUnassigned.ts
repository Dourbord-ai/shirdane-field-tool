// ============================================================================
// Manual auto-processing pipeline for already-imported bank transactions.
//
// Decoupled from Excel upload. Operator triggers this via the
// "تشخیص و ثبت اتوماتیک تراکنش‌های تخصیص‌نشده" button.
//
// Three classifier paths per transaction (priority order):
//   1. Bank fee  (withdraw, abs(amount) < 1,000,000 IRR)
//   2. Internal inter-bank transfer (re-uses autoMatchBankTransfer)
//   3. Known-beneficiary deposit (re-uses autoIdentifyTransaction)
//
// THIS REVISION: business logic unchanged — only adds maximum-verbose
// diagnostic logging via src/lib/financeAutoProcessDebug.ts so we can see
// exactly where rows get skipped/matched/failed and why the button reports
// 0 processed.
// ============================================================================

import { supabase } from "@/integrations/supabase/client";
import { extractIdentifiers } from "@/lib/bankImport";
import {
  extractIdentifiersStrict,
  logExtractionResult,
} from "@/lib/identifierExtraction";
import { autoIdentifyTransaction } from "@/lib/autoIdentify";
import { autoMatchBankTransfer } from "@/lib/autoBankTransfer";
import {
  isDebugOn,
  dlog,
  dwarn,
  derror,
  dgroup,
  dgroupEnd,
  dlogAlways,
  dtable,
  debugSupabaseCall,
} from "@/lib/financeAutoProcessDebug";

const BANK_FEE_THRESHOLD_IRR = 1_000_000;
const BATCH_SIZE = 25;

// ---------------------------------------------------------------------------
// Diagnostic record shapes — surfaced both via console and the UI panel.
// ---------------------------------------------------------------------------
export interface FailedTxRecord {
  id: string;
  reason: string;
  step: string;
  errorCode?: string;
  errorMessage?: string;
}
export interface SkippedTxRecord {
  id: string;
  reason: string;
}
export interface MatchedTxRecord {
  id: string;
  path: "bank_fee" | "inter_bank_transfer" | "beneficiary_deposit";
  party_id?: string | null;
  paired_tx_id?: string | null;
  voucher_id?: string | null;
}

export interface AutoProcessProgress {
  total: number;
  processed: number;
  beneficiary_identified: number;
  bank_fees_classified: number;
  bank_transfers_matched: number;
  sepidar_posted: number;
  failed: number;
  skipped: number;
  remaining: number;
  durationMs?: number;
  lastMessage?: string;
  // Diagnostic detail surfaced into the UI debug panel.
  lastTxId?: string;
  lastError?: string;
  lastSkipReason?: string;
  failedTransactions: FailedTxRecord[];
  skippedTransactions: SkippedTxRecord[];
  matchedTransactions: MatchedTxRecord[];
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
    skipped: 0,
    remaining: 0,
    failedTransactions: [],
    skippedTransactions: [],
    matchedTransactions: [],
  };
}

// Internal shape — only the columns needed for classification + logging.
interface UnassignedTx {
  id: string;
  bank_id: string | null;
  transaction_type: "deposit" | "withdraw" | null;
  deposit_amount: number | null;
  withdraw_amount: number | null;
  amount: number | null;
  transaction_datetime: string | null;
  description: string | null;
  reference_number?: string | null;
  tracking_number?: string | null;
  document_number?: string | null;
  assignment_status?: string | null;
  assigned_operation_type?: string | null;
}

// ---------------------------------------------------------------------------
// Audit log writer. Best-effort + logged via debugSupabaseCall.
// ---------------------------------------------------------------------------
async function logAudit(
  bankTransactionId: string,
  step: string,
  success: boolean,
  message?: string,
  extras?: Record<string, unknown>,
) {
  try {
    await debugSupabaseCall(
      "audit.insert",
      {
        table: "finance_auto_identification_log",
        payload: { bankTransactionId, step, success, message },
      },
      () =>
        supabase.from("finance_auto_identification_log").insert({
          bank_transaction_id: bankTransactionId,
          step,
          success,
          message: message ?? null,
          candidates: (extras ?? null) as never,
        }),
    );
  } catch (e) {
    // Audit failures are non-fatal.
    derror("audit log write failed", { bankTransactionId, step, error: e });
  }
}

// ---------------------------------------------------------------------------
// Bank-fee classifier with verbose reasoning.
// ---------------------------------------------------------------------------
async function classifyBankFee(tx: UnassignedTx): Promise<boolean> {
  const withdrawAmount = Number(tx.withdraw_amount) || 0;
  const amount = Math.abs(Number(tx.amount) || 0);
  const absWithdraw = Math.abs(withdrawAmount) || amount;
  const isWithdraw =
    tx.transaction_type === "withdraw" || withdrawAmount > 0;

  dlog("fee.eval", {
    txId: tx.id,
    isWithdraw,
    withdrawAmount,
    amount,
    absWithdraw,
    threshold: BANK_FEE_THRESHOLD_IRR,
  });

  if (absWithdraw <= 0) {
    dlog("fee.skip", { txId: tx.id, reason: "amount <= 0" });
    return false;
  }
  if (absWithdraw >= BANK_FEE_THRESHOLD_IRR) {
    dlog("fee.skip", {
      txId: tx.id,
      reason: `amount ${absWithdraw} >= threshold ${BANK_FEE_THRESHOLD_IRR}`,
    });
    return false;
  }

  const updatePayload = {
    assignment_status: "needs_review",
    assigned_operation_type: "bank_fee_candidate",
  };
  dlog("fee.update", { txId: tx.id, updatePayload });

  const { error } = await debugSupabaseCall(
    "fee.classify.update",
    {
      table: "finance_bank_transactions",
      payload: { id: tx.id, ...updatePayload },
    },
    () =>
      supabase
        .from("finance_bank_transactions")
        .update(updatePayload)
        .eq("id", tx.id)
        .eq("assignment_status", "unassigned"),
  );

  await logAudit(tx.id, "bank_fee_classify", !error, error?.message, {
    amount: absWithdraw,
    threshold: BANK_FEE_THRESHOLD_IRR,
  });

  if (error) {
    derror("fee.update.failed", { txId: tx.id, error });
    return false;
  }

  dlog("fee.classified", { txId: tx.id });
  return true;
}

async function tryInterBankTransfer(tx: UnassignedTx) {
  dlog("xfer.try", {
    txId: tx.id,
    bank_id: tx.bank_id,
    transaction_type: tx.transaction_type,
    deposit_amount: tx.deposit_amount,
    transaction_datetime: tx.transaction_datetime,
  });
  const result = await autoMatchBankTransfer({
    id: tx.id,
    bank_id: tx.bank_id,
    transaction_type: tx.transaction_type,
    deposit_amount: tx.deposit_amount,
    transaction_datetime: tx.transaction_datetime,
  });
  dlog("xfer.result", { txId: tx.id, ...result });
  return result;
}

async function tryBeneficiaryDeposit(tx: UnassignedTx) {
  if (tx.transaction_type !== "deposit") {
    dlog("ident.skip", { txId: tx.id, reason: "not a deposit" });
    return { state: "no_identifier" as const, message: "تراکنش واریز نیست" };
  }

  // Check whether identifier rows already exist. If they do we REUSE them
  // and continue with verify-account + party matching (we do NOT skip the
  // whole beneficiary pipeline — that was the previous bug).
  const { data: existingRows, error: existingErr } = await debugSupabaseCall(
    "ident.exist.fetch",
    {
      table: "finance_bank_tx_identifiers",
      payload: { bank_transaction_id: tx.id },
    },
    () =>
      supabase
        .from("finance_bank_tx_identifiers")
        .select("match_type,raw_value,normalized_value")
        .eq("bank_transaction_id", tx.id),
  );
  if (existingErr) {
    derror("ident.exist.fetch.error", { txId: tx.id, error: existingErr });
  }

  // Mapped to ExtractedIdentifier shape so we can feed them straight into
  // autoIdentifyTransaction with skipPersist=true.
  type ExistingRow = { match_type: number; raw_value: string | null; normalized_value: string };
  const existing = (existingRows ?? []) as ExistingRow[];
  let idents: ReturnType<typeof extractIdentifiers> = [];
  let reused = false;

  if (existing.length > 0) {
    reused = true;
    idents = existing
      .filter((r) => r.match_type === 1 || r.match_type === 2 || r.match_type === 3)
      .map((r) => ({
        type: r.match_type as 1 | 2 | 3,
        raw: r.raw_value ?? r.normalized_value,
        normalized: r.normalized_value,
      }));
    dlog("ident.reuse", {
      txId: tx.id,
      identifierCount: idents.length,
      identifierValues: idents.map((i) => i.normalized),
      identifierTypes: idents.map((i) => i.type),
    });
  } else {
    // Pull identifiers from description AND any other free-text columns we
    // happen to have. The parser dedupes/normalizes internally.
    const combined = [
      tx.description ?? "",
      tx.reference_number ?? "",
      tx.tracking_number ?? "",
      tx.document_number ?? "",
    ]
      .filter(Boolean)
      .join(" \n ");
    idents = extractIdentifiers(combined);

    dlog("ident.extract", {
      txId: tx.id,
      descriptionPreview: (tx.description ?? "").slice(0, 120),
      refs: {
        reference_number: tx.reference_number,
        tracking_number: tx.tracking_number,
        document_number: tx.document_number,
      },
      candidatesCount: idents.length,
      candidates: idents.map((i) => ({
        type: i.type,
        raw: i.raw,
        normalized: i.normalized,
      })),
    });

    if (idents.length === 0) {
      dlog("ident.skip", { txId: tx.id, reason: "no identifier in description" });
    }
  }

  // Resolve the bank's 3-digit code (e.g. "016" for Keshavarzi) so the
  // verify-account edge function can hit cardinfo's deposit_sheba endpoint
  // with the correct bank parameter. Without this it falls back to "016"
  // which 400s for any non-Keshavarzi deposit.
  let resolvedBankCode: string | null = null;
  if (tx.bank_id) {
    const { data: bankRow, error: bankErr } = await debugSupabaseCall(
      "bank.code.lookup",
      { table: "finance_banks", payload: { bank_id: tx.bank_id } },
      () =>
        supabase
          .from("finance_banks")
          .select("legacy_bank_name_code")
          .eq("id", tx.bank_id!)
          .maybeSingle(),
    );
    if (bankErr) {
      derror("bank.code.lookup.error", { txId: tx.id, bank_id: tx.bank_id, error: bankErr });
    }
    const code = bankRow?.legacy_bank_name_code;
    if (code != null) {
      // legacy_bank_name_code is numeric; pad to 3 digits for cardinfo.
      resolvedBankCode = String(code).padStart(3, "0");
    }
    dlog("bank.code.resolved", {
      txId: tx.id,
      bank_id: tx.bank_id,
      legacy_bank_name_code: code ?? null,
      resolvedBankCode,
    });
  }

  const result = await autoIdentifyTransaction(tx.id, tx.transaction_type, idents, {
    bankId: tx.bank_id,
    bankCode: resolvedBankCode,
    // CRITICAL: when we reuse previously persisted identifiers, the inner
    // pipeline must NOT try to re-insert them — the unique constraint on
    // (bank_transaction_id, match_type, normalized_value) would throw and
    // abort verification. Skip persist, continue with verify + match.
    skipPersistIdentifiers: reused,
  });
  dlog("ident.result", { txId: tx.id, reusedIdentifiers: reused, ...result });
  return result;
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------
export async function autoProcessUnassigned(
  onProgress: (p: AutoProcessProgress) => void,
  hardLimit = 5000,
): Promise<AutoProcessProgress> {
  const progress = emptyProgress();
  const runStartedAt = performance.now();

  // ── START banner ───────────────────────────────────────────────────────
  // Always log this so even with debug off the operator sees the entry.
  dlogAlways("START", {
    timestamp: new Date().toISOString(),
    debugEnabled: isDebugOn(),
    batchSize: BATCH_SIZE,
    hardLimit,
    filters: { assignment_status: "unassigned", is_deleted: false },
    env: (import.meta as unknown as { env?: Record<string, string> }).env?.MODE,
  });

  // Session info (best-effort — never blocks the run).
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    dlog("session", {
      userId: sessionData?.session?.user?.id ?? null,
      email: sessionData?.session?.user?.email ?? null,
      hasToken: Boolean(sessionData?.session?.access_token),
    });
  } catch (e) {
    dwarn("session lookup failed", e);
  }

  dgroup("START");

  try {
    // ── Count unassigned ────────────────────────────────────────────────
    const countResp = await debugSupabaseCall(
      "fetch.unassigned.count",
      {
        table: "finance_bank_transactions",
        payload: { filters: { is_deleted: false, assignment_status: "unassigned" } },
      },
      () =>
        supabase
          .from("finance_bank_transactions")
          .select("id", { count: "exact", head: true })
          .eq("is_deleted", false)
          .eq("assignment_status", "unassigned"),
    );
    const totalCount = countResp.count ?? 0;
    progress.total = Math.min(totalCount, hardLimit);
    progress.remaining = progress.total;
    dlogAlways("unassigned.totalCount", {
      totalCount,
      cappedTotal: progress.total,
      hardLimit,
    });
    onProgress({ ...progress });

    if (progress.total === 0) {
      dlogAlways("STOP: no unassigned rows match filters", {
        filters: { is_deleted: false, assignment_status: "unassigned" },
        hint: "Check that rows actually exist with assignment_status='unassigned' and is_deleted=false in finance_bank_transactions.",
      });
      progress.lastMessage = "هیچ تراکنش تخصیص‌نشده‌ای یافت نشد";
      onProgress({ ...progress });
    }

    // ── Page loop ───────────────────────────────────────────────────────
    let batchIndex = 0;
    let safetyGuard = 0;
    while (progress.processed < progress.total && safetyGuard < hardLimit) {
      safetyGuard += BATCH_SIZE;
      batchIndex += 1;
      const batchStartedAt = performance.now();

      dgroup(`batch #${batchIndex}`);

      const fetchResp = await debugSupabaseCall(
        `fetch.unassigned.page.${batchIndex}`,
        {
          table: "finance_bank_transactions",
          payload: {
            limit: BATCH_SIZE,
            order: "transaction_datetime asc",
            filters: { is_deleted: false, assignment_status: "unassigned" },
          },
        },
        () =>
          supabase
            .from("finance_bank_transactions")
            .select(
              "id,bank_id,transaction_type,deposit_amount,withdraw_amount,amount,transaction_datetime,description,reference_number,tracking_number,document_number,assignment_status,assigned_operation_type",
            )
            .eq("is_deleted", false)
            .eq("assignment_status", "unassigned")
            .order("transaction_datetime", { ascending: true })
            .limit(BATCH_SIZE),
      );
      const { data, error } = fetchResp;

      if (error) {
        derror("batch.fetch.error", { batchIndex, error });
        progress.lastMessage = error.message;
        progress.lastError = error.message;
        onProgress({ ...progress });
        dgroupEnd();
        break;
      }
      if (!data || data.length === 0) {
        dlog("batch.empty — stopping loop", { batchIndex });
        progress.lastMessage = "هیچ تراکنش تخصیص‌نشده‌ای باقی نماند";
        onProgress({ ...progress });
        dgroupEnd();
        break;
      }

      const rows = data as UnassignedTx[];
      dlog("batch.rows", {
        batchIndex,
        batchSize: rows.length,
        sampleIds: rows.slice(0, 5).map((r) => r.id),
      });

      let batchSuccess = 0;
      let batchFailed = 0;
      let batchSkipped = 0;

      for (const tx of rows) {
        const txStartedAt = performance.now();
        dgroup(`tx ${tx.id}`);
        dlog("tx.snapshot", {
          id: tx.id,
          bank_id: tx.bank_id,
          transaction_datetime: tx.transaction_datetime,
          transaction_type: tx.transaction_type,
          amount: tx.amount,
          deposit_amount: tx.deposit_amount,
          withdraw_amount: tx.withdraw_amount,
          assignment_status: tx.assignment_status,
          assigned_operation_type: tx.assigned_operation_type,
          reference_number: tx.reference_number,
          tracking_number: tx.tracking_number,
          document_number: tx.document_number,
          descriptionPreview: (tx.description ?? "").slice(0, 160),
        });
        progress.lastTxId = tx.id;

        try {
          // ── Path 1: withdraw → bank fee classifier ──────────────────
          if (
            tx.transaction_type === "withdraw" ||
            (Number(tx.withdraw_amount) || 0) > 0
          ) {
            dlog("path.selected", { txId: tx.id, path: "bank_fee_candidate" });
            const classified = await classifyBankFee(tx);
            if (classified) {
              progress.bank_fees_classified++;
              batchSuccess++;
              progress.lastMessage = "کارمزد بانکی شناسایی شد";
              progress.matchedTransactions.push({
                id: tx.id,
                path: "bank_fee",
              });
            } else {
              await logAudit(
                tx.id,
                "withdraw_above_fee_threshold",
                true,
                "بالاتر از سقف کارمزد یا شرایط فی برقرار نیست",
              );
              progress.skipped++;
              batchSkipped++;
              const reason = "برداشت ولی شرایط کارمزد برقرار نیست";
              progress.lastSkipReason = reason;
              progress.skippedTransactions.push({ id: tx.id, reason });
            }
          } else if (tx.transaction_type === "deposit") {
            // ── Path 2: inter-bank transfer ───────────────────────────
            dlog("path.selected", { txId: tx.id, path: "inter_bank_transfer.try" });
            const xfer = await tryInterBankTransfer(tx);
            if (
              xfer.state === "auto_bank_transfer_matched" ||
              xfer.state === "auto_bank_transfer_posted" ||
              xfer.state === "auto_bank_transfer_failed"
            ) {
              progress.bank_transfers_matched++;
              batchSuccess++;
              if (xfer.state === "auto_bank_transfer_posted") progress.sepidar_posted++;
              progress.lastMessage = "انتقال بین بانکی شناسایی شد";
              progress.matchedTransactions.push({
                id: tx.id,
                path: "inter_bank_transfer",
                paired_tx_id: xfer.matched_withdraw_tx_id ?? null,
                voucher_id: xfer.transfer_id ?? null,
              });
            } else {
              // ── Path 3: known-beneficiary deposit ───────────────────
              dlog("path.selected", { txId: tx.id, path: "beneficiary_deposit.try" });
              const ident = await tryBeneficiaryDeposit(tx);
              if (
                ident.state === "auto_identified" ||
                ident.state === "sepidar_posted"
              ) {
                progress.beneficiary_identified++;
                batchSuccess++;
                if (ident.state === "sepidar_posted") progress.sepidar_posted++;
                progress.lastMessage = "ذینفع شناخته‌شده تطبیق داده شد";
                progress.matchedTransactions.push({
                  id: tx.id,
                  path: "beneficiary_deposit",
                  party_id:
                    (ident as { matched_party_id?: string | null }).matched_party_id ??
                    null,
                });
              } else {
                const reason = ident.message || "نیازمند بازبینی دستی";
                progress.skipped++;
                batchSkipped++;
                progress.lastMessage = reason;
                progress.lastSkipReason = reason;
                progress.skippedTransactions.push({ id: tx.id, reason });
              }
            }
          } else {
            const reason = `نوع تراکنش نامعتبر: ${tx.transaction_type ?? "null"}`;
            dwarn("tx.skip.unknown_type", { txId: tx.id, reason });
            progress.skipped++;
            batchSkipped++;
            progress.lastSkipReason = reason;
            progress.skippedTransactions.push({ id: tx.id, reason });
          }
        } catch (e) {
          // Per-row crash — log and keep going.
          const errObj = e as {
            code?: string;
            message?: string;
            stack?: string;
          };
          const msg = errObj?.message || String(e);
          derror("tx.crash", {
            txId: tx.id,
            message: msg,
            code: errObj?.code,
            stack: errObj?.stack,
            error: e,
          });
          progress.failed++;
          batchFailed++;
          progress.lastError = msg;
          progress.lastMessage = msg;
          progress.failedTransactions.push({
            id: tx.id,
            reason: msg,
            step: "tx.process",
            errorCode: errObj?.code,
            errorMessage: msg,
          });
          await logAudit(tx.id, "auto_process_crash", false, msg);
        }

        progress.processed++;
        progress.remaining = Math.max(0, progress.total - progress.processed);
        dlog("tx.done", {
          txId: tx.id,
          durationMs: Math.round(performance.now() - txStartedAt),
        });
        dgroupEnd();
        onProgress({ ...progress });
      }

      const batchDuration = Math.round(performance.now() - batchStartedAt);
      dlog("batch.summary", {
        batchIndex,
        batchSize: rows.length,
        durationMs: batchDuration,
        success: batchSuccess,
        failed: batchFailed,
        skipped: batchSkipped,
      });
      dgroupEnd();
    }
  } catch (fatal) {
    // Fatal — always log.
    const msg = fatal instanceof Error ? fatal.message : String(fatal);
    derror("FATAL", {
      message: msg,
      stack: fatal instanceof Error ? fatal.stack : undefined,
      error: fatal,
    });
    progress.lastError = msg;
    progress.lastMessage = `خطای بحرانی: ${msg}`;
    onProgress({ ...progress });
  } finally {
    progress.durationMs = Math.round(performance.now() - runStartedAt);

    // ── Always-on final report ──────────────────────────────────────────
    dlogAlways("FINAL SUMMARY");
    dtable({
      total: progress.total,
      processed: progress.processed,
      beneficiary_identified: progress.beneficiary_identified,
      bank_fees: progress.bank_fees_classified,
      bank_transfers: progress.bank_transfers_matched,
      sepidar_posted: progress.sepidar_posted,
      skipped: progress.skipped,
      failed: progress.failed,
      remaining: progress.remaining,
      durationMs: progress.durationMs,
    });
    if (progress.failedTransactions.length > 0) {
      dlogAlways("failedTransactions", progress.failedTransactions);
    }
    if (progress.skippedTransactions.length > 0) {
      dlogAlways("skippedTransactions (last 50)", progress.skippedTransactions.slice(-50));
    }
    if (progress.matchedTransactions.length > 0) {
      dlogAlways("matchedTransactions (last 50)", progress.matchedTransactions.slice(-50));
    }
    dgroupEnd(); // closes START group
    dlogAlways("END", { durationMs: progress.durationMs });
  }

  return progress;
}
