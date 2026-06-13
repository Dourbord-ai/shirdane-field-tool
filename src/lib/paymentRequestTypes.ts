// Legacy payment request type mapping (preserved from old system)
export const PAYMENT_REQUEST_TYPES: { code: number; label: string }[] = [
  { code: 1, label: "پرداخت متفرقه" },
  { code: 2, label: "پرداخت خرید" },
  { code: 3, label: "پرداخت عودت وجه" },
  { code: 4, label: "پرداخت بیمه و مالیات" },
  { code: 5, label: "پرداخت تنخواه" },
  { code: 6, label: "پرداخت حقوق و دستمزد" },
  { code: 7, label: "پرداخت کارمزدهای بانکی" },
];

export function getPaymentRequestTypeLabel(code: number | null | undefined): string {
  if (code === null || code === undefined) return "—";
  const t = PAYMENT_REQUEST_TYPES.find((x) => x.code === Number(code));
  return t ? `${t.code} - ${t.label}` : String(code);
}

// Maps numeric legacy code to a stable text key for `request_type` text column
export function getPaymentRequestTypeKey(code: number | null | undefined): string | null {
  const map: Record<number, string> = {
    1: "misc",
    2: "purchase",
    3: "refund",
    4: "insurance_tax",
    5: "petty_cash",
    6: "payroll",
    7: "bank_fees",
  };
  return code ? map[Number(code)] ?? null : null;
}
