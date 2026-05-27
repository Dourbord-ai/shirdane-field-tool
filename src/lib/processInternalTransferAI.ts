// ============================================================================
// processInternalTransferAI.ts — Orchestrator for the
// "شناسایی تراکنش بین بانکی" toolbar button.
//
// Architecture rule (mirrors processDepositAI.ts):
//   • The MANUAL inter-bank-transfer flow (BankTransferTab + the
//     `auto_create_bank_transfer` SECURITY DEFINER RPC + the canonical
//     createVoucher → syncVoucherToSepidar pipeline) is the SOURCE OF TRUTH.
//   • This orchestrator does NOT duplicate any of:
//       - the finance_bank_transfers insert (RPC owns it + idempotency)
//       - the voucher creation / Sepidar posting (createVoucher +
//         syncVoucherToSepidar, called inside autoMatchBankTransfer)
//       - the assignment_status flip on the two bank transactions
//         (handled inside the RPC + the voucher pipeline)
//
// What it adds on top of `autoMatchBankTransfer`:
//   1. A row-by-row sweep over every still-unassigned deposit (instead of
//      the import-time per-row trigger).
//   2. An "own-bank identifier" pre-classification: if a deposit's
//      ai_verify_payload.number matches one of our own active
//      finance_banks (card_number / iban_number / account_number) but no
//      withdrawal counterpart is found, surface it as
//      `needs_pair_review` instead of silently skipping it. This is the
//      signal that the deposit IS an internal transfer but its sibling
//      hasn't been imported yet (or matches outside the time window).
//   3. Persian counters + structured console logs prefixed
//      `[InternalTransferAI]` for the operator.
// ============================================================================

import { supabase } from "@/integrations/supabase/client";
import {
  autoMatchBankTransfer,
  type AutoBankTransferInput,
} from "@/lib/autoBankTransfer";

// Per-run counters surfaced as Persian chips in the toolbar summary toast.
export interface InternalTransferAIProgress {
  total: number;                  // candidate deposits considered
  processed: number;              // candidates that completed (any state)
  own_bank_detected: number;      // deposits flagged by own-bank identifier
  pairs_detected: number;         // pair-matched (1 unique withdrawal found)
  posted: number;                 // transfer created AND Sepidar posted
  matched_not_posted: number;     // transfer created, Sepidar failed
  needs_review: number;           // ambiguous OR own-bank-without-pair
  failed: number;                 // unexpected exceptions
  // Per-row failure descriptions (Persian) for an optional log panel.
  failures: Array<{ tx_id: string; message: string }>;
}

export type InternalTransferAISummary = InternalTransferAIProgress;

export function emptyInternalTransferAIProgress(): InternalTransferAIProgress {
  return {
    total: 0,
    processed: 0,
    own_bank_detected: 0,
    pairs_detected: 0,
    posted: 0,
    matched_not_posted: 0,
    needs_review: 0,
    failed: 0,
    failures: [],
  };
}

// JSONB shape n8n / verify-account write into `ai_verify_payload`.
interface AiVerifyPayload {
  type?: string | null;
  number?: string | null;
  bankCode?: string | null;
}

// Minimal projection of the candidate deposit rows we walk.
interface DepositRow {
  id: string;
  bank_id: string | null;
  transaction_type: string | null;
  deposit_amount: number | null;
  transaction_datetime: string | null;
  ai_verify_payload: AiVerifyPayload | null;
}

// Minimal projection of finance_banks rows used to build the own-bank
// identifier set (card / IBAN / account numbers).
interface OwnBankRow {
  id: string;
  card_number: string | null;
  iban_number: string | null;
  account_number: string | null;
  is_active: boolean | null;
  is_deleted: boolean | null;
}

// Normalize an identifier so loose-equality matches survive surface
// differences like "IR12 1234 …" vs "IR12123…", "6037-9911" vs "6037991100".
function normalizeIdent(v: string | null | undefined): string {
  return (v ?? "").replace(/[\s-]/g, "").toUpperCase();
}

// Build the set of all known own-bank identifiers (card/IBAN/account)
// across every active, non-deleted finance_banks row.
async function loadOwnBankIdentifiers(): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("finance_banks")
    .select("id, card_number, iban_number, account_number, is_active, is_deleted")
    .eq("is_active", true)
    .eq("is_deleted", false);
  if (error) {
    console.error("[InternalTransferAI] own_bank_identifiers.load_failed", error);
    return new Set();
  }
  const s = new Set<string>();
  for (const b of (data as OwnBankRow[]) || []) {
    const c = normalizeIdent(b.card_number);
    const i = normalizeIdent(b.iban_number);
    const a = normalizeIdent(b.account_number);
    if (c) s.add(c);
    if (i) s.add(i);
    if (a) s.add(a);
  }
  return s;
}

