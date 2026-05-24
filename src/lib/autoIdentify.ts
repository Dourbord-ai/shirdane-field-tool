// ============================================================================
// Auto-identification pipeline for imported bank deposits.
//
// This module turns the raw identifiers extracted by `bankImport.ts` into
// fully linked, optionally Sepidar-posted receive identifications.
//
// Design notes (read these before touching the file):
//   • This file lives on the FRONTEND — every database mutation runs through
//     supabase-js. The heavy lifting (duplicate guards, balance checks, etc.)
//     happens inside Postgres triggers, so the client only needs to make
//     idempotent calls and stop the moment the DB says "no".
//   • Verification is **cache-first**: we always try the
//     `bankpartyaccountinfos` table before invoking the `verify-account`
//     edge function. That function ALSO caches server-side, so we get
//     belt-and-braces protection against repeatedly hitting cardinfo.ir.
//   • Auto-confirmation is intentionally STRICT: we only auto-create a
//     receive identification when the same normalised identifier has
//     historically been confirmed for EXACTLY ONE distinct party. Anything
//     else (multiple parties, no history, unverified owner) is reported
//     back as "needs_review" so the user keeps full control.
// ============================================================================

import { supabase } from "@/integrations/supabase/client";
import type { ExtractedIdentifier } from "@/lib/bankImport";

// ----------------------------------------------------------------------------
// Outcome shape returned to the import UI so it can show counters & filters.
// ----------------------------------------------------------------------------
export interface AutoIdentifyOutcome {
  // Final state of a single transaction after the pipeline ran.
  // "auto_identified": we created a confirmed receive identification.
  // "needs_review":    we found identifiers but couldn't safely auto-confirm.
  // "no_identifier":   the description had nothing recognisable.
  // "sepidar_posted" / "sepidar_failed": only set when Phase 5 is enabled.
  state:
    | "no_identifier"
    | "needs_review"
    | "auto_identified"
    | "sepidar_posted"
    | "sepidar_failed";
  // Human-readable note for the UI tooltip (Persian, since the rest of the
  // app is RTL Persian).
  message?: string;
  // The identifier we matched against (if any) — surfaced in the result
  // table so reviewers can see WHY a row was auto-identified.
  matched_identifier?: string;
  matched_type?: 1 | 2 | 3;
  matched_owner_name?: string | null;
  matched_party_id?: string | null;
  receive_id?: string | null;
}

// Aggregated counters that the import dialog displays as summary chips.
export interface AutoIdentifySummary {
  total: number;
  auto_identified: number;
  needs_review: number;
  no_identifier: number;
  sepidar_posted: number;
  sepidar_failed: number;
}

// ----------------------------------------------------------------------------
// Small helpers — these stay private so the public surface remains tiny.
// ----------------------------------------------------------------------------

/**
 * Look up the cached owner for an identifier. Returns null when the cache
 * has no entry — the caller will then ask the edge function to fetch it.
 */
async function lookupCache(ident: ExtractedIdentifier) {
  // We query the cache directly instead of going through verify-account on
  // every row: the goal is to NEVER hit the external API for identifiers we
  // already know about, even when the user re-imports the same statement.
  const { data, error } = await supabase
    .from("bankpartyaccountinfos")
    .select("id, matchname, matchbankname, finance_party_id, bankpartyid")
    .eq("matchtype", String(ident.type))
    .eq("matchcontent", ident.normalized)
    .maybeSingle();
  if (error) return null;
  return data;
}

/**
 * Fall back to the verify-account edge function when the cache is empty.
 * The edge function will populate the cache as a side-effect, so the next
 * import won't pay this cost again.
 */
async function callVerifyAccount(ident: ExtractedIdentifier) {
  try {
    const { data, error } = await supabase.functions.invoke("verify-account", {
      // The edge function expects `type` as a string ("1" | "2" | "3") and
      // `number` in raw form — it does its own digit normalisation.
      body: { type: String(ident.type), number: ident.normalized },
    });
    if (error || !data?.ok) return null;
    // Re-read from the cache so we get the row's PK (the edge function
    // doesn't return it in the response payload).
    return await lookupCache(ident);
  } catch {
    return null;
  }
}

/**
 * Find historical receive identifications that link this identifier to a
 * specific beneficiary. Two sources are checked, in priority order:
 *   1. A previously trusted link stored on the cache row
 *      (`bankpartyaccountinfos.finance_party_id`). This is the strongest
 *      signal because it was set by a successful auto-identification OR
 *      a manual confirmation flowing through the same pipeline.
 *   2. Direct history: APPROVED receive identifications whose own bank
 *      transaction had the SAME normalised identifier. We require exactly
 *      one distinct party across all matches to auto-confirm.
 */
