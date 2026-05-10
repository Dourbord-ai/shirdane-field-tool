// Legacy payment request item AmountType mapping
// 1 = بستانکار (creditor) — pay against existing creditor balance
// 2 = پیش پرداخت (prepayment)
// 3 = علی الحساب (on_account)
export type PaymentAmountTypeKey = "creditor" | "prepayment" | "on_account";

export const PAYMENT_AMOUNT_TYPES: { code: number; key: PaymentAmountTypeKey; label: string }[] = [
  { code: 1, key: "creditor", label: "بستانکار" },
  { code: 2, key: "prepayment", label: "پیش پرداخت" },
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
