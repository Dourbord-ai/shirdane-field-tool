// Bank file (xls/xlsx/csv) import parser based on legacy bank format templates.
import * as XLSX from "xlsx";
import { jalaliToGregorian } from "@/lib/jalali";

export interface BankImportTemplate {
  id: string;
  title: string;
  bank_name_code: number | null;
  file_type: "xls" | "xlsx" | "csv";
  has_header: boolean;
  row_validation_column_index: number | null;
  creditor_amount_column_index: number | null;
  debtor_amount_column_index: number | null;
  date_column_index: number | null;
  time_column_index: number | null;
  doc_number_column_index: number | null;
  description_column_indexes: number[];
  needs_rtl_cleanup: boolean;
  time_24_fix: boolean;
  is_active: boolean;
  description?: string | null;
}

export interface ExtractedIdentifier {
  // 1 = card (16 digits), 2 = IBAN/Sheba (IR + 24 digits), 3 = account number.
  // We reuse the numeric `match_type` contract that the existing
  // `bankpartyaccountinfos` cache and the `verify-account` edge function
  // already speak — that way the import pipeline doesn't have to translate
  // values back and forth when looking up cached owner info.
  type: 1 | 2 | 3;
  // Original substring from the bank description, kept verbatim so that
  // human reviewers can audit exactly what the parser pulled out.
  raw: string;
  // Canonical form used for cache lookups & duplicate detection.
  // Persian/Arabic digits → ASCII, separators stripped, IBAN stored
  // WITHOUT the leading "IR" prefix to match how the edge function caches.
  normalized: string;
}

export interface ParsedRow {
  index: number;
  date: string; // jalali display
  time: string;
  deposit: number;
  withdraw: number;
  amount: number;
  transaction_type: "deposit" | "withdraw" | null;
  document_number: string;
  description: string;
  transaction_datetime: string | null; // ISO
  status: "valid" | "invalid" | "duplicate";
  status_reason?: string;
  raw: unknown[];
  // Identifiers (card / IBAN / account) extracted from the description.
  // Empty when nothing recognisable was found. Phase 1 only — actual
  // verification & matching happens AFTER the row is inserted, inside
  // `src/lib/autoIdentify.ts`.
  identifiers: ExtractedIdentifier[];
}

// ---------------- helpers ----------------
const RTL_CHARS = /[\u202D\u202C\u200E\u200F\u202A\u202B\u202E]/g;

function clean(s: unknown, rtl: boolean): string {
  if (s == null) return "";
  let v = String(s).trim();
  if (rtl) v = v.replace(RTL_CHARS, "");
  return v;
}

function parseNumber(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === "number") return isFinite(v) ? v : 0;
  let s = String(v).replace(RTL_CHARS, "").trim();
  if (!s) return 0;
  const fa = "۰۱۲۳۴۵۶۷۸۹";
  const ar = "٠١٢٣٤٥٦٧٨٩";
  for (let i = 0; i < 10; i++) {
    s = s.replace(new RegExp(fa[i], "g"), String(i)).replace(new RegExp(ar[i], "g"), String(i));
  }
  s = s.replace(/[،,\s]/g, "");
  const n = Number(s);
  return isFinite(n) ? n : 0;
}

function normalizeDigits(s: string): string {
  let v = s;
  const fa = "۰۱۲۳۴۵۶۷۸۹";
  const ar = "٠١٢٣٤٥٦٧٨٩";
  for (let i = 0; i < 10; i++) {
    v = v.replace(new RegExp(fa[i], "g"), String(i)).replace(new RegExp(ar[i], "g"), String(i));
  }
  return v;
}

