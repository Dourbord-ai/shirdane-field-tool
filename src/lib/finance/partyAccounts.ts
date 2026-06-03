// ============================================================================
// Party bank accounts — pure helpers (no React)
// ----------------------------------------------------------------------------
// Centralises normalisation, masking and small lookups for the
// `finance_party_accounts` table created in Phase 6A.
//
// Phase 6B will consume `accountTypeToVerifyMethod()` and `maskAccountValue()`
// when wiring the settlement bank_transfer picker.
// ============================================================================

import { supabase } from "@/integrations/supabase/client";

// ----- Types --------------------------------------------------------------

// The three account flavours the project supports — must stay in sync with
// the CHECK constraint on finance_party_accounts.account_type and with
// settlementItemDetails.ts (account_identifier_type).
export type PartyAccountType = "card" | "account" | "sheba";

// Verification lifecycle — mirrors the CHECK constraint exactly so callers
// can switch on string literals without casting.
export type PartyAccountVerificationStatus =
  | "pending"
  | "verified"
  | "mismatch"
  | "invalid"
  | "unknown";

// Row shape returned from supabase. Kept loose (string | null) so it matches
// PostgREST output without manual mapping.
export interface PartyAccount {
  id: string;
  party_id: string;
  account_type: PartyAccountType;
  account_value: string;
  account_title: string | null;
  declared_owner_name: string;
  verified_owner_name: string | null;
  verified_bank_name: string | null;
  verification_status: PartyAccountVerificationStatus;
  verified_at: string | null;
  verified_by: string | null;
  raw_response: Record<string, unknown> | null;
  is_default: boolean;
  is_active: boolean;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
}

// Result row from the SQL helper fn_fpa_find_duplicates.
export interface DuplicateAccountHit {
  account_id: string;
  party_id: string;
  party_full_name: string;
  declared_owner_name: string | null;
  verified_owner_name: string | null;
  verification_status: PartyAccountVerificationStatus;
}

// ----- Normalisation ------------------------------------------------------

