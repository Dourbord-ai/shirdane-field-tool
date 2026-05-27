// ============================================================================
// processWithdrawAI.ts — Orchestrator for the
// "شناسایی برداشت‌ها" toolbar button.
//
// Architecture rule (mirrors processDepositAI.ts):
//   • The MANUAL payment-allocation flow (PaymentRequestsTab → the
//     `createPaymentAllocation` helper in `@/lib/finance`) is the SINGLE
//     SOURCE OF TRUTH. That helper owns:
//       - the finance_payment_allocations insert + guard trigger
//       - the assignment_status flip (`assigning` → `assigned`)
//       - the voucher creation via `createVoucher`
//       - the Sepidar posting via `syncVoucherToSepidar`
//       - the party balance + payment-request totals update
//   • This file is an ORCHESTRATOR — it never duplicates that logic. It only:
//       1. Discovers unassigned withdraws.
//       2. Filters out internal-bank transfer candidates (those belong to
//          "شناسایی تراکنش بین بانکی" — never to this pipeline).
//       3. Resolves a trusted finance_party_id from existing identifier
//          evidence (cache → history of past approved allocations).
//       4. Picks ONE open approved payment_request_item for that party whose
//          remaining payable amount equals the withdraw amount exactly
//          (ambiguity = skip → operator handles it manually).
//       5. Delegates to `createPaymentAllocation` and reports the outcome.
//
// Why mirror processDepositAI instead of processInternalTransferAI:
//   - Both pipelines (deposit + withdraw) share the same "identifier →
//     trusted party" resolution philosophy. Internal-transfer matching is a
//     fundamentally different problem (pair two of OUR rows together) and
//     has no party concept.
// ============================================================================

import { supabase } from "@/integrations/supabase/client";
// Reuse the EXACT manual posting helper — see header doc for why.
import { createPaymentAllocation } from "@/lib/finance";

// ----- Public types --------------------------------------------------------

// Persian counters surfaced as chips in the toolbar summary panel.
export interface WithdrawAIProgress {
  total: number;                 // candidate withdraws fetched
  processed: number;             // candidates that completed (any state)
  internal_skipped: number;      // skipped because identifier hits own bank
  identified: number;            // party resolved with confidence
  party_not_found: number;       // no trusted party for any identifier
  needs_mapping: number;         // party found but no unique matching PR item
  posted: number;                // createPaymentAllocation returned ok
  failed: number;                // helper threw OR returned ok=false
  failures: Array<{ tx_id: string; step: string; message: string }>;
}

export type WithdrawAISummary = WithdrawAIProgress;

export function emptyWithdrawAIProgress(): WithdrawAIProgress {
  return {
    total: 0,
    processed: 0,
    internal_skipped: 0,
    identified: 0,
    party_not_found: 0,
    needs_mapping: 0,
    posted: 0,
    failed: 0,
    failures: [],
  };
}

// Tiny grep-friendly logger — matches the spec's "[WithdrawAI] …" markers.
function log(step: string, payload?: unknown) {
  // eslint-disable-next-line no-console
  console.log(`[WithdrawAI] ${step}`, payload ?? "");
}

// ----- Internal projections ------------------------------------------------

// Minimal projection of the withdraw rows we walk row-by-row.
interface WithdrawTx {
  id: string;
  bank_id: string | null;
  withdraw_amount: number | null;
  transaction_datetime: string | null;
  assignment_status: string | null;
}

// Identifier row attached to a single bank transaction. `match_type` is
// numeric in this table (1/2/3) and we pass it verbatim to the cache /
// history queries below.
interface IdentifierRow {
  match_type: number;
  normalized_value: string;
}

// Tiny shape of an open payment-request-item row eligible for allocation.
interface OpenItem {
  id: string;                       // payment_request_item_id
  payment_request_id: string;
  party_id: string | null;
  amount: number | null;            // originally requested
  confirmed_amount: number | null;  // approved payable (preferred when > 0)
  paid_amount: number | null;       // already allocated
}

// Normalize an identifier so loose-equality survives surface differences
// (spaces, dashes). Mirrors the own-bank lookup in processInternalTransferAI.
function norm(v: string | null | undefined): string {
  return (v ?? "").replace(/[\s-]/g, "").toUpperCase();
}