function parseDate(raw: unknown): { jalali: string; iso: Date | null } {
  if (raw == null || raw === "") return { jalali: "", iso: null };
  // Excel JS Date object
  if (raw instanceof Date) {
    return { jalali: raw.toISOString().slice(0, 10), iso: raw };
  }
  let s = normalizeDigits(String(raw)).replace(RTL_CHARS, "").trim();
  s = s.replace(/[-.]/g, "/");
  const m = s.match(/(\d{2,4})\/(\d{1,2})\/(\d{1,2})/);
  if (!m) return { jalali: s, iso: null };
  let y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y < 100) y += 1400;
  // Jalali if year < 1700, otherwise Gregorian
  if (y < 1700) {
    const g = jalaliToGregorian(y, mo, d);
    return { jalali: `${y}/${String(mo).padStart(2, "0")}/${String(d).padStart(2, "0")}`, iso: new Date(Date.UTC(g.year, g.month - 1, g.day)) };
  }
  return { jalali: s, iso: new Date(Date.UTC(y, mo - 1, d)) };
}

function parseTime(raw: unknown, fix24: boolean): string {
  if (raw == null) return "00:00:00";
  let s = normalizeDigits(String(raw)).replace(RTL_CHARS, "").trim();
  if (!s) return "00:00:00";
  // Excel may serialize times as fractional days
  if (/^0?\.\d+$/.test(s)) {
    const f = Number(s);
    const total = Math.round(f * 86400);
    const h = Math.floor(total / 3600);
    const mi = Math.floor((total % 3600) / 60);
    const se = total % 60;
    s = `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}:${String(se).padStart(2, "0")}`;
  }
  if (fix24 && s.startsWith("24:00")) s = "23:59:59";
  // ensure HH:MM:SS
  const parts = s.split(":");
  while (parts.length < 3) parts.push("00");
  return parts.slice(0, 3).map((p) => p.padStart(2, "0")).join(":");
}

// ---------------- file reading ----------------
export async function readFileRows(file: File, template: BankImportTemplate): Promise<unknown[][]> {
  const buf = await file.arrayBuffer();
  if (template.file_type === "csv") {
    const text = new TextDecoder("utf-8").decode(buf);
    const wb = XLSX.read(text, { type: "string" });
    const sh = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json<unknown[]>(sh, { header: 1, raw: true, defval: "" });
  }
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const sh = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json<unknown[]>(sh, { header: 1, raw: true, defval: "" });
}

// ---------------- main parse ----------------
export function parseRowsWithTemplate(rows: unknown[][], template: BankImportTemplate): ParsedRow[] {
  const start = template.has_header ? 1 : 0;
  const out: ParsedRow[] = [];
  for (let i = start; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length === 0) continue;
    const rtl = template.needs_rtl_cleanup;

    // Row validation column must be non-empty
    if (template.row_validation_column_index != null) {
      const v = clean(r[template.row_validation_column_index], rtl);
      if (!v) continue;
    }

    const credit = parseNumber(r[template.creditor_amount_column_index ?? -1]);
    const debit = parseNumber(r[template.debtor_amount_column_index ?? -1]);
    const dateCell = r[template.date_column_index ?? -1];
    const timeCell = r[template.time_column_index ?? -1];
    const docNum = clean(r[template.doc_number_column_index ?? -1], rtl);
    const desc = (template.description_column_indexes || [])
      .map((idx) => clean(r[idx], rtl))
      .filter(Boolean)
      .join(" ");

    const { jalali, iso } = parseDate(dateCell);
    const time = parseTime(timeCell, template.time_24_fix);

    let datetime: string | null = null;
    if (iso) {
      const [hh, mm, ss] = time.split(":").map(Number);
      const d = new Date(iso);
      d.setUTCHours(hh || 0, mm || 0, ss || 0, 0);
      datetime = d.toISOString();
    }

    const isDeposit = credit > 0;
    const isWithdraw = debit > 0;
    const tType: "deposit" | "withdraw" | null = isDeposit ? "deposit" : isWithdraw ? "withdraw" : null;
    const amount = isDeposit ? credit : debit;

    let status: ParsedRow["status"] = "valid";
    let reason: string | undefined;
    if (!datetime) { status = "invalid"; reason = "تاریخ نامعتبر"; }
    else if (!tType || amount <= 0) { status = "invalid"; reason = "مبلغ نامعتبر"; }

    out.push({
      index: out.length + 1,
      date: jalali,
      time,
      deposit: credit,
      withdraw: debit,
      amount,
      transaction_type: tType,
      document_number: docNum,
      description: desc,
      transaction_datetime: datetime,
      status,
      status_reason: reason,
      raw: r as unknown[],
      // Phase-1 extraction: scan the combined description text for any
      // card/IBAN/account number the depositor might have left there.
      // We pass an empty-array fallback when desc is empty to keep the
      // pipeline downstream simple (always an array, never undefined).
      identifiers: desc ? extractIdentifiers(desc) : [],
    });
  }
  return out;
}