// ----------------------------------------------------------------------------
// Public entry point. Returns the final summary; pushes progress via
// `onProgress` after every row so the UI can render a live panel.
// ----------------------------------------------------------------------------
export async function processInternalTransferAI(
  onProgress?: (p: InternalTransferAIProgress) => void,
): Promise<InternalTransferAISummary> {
  const progress = emptyInternalTransferAIProgress();
  const push = () => onProgress?.({ ...progress, failures: [...progress.failures] });

  console.log("[InternalTransferAI] candidates.started");

  // Fetch own-bank identifier set ONCE — it's small and reused per row.
  const ownIdentifiers = await loadOwnBankIdentifiers();

  // Fetch every still-unassigned deposit, oldest-first so pairs created
  // earlier in the day get matched against their natural counterparts first.
  const { data: candidates, error: candErr } = await supabase
    .from("finance_bank_transactions")
    .select(
      "id, bank_id, transaction_type, deposit_amount, transaction_datetime, ai_verify_payload",
    )
    .eq("transaction_type", "deposit")
    .eq("assignment_status", "unassigned")
    .eq("is_deleted", false)
    .order("transaction_datetime", { ascending: true })
    .limit(500);

  if (candErr) {
    console.error("[InternalTransferAI] candidates.query_failed", candErr);
    throw candErr;
  }

  const rows = (candidates as DepositRow[]) || [];
  progress.total = rows.length;
  push();

  // Row-by-row — correctness over speed, per spec.
  for (const tx of rows) {
    try {
      // Re-check the row's current state right before processing — another
      // operator (or a parallel import) could have assigned it in the
      // meantime. Cheap single-row select.
      const { data: fresh } = await supabase
        .from("finance_bank_transactions")
        .select("id, assignment_status, is_deleted")
        .eq("id", tx.id)
        .maybeSingle();
      if (!fresh || fresh.is_deleted || fresh.assignment_status !== "unassigned") {
        progress.processed += 1;
        push();
        continue;
      }

      // Own-bank identifier pre-classification — purely informational; it
      // does NOT change the posting path. We still try to find a withdraw
      // pair; if none, we surface needs_review with a clearer reason.
      const payloadNumber = normalizeIdent(tx.ai_verify_payload?.number);
      const ownBankHit = payloadNumber && ownIdentifiers.has(payloadNumber);
      if (ownBankHit) {
        progress.own_bank_detected += 1;
        console.log("[InternalTransferAI] own_bank_identifier.detected", {
          tx_id: tx.id,
          number: payloadNumber,
        });
      }

      console.log("[InternalTransferAI] pair.claim.started", { tx_id: tx.id });

      // Delegate to the canonical helper — it owns candidate query, the
      // SECURITY DEFINER RPC that creates the transfer atomically, the
      // assignment_status updates, voucher creation, and Sepidar posting.
      // `force:true` skips the two import-time feature flags so the manual
      // button always runs end-to-end (matching manual BankTransferTab).
      const input: AutoBankTransferInput = {
        id: tx.id,
        bank_id: tx.bank_id,
        transaction_type: "deposit",
        deposit_amount: tx.deposit_amount,
        transaction_datetime: tx.transaction_datetime,
      };

      const outcome = await autoMatchBankTransfer(input, { force: true });
      console.log("[InternalTransferAI] pair.outcome", { tx_id: tx.id, outcome });

      switch (outcome.state) {
        case "no_match":
          // No pair AND no own-bank signal → genuinely not an internal
          // transfer. Silent skip. Own-bank-flagged without pair becomes
          // needs_review so the operator can investigate.
          if (ownBankHit) {
            progress.needs_review += 1;
            console.log("[InternalTransferAI] failed", {
              tx_id: tx.id,
              reason: "own_bank_no_pair",
            });
          }
          break;
        case "auto_bank_transfer_needs_review":
          progress.needs_review += 1;
          console.log("[InternalTransferAI] failed", {
            tx_id: tx.id,
            reason: "ambiguous_or_rpc_failed",
            message: outcome.message,
          });
          break;
        case "auto_bank_transfer_matched":
          // Transfer row created but auto-post flag was off (cannot happen
          // with force:true — kept for safety) OR Sepidar didn't run.
          progress.pairs_detected += 1;
          progress.matched_not_posted += 1;
          console.log("[InternalTransferAI] manual.create.success", {
            tx_id: tx.id,
            transfer_id: outcome.transfer_id,
          });
          break;
        case "auto_bank_transfer_posted":
          progress.pairs_detected += 1;
          progress.posted += 1;
          console.log("[InternalTransferAI] approve.success", {
            tx_id: tx.id,
            transfer_id: outcome.transfer_id,
          });
          break;
        case "auto_bank_transfer_failed":
          progress.pairs_detected += 1;
          progress.matched_not_posted += 1;
          progress.failures.push({
            tx_id: tx.id,
            message: outcome.message ?? "ثبت سپیدار ناموفق",
          });
          console.log("[InternalTransferAI] failed", {
            tx_id: tx.id,
            reason: "sepidar_failed",
            message: outcome.message,
          });
          break;
      }
    } catch (e) {
      // Per-row crash must never stop the sweep — log and continue.
      const msg = e instanceof Error ? e.message : String(e);
      progress.failed += 1;
      progress.failures.push({ tx_id: tx.id, message: msg });
      console.error("[InternalTransferAI] failed", { tx_id: tx.id, error: msg });
    } finally {
      progress.processed += 1;
      push();
    }
  }

  console.log("[InternalTransferAI] summary", {
    total: progress.total,
    own_bank_detected: progress.own_bank_detected,
    pairs_detected: progress.pairs_detected,
    posted: progress.posted,
    matched_not_posted: progress.matched_not_posted,
    needs_review: progress.needs_review,
    failed: progress.failed,
  });

  return progress;
}
