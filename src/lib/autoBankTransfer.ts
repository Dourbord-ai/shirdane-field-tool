// ============================================================================
// Auto-matching pipeline for inter-bank transfers detected during bank import.
//
// Mirrors `autoIdentify.ts` (which auto-creates customer-receive
// identifications). The shapes/states/logging look intentionally similar so
// future maintainers only have to learn one mental model.
//
// What this module does, in order:
//   1. For a freshly-inserted DEPOSIT row whose `bank_id` is one of our
//      configured banks, find a single matching WITHDRAWAL row.
//       - same amount
//       - opposite direction (deposit ↔ withdraw)
//       - DIFFERENT bank
  //       - close transaction date/time (we use a configurable window;
  //         default ±24h to reduce false multi-matches)
//       - not already assigned to another operation
//       - not already linked into another active transfer
//   2. If EXACTLY ONE candidate is found → call the SECURITY DEFINER RPC
//      `auto_create_bank_transfer` to insert the transfer atomically. The
//      partial unique indexes added in the matching migration are the
//      idempotency anchor — re-running the import cannot create duplicates.
//   3. If the `auto_post_bank_transfers_to_sepidar` feature flag is ON,
//      build the same voucher items the manual `BankTransferTab` builds and
//      post via the canonical `createVoucher` + `syncVoucherToSepidar` path.
//      A failure here NEVER rolls back the transfer; the user retries from
//      the existing manual UI.
//
// Both feature flags default to OFF; the entry point checks the *create*
// flag and silently returns "no_match" when it is disabled, so the import
// pipeline can call this unconditionally.
// ============================================================================

import { supabase } from "@/integrations/supabase/client";
// Reuse the EXACT same canonical posting path used by the manual
// BankTransferTab form. Do NOT introduce a parallel Sepidar flow here.
import {
  createVoucher,
  syncVoucherToSepidar,
  type VoucherItemInput,
} from "@/lib/finance";

// Outcome returned to the import UI so it can show counters / per-row chips.
export interface AutoBankTransferOutcome {
  state:
    // No candidate at all — most common case, treated as a no-op.
    | "no_match"
    // Found candidates but couldn't auto-confirm (>1 match, ambiguous).
    | "auto_bank_transfer_needs_review"
    // Created the transfer record (and updated tx assignment_status).
    | "auto_bank_transfer_matched"
    // Created the transfer AND posted to Sepidar successfully.
    | "auto_bank_transfer_posted"
    // Created the transfer but Sepidar posting failed; retry via manual UI.
    | "auto_bank_transfer_failed";
  message?: string;
  transfer_id?: string | null;
  matched_withdraw_tx_id?: string | null;
}

// Aggregated counters displayed as summary chips in the import dialog.
export interface AutoBankTransferSummary {
  matched: number;
  posted: number;
  failed: number;
  needs_review: number;
}

export function emptyAutoBankTransferSummary(): AutoBankTransferSummary {
  return { matched: 0, posted: 0, failed: 0, needs_review: 0 };
}

export function bumpBankTransferSummary(
  s: AutoBankTransferSummary,
  o: AutoBankTransferOutcome,
) {
  // Explicit per-state mapping so a future state can't silently slip through.
  if (o.state === "auto_bank_transfer_matched") s.matched += 1;
  else if (o.state === "auto_bank_transfer_posted") {
    s.matched += 1;
    s.posted += 1;
  } else if (o.state === "auto_bank_transfer_failed") {
    s.matched += 1;
    s.failed += 1;
  } else if (o.state === "auto_bank_transfer_needs_review") {
    s.needs_review += 1;
  }
}

// ----------------------------------------------------------------------------
// Feature flag helpers. We treat any DB/network error as "disabled" — the
// safe default is to do nothing.
// ----------------------------------------------------------------------------
async function isFlagOn(key: string): Promise<boolean> {
  const { data } = await supabase
    .from("finance_feature_flags")
    .select("enabled")
    .eq("key", key)
    .maybeSingle();
  return Boolean(data?.enabled);
}

// ----------------------------------------------------------------------------
// Audit log helper. We piggy-back on `finance_auto_identification_log`
// because it already has the right shape (bank_transaction_id, step,
// success, message, candidates). Step names are namespaced with the
// `auto_bank_transfer_` prefix so reports can filter the two pipelines
// apart trivially.
// ----------------------------------------------------------------------------
async function logStep(
  bankTransactionId: string,
  step: string,
  success: boolean,
  extras: { candidates?: unknown; message?: string } = {},
) {
  // Swallow errors — audit logging must never break the main pipeline.
  await supabase.from("finance_auto_identification_log").insert({
    bank_transaction_id: bankTransactionId,
    step,
    success,
    candidates: (extras.candidates ?? null) as never,
    message: extras.message ?? null,
  });
}

