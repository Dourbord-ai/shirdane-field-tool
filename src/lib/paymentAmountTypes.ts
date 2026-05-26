// Payment request item AmountType mapping (business basis of the request amount).
// This is NOT a debit/credit accounting direction — it describes how the
// amount should be treated against the beneficiary's balance:
//   1 = بستانکار (creditor)   → MUST validate creditor balance before allowing
//   2 = پیش پرداخت (advance)  → no balance validation
//   3 = علی الحساب (on_account) → no balance validation
//
// NOTE: the legacy key "prepayment" is treated as an alias for "advance" so
// any in-flight code or older rows keep working. New code should emit "advance".
export type PaymentAmountTypeKey = "creditor" | "advance" | "on_account";

export const PAYMENT_AMOUNT_TYPES: { code: number; key: PaymentAmountTypeKey; label: string }[] = [
  // Order matches the legacy numeric codes already persisted in the DB column
  // `amount_type_code`, so we don't churn historical data.
  { code: 1, key: "creditor", label: "بستانکار" },
  { code: 2, key: "advance", label: "پیش پرداخت" },
  { code: 3, key: "on_account", label: "علی الحساب" },
];

export function getPaymentAmountTypeLabel(code: number | null | undefined): string {
  if (code === null || code === undefined) return "—";
  const t = PAYMENT_AMOUNT_TYPES.find((x) => x.code === Number(code));
  return t ? `${t.code} - ${t.label}` : String(code);
}

export function getPaymentAmountTypeKey(code: number | null | undefined): PaymentAmountTypeKey | null {
  const t = PAYMENT_AMOUNT_TYPES.find((x) => x.code === Number(code));
  return t ? t.key : null;
}

export function getPaymentAmountTypeCode(key: string | null | undefined): number | null {
  const t = PAYMENT_AMOUNT_TYPES.find((x) => x.key === key);
  return t ? t.code : null;
}

/**
 * Defensive builder for a payment-request-item amount-type pair.
 *
 * Why: the DB stores BOTH `amount_type` (text) and `amount_type_code` (int)
 * on each `finance_payment_request_items` row. They MUST stay in lockstep
 * (a new DB CHECK constraint also enforces this). Historically a callsite
 * once hand-coded `amount_type='creditor', amount_type_code=2` — which
 * silently meant "advance" under the new mapping. This helper exists so
 * no future code can repeat that mistake: callers pass the business key,
 * and we always derive the matching numeric code from the single
 * `PAYMENT_AMOUNT_TYPES` table of truth.
 *
 * Accepts the legacy alias "prepayment" and normalizes it to "advance"
 * so older callsites keep compiling without behavior change.
 */
export function buildPaymentRequestItemAmountType(
  key: PaymentAmountTypeKey | "prepayment",
): { amount_type: PaymentAmountTypeKey; amount_type_code: number } {
  // Normalize the legacy "prepayment" alias to its modern equivalent.
  const normalized: PaymentAmountTypeKey = key === "prepayment" ? "advance" : key;
  const entry = PAYMENT_AMOUNT_TYPES.find((x) => x.key === normalized);
  // Hard fail loudly during development if a typo slips in — better than
  // writing an inconsistent (text, code) pair to the database.
  if (!entry) {
    throw new Error(`buildPaymentRequestItemAmountType: unknown key "${key}"`);
  }
  return { amount_type: entry.key, amount_type_code: entry.code };
}

/**
 * Validates a بستانکار (creditor) item against the party's available creditor balance.
 * Convention: party.balance is negative when the party is creditor (we owe them).
 *   Available creditor balance = abs(min(party.balance, 0))
 * Returns { ok, available, message }.
 */
export function validateCreditorBalance(partyBalance: number | null | undefined, requestedAmount: number): {
  ok: boolean;
  available: number;
  message?: string;
} {
  const bal = Number(partyBalance || 0);
  const available = bal <= 0 ? Math.abs(bal) : 0;
  if (available + 1e-6 < requestedAmount) {
    return { ok: false, available, message: "مانده بستانکاری ذینفع برای این مبلغ کافی نیست" };
  }
  return { ok: true, available };
}
