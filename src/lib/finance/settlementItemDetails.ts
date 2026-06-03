/**
 * Phase 5 — Settlement item "details" jsonb payload.
 *
 * The DB column `finance_payment_request_items.details` (jsonb) is the home
 * for every method-specific field. Keeping these in jsonb (instead of new
 * columns) lets us iterate freely without schema churn while every method
 * eventually graduates to its own dedicated table.
 *
 * This module owns:
 *   1. The TypeScript shapes for each `payment_method` variant.
 *   2. A central `validateDetails(method, details)` function used by the
 *      create-dialog before submit.
 *   3. `summarizeDetails(method, details)` — a Persian one-line summary
 *      rendered in the read-only PRDetail view.
 *
 * Intentionally NOT included in this phase:
 *   - check_number capture (deferred per spec)
 *   - finance_party_accounts integration / CardInfo / Verify Account
 *   - check execution wiring
 *
 * Legacy rows (payment_method='legacy') NEVER pass through here — the
 * dialog blocks `legacy` from the picker and the detail view shows them
 * read-only without touching `details`.
 */

// -----------------------------------------------------------------------------
// 1) Per-method shapes. Everything is optional at the type level so partially
// filled forms can be stored as drafts in component state; `validateDetails`
// is the single source of truth for what's REQUIRED.
// -----------------------------------------------------------------------------

export interface BankTransferDetails {
  declared_account_owner_name?: string;
  account_identifier_type?: "card" | "account" | "sheba";
  account_identifier_value?: string;
  destination_bank_name?: string;
  transfer_type?: "card_to_card" | "paya" | "satna" | "bank_transfer";
  payment_note?: string;
  // ---- Phase 6B additions: registered-account snapshot ------------------
  // When a user picks a verified account from `finance_party_accounts` the
  // picker snapshots its identifying fields here so:
  //   1. The picker doesn't have to re-fetch when rendering the read view.
  //   2. Phase 6B enforces that only `verification_status='verified'` rows
  //      can be selected — recorded as `account_verification_status`.
  //   3. Future deletes/disables of the party account row don't retroactively
  //      change the historical settlement payload.
  party_account_id?: string;
  account_verification_status?: "verified"; // Phase 6B only allows 'verified'
  verified_at?: string;
}


export interface CheckDetails {
  payee_name?: string;
  check_reason?: string;
  check_description?: string;
  suggested_bank_id?: string;
  suggested_bank_name?: string;
  suggested_checkbook_id?: string;
}

export interface CashboxDetails {
  cashbox_id?: string;
  cashbox_name?: string;
  recipient_name?: string;
  cash_payment_note?: string;
}

export interface DeferredDetails {
  follow_up_date?: string; // ISO yyyy-mm-dd (Gregorian)
  defer_reason?: string;
  defer_note?: string;
}

export interface BarterDetails {
  counterparty_party_id?: string;
  counterparty_name?: string;
  barter_type?: string;
  reference_document?: string;
  barter_note?: string;
}

/** Union of every known shape, used when narrowing by `payment_method`. */
export type SettlementItemDetails =
  | BankTransferDetails
  | CheckDetails
  | CashboxDetails
  | DeferredDetails
  | BarterDetails
  | Record<string, unknown>; // permissive fallback for legacy/unknown methods

// -----------------------------------------------------------------------------
// 2) Persian labels for the small enums above — kept here so a single import
// gives both the constant list and its display text. The arrays are also
// what the form dropdowns iterate over.
// -----------------------------------------------------------------------------

export const ACCOUNT_IDENTIFIER_TYPES = ["card", "account", "sheba"] as const;
export const ACCOUNT_IDENTIFIER_TYPE_LABELS_FA: Record<(typeof ACCOUNT_IDENTIFIER_TYPES)[number], string> = {
  card: "شماره کارت",
  account: "شماره حساب",
  sheba: "شماره شبا",
};

export const TRANSFER_TYPES = ["card_to_card", "paya", "satna", "bank_transfer"] as const;
export const TRANSFER_TYPE_LABELS_FA: Record<(typeof TRANSFER_TYPES)[number], string> = {
  card_to_card: "کارت به کارت",
  paya: "پایا",
  satna: "ساتنا",
  bank_transfer: "انتقال داخلی بانک",
};

// -----------------------------------------------------------------------------
// 3) Validation. Returns `null` on success, or a Persian error message on
// failure. The dialog prefixes each message with the row index.
// -----------------------------------------------------------------------------

