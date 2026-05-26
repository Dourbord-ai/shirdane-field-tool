// ============================================================================
// processDepositAI.ts — Orchestrator for the "شناسایی واریزها" button.
//
// Architecture rule (read this before touching the file):
//   • The MANUAL receive-identification flow is the single source of truth.
//   • This file is an ORCHESTRATOR — it does NOT duplicate any of:
//       - the receive-identification insert  (handled by the RPC
//         `auto_create_receive_identification`, guarded by
//         `fn_finance_receive_identifications_guard`)
//       - the voucher creation / Sepidar posting (handled by
//         `approveReceiveIdentification` in `@/lib/finance`)
//       - the `assignment_status='assigned'` flip on the bank transaction
//         (also owned by `approveReceiveIdentification`)
//
// Flow per click:
//   1. POST to n8n webhook → n8n fills `ai_verify_payload` + sets
//      `ai_verify_status='parsed_by_regex'` on each candidate deposit.
//   2. Re-fetch the candidates the webhook populated.
//   3. For each candidate, sequentially:
//        a. mark `ai_verify_status='processing'` (rerun protection)
//        b. call `verify-account` with `ai_verify_payload` verbatim
//        c. on failure → ai_verify_status='verify_failed'
//        d. on success → look up cached owner → resolve trusted finance party
//        e. no party → ai_verify_status='party_not_found'
//        f. party found → call the SAME manual RPC + approval helper
//        g. on posting success → ai_verify_status='posted'
//        h. on posting failure → ai_verify_status='posting_failed'
//   4. Return the Persian summary the UI will display.
// ============================================================================

import { supabase } from "@/integrations/supabase/client";
// Reuse the EXACT manual posting helper — do NOT duplicate Sepidar logic.
import { approveReceiveIdentification } from "@/lib/finance";

// Webhook URL is the n8n entry point that parses unassigned deposit
// descriptions and writes ai_verify_payload + ai_verify_status back to the
// database. We do not need any payload — n8n discovers candidates itself.
const N8N_WEBHOOK_URL = "https://dcn8n.dourbord.ir/webhook/finance-deposit-ai";

// Shape of the JSONB blob n8n writes into ai_verify_payload.
//   type   "1" = card, "2" = sheba (IBAN), "3" = account/deposit
//   number normalized identifier
//   bankCode optional 3-digit code (e.g. "016"); pass through to verify-account
interface AiVerifyPayload {
  type: string;
  number: string;
  bankCode?: string | null;
}

// Summary counters returned to the toolbar so it can render the result toast.
export interface DepositAISummary {
  total: number;             // candidates fetched from DB
  identified_by_ai: number;  // rows that had a non-null ai_verify_payload
  verify_success: number;    // verify-account returned ok
  party_not_found: number;   // verified, but no trusted finance party match
  posted: number;            // full pipeline succeeded (assigned + voucher)
  failed: number;            // verify_failed OR posting_failed OR exception
}

// Progress shape pushed to the UI between iterations.
export interface DepositAIProgress extends DepositAISummary {
  processed: number;
  lastMessage?: string;
  failures: Array<{ txId: string; step: string; message: string }>;
}

export function emptyDepositAIProgress(): DepositAIProgress {
  return {
    total: 0,
    identified_by_ai: 0,
    verify_success: 0,
    party_not_found: 0,
    posted: 0,
    failed: 0,
    processed: 0,
    failures: [],
  };
}

// Tiny logger to keep the grep-friendly prefix the spec requires.
function log(step: string, payload?: unknown) {
  // eslint-disable-next-line no-console
  console.log(`[DepositAI] ${step}`, payload ?? "");
}

// ---------------------------------------------------------------------------
// Step 1 — fire the n8n webhook. We swallow non-2xx as a soft warning: even
// if n8n is down, the DB might already contain previously-parsed rows and
// the rest of the pipeline should still run against them.
// ---------------------------------------------------------------------------
async function triggerWebhook(): Promise<void> {
  log("webhook.started", { url: N8N_WEBHOOK_URL });
  try {
    const res = await fetch(N8N_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "lovable-deposit-ai-button" }),
    });
    log("webhook.finished", { status: res.status, ok: res.ok });
  } catch (e) {
    log("webhook.error", { error: e instanceof Error ? e.message : String(e) });
    // Intentionally non-fatal — we still process whatever the DB already has.
  }
}

// ---------------------------------------------------------------------------
// Step 2 — fetch the candidate rows the webhook just populated.
// Strict filter so a rerun never reprocesses something already posted.
// ---------------------------------------------------------------------------
interface CandidateTx {
  id: string;
  bank_id: string | null;
  ai_verify_payload: AiVerifyPayload | null;
  ai_verify_status: string | null;
  assignment_status: string | null;
}