// ----- Own-bank set (internal-transfer guard) -----------------------------

// Build the set of all known own-bank identifiers (card/IBAN/account)
// across every active, non-deleted finance_banks row. Any withdraw whose
// identifier hits this set is left for "شناسایی تراکنش بین بانکی".
async function loadOwnBankIdentifiers(): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("finance_banks")
    .select("card_number, iban_number, account_number, is_active, is_deleted")
    .eq("is_active", true)
    .eq("is_deleted", false);
  if (error) {
    log("own_bank_identifiers.load_failed", error);
    return new Set();
  }
  const s = new Set<string>();
  for (const b of (data ?? []) as Array<{
    card_number: string | null;
    iban_number: string | null;
    account_number: string | null;
  }>) {
    const c = norm(b.card_number);
    const i = norm(b.iban_number);
    const a = norm(b.account_number);
    if (c) s.add(c);
    if (i) s.add(i);
    if (a) s.add(a);
  }
  return s;
}

// ----- Party resolution ----------------------------------------------------

// Tier-1: trusted cache pointer set by past confirmed flows. Keyed by the
// (matchtype, matchcontent) pair used everywhere in the manual UI.
async function lookupCacheParty(ident: IdentifierRow): Promise<string | null> {
  const { data } = await supabase
    .from("bankpartyaccountinfos")
    .select("finance_party_id")
    .eq("matchtype", String(ident.match_type))
    .eq("matchcontent", ident.normalized_value)
    .maybeSingle();
  return (data?.finance_party_id as string | null) ?? null;
}

// Tier-2: historical evidence — find every OTHER bank transaction that
// carried the same identifier, then look at the approved payment
// allocations posted against those transactions. If they ALL point to the
// same finance_party_id, auto-confirm. Zero/many distinct parties = ambiguous.
async function lookupHistoryParty(ident: IdentifierRow): Promise<string | null> {
  // Step A: every tx that shares this normalized identifier.
  const { data: identRows } = await supabase
    .from("finance_bank_tx_identifiers")
    .select("bank_transaction_id")
    .eq("match_type", ident.match_type)
    .eq("normalized_value", ident.normalized_value);
  const txIds = (identRows ?? [])
    .map((r) => r.bank_transaction_id)
    .filter((x): x is string => Boolean(x));
  if (txIds.length === 0) return null;

  // Step B: approved allocations posted against any of those transactions.
  // Restrict to non-failed states so a row that the operator manually
  // rejected/erred does NOT leak a "trusted" party identity.
  const { data: allocRows } = await supabase
    .from("finance_payment_allocations")
    .select("party_id, status")
    .in("bank_transaction_id", txIds)
    .in("status", ["synced", "pending_sync"]);

  const partySet = new Set<string>();
  for (const a of (allocRows ?? []) as Array<{ party_id: string | null }>) {
    if (a.party_id) partySet.add(a.party_id);
  }
  // Strict uniqueness: silent guessing is forbidden by the spec.
  if (partySet.size !== 1) return null;
  return Array.from(partySet)[0];
}

// Combined resolver: walk every identifier on the tx, take the first one
// that produces a single trusted party. Returning the identifier alongside
// the party lets the caller log which evidence won.
async function resolveTrustedParty(
  idents: IdentifierRow[],
): Promise<{ party_id: string; via: "cache" | "history"; ident: IdentifierRow } | null> {
  for (const ident of idents) {
    const cached = await lookupCacheParty(ident);
    if (cached) return { party_id: cached, via: "cache", ident };
  }
  for (const ident of idents) {
    const historical = await lookupHistoryParty(ident);
    if (historical) return { party_id: historical, via: "history", ident };
  }
  return null;
}

// ----- Payment-request-item picker ----------------------------------------