// Convert Persian/Arabic digits → ASCII digits. Needed because users often
// paste card/sheba numbers that arrived from Persian keyboards or SMS.
function toEnglishDigits(s: string): string {
  return s
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

/**
 * Normalise raw user input into the canonical storage form:
 *  - card    → 16 digits, no spaces/dashes
 *  - sheba   → "IR" + 24 digits (uppercase, no spaces)
 *  - account → digits + optional dashes preserved, but trimmed
 * We store the canonical form so UNIQUE indexes & duplicate detection work.
 */
export function normalizeAccountValue(
  type: PartyAccountType,
  raw: string,
): string {
  // Always strip Persian digits and surrounding whitespace first.
  const cleaned = toEnglishDigits(raw ?? "").trim();
  if (!cleaned) return "";

  if (type === "card") {
    // Cards are 16 digits — drop every non-digit (spaces, dashes, etc.).
    return cleaned.replace(/\D/g, "");
  }

  if (type === "sheba") {
    // Strip everything that isn't a digit, then prefix with IR. Users may
    // already have typed "IR" — drop it before re-prefixing to avoid "IRIR".
    const digits = cleaned.replace(/[^0-9]/g, "");
    return `IR${digits}`;
  }

  // Generic account number: keep digits and dashes but collapse whitespace.
  return cleaned.replace(/\s+/g, "");
}

// ----- Validation ---------------------------------------------------------

/**
 * Cheap per-type format check used by the editor to enable/disable Save.
 * Intentionally lenient — strict Sheba checksum is handled server-side by
 * the verify-account edge function.
 */
export function isAccountValueValid(
  type: PartyAccountType,
  normalized: string,
): boolean {
  if (!normalized) return false;
  if (type === "card") return /^\d{16}$/.test(normalized);
  if (type === "sheba") return /^IR\d{24}$/.test(normalized);
  // Account numbers have no universal format — require at least 4 chars.
  return normalized.length >= 4;
}

// ----- Display masking ----------------------------------------------------

/**
 * Mask the value for safe display in lists / pickers:
 *   card     6037-99**-****-1234
 *   sheba    IR82************1234
 *   account  ***-1234     (last 4 visible)
 *
 * Why: bank values are sensitive; we should never render full numbers in
 * list views. The editor's input still shows the full value when focused.
 */
export function maskAccountValue(
  type: PartyAccountType,
  value: string,
): string {
  const v = value ?? "";
  if (!v) return "";

  if (type === "card" && v.length === 16) {
    // Show first 6 (BIN) and last 4 — middle 6 are masked.
    return `${v.slice(0, 4)}-${v.slice(4, 6)}**-****-${v.slice(12, 16)}`;
  }

  if (type === "sheba" && v.length >= 6) {
    // Show IR + 2 check digits and last 4. Middle is masked with the right
    // length so the visual cue (24 digits total) is preserved.
    const head = v.slice(0, 4);
    const tail = v.slice(-4);
    const mask = "*".repeat(Math.max(0, v.length - head.length - tail.length));
    return `${head}${mask}${tail}`;
  }

  if (v.length <= 4) return v;
  return `***-${v.slice(-4)}`;
}

// ----- Bridge to AccountVerifyButton --------------------------------------

/**
 * AccountVerifyButton already expects "1" | "2" | "3" (card/sheba/deposit).
 * Keeping the mapping in one place avoids drift between modules.
 */
export function accountTypeToVerifyMethod(
  type: PartyAccountType,
): "1" | "2" | "3" {
  if (type === "card") return "1";
  if (type === "sheba") return "2";
  return "3";
}

// Persian labels for badges/lists — collected here so future copy changes
// happen in a single place.
export const ACCOUNT_TYPE_LABEL_FA: Record<PartyAccountType, string> = {
  card: "کارت",
  sheba: "شبا",
  account: "حساب",
};

export const VERIFICATION_LABEL_FA: Record<PartyAccountVerificationStatus, string> = {
  pending: "در انتظار استعلام",
  verified: "تأیید شده",
  mismatch: "مغایرت نام",
  invalid: "نامعتبر",
  unknown: "نامشخص",
};

/**
 * Map AccountVerifyButton's MatchStatus into our persisted verification
 * status enum. Centralised so the editor and any future caller agree.
 */
export function matchStatusToVerification(
  match: "match" | "partial" | "mismatch" | null,
): PartyAccountVerificationStatus {
  if (match === "match") return "verified";
  if (match === "partial" || match === "mismatch") return "mismatch";
  return "pending";
}

// ----- Persian one-line summary -------------------------------------------

/**
 * Used by the list row and by Phase 6B settlement summaries.
 * Example:
 *   "کارت ملت — 6037-99**-****-1234 — حسن رضایی ✓"
 */
export function summarizeAccount(a: PartyAccount): string {
  const parts: string[] = [];
  parts.push(ACCOUNT_TYPE_LABEL_FA[a.account_type]);
  if (a.verified_bank_name) parts.push(a.verified_bank_name);
  parts.push(maskAccountValue(a.account_type, a.account_value));
  const owner = a.verified_owner_name || a.declared_owner_name;
  if (owner) parts.push(owner);
  return parts.join(" — ");
}

// ----- Cross-party duplicate lookup ---------------------------------------

/**
 * Wraps the SQL helper. Returns rows for every OTHER party that already
 * owns `account_value`. The editor calls this on blur to warn the user
 * before they save what looks like a misattributed account.
 */
export async function findDuplicateAccountsAcrossParties(
  type: PartyAccountType,
  normalizedValue: string,
  excludePartyId?: string | null,
): Promise<DuplicateAccountHit[]> {
  if (!isAccountValueValid(type, normalizedValue)) return [];
  // We rely on the SECURITY DEFINER function created in the Phase 6A
  // migration so it works with the project's permissive RLS policy.
  const { data, error } = await supabase.rpc("fn_fpa_find_duplicates", {
    _account_type: type,
    _account_value: normalizedValue,
    _exclude_party_id: excludePartyId ?? null,
  });
  if (error) {
    // Soft-fail: duplicate detection is advisory, not a save blocker.
    // eslint-disable-next-line no-console
    console.warn("[partyAccounts] duplicate lookup failed", error);
    return [];
  }
  return (data ?? []) as DuplicateAccountHit[];
}