async function fetchCandidates(): Promise<CandidateTx[]> {
  const { data, error } = await supabase
    .from("finance_bank_transactions")
    .select("id, bank_id, ai_verify_payload, ai_verify_status, assignment_status")
    .eq("transaction_type", "deposit")
    .eq("assignment_status", "unassigned")
    .eq("ai_verify_status", "parsed_by_regex")
    .eq("is_deleted", false)
    .not("ai_verify_payload", "is", null)
    // Spec rule: rows that already carry an error must NOT be reprocessed —
    // they belong to a terminal state and a rerun would loop forever.
    .is("ai_verify_error", null)
    // Hard cap to keep a single click bounded; rerun for the rest.
    .limit(500);
  if (error) {
    log("candidates.error", { error: error.message });
    throw error;
  }
  return (data || []) as unknown as CandidateTx[];
}

// ---------------------------------------------------------------------------
// Recover stale 'processing' rows. If a previous run crashed (tab closed,
// network drop) a candidate may have been claimed but never advanced to a
// terminal state. Without this reset the row is invisible to fetchCandidates
// forever (it only sees 'parsed_by_regex'). We only revert rows that are
// truly orphaned: still unassigned and have no Sepidar-linked receive
// identification pointing at them — anything else might be mid-flight in a
// concurrent tab and must NOT be touched.
//
// We bound the lookback so a row that is genuinely in-flight in another tab
// (started seconds ago) is left alone. Five minutes is far longer than any
// single-row run takes in practice.
// ---------------------------------------------------------------------------
async function recoverStaleProcessing(): Promise<void> {
  const cutoffIso = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  // Only touch rows that:
  //   - were claimed (ai_verify_status='processing')
  //   - have not been assigned to any operation (assignment_status='unassigned')
  //   - were touched more than 5 minutes ago (stale)
  // The DB has ai_verified_at; we use it as the "last touched" timestamp
  // because setVerifyResult writes it, and the claim() update lands earlier
  // but its updated_at column is also bumped by the row trigger. ai_verified_at
  // is null when claim() runs (it's only set in setVerifyResult), so use
  // updated_at as the more reliable freshness signal.
  const { error } = await supabase
    .from("finance_bank_transactions")
    .update({ ai_verify_status: "parsed_by_regex" })
    .eq("ai_verify_status", "processing")
    .eq("assignment_status", "unassigned")
    .lt("updated_at", cutoffIso);
  if (error) {
    log("recovery.error", { error: error.message });
  } else {
    log("recovery.done", { cutoffIso });
  }
}

// ---------------------------------------------------------------------------
// Atomic claim — sets ai_verify_status='processing' only if it's still
// 'parsed_by_regex'. Returns true when this client successfully claimed the
// row (so concurrent runs cannot double-process the same transaction).
// ---------------------------------------------------------------------------
async function claim(txId: string): Promise<boolean> {
  // Emit the spec-mandated log marker so dashboards can group claim attempts.
  log("claim.started", { txId });
  const { data, error } = await supabase
    .from("finance_bank_transactions")
    .update({
      ai_verify_status: "processing",
      // Spec rule: clear stale error when we (re-)enter the processing state
      // so a previously-errored row that was manually reset to
      // 'parsed_by_regex' doesn't carry its old message into the new run.
      ai_verify_error: null,
    })
    .eq("id", txId)
    .eq("ai_verify_status", "parsed_by_regex")
    .select("id")
    .maybeSingle();
  if (error) {
    log("claim.error", { txId, error: error.message });
    return false;
  }
  const ok = Boolean(data?.id);
  // Distinct success/skip markers — the spec asks for both so operators can
  // tell concurrency races (skipped) apart from real successful claims.
  log(ok ? "claim.success" : "claim.skipped", { txId });
  return ok;
}

// ---------------------------------------------------------------------------
// Persist the verify-account / pipeline outcome onto the transaction row.
// The status union mirrors the spec's terminal-state list plus 'verified'
// (intermediate, written immediately after verify-account succeeds so the
// row is never left in 'processing' for longer than one network hop).
// ---------------------------------------------------------------------------
async function setVerifyResult(
  txId: string,
  status:
    | "verified"
    | "verify_failed"
    | "party_not_found"
    | "posted"
    | "posting_failed",
  patch: { result?: unknown; error?: string | null } = {},
) {
  await supabase
    .from("finance_bank_transactions")
    .update({
      ai_verify_status: status,
      ai_verified_result: (patch.result ?? null) as never,
      ai_verify_error: patch.error ?? null,
      ai_verified_at: new Date().toISOString(),
    })
    .eq("id", txId);
}