// ---------------- identifier extraction (Phase 1) ----------------
// Helpers below recognise depositor identifiers embedded inside the free-text
// `description` column that Iranian bank statements typically include.
// We intentionally extract OPPORTUNISTICALLY — false positives are filtered
// later by the verify-account API; missed identifiers just fall through to
// the existing manual-identification flow.

/**
 * Scan a transaction description and return every plausible card / IBAN /
 * account number we can recognise. Order matters: IBAN and card detection
 * runs first so that an account-number regex doesn't greedily swallow
 * digits that already belong to a card.
 */
export function extractIdentifiers(description: string): ExtractedIdentifier[] {
  if (!description) return [];

  // Step 1 — normalise the input ONCE so every regex below sees ASCII
  // digits and a clean RTL-stripped string. We keep the original text
  // around (via `raw` matches) for audit display.
  const cleaned = description.replace(RTL_CHARS, "");
  const ascii = normalizeDigits(cleaned);

  const found: ExtractedIdentifier[] = [];
  const claimedSpans: Array<[number, number]> = [];

  // Helper: was this character range already claimed by a higher-priority
  // identifier? Prevents the 6-20 digit account regex from matching the
  // tail of an already-extracted 16-digit card number.
  const overlaps = (start: number, end: number) =>
    claimedSpans.some(([s, e]) => start < e && end > s);

  // ---- IBAN / Sheba (priority 1) ----
  // Standard Iranian IBAN: "IR" + 24 digits. We also accept bare 26-digit
  // numbers preceded by a Persian/English hint word, then normalise to the
  // canonical 24-digit form (cache key) — the leading "IR" is stripped to
  // match how `verify-account` stores it.
  const ibanRe = /IR\s*\d{24}/gi;
  let m: RegExpExecArray | null;
  while ((m = ibanRe.exec(ascii))) {
    const raw = m[0];
    const normalized = raw.replace(/[^0-9]/g, "");
    found.push({ type: 2, raw, normalized });
    claimedSpans.push([m.index, m.index + raw.length]);
  }

  // ---- Card numbers (priority 2) ----
  // Allow 16 digits with optional dash/space separators in 4-4-4-4 form.
  const cardRe = /\b(?:\d[ -]?){15}\d\b/g;
  while ((m = cardRe.exec(ascii))) {
    if (overlaps(m.index, m.index + m[0].length)) continue;
    const normalized = m[0].replace(/[^0-9]/g, "");
    if (normalized.length !== 16) continue;
    found.push({ type: 1, raw: m[0], normalized });
    claimedSpans.push([m.index, m.index + m[0].length]);
  }

  // ---- Bank account numbers (priority 3) ----
  // Iranian deposit numbers vary by bank (6–20 digits typical). We only
  // pick runs that are NOT already claimed by card/IBAN, AND skip very
  // short numbers that are likely document/reference numbers — they would
  // explode the verify-account cache with noise.
  const acctRe = /\b\d{8,20}\b/g;
  while ((m = acctRe.exec(ascii))) {
    if (overlaps(m.index, m.index + m[0].length)) continue;
    // 16 digits with no separators are almost certainly cards that the
    // card regex missed because of weird spacing — skip them defensively.
    if (m[0].length === 16) continue;
    found.push({ type: 3, raw: m[0], normalized: m[0] });
    claimedSpans.push([m.index, m.index + m[0].length]);
  }

  // De-duplicate by (type, normalized) — the same identifier can appear
  // multiple times in a description (e.g. echoed in both Latin and Persian).
  const seen = new Set<string>();
  return found.filter((f) => {
    const key = `${f.type}:${f.normalized}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

