// ============================================================================
// Strict identifier extraction for Iranian bank transaction descriptions.
//
// Goal: produce only HIGH-QUALITY candidates safe to send to verify-account.
// We never want to ship short numeric fragments like "600268" coming from
// phrases like "انتقال از حساب 600268" — verify-account will reject them and
// waste both quota and cache rows.
//
// Output shape: { accepted, rejected, sourceTexts }
//   - accepted: ready-to-verify candidates with type/raw/normalized + scoring
//   - rejected: every candidate that was filtered out + a human-readable reason
//   - sourceTexts: per-field cleaned text we extracted from (for log audit)
//
// Match-type integers mirror the existing DB contract used by
// `bankpartyaccountinfos` + `verify-account`:
//   1 = card (16 digits)
//   2 = sheba / IBAN (24 digits, "IR" stripped)
//   3 = deposit / account number
// ============================================================================

import { toEnDigits } from "@/lib/digits";

// ----- public types ---------------------------------------------------------

export type IdentifierKind = "card" | "sheba" | "account" | "national_id";

export interface CandidateBase {
  kind: IdentifierKind;
  // Mirrors finance_bank_tx_identifiers.match_type. null for national_id
  // because we do not currently call verify-account for it.
  matchType: 1 | 2 | 3 | null;
  raw: string;
  normalized: string;
  length: number;
  sourceField: string;
  // 0..1 — higher is safer to verify against external service.
  confidence: number;
  reason: string;
}
export interface AcceptedCandidate extends CandidateBase {
  accepted: true;
}
export interface RejectedCandidate extends CandidateBase {
  accepted: false;
}
export interface ExtractionResult {
  accepted: AcceptedCandidate[];
  rejected: RejectedCandidate[];
  sourceTexts: Record<string, string>;
  // Per-field token debug info — every token the tokenizer produced, with
  // how it was classified. Surfaced via logExtractionResult for audit.
  tokensByField: Record<string, TokenDebugInfo[]>;
}

// ----- tunables -------------------------------------------------------------

// Minimum digits we accept for a plain account / deposit number. Bank
// branch codes and document numbers are commonly 4-7 digits, so we require
// at least 8 to avoid sending those to verify-account. Configurable.
export const MIN_ACCOUNT_DIGITS = 8;

// Strings (after digit normalisation) that strongly suggest the digits
// following them refer to a bank ACCOUNT/DEPOSIT, not a card or document
// number. Used to tag rejected short fragments as "too_short_account_fragment"
// so the operator can tell apart noise from genuine-but-short account refs.
const ACCOUNT_HINT_WORDS = [
  "از حساب",
  "به حساب",
  "حساب شماره",
  "حساب",
  "سپرده",
  "deposit",
  "account",
];

const RTL_CHARS = /[\u202D\u202C\u200E\u200F\u202A\u202B\u202E]/g;

// Token separators: whitespace, newlines, tabs, commas (ASCII + Persian),
// colon, semicolon, parentheses, brackets, pipes. We intentionally DO NOT
// split on dash/slash/space-between-digit-groups because card numbers and
// IBANs are commonly written with those separators inside a single token.
// Instead we pre-glue digit groups joined by dash/slash/space before
// tokenisation (see `glueDigitGroups`).
const TOKEN_SEPARATORS = /[\s،,;:()\[\]|]+/u;

/**
 * Glue digit groups separated by dash/slash/space so that things like
 *   "6037-7015-7710-9629"  -> "6037701577109629"
 *   "IR82 0540 1026 8002 0817 9090 02" -> "IR82054010268002081790902"
 * survive tokenisation as a SINGLE token. We only collapse separators that
 * sit strictly between digit characters (or between IR + digits), so prose
 * like "حساب - 12345" is left alone.
 */
function glueDigitGroups(s: string): string {
  // Repeat to collapse chains like "1-2-3-4".
  let prev = "";
  let cur = s;
  // Allow IR prefix to participate in the left side of a glue.
  const re = /(\d|IR)([ \t\-\/]+)(\d)/gi;
  while (cur !== prev) {
    prev = cur;
    cur = cur.replace(re, "$1$3");
  }
  return cur;
}