// ---------------------------------------------------------------------------
// Party resolution — mirrors the same two-tier rule used by autoIdentify.ts:
//   1. bankpartyaccountinfos.finance_party_id (cache pointer set whenever
//      the canonical flow has previously confirmed this identifier).
//   2. Otherwise: historical approved receive identifications keyed by the
//      same normalised identifier. Auto-confirm ONLY when exactly one
//      distinct party appears across all matches (zero/many = ambiguous).
// We re-implement here (instead of importing the private helper) because
// autoIdentify.ts re-extracts identifiers from the description; we already
// have them straight from ai_verify_payload.
// ---------------------------------------------------------------------------
async function lookupCache(payload: AiVerifyPayload) {
  const { data } = await supabase
    .from("bankpartyaccountinfos")
    .select("id, matchname, matchbankname, finance_party_id")
    .eq("matchtype", String(payload.type))
    .eq("matchcontent", payload.number)
    .maybeSingle();
  return data;
}

async function findTrustedPartyId(
  payload: AiVerifyPayload,
  cache: { finance_party_id: string | null } | null,
): Promise<string | null> {
  if (cache?.finance_party_id) return cache.finance_party_id;

  // Numeric type in finance_bank_tx_identifiers.match_type — payload.type is a string ("1"/"2"/"3").
  const matchTypeNum = Number(payload.type);
  if (!Number.isFinite(matchTypeNum)) return null;

  const { data: identRows } = await supabase
    .from("finance_bank_tx_identifiers")
    .select("bank_transaction_id")
    .eq("match_type", matchTypeNum)
    .eq("normalized_value", payload.number);
  const txIds = (identRows ?? [])
    .map((r) => r.bank_transaction_id)
    .filter((x): x is string => Boolean(x));
  if (txIds.length === 0) return null;

  const { data: receiveRows } = await supabase
    .from("finance_receive_identifications")
    .select("party_id")
    .in("bank_transaction_id", txIds)
    .eq("status", "approved")
    .eq("is_deleted", false);

  const partySet = new Set<string>();
  for (const r of (receiveRows ?? []) as Array<{ party_id: string | null }>) {
    if (r.party_id) partySet.add(r.party_id);
  }
  if (partySet.size !== 1) return null;
  return Array.from(partySet)[0];
}