async function findTrustedParty(
  ident: ExtractedIdentifier,
  cache: { id: number; finance_party_id: string | null } | null,
) {
  // Step 1: trust the cache pointer when present. This is the cheapest and
  // most reliable signal because writing it requires going through the
  // server-side `auto_create_receive_identification` RPC.
  if (cache?.finance_party_id) {
    return { party_id: cache.finance_party_id, source: "cache" as const };
  }

  // Step 2: look for historical confirmations of the same identifier. We
  // walk through `finance_bank_tx_identifiers` (the table we just created)
  // to collect the bank-transaction ids, then ask the receive-identification
  // table which parties were approved on those transactions. Two round
  // trips, but each one is index-covered and trivially small.
  const { data: identRows } = await supabase
    .from("finance_bank_tx_identifiers")
    .select("bank_transaction_id")
    .eq("match_type", ident.type)
    .eq("normalized_value", ident.normalized);

  const txIds = (identRows ?? [])
    .map((r) => r.bank_transaction_id)
    .filter((x): x is string => Boolean(x));
  if (txIds.length === 0) return null;

  const { data: receiveRows } = await supabase
    .from("finance_receive_identifications")
    .select("party_id, status, is_deleted")
    .in("bank_transaction_id", txIds)
    .eq("status", "approved")
    .eq("is_deleted", false);

  const partySet = new Set<string>();
  for (const r of (receiveRows ?? []) as Array<{ party_id: string | null }>) {
    if (r.party_id) partySet.add(r.party_id);
  }

  // STRICT rule: only auto-confirm when exactly one party is implicated.
  // Zero → no history yet, multiple → ambiguous, both require manual review.
  if (partySet.size !== 1) return null;
  const partyId = Array.from(partySet)[0];
  return { party_id: partyId, source: "history" as const };
}

/**
 * Append a row to the auto-identification audit log. We swallow errors here
 * because audit logging must never block the main pipeline — a missing log
 * line is annoying but not fatal.
 */
async function logStep(
  bankTransactionId: string,
  step: string,
  success: boolean,
  extras: { candidates?: unknown; chosen_party_id?: string | null; message?: string } = {},
) {
  await supabase.from("finance_auto_identification_log").insert({
    bank_transaction_id: bankTransactionId,
    step,
    success,
    candidates: (extras.candidates ?? null) as never,
    chosen_party_id: extras.chosen_party_id ?? null,
    message: extras.message ?? null,
  });
}

// ----------------------------------------------------------------------------
// Phase 5 helper: check the feature flag before auto-posting to Sepidar.
// Returns false (the safe default) if anything goes wrong.
// ----------------------------------------------------------------------------
async function isSepidarAutoPostEnabled() {
  const { data } = await supabase
    .from("finance_feature_flags")
    .select("enabled")
    .eq("key", "auto_post_receives_to_sepidar")
    .maybeSingle();
  return Boolean(data?.enabled);
}