// ----------------------------------------------------------------------------
// Input shape: the bare minimum we need from the just-inserted deposit row.
// ----------------------------------------------------------------------------
export interface AutoBankTransferInput {
  id: string;
  bank_id: string | null;
  transaction_type: "deposit" | "withdraw" | null;
  deposit_amount: number | null;
  transaction_datetime: string | null; // ISO string
}

// Match window — bank-side timestamps frequently drift by a few hours
// between source and destination. 24h keeps false multi-matches low while
// still catching same-day and next-day posting drift.
const MATCH_WINDOW_HOURS = 24;
// Aggressive window — used when the caller has independent confirmation
// (e.g. own-bank identifier hit) that the deposit IS an internal transfer.
// Tied to the same 24h window as normal mode so repeated identical transfers
// across multiple days do not create ambiguous matches.
const AGGRESSIVE_MATCH_WINDOW_HOURS = 24;

// ----------------------------------------------------------------------------
// Public entry point. Returns a "no_match" outcome (zero side-effects) if
// the creation feature flag is OFF or the row isn't an eligible deposit.
// `aggressive` widens the time window and breaks ambiguity by closest-time
// tie-break — only safe when the caller has already confirmed the deposit
// is an internal transfer (orchestrator's own-bank identifier hit).
// ----------------------------------------------------------------------------
export async function autoMatchBankTransfer(
  tx: AutoBankTransferInput,
  opts: { force?: boolean; aggressive?: boolean } = {},
): Promise<AutoBankTransferOutcome> {
  // --- Early-outs (no logging — silent no-op) ------------------------------
  if (tx.transaction_type !== "deposit") return { state: "no_match" };
  if (!tx.bank_id) return { state: "no_match" };
  if (!tx.deposit_amount || tx.deposit_amount <= 0) return { state: "no_match" };
  if (!tx.transaction_datetime) return { state: "no_match" };

  // Feature flag — when disabled we don't even probe candidates. This keeps
  // the import path's perceived cost zero until the operator opts in.
  // `force=true` bypasses the flag (used by the explicit
  // "شناسایی تراکنش بین بانکی" toolbar button which is an operator action).
  if (!opts.force && !(await isFlagOn("auto_create_bank_transfers"))) {
    return { state: "no_match" };
  }

  // --- Step 1: candidate search --------------------------------------------
  // Build the time window around the deposit's timestamp. Aggressive mode
  // uses the same 24h window as normal mode.
  const windowHours = opts.aggressive
    ? AGGRESSIVE_MATCH_WINDOW_HOURS
    : MATCH_WINDOW_HOURS;
  const depAt = new Date(tx.transaction_datetime).getTime();
  const fromISO = new Date(depAt - windowHours * 3600_000).toISOString();
  const toISO = new Date(depAt + windowHours * 3600_000).toISOString();

  const { data: candidates, error: candErr } = await supabase
    .from("finance_bank_transactions")
    .select("id, bank_id, withdraw_amount, transaction_datetime")
    .eq("transaction_type", "withdraw")
    .eq("withdraw_amount", tx.deposit_amount)
    .eq("assignment_status", "unassigned")
    .eq("is_deleted", false)
    .neq("bank_id", tx.bank_id)
    .gte("transaction_datetime", fromISO)
    .lte("transaction_datetime", toISO)
    // Cap defensively — if we somehow get >50 candidates the data is so
    // noisy that auto-confirming would be irresponsible anyway.
    .limit(50);

  if (candErr) {
    await logStep(tx.id, "auto_bank_transfer_candidate_query_failed", false, {
      message: candErr.message,
    });
    return { state: "no_match" };
  }

  const list = candidates ?? [];
  if (list.length === 0) return { state: "no_match" };

  let withdraw = list[0];
  if (list.length > 1) {
    if (opts.aggressive) {
      // Caller confirmed this is an internal transfer (own-bank hit). Pick
      // the withdraw closest in time to the deposit — safe tie-break since
      // amount + opposite-direction + cross-bank are already locked in.
      withdraw = list.reduce((best, c) => {
        const d = (t: string | null) =>
          t ? Math.abs(new Date(t).getTime() - depAt) : Number.POSITIVE_INFINITY;
        return d(c.transaction_datetime) < d(best.transaction_datetime) ? c : best;
      }, list[0]);
      await logStep(tx.id, "auto_bank_transfer_aggressive_tiebreak", true, {
        candidates: list.map((c) => c.id),
        message: `picked closest-time withdraw=${withdraw.id} from ${list.length}`,
      });
    } else {
      // Ambiguous — log and surface as needs_review. We deliberately do NOT
      // try a tie-breaker (closest timestamp) in v1: silent guessing is the
      // exact failure mode the user told us to avoid.
      await logStep(tx.id, "auto_bank_transfer_needs_review", false, {
        candidates: list.map((c) => c.id),
        message: `${list.length} matching withdrawals found`,
      });
      return {
        state: "auto_bank_transfer_needs_review",
        message: `${list.length} برداشت همخوان یافت شد — نیاز به بازبینی`,
      };
    }
  }

  // --- Step 2: create the transfer via the SECURITY DEFINER RPC ------------
  // The RPC enforces locking, type/amount/bank checks, and is idempotent on
  // re-runs via the partial unique indexes on (from_transaction_id) and
  // (to_transaction_id).
  const { data: transferId, error: rpcErr } = await supabase.rpc(
    "auto_create_bank_transfer",
    {
      p_deposit_tx_id: tx.id,
      p_withdraw_tx_id: withdraw.id,
      p_match_source: "excel_import_auto",
    },
  );

  if (rpcErr || !transferId) {
    await logStep(tx.id, "auto_bank_transfer_failed", false, {
      message: rpcErr?.message ?? "rpc returned null",
      candidates: { withdraw_id: withdraw.id },
    });
    // Treat as needs_review so the user can investigate without losing the
    // surfaced candidate.
    return {
      state: "auto_bank_transfer_needs_review",
      message: rpcErr?.message ?? "ایجاد خودکار انتقال ناموفق بود",
      matched_withdraw_tx_id: withdraw.id,
    };
  }

  await logStep(tx.id, "auto_bank_transfer_matched", true, {
    candidates: { transfer_id: transferId, withdraw_id: withdraw.id },
  });

  const outcome: AutoBankTransferOutcome = {
    state: "auto_bank_transfer_matched",
    transfer_id: transferId as string,
    matched_withdraw_tx_id: withdraw.id,
  };

  // --- Step 3: optional Sepidar posting ------------------------------------
  // Gated behind the second flag. When OFF, the transfer is preserved with
  // status='approved' and voucher_id=NULL; the user can issue/post manually.
  // `force=true` also bypasses the post-flag so the manual button always
  // posts to Sepidar end-to-end (mirrors the manual BankTransferTab flow).
  if (!opts.force && !(await isFlagOn("auto_post_bank_transfers_to_sepidar"))) {
    return outcome;
  }

  try {
    // Mirror the items built by BankTransferTab.submit() exactly: debit the
    // destination bank, credit the source bank. We skip the fee leg because
    // auto-matched transfers always pass the strict equal-amount check.
    const items: VoucherItemInput[] = [
      {
        bank_id: tx.bank_id,
        account_type: "bank",
        debit: tx.deposit_amount,
        credit: 0,
        description: "بانک مقصد",
      },
      {
        bank_id: withdraw.bank_id,
        account_type: "bank",
        debit: 0,
        credit: withdraw.withdraw_amount ?? tx.deposit_amount,
        description: "بانک مبدا",
      },
    ];

    const voucher = await createVoucher({
      voucher_type: "bank_transfer",
      source_operation_type: "bank_transfer",
      source_operation_id: transferId as string,
      title: "انتقال بین بانکی - خودکار",
      description: "تشخیص خودکار از ایمپورت بانکی",
      items,
    });

    // Link the voucher to the transfer BEFORE posting so a Sepidar crash
    // still leaves voucher_id as a stable idempotency anchor for retries.
    await supabase
      .from("finance_bank_transfers")
      .update({ voucher_id: voucher.id })
      .eq("id", transferId as string);

    const sync = await syncVoucherToSepidar(voucher.id);

    // `syncVoucherToSepidar` returns `{ status, error_message }` — the
    // edge function is the source of truth and already persisted
    // sepidar_sync_status on the voucher row.
    if (sync.status === "synced") {
      await logStep(tx.id, "auto_bank_transfer_posted", true, {
        candidates: { transfer_id: transferId, voucher_id: voucher.id },
      });
      outcome.state = "auto_bank_transfer_posted";
      outcome.message = "ثبت‌شده در سپیدار";
    } else {
      await logStep(tx.id, "auto_bank_transfer_failed", false, {
        candidates: { transfer_id: transferId, voucher_id: voucher.id },
        message: sync.error_message ?? "Sepidar posting failed",
      });
      outcome.state = "auto_bank_transfer_failed";
      outcome.message = sync.error_message ?? "خطا در ثبت سپیدار";
    }
  } catch (e) {
    // Same policy as receive auto-identification: NEVER roll back the
    // transfer on a Sepidar failure. The manual retry path owns recovery.
    const msg = e instanceof Error ? e.message : String(e);
    await logStep(tx.id, "auto_bank_transfer_failed", false, {
      candidates: { transfer_id: transferId },
      message: msg,
    });
    outcome.state = "auto_bank_transfer_failed";
    outcome.message = msg;
  }

  return outcome;
}