export function validateDetails(
  method: string | null | undefined,
  details: SettlementItemDetails | undefined,
): string | null {
  // Defensive: missing details = empty object so we don't crash on `d.foo`.
  const d = (details ?? {}) as Record<string, unknown>;
  const req = (key: string, label: string): string | null =>
    !d[key] || String(d[key]).trim() === "" ? `${label} الزامی است.` : null;

  switch (method) {
    case "bank_transfer": {
      // Phase 6B: branch by mode. If a `party_account_id` is present we are
      // in "registered account" mode — the snapshot fields are already
      // copied from the verified account row, so we only need to ensure the
      // verification stamp is 'verified' and the user picked a transfer type.
      if (d.party_account_id) {
        if (d.account_verification_status !== "verified") {
          return "حساب انتخاب‌شده تأیید نشده است؛ ابتدا در پروفایل ذینفع آن را استعلام کنید.";
        }
        return req("transfer_type", "نوع انتقال");
      }
      // Manual mode — same Phase 5 rules. (Verification of manual entries is
      // deferred to a later phase; the UI warns the user.)
      return (
        req("declared_account_owner_name", "نام صاحب حساب اعلام‌شده") ||
        req("account_identifier_type", "نوع شناسه حساب") ||
        req("account_identifier_value", "شماره حساب/کارت/شبا") ||
        req("transfer_type", "نوع انتقال")
      );
    }

    case "check":
      // check_number is intentionally NOT required at request stage.
      return req("payee_name", "نام دریافت‌کننده چک") || req("check_reason", "بابت");
    case "cashbox":
      // cashbox_id is required only if a cashbox table is wired; for now we
      // accept either id or name to keep the form usable.
      return (
        req("recipient_name", "نام دریافت‌کننده") ||
        (!d.cashbox_id && !d.cashbox_name ? "صندوق را انتخاب کنید یا نام آن را وارد کنید." : null)
      );
    case "deferred":
      return req("follow_up_date", "تاریخ پیگیری") || req("defer_reason", "دلیل تعویق");
    case "barter":
      return (
        req("barter_type", "نوع پایاپای") ||
        (!d.counterparty_party_id && !d.counterparty_name
          ? "طرف مقابل پایاپای را انتخاب کنید یا نام آن را وارد کنید."
          : null)
      );
    default:
      // legacy / unknown / missing method: no details validation in Phase 5.
      return null;
  }
}

// -----------------------------------------------------------------------------
// 4) Persian one-line summary used in PRDetail. We accept `unknown` for the
// raw jsonb because Supabase returns `Json | null` which is structurally
// equivalent to `unknown` for our purposes.
// -----------------------------------------------------------------------------

export function summarizeDetails(method: string | null | undefined, raw: unknown): string {
  if (!raw || typeof raw !== "object") return "—";
  const d = raw as Record<string, unknown>;
  const pick = (k: string): string => (typeof d[k] === "string" && d[k] ? String(d[k]) : "");
  switch (method) {
    case "bank_transfer": {
      const owner = pick("declared_account_owner_name");
      const idType = pick("account_identifier_type");
      const idValue = pick("account_identifier_value");
      const bank = pick("destination_bank_name");
      const tType = pick("transfer_type");
      const idLabel = (ACCOUNT_IDENTIFIER_TYPE_LABELS_FA as Record<string, string>)[idType] || idType || "";
      const tLabel = (TRANSFER_TYPE_LABELS_FA as Record<string, string>)[tType] || tType || "";
      return [owner, idValue && `${idLabel}: ${idValue}`, bank, tLabel].filter(Boolean).join(" — ") || "—";
    }
    case "check": {
      return [pick("payee_name"), pick("check_reason"), pick("suggested_bank_name")]
        .filter(Boolean).join(" — ") || "—";
    }
    case "cashbox": {
      return [pick("recipient_name"), pick("cashbox_name") || pick("cashbox_id")]
        .filter(Boolean).join(" — ") || "—";
    }
    case "deferred": {
      return [pick("follow_up_date"), pick("defer_reason")].filter(Boolean).join(" — ") || "—";
    }
    case "barter": {
      return [pick("counterparty_name") || pick("counterparty_party_id"), pick("barter_type"), pick("reference_document")]
        .filter(Boolean).join(" — ") || "—";
    }
    default:
      return "—";
  }
}