// Pick ONE open approved payment_request_item for the resolved party whose
// remaining payable amount equals the withdraw amount exactly. We reject
// any ambiguity (multiple matches) so operators stay in control of partial
// allocations — partials still go through the manual UI.
async function pickOpenItemForParty(
  party_id: string,
  withdraw_amount: number,
): Promise<{ item: OpenItem | null; reason: "ok" | "none" | "ambiguous" }> {
  // We pull ALL eligible-state items for the party once and filter in JS:
  // there are usually only a handful of open items per party, and we need
  // the COALESCE(confirmed_amount, amount) - paid_amount math which is
  // awkward to express as a single PostgREST `.eq()` filter.
  const { data, error } = await supabase
    .from("finance_payment_request_items")
    .select("id, payment_request_id, party_id, amount, confirmed_amount, paid_amount, status")
    .eq("party_id", party_id)
    .in("status", ["approved", "partially_paid", "sync_failed"]);
  if (error) {
    log("pick_item.query_failed", { party_id, error: error.message });
    return { item: null, reason: "none" };
  }

  const matches: OpenItem[] = [];
  for (const it of (data ?? []) as Array<OpenItem & { status: string | null }>) {
    // Same payable formula createPaymentAllocation enforces internally:
    // approved payable = confirmed_amount when > 0, else original amount.
    const payable = Number(it.confirmed_amount || 0) || Number(it.amount || 0);
    const remaining = Math.max(0, payable - Number(it.paid_amount || 0));
    // Float-tolerant equality — the deposit pipeline uses 1e-6 too.
    if (Math.abs(remaining - withdraw_amount) <= 1e-6) {
      matches.push({
        id: it.id,
        payment_request_id: it.payment_request_id,
        party_id: it.party_id,
        amount: it.amount,
        confirmed_amount: it.confirmed_amount,
        paid_amount: it.paid_amount,
      });
    }
  }

  if (matches.length === 0) return { item: null, reason: "none" };
  if (matches.length > 1) return { item: null, reason: "ambiguous" };
  return { item: matches[0], reason: "ok" };
}

// ----- Public entry point --------------------------------------------------