// ----------------------------------------------------------------------------
// Public entry point.
// Call this AFTER a transaction row has been inserted. We need the persisted
// `bank_transaction_id` so the identifier rows and log entries can FK to it.
// ----------------------------------------------------------------------------
export async function autoIdentifyTransaction(
  bankTransactionId: string,
  // Pass `null` for withdraw transactions — only deposits are eligible.
  txType: "deposit" | "withdraw" | null,
  identifiers: ExtractedIdentifier[],
): Promise<AutoIdentifyOutcome> {
  // Sanity early-outs before we touch the network. Anything that isn't a
  // deposit with at least one identifier can't be auto-identified by design
  // (deposits map to receive identifications, withdrawals to allocations).
  if (txType !== "deposit") {
    return { state: "no_identifier", message: "تراکنش واریز نیست" };
  }
  if (!identifiers || identifiers.length === 0) {
    await logStep(bankTransactionId, "extract", false, { message: "no identifiers" });
    return { state: "no_identifier", message: "هیچ شناسه‌ای در توضیحات یافت نشد" };
  }

  await logStep(bankTransactionId, "extract", true, { candidates: identifiers });

  // Walk identifiers in priority order (already enforced by extractIdentifiers):
  // first identifier with a trusted match wins. The remaining ones are still
  // persisted for audit + future history.
  let chosen: {
    ident: ExtractedIdentifier;
    cache: Awaited<ReturnType<typeof lookupCache>>;
    party_id: string;
  } | null = null;

  for (const ident of identifiers) {
    // Cache lookup first — never call the API for identifiers we know.
    let cache = await lookupCache(ident);
    if (cache) {
      await logStep(bankTransactionId, "cache_hit", true, { candidates: ident });
    } else {
      cache = await callVerifyAccount(ident);
      await logStep(bankTransactionId, "verify_api", Boolean(cache), { candidates: ident });
    }

    // Persist the identifier row regardless of whether verification worked;
    // this gives us the history needed to auto-identify future imports.
    await supabase.from("finance_bank_tx_identifiers").insert({
      bank_transaction_id: bankTransactionId,
      match_type: ident.type,
      raw_value: ident.raw,
      normalized_value: ident.normalized,
      bankpartyaccountinfo_id: cache?.id ?? null,
      verified_owner_name: cache?.matchname ?? null,
      verified_bank_name: cache?.matchbankname ?? null,
    });

    if (!cache?.matchname) continue; // unverified → skip auto-match

    const match = await findTrustedParty(ident, cache);
    await logStep(bankTransactionId, "match", Boolean(match), {
      candidates: { ident, cache_id: cache.id },
      chosen_party_id: match?.party_id ?? null,
    });
    if (match) {
      chosen = { ident, cache, party_id: match.party_id };
      break;
    }
  }

  if (!chosen) {
    return {
      state: "needs_review",
      message: "شناسه شناسایی شد ولی مطابقت قطعی یافت نشد",
    };
  }

  // Create the receive identification through the SECURITY DEFINER RPC.
  // We rely on the existing trigger (fn_finance_receive_identifications_guard)
  // to enforce all the safety rules — duplicate tx use, amount sanity,
  // deposit-only — so the client doesn't need to re-check them here.
  const { data: receiveId, error } = await supabase.rpc(
    "auto_create_receive_identification",
    {
      p_bank_transaction_id: bankTransactionId,
      p_party_id: chosen.party_id,
      p_bankpartyaccountinfo_id: chosen.cache?.id ?? null,
      p_matched_by:
        chosen.ident.type === 1 ? "card" : chosen.ident.type === 2 ? "iban" : "account",
      p_matched_identifier: chosen.ident.normalized,
      p_confidence: 1.0, // binary confidence in v1 — see plan
    },
  );

  if (error || !receiveId) {
    await logStep(bankTransactionId, "create_receive", false, {
      message: error?.message ?? "rpc returned null",
      chosen_party_id: chosen.party_id,
    });
    // Trigger likely refused (e.g. tx already linked manually in a race).
    // Surface as needs_review so the user can investigate without losing
    // the extracted identifiers (they're already saved above).
    return {
      state: "needs_review",
      message: error?.message ?? "ایجاد خودکار شناسایی واریز ناموفق بود",
      matched_identifier: chosen.ident.normalized,
      matched_type: chosen.ident.type,
      matched_owner_name: chosen.cache?.matchname ?? null,
      matched_party_id: chosen.party_id,
    };
  }

  await logStep(bankTransactionId, "create_receive", true, {
    chosen_party_id: chosen.party_id,
  });

  const outcome: AutoIdentifyOutcome = {
    state: "auto_identified",
    matched_identifier: chosen.ident.normalized,
    matched_type: chosen.ident.type,
    matched_owner_name: chosen.cache?.matchname ?? null,
    matched_party_id: chosen.party_id,
    receive_id: receiveId as string,
  };

  // Phase 5 — gated behind a feature flag so this can ship dark and be
  // enabled later by simply updating the row in `finance_feature_flags`.
  if (await isSepidarAutoPostEnabled()) {
    // Placeholder: invoke whichever edge function the manual "post receive"
    // button uses today. We DON'T own that contract here — when the flag is
    // flipped on, replace this block with the real invocation. The flag
    // defaults to false so this branch is intentionally inert in v1.
    await logStep(bankTransactionId, "post_sepidar", false, {
      message: "auto-post enabled but no posting client wired yet",
    });
    outcome.state = "sepidar_failed";
    outcome.message = "ارسال خودکار به سپیدار هنوز فعال نشده";
  }

  return outcome;
}

// Convenience helper that builds an empty summary; the import dialog
// increments it as each transaction completes.
export function emptyAutoIdentifySummary(): AutoIdentifySummary {
  return {
    total: 0,
    auto_identified: 0,
    needs_review: 0,
    no_identifier: 0,
    sepidar_posted: 0,
    sepidar_failed: 0,
  };
}

export function bumpSummary(s: AutoIdentifySummary, o: AutoIdentifyOutcome) {
  s.total += 1;
  // Map the per-row outcome state onto the summary counters. We keep the
  // mapping explicit (no clever indexing) so a future state can't silently
  // skip a counter.
  if (o.state === "auto_identified") s.auto_identified += 1;
  else if (o.state === "needs_review") s.needs_review += 1;
  else if (o.state === "no_identifier") s.no_identifier += 1;
  else if (o.state === "sepidar_posted") {
    s.auto_identified += 1;
    s.sepidar_posted += 1;
  } else if (o.state === "sepidar_failed") {
    s.auto_identified += 1;
    s.sepidar_failed += 1;
  }
}