// ----- helpers --------------------------------------------------------------

function cleanText(s: string | null | undefined): string {
  if (!s) return "";
  // 1) normalise FA/AR → ASCII so digit regexes work uniformly.
  // 2) strip RTL/LRM markers that often appear inside Persian bank exports.
  return toEnDigits(String(s)).replace(RTL_CHARS, "").trim();
}

/**
 * Luhn checksum for 16-digit Iranian bank cards. Boosts confidence; failing
 * Luhn doesn't reject (some test cards in the wild are valid PANs that fail
 * the checksum) but we mark a lower confidence and a reason for audit.
 */
function passesLuhn(digits: string): boolean {
  if (!/^\d{16}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 16; i++) {
    let d = digits.charCodeAt(15 - i) - 48;
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/**
 * Iranian IBAN checksum (mod-97). Returns true if the 24-digit body is a
 * structurally valid IR IBAN. We do the standard ISO 13616 conversion:
 *   move "IR" + check digits to the end, replace letters with 18/27, then
 *   compute the BigInt mod 97 == 1.
 */
function passesIbanChecksum(twentyFourDigits: string): boolean {
  if (!/^\d{24}$/.test(twentyFourDigits)) return false;
  // Rearranged: BBAN (22 digits) + "1827" (IR) + 2 check digits.
  const bban = twentyFourDigits.slice(2);
  const check = twentyFourDigits.slice(0, 2);
  const numeric = bban + "1827" + check;
  try {
    return BigInt(numeric) % 97n === 1n;
  } catch {
    return false;
  }
}

function hasAccountHintNearby(text: string, matchStart: number): boolean {
  // Look 24 chars to the LEFT of the match — Persian descriptions read RTL
  // but our ASCII-normalised string is LTR, so left = preceding context.
  const windowStart = Math.max(0, matchStart - 24);
  const slice = text.slice(windowStart, matchStart);
  return ACCOUNT_HINT_WORDS.some((w) => slice.includes(w));
}

// ----- per-field candidate harvesting ---------------------------------------

interface RawHit {
  raw: string;
  normalized: string;
  index: number;
  kind: IdentifierKind;
  token: string;
}

export interface TokenDebugInfo {
  token: string;
  index: number;
  classifiedAs: IdentifierKind | "non-identifier";
}

/**
 * Tokenise a field by splitting on common separators (whitespace, commas,
 * Persian comma، colon, semicolon, parens, brackets, pipe). Card/IBAN
 * groups joined by dash/slash/space are pre-glued so they survive as a
 * single token. Each token is then classified independently — short
 * fragments stay isolated and never merge with neighbouring digits.
 */
function tokenize(glued: string): Array<{ token: string; index: number }> {
  const tokens: Array<{ token: string; index: number }> = [];
  let i = 0;
  while (i < glued.length) {
    const rest = glued.slice(i);
    // Skip leading separators.
    const skip = rest.match(/^[\s،,;:()\[\]|]+/u);
    if (skip) {
      i += skip[0].length;
      continue;
    }
    // Read until next separator.
    const end = rest.search(TOKEN_SEPARATORS);
    const tokenLen = end === -1 ? rest.length : end;
    if (tokenLen > 0) tokens.push({ token: rest.slice(0, tokenLen), index: i });
    i += tokenLen || 1;
  }
  return tokens;
}

/**
 * Classify a single token in isolation. Returns null for tokens that are
 * not identifier-shaped at all (prose words, 1-3 digit fragments, etc).
 */
function classifyToken(token: string): IdentifierKind | null {
  if (/^IR\d{22}$/i.test(token)) return "sheba"; // IR + 22 digits = 24 total
  if (/^\d{24}$/.test(token)) return "sheba";    // bare 24-digit IBAN body
  if (/^\d{16}$/.test(token)) return "card";
  if (/^\d{10}$/.test(token)) return "national_id";
  if (/^\d{4,30}$/.test(token)) return "account";
  return null;
}

function harvestField(
  text: string,
): { hits: RawHit[]; tokens: TokenDebugInfo[]; glued: string } {
  const glued = glueDigitGroups(text);
  const rawTokens = tokenize(glued);
  const tokens: TokenDebugInfo[] = [];
  const hits: RawHit[] = [];

  for (const { token, index } of rawTokens) {
    const kind = classifyToken(token);
    tokens.push({ token, index, classifiedAs: kind ?? "non-identifier" });
    if (!kind) continue;
    // Normalised form for storage / verify-account = digits only (drops "IR").
    const normalized = token.replace(/[^0-9]/g, "");
    hits.push({ kind, raw: token, normalized, index, token });
  }

  return { hits, tokens, glued };
}

// ----- main entry -----------------------------------------------------------

export interface ExtractOptions {
  minAccountDigits?: number;
}

/**
 * Extract identifiers from a structured set of bank-transaction text fields.
 * Each field is harvested independently so we can attribute every candidate
 * to its source (description vs. tracking_number vs. ...).
 */
export function extractIdentifiersStrict(
  fields: Record<string, string | null | undefined>,
  opts: ExtractOptions = {},
): ExtractionResult {
  const minAccountDigits = opts.minAccountDigits ?? MIN_ACCOUNT_DIGITS;
  const accepted: AcceptedCandidate[] = [];
  const rejected: RejectedCandidate[] = [];
  const sourceTexts: Record<string, string> = {};
  const tokensByField: Record<string, TokenDebugInfo[]> = {};
  // De-duplicate across fields by (kind, normalized) so we don't verify the
  // same card / IBAN / account twice when it appears in description AND
  // reference_number.
  const seen = new Set<string>();

  for (const [fieldName, rawValue] of Object.entries(fields)) {
    const text = cleanText(rawValue);
    sourceTexts[fieldName] = text;
    if (!text) {
      tokensByField[fieldName] = [];
      continue;
    }

    // Tokenise first, then classify each token independently. This is the
    // key safeguard against pulling a short fragment like "600268" out of
    // "انتقال از حساب 600268 نام واریز کننده ...": the digit run is its own
    // token, gets classified as a sub-threshold account candidate, and is
    // rejected without ever reaching verify-account.
    const { hits, tokens, glued } = harvestField(text);
    tokensByField[fieldName] = tokens;

    for (const hit of hits) {
      const dedupKey = `${hit.kind}:${hit.normalized}`;
      // We still want duplicates to be visible — log a rejection so the
      // operator can see we acknowledged the second occurrence, but skip
      // pushing it as an accepted candidate.
      if (seen.has(dedupKey)) {
        rejected.push({
          accepted: false,
          kind: hit.kind,
          matchType: kindToMatchType(hit.kind),
          raw: hit.raw,
          normalized: hit.normalized,
          length: hit.normalized.length,
          sourceField: fieldName,
          confidence: 0,
          reason: "duplicate",
        });
        continue;
      }

      // ---- IBAN / sheba ----
      if (hit.kind === "sheba") {
        const ok = passesIbanChecksum(hit.normalized);
        const cand: AcceptedCandidate = {
          accepted: true,
          kind: "sheba",
          matchType: 2,
          raw: hit.raw,
          normalized: hit.normalized,
          length: hit.normalized.length,
          sourceField: fieldName,
          confidence: ok ? 0.99 : 0.7,
          reason: ok ? "iban_checksum_ok" : "iban_checksum_failed_but_shape_ok",
        };
        accepted.push(cand);
        seen.add(dedupKey);
        continue;
      }

      // ---- Card (16 digits) ----
      if (hit.kind === "card") {
        const ok = passesLuhn(hit.normalized);
        const cand: AcceptedCandidate = {
          accepted: true,
          kind: "card",
          matchType: 1,
          raw: hit.raw,
          normalized: hit.normalized,
          length: 16,
          sourceField: fieldName,
          confidence: ok ? 0.98 : 0.7,
          reason: ok ? "luhn_ok" : "luhn_failed_but_shape_ok",
        };
        accepted.push(cand);
        seen.add(dedupKey);
        continue;
      }

      // ---- National id (10 digits) ----
      // We do not currently match national-ids against any party table so
      // surface them only as informational rejections (no verify-account
      // call). Add real handling later if/when needed.
      if (hit.kind === "national_id") {
        rejected.push({
          accepted: false,
          kind: "national_id",
          matchType: null,
          raw: hit.raw,
          normalized: hit.normalized,
          length: hit.normalized.length,
          sourceField: fieldName,
          confidence: 0,
          reason: "national_id_not_supported_yet",
        });
        continue;
      }

      // ---- Account / deposit number ----
      const len = hit.normalized.length;
      if (len < minAccountDigits) {
        const nearAccountWord = hasAccountHintNearby(glued, hit.index);
        rejected.push({
          accepted: false,
          kind: "account",
          matchType: 3,
          raw: hit.raw,
          normalized: hit.normalized,
          length: len,
          sourceField: fieldName,
          confidence: 0,
          reason: nearAccountWord
            ? "too_short_account_fragment"
            : "too_short_numeric_fragment",
        });
        continue;
      }
      // Defensive: never let a stray 16-digit number through here — it
      // belongs to the card branch, and treating it as an account would
      // pollute verify-account cache rows.
      if (len === 16) {
        rejected.push({
          accepted: false,
          kind: "account",
          matchType: 3,
          raw: hit.raw,
          normalized: hit.normalized,
          length: len,
          sourceField: fieldName,
          confidence: 0,
          reason: "16_digits_treat_as_card_only",
        });
        continue;
      }

      // Medium-high confidence: 10..20 digits is the sweet spot for
      // Iranian deposit numbers. 8-9 digits exists too (older banks) but
      // we score it slightly lower.
      const confidence = len >= 10 && len <= 20 ? 0.8 : 0.6;
      accepted.push({
        accepted: true,
        kind: "account",
        matchType: 3,
        raw: hit.raw,
        normalized: hit.normalized,
        length: len,
        sourceField: fieldName,
        confidence,
        reason: confidence >= 0.8 ? "length_in_expected_range" : "length_short_but_acceptable",
      });
      seen.add(dedupKey);
    }
  }

  return { accepted, rejected, sourceTexts, tokensByField };
}

function kindToMatchType(k: IdentifierKind): 1 | 2 | 3 | null {
  if (k === "card") return 1;
  if (k === "sheba") return 2;
  if (k === "account") return 3;
  return null;
}

// ---------------------------------------------------------------------------
// Logging helper used by callers (autoProcessUnassigned). Centralised here
// so every consumer emits the same shape of log lines.
// ---------------------------------------------------------------------------
const LOG_TAG = "[IdentifierExtract]";

export function logExtractionResult(
  txId: string,
  fields: Record<string, string | null | undefined>,
  result: ExtractionResult,
): void {
  /* eslint-disable no-console */
  console.log(LOG_TAG, "source text", { txId, sourceTexts: result.sourceTexts });
  console.log(LOG_TAG, "tokens", { txId, tokensByField: result.tokensByField });
  console.log(LOG_TAG, "candidates before filtering", {
    txId,
    totalAcceptedOrRejected: result.accepted.length + result.rejected.length,
    accepted: result.accepted.length,
    rejected: result.rejected.length,
  });
  if (result.rejected.length) {
    console.log(LOG_TAG, "rejected candidates", {
      txId,
      rejected: result.rejected.map((c) => ({
        kind: c.kind,
        raw: c.raw,
        normalized: c.normalized,
        length: c.length,
        sourceField: c.sourceField,
        reason: c.reason,
      })),
    });
  }
  if (result.accepted.length) {
    console.log(LOG_TAG, "accepted candidates", {
      txId,
      accepted: result.accepted.map((c) => ({
        type: c.matchType,
        kind: c.kind,
        raw: c.raw,
        normalized: c.normalized,
        length: c.length,
        sourceField: c.sourceField,
        confidence: c.confidence,
        reason: c.reason,
      })),
    });
  } else {
    console.warn(LOG_TAG, "no reliable identifier found", { txId, fields });
  }
  /* eslint-enable no-console */
}