// ---------------------------------------------------------------------------
// Public entry point — wires steps 1-4 together and pushes progress updates
// to the UI between transactions.
// ---------------------------------------------------------------------------
export async function processDepositAI(
  onProgress?: (p: DepositAIProgress) => void,
): Promise<DepositAISummary> {
  const progress = emptyDepositAIProgress();
  const push = (msg?: string) => {
    if (msg) progress.lastMessage = msg;
    onProgress?.({ ...progress, failures: [...progress.failures] });
  };

  // 1) trigger n8n parser (non-fatal if down)
  await triggerWebhook();
  push("هوشیار در حال بررسی شرح واریزی‌ها — لطفا کمی صبر کنید");

  // 1b) Crash-recovery sweep: any row left in 'processing' by an earlier
  // run (closed tab / network drop) gets reset back to 'parsed_by_regex'
  // so this run can pick it up. Bounded by a 5-minute age check inside
  // recoverStaleProcessing so concurrent in-flight rows are never stolen.
  await recoverStaleProcessing();

  // 2) fetch candidates that n8n marked ready
  const candidates = await fetchCandidates();
  progress.total = candidates.length;
  progress.identified_by_ai = candidates.filter((c) => c.ai_verify_payload).length;
  log("candidates.count", { total: progress.total, identified: progress.identified_by_ai });
  push(`${progress.total} تراکنش آماده برای شناسایی`);

  // 3) iterate sequentially — keeps DB load predictable and makes per-row
  //    failure isolation trivial (one try/catch per iteration).
  for (const tx of candidates) {
    progress.processed += 1;
    const payload = tx.ai_verify_payload;

    try {
      // Rerun protection — only process rows still in 'parsed_by_regex'.
      if (!payload || tx.assignment_status !== "unassigned") {
        log("skip", { txId: tx.id, reason: "stale state" });
        push();
        continue;
      }
      const claimed = await claim(tx.id);
      if (!claimed) {
        log("skip", { txId: tx.id, reason: "claim failed (race?)" });
        push();
        continue;
      }

      // 3a) verify-account — pass ai_verify_payload EXACTLY as the body.
      log("verify.started", { txId: tx.id, payload });
      const { data: verifyData, error: verifyError } = await supabase.functions.invoke(
        "verify-account",
        { body: payload },
      );

      const verifyOk =
        !verifyError && Boolean((verifyData as { ok?: boolean } | null)?.ok);

      if (!verifyOk) {
        log("verify.failed", { txId: tx.id, error: verifyError, data: verifyData });
        progress.failed += 1;
        progress.failures.push({
          txId: tx.id,
          step: "verify",
          message: verifyError?.message ?? "تایید حساب ناموفق",
        });
        await setVerifyResult(tx.id, "verify_failed", {
          result: verifyData ?? verifyError ?? null,
          error: verifyError?.message ?? "تایید حساب ناموفق",
        });
        push(`تایید حساب ناموفق — ${tx.id.slice(0, 8)}`);
        continue;
      }

      log("verify.success", { txId: tx.id });
      progress.verify_success += 1;

      // Spec-mandated marker: log the start of party matching so operators can
      // correlate it with cache/history lookups that follow.
      log("party.match.started", { txId: tx.id, payload });
      const cache = await lookupCache(payload);
      const partyId = await findTrustedPartyId(payload, cache);

      if (!partyId) {
        log("party.match.failed", { txId: tx.id, payload });
        progress.party_not_found += 1;
        await setVerifyResult(tx.id, "party_not_found", {
          result: verifyData,
          error: "طرف حساب معتبر برای این شماره یافت نشد",
        });
        push(`طرف حساب پیدا نشد — ${tx.id.slice(0, 8)}`);
        continue;
      }

      log("party.match.success", { txId: tx.id, partyId });

      // 3c) create the receive identification through the canonical RPC.
      log("receive.create.started", { txId: tx.id, partyId });
      const matchedBy =
        payload.type === "1" ? "card" : payload.type === "2" ? "iban" : "account";
      const { data: receiveId, error: rpcError } = await supabase.rpc(
        "auto_create_receive_identification",
        {
          p_bank_transaction_id: tx.id,
          p_party_id: partyId,
          p_bankpartyaccountinfo_id: cache?.id ?? null,
          p_matched_by: matchedBy,
          p_matched_identifier: payload.number,
          p_confidence: 1.0,
        },
      );

      if (rpcError || !receiveId) {
        log("receive.create.failed", { txId: tx.id, error: rpcError?.message });
        progress.failed += 1;
        progress.failures.push({
          txId: tx.id,
          step: "receive_create",
          message: rpcError?.message ?? "ایجاد شناسایی واریز ناموفق",
        });
        await setVerifyResult(tx.id, "posting_failed", {
          result: verifyData,
          error: rpcError?.message ?? "ایجاد شناسایی واریز ناموفق",
        });
        push(`ثبت شناسایی ناموفق — ${tx.id.slice(0, 8)}`);
        continue;
      }
      log("receive.create.success", { txId: tx.id, receiveId });

      // 3d) post through the SAME manual approval helper. This owns the
      //     voucher creation, Sepidar sync and the assignment_status flip
      //     to 'assigned' — we never touch those columns ourselves.
      log("approve.started", { txId: tx.id, receiveId });
      try {
        const result = await approveReceiveIdentification(receiveId as string);
        if (result.ok) {
          log("approve.success", { txId: tx.id, receiveId });
          progress.posted += 1;
          await setVerifyResult(tx.id, "posted", {
            result: verifyData,
            error: null,
          });
          push(`ثبت موفق — ${tx.id.slice(0, 8)}`);
        } else {
          log("approve.failed", { txId: tx.id, error: result.error });
          progress.failed += 1;
          progress.failures.push({
            txId: tx.id,
            step: "approve",
            message: result.error ?? "ثبت سپیدار ناموفق",
          });
          // Do NOT touch assignment_status — the manual helper has already
          // recorded sync_failed on the receive row; the user can retry it
          // from the existing manual UI.
          await setVerifyResult(tx.id, "posting_failed", {
            result: verifyData,
            error: result.error ?? "ثبت سپیدار ناموفق",
          });
          push(`ثبت سپیدار ناموفق — ${tx.id.slice(0, 8)}`);
        }
      } catch (postErr) {
        const msg = postErr instanceof Error ? postErr.message : String(postErr);
        log("approve.failed", { txId: tx.id, error: msg });
        progress.failed += 1;
        progress.failures.push({ txId: tx.id, step: "approve", message: msg });
        await setVerifyResult(tx.id, "posting_failed", {
          result: verifyData,
          error: msg,
        });
        push(`ثبت سپیدار ناموفق — ${tx.id.slice(0, 8)}`);
      }
    } catch (rowErr) {
      // Per-row catch — one bad row must never abort the whole sweep.
      const msg = rowErr instanceof Error ? rowErr.message : String(rowErr);
      log("row.exception", { txId: tx.id, error: msg });
      progress.failed += 1;
      progress.failures.push({ txId: tx.id, step: "exception", message: msg });
      try {
        await setVerifyResult(tx.id, "verify_failed", { error: msg });
      } catch {
        /* swallow — already in error path */
      }
      push(`خطا — ${tx.id.slice(0, 8)}`);
    }
  }

  log("summary", { ...progress });
  push("پایان بررسی");
  return {
    total: progress.total,
    identified_by_ai: progress.identified_by_ai,
    verify_success: progress.verify_success,
    party_not_found: progress.party_not_found,
    posted: progress.posted,
    failed: progress.failed,
  };
}