export async function processWithdrawAI(
  onProgress?: (p: WithdrawAIProgress) => void,
): Promise<WithdrawAISummary> {
  const progress = emptyWithdrawAIProgress();
  // `push` mirrors the deposit orchestrator — clone the failures array so
  // React sees a fresh reference and re-renders the live panel each tick.
  const push = () => onProgress?.({ ...progress, failures: [...progress.failures] });

  log("candidates.started");

  // Load the own-bank identifier set ONCE per run; it's small and reused
  // for every row's internal-transfer check.
  const ownIdentifiers = await loadOwnBankIdentifiers();

  // Fetch every still-unassigned withdraw, oldest-first so the user sees
  // the historical backlog drained in a natural chronological order.
  const { data: candidates, error: candErr } = await supabase
    .from("finance_bank_transactions")
    .select("id, bank_id, withdraw_amount, transaction_datetime, assignment_status")
    .eq("transaction_type", "withdraw")
    .eq("assignment_status", "unassigned")
    .eq("is_deleted", false)
    .order("transaction_datetime", { ascending: true })
    .limit(500);

  if (candErr) {
    log("candidates.query_failed", candErr);
    throw candErr;
  }

  const rows = (candidates as WithdrawTx[]) || [];
  progress.total = rows.length;
  log("candidates.count", { total: progress.total });
  push();

  // Row-by-row — correctness over speed, per spec.
  for (const tx of rows) {
    try {
      // Re-check the row's current state right before processing — another
      // operator or a parallel sweep could have assigned it in the meantime.
      const { data: fresh } = await supabase
        .from("finance_bank_transactions")
        .select("assignment_status, is_deleted")
        .eq("id", tx.id)
        .maybeSingle();
      if (!fresh || fresh.is_deleted || fresh.assignment_status !== "unassigned") {
        // The `finally` block at the bottom of the loop handles processed++
        // and push() for us — emitting them here too would double-count.
        log("claim.skipped", { tx_id: tx.id, reason: "stale_state" });
        continue;
      }

      log("claim.started", { tx_id: tx.id });

      // Pull every identifier attached to this tx. The DB usually has 1-2.
      const { data: identsData } = await supabase
        .from("finance_bank_tx_identifiers")
        .select("match_type, normalized_value")
        .eq("bank_transaction_id", tx.id);
      const idents = (identsData ?? []) as IdentifierRow[];

      // Internal-transfer guard — if ANY identifier points to one of our
      // own bank accounts, leave this row to "شناسایی تراکنش بین بانکی".
      const internalHit = idents.find((i) => ownIdentifiers.has(norm(i.normalized_value)));
      if (internalHit) {
        log("internal_transfer.skipped", { tx_id: tx.id, ident: internalHit });
        progress.internal_skipped += 1;
        continue; // finally handles processed++ / push()
      }

      // Log every distinct identifier we'll try (helps operator debugging).
      for (const i of idents) {
        log("identifier.detected", { tx_id: tx.id, ident: i });
      }

      log("claim.success", { tx_id: tx.id });

      const withdraw = Number(tx.withdraw_amount || 0);
      if (withdraw <= 0) {
        // Zero/negative withdraws should not exist for real bank rows but
        // we guard explicitly so a bad import row can never crash the sweep.
        log("party.match.failed", { tx_id: tx.id, reason: "invalid_amount" });
        progress.party_not_found += 1;
        continue; // finally handles processed++ / push()
      }

      // Resolve trusted party from cache → history.
      const resolved = idents.length ? await resolveTrustedParty(idents) : null;
      if (!resolved) {
        log("party.match.failed", { tx_id: tx.id, idents });
        progress.party_not_found += 1;
        progress.processed += 1;
        push();
        continue;
      }
      log("party.match.success", {
        tx_id: tx.id,
        party_id: resolved.party_id,
        via: resolved.via,
        ident: resolved.ident,
      });
      progress.identified += 1;

      // Pick exactly one open payment_request_item for that party with a
      // remaining payable that matches the withdraw amount exactly.
      const pick = await pickOpenItemForParty(resolved.party_id, withdraw);
      if (pick.reason !== "ok" || !pick.item) {
        log("party.match.success.but_no_item", {
          tx_id: tx.id,
          party_id: resolved.party_id,
          reason: pick.reason,
        });
        progress.needs_mapping += 1;
        progress.failures.push({
          tx_id: tx.id,
          step: "pick_item",
          message:
            pick.reason === "ambiguous"
              ? "چند درخواست پرداخت باز با همین مبلغ — نیاز به تخصیص دستی"
              : "درخواست پرداخت بازی با مبلغ یکسان برای این طرف یافت نشد",
        });
        progress.processed += 1;
        push();
        continue;
      }

      // Delegate to the SAME manual helper — voucher + Sepidar +
      // assignment_status are all owned by it. We never touch those columns.
      log("manual.create.started", {
        tx_id: tx.id,
        payment_request_item_id: pick.item.id,
        amount: withdraw,
      });
      try {
        const result = await createPaymentAllocation({
          payment_request_id: pick.item.payment_request_id,
          payment_request_item_id: pick.item.id,
          bank_transaction_id: tx.id,
          amount: withdraw,
        });
        if (result.ok) {
          log("manual.create.success", { tx_id: tx.id, alloc_id: result.id });
          log("approve.started", { tx_id: tx.id, alloc_id: result.id });
          // createPaymentAllocation also performs the Sepidar sync inline,
          // so an `ok:true` already means voucher created + posted +
          // assignment flipped. We still emit approve.success so the spec's
          // log-marker contract is honored.
          log("approve.success", { tx_id: tx.id, alloc_id: result.id });
          progress.posted += 1;
        } else {
          log("approve.failed", { tx_id: tx.id, error: result.error });
          progress.failed += 1;
          progress.failures.push({
            tx_id: tx.id,
            step: "approve",
            message: result.error ?? "ثبت پرداخت ناموفق",
          });
        }
      } catch (helperErr) {
        const msg = helperErr instanceof Error ? helperErr.message : String(helperErr);
        log("approve.failed", { tx_id: tx.id, error: msg });
        progress.failed += 1;
        progress.failures.push({ tx_id: tx.id, step: "approve", message: msg });
      }
    } catch (rowErr) {
      // Per-row catch — one bad row must never abort the sweep.
      const msg = rowErr instanceof Error ? rowErr.message : String(rowErr);
      log("row.exception", { tx_id: tx.id, error: msg });
      progress.failed += 1;
      progress.failures.push({ tx_id: tx.id, step: "exception", message: msg });
    } finally {
      progress.processed += 1;
      push();
    }
  }

  log("summary", {
    total: progress.total,
    identified: progress.identified,
    party_not_found: progress.party_not_found,
    needs_mapping: progress.needs_mapping,
    internal_skipped: progress.internal_skipped,
    posted: progress.posted,
    failed: progress.failed,
  });

  return progress;
}
