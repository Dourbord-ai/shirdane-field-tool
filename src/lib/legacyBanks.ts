// Legacy bank_name_code mapping (from old SQL Server system)
export const LEGACY_BANK_CODES: { code: number; name: string }[] = [
  { code: 1, name: "گردشگری" },
  { code: 2, name: "کشاورزی" },
  { code: 3, name: "صادرات" },
  { code: 4, name: "رفاه" },
  { code: 5, name: "ملت" },
];

export function legacyBankName(code: number | null | undefined): string {
  if (code == null) return "—";
  return LEGACY_BANK_CODES.find((b) => b.code === code)?.name || `کد ${code}`;
}

// Display "code - name" e.g. "2 - کشاورزی"
export function legacyBankLabel(code: number | null | undefined): string {
  if (code == null) return "—";
  const n = LEGACY_BANK_CODES.find((b) => b.code === code)?.name;
  return n ? `${code} - ${n}` : `${code}`;
}
