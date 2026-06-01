// Beneficiary statement comparison service.
// Required permission (when DEV_ACCESS_MODE is off): finance.beneficiaries.statement_compare
import { supabase } from "@/integrations/supabase/client";
import { formatJalaliDate } from "@/lib/finance";
import * as XLSX from "xlsx";

export interface StatementRow {
  id: string;
  date: string | null; // ISO
  description: string;
  debit: number;
  credit: number;
  balance: number;
  documentNumber: string | null;
  source: string | null;
  // matching keys
  sepidarVoucherId?: number | null;
  sepidarVoucherNumber?: number | null;
  externalReferenceId?: string | null;
  // sepidar-only details
  account?: string | null;
  dlCode?: string | null;
  dlTitle?: string | null;
  slCode?: string | null;
  slTitle?: string | null;
  issuerEntityName?: string | null;
}

export interface StatementDiff {
  kind: "only_internal" | "only_sepidar" | "amount_mismatch" | "date_mismatch";
  internal?: StatementRow;
  sepidar?: StatementRow;
  message: string;
}

export interface BeneficiaryStatementComparison {
  beneficiary: {
    id: string;
    name: string;
    code: string | null;
    sepidar_party_id: number | null;
  };
  openingBalance: number;
  internalStatement: StatementRow[];
  sepidarStatement: StatementRow[];
  internalFinalBalance: number;
  sepidarFinalBalance: number;
  matchedItems: Array<{ internal: StatementRow; sepidar: StatementRow }>;
  onlyInInternal: StatementRow[];
  onlyInSepidar: StatementRow[];
  amountMismatches: StatementDiff[];
  dateMismatches: StatementDiff[];
  finalBalanceDifference: number;
  sepidarAvailable: boolean;
  sepidarErrorMessage?: string | null;
}

function partyDisplayName(p: {
  first_name?: string | null;
  last_name?: string | null;
  company_name?: string | null;
}): string {
  if (p.company_name) return p.company_name;
  return [p.first_name, p.last_name].filter(Boolean).join(" ").trim() || "—";
}

async function fetchInternal(
  beneficiaryId: string,
  fromDate?: string | null,
  toDate?: string | null,
): Promise<{ rows: StatementRow[]; opening: number }> {
  // Items posted to this party
  let q = supabase
    .from("finance_voucher_items")
    .select(
      "id, debit, credit, description, voucher_id, finance_vouchers!inner(id, voucher_date, voucher_number, sepidar_voucher_id, sepidar_voucher_number, title, source_operation_type, is_deleted, status)",
    )
    .eq("party_id", beneficiaryId)
    .eq("finance_vouchers.is_deleted", false);

  const { data, error } = await q;
  if (error) throw error;

  type Row = {
    id: string;
    debit: number | null;
    credit: number | null;
    description: string | null;
    finance_vouchers: {
      id: string;
      voucher_date: string | null;
      voucher_number: number | null;
      sepidar_voucher_id: number | null;
      sepidar_voucher_number: number | null;
      title: string | null;
      source_operation_type: string | null;
      status: string | null;
    } | null;
  };
  const items = (data as unknown as Row[]) || [];

  // Filter by date and split opening
  const fromTs = fromDate ? new Date(fromDate).getTime() : null;
  const toTs = toDate ? new Date(toDate).getTime() : null;

  let opening = 0;
  const inRange: Row[] = [];
  for (const r of items) {
    const d = r.finance_vouchers?.voucher_date
      ? new Date(r.finance_vouchers.voucher_date).getTime()
      : null;
    if (fromTs && d != null && d < fromTs) {
      opening += (r.credit || 0) - (r.debit || 0);
      continue;
    }
    if (toTs && d != null && d > toTs) continue;
    inRange.push(r);
  }

  inRange.sort((a, b) => {
    const da = a.finance_vouchers?.voucher_date
      ? new Date(a.finance_vouchers.voucher_date).getTime()
      : 0;
    const db = b.finance_vouchers?.voucher_date
      ? new Date(b.finance_vouchers.voucher_date).getTime()
      : 0;
    return da - db;
  });

  let bal = opening;
  const rows: StatementRow[] = inRange.map((r) => {
    const debit = r.debit || 0;
    const credit = r.credit || 0;
    bal += credit - debit;
    const v = r.finance_vouchers;
    return {
      id: r.id,
      date: v?.voucher_date || null,
      description: r.description || v?.title || "",
      debit,
      credit,
      balance: bal,
      documentNumber: v?.voucher_number != null ? String(v.voucher_number) : v?.id?.slice(0, 8) || null,
      source: v?.source_operation_type || "voucher",
      sepidarVoucherId: v?.sepidar_voucher_id ?? null,
      sepidarVoucherNumber: v?.sepidar_voucher_number ?? null,
    };
  });

  return { rows, opening };
}

async function fetchSepidar(
  sepidarPartyId: number | null,
  fromDate?: string | null,
  toDate?: string | null,
): Promise<{ rows: StatementRow[]; opening: number; available: boolean; error?: string }> {
  if (!sepidarPartyId) {
    return {
      rows: [],
      opening: 0,
      available: false,
      error: "برای این ذینفع، شناسه سپیدار ثبت نشده است.",
    };
  }

  try {
    const { data, error } = await supabase.functions.invoke(
      "sepidar-beneficiary-statement",
      {
        body: {
          partyId: sepidarPartyId,
          fromDate: fromDate ?? null,
          toDate: toDate ?? null,
        },
      },
    );
    if (error) {
      return { rows: [], opening: 0, available: false, error: error.message || String(error) };
    }
    const payload = data as
      | { success: boolean; rowCount?: number; data?: Record<string, unknown>[]; message?: string }
      | null;
    if (!payload) {
      return { rows: [], opening: 0, available: false, error: "پاسخی از سپیدار دریافت نشد." };
    }
    if (!payload.success) {
      return { rows: [], opening: 0, available: false, error: payload.message || "خطا در واکشی صورتحساب." };
    }
    const list = payload.data || [];

    const num = (v: unknown): number => {
      if (v == null || v === "") return 0;
      const n = typeof v === "number" ? v : Number(v);
      return Number.isFinite(n) ? n : 0;
    };
    const str = (v: unknown): string | null => {
      if (v == null) return null;
      const s = String(v).trim();
      return s.length ? s : null;
    };
    const pick = <T,>(r: Record<string, unknown>, ...keys: string[]): T | undefined => {
      for (const k of keys) {
        if (r[k] !== undefined && r[k] !== null) return r[k] as T;
        const lk = Object.keys(r).find((x) => x.toLowerCase() === k.toLowerCase());
        if (lk && r[lk] !== undefined && r[lk] !== null) return r[lk] as T;
      }
      return undefined;
    };

    let bal = 0;
    const rows: StatementRow[] = list.map((r, i) => {
      const debit = num(pick(r, "Debit", "debit"));
      const credit = num(pick(r, "Credit", "credit"));
      bal += credit - debit;
      const dateRaw = pick<string>(r, "VoucherDate", "voucher_date", "Date");
      return {
        id: `sep-${i}`,
        date: dateRaw ? String(dateRaw) : null,
        description: str(pick(r, "Description", "description")) || "",
        debit,
        credit,
        balance: bal,
        documentNumber:
          str(pick(r, "VoucherNumber", "voucher_number")) ||
          null,
        source: "sepidar",
        sepidarVoucherId:
          pick<number>(r, "VoucherId", "SepidarVoucherId", "sepidar_voucher_id") != null
            ? Number(pick(r, "VoucherId", "SepidarVoucherId", "sepidar_voucher_id"))
            : null,
        sepidarVoucherNumber:
          pick<number>(r, "VoucherNumber", "voucher_number") != null
            ? Number(pick(r, "VoucherNumber", "voucher_number"))
            : null,
        externalReferenceId: str(pick(r, "ExternalReferenceId", "external_reference_id")),
        account:
          str(pick(r, "DLTitle", "AccountTitle")) ||
          str(pick(r, "DLCode", "AccountCode")),
        dlCode: str(pick(r, "DLCode", "dl_code")),
        dlTitle: str(pick(r, "DLTitle", "dl_title")),
        slCode: str(pick(r, "SLCode", "sl_code")),
        slTitle: str(pick(r, "SLTitle", "sl_title")),
        issuerEntityName: str(pick(r, "IssuerEntityName", "issuer_entity_name", "Issuer")),
      };
    });
    return { rows, opening: 0, available: true };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { rows: [], opening: 0, available: false, error: msg };
  }
}

function ymd(iso: string | null): string {
  if (!iso) return "";
  return iso.slice(0, 10);
}

function fuzzyKey(r: StatementRow): string {
  return `${ymd(r.date)}|${r.debit}|${r.credit}|${(r.description || "").trim().slice(0, 20)}`;
}

export async function getBeneficiaryStatementComparison(
  beneficiaryId: string,
  fromDate?: string | null,
  toDate?: string | null,
): Promise<BeneficiaryStatementComparison> {
  const { data: party, error: pErr } = await supabase
    .from("finance_parties")
    .select(
      "id, first_name, last_name, company_name, sepidar_party_id, sepidar_dl_code, identification_code",
    )
    .eq("id", beneficiaryId)
    .maybeSingle();
  if (pErr || !party) throw pErr || new Error("ذینفع یافت نشد");

  const [{ rows: internal, opening }, sep] = await Promise.all([
    fetchInternal(beneficiaryId, fromDate, toDate),
    fetchSepidar(party.sepidar_party_id ?? null, fromDate, toDate),
  ]);

  const internalFinal = internal.length ? internal[internal.length - 1].balance : opening;
  const sepidarFinal = sep.rows.length ? sep.rows[sep.rows.length - 1].balance : 0;

  // Matching
  const matched: Array<{ internal: StatementRow; sepidar: StatementRow }> = [];
  const onlyInternal: StatementRow[] = [];
  const onlySepidar: StatementRow[] = [];
  const amountMismatches: StatementDiff[] = [];
  const dateMismatches: StatementDiff[] = [];

  const usedSep = new Set<string>();

  // 1) Strong match by sepidar voucher id / external reference
  const sepById = new Map<string, StatementRow>();
  sep.rows.forEach((r) => {
    if (r.sepidarVoucherId != null) sepById.set(`vid:${r.sepidarVoucherId}`, r);
    if (r.externalReferenceId) sepById.set(`ref:${r.externalReferenceId}`, r);
    if (r.sepidarVoucherNumber != null) sepById.set(`vno:${r.sepidarVoucherNumber}`, r);
  });

  const remainingInternal: StatementRow[] = [];
  for (const r of internal) {
    let m: StatementRow | undefined;
    if (r.sepidarVoucherId != null) m = sepById.get(`vid:${r.sepidarVoucherId}`);
    if (!m && r.sepidarVoucherNumber != null) m = sepById.get(`vno:${r.sepidarVoucherNumber}`);
    if (m && !usedSep.has(m.id)) {
      usedSep.add(m.id);
      pushMatch(r, m);
    } else {
      remainingInternal.push(r);
    }
  }

  // 2) Fuzzy by key
  const sepByKey = new Map<string, StatementRow[]>();
  for (const r of sep.rows) {
    if (usedSep.has(r.id)) continue;
    const k = fuzzyKey(r);
    const arr = sepByKey.get(k) || [];
    arr.push(r);
    sepByKey.set(k, arr);
  }
  const stillRemaining: StatementRow[] = [];
  for (const r of remainingInternal) {
    const arr = sepByKey.get(fuzzyKey(r));
    if (arr && arr.length) {
      const m = arr.shift()!;
      usedSep.add(m.id);
      pushMatch(r, m);
    } else {
      stillRemaining.push(r);
    }
  }

  // 3) Looser matching: same date + same |debit-credit|
  for (const r of stillRemaining) {
    const cand = sep.rows.find(
      (s) =>
        !usedSep.has(s.id) &&
        ymd(s.date) === ymd(r.date) &&
        Math.abs((s.debit - s.credit) - (r.debit - r.credit)) < 0.01,
    );
    if (cand) {
      usedSep.add(cand.id);
      pushMatch(r, cand);
    } else {
      // try same amount, different date
      const dCand = sep.rows.find(
        (s) =>
          !usedSep.has(s.id) &&
          Math.abs((s.debit - s.credit) - (r.debit - r.credit)) < 0.01,
      );
      if (dCand) {
        usedSep.add(dCand.id);
        dateMismatches.push({
          kind: "date_mismatch",
          internal: r,
          sepidar: dCand,
          message: "سند مشابه پیدا شد اما تاریخ آن متفاوت است.",
        });
      } else {
        onlyInternal.push(r);
      }
    }
  }

  for (const s of sep.rows) {
    if (!usedSep.has(s.id)) onlySepidar.push(s);
  }

  function pushMatch(i: StatementRow, s: StatementRow) {
    if (Math.abs(i.debit - s.debit) > 0.01 || Math.abs(i.credit - s.credit) > 0.01) {
      amountMismatches.push({
        kind: "amount_mismatch",
        internal: i,
        sepidar: s,
        message: "سند مشابه پیدا شد اما مبلغ بدهکار/بستانکار متفاوت است.",
      });
    } else if (ymd(i.date) !== ymd(s.date)) {
      dateMismatches.push({
        kind: "date_mismatch",
        internal: i,
        sepidar: s,
        message: "سند مشابه پیدا شد اما تاریخ آن متفاوت است.",
      });
    } else {
      matched.push({ internal: i, sepidar: s });
    }
  }

  return {
    beneficiary: {
      id: party.id,
      name: partyDisplayName(party),
      code: party.identification_code || (party.sepidar_dl_code != null ? String(party.sepidar_dl_code) : null),
      sepidar_party_id: party.sepidar_party_id ?? null,
    },
    openingBalance: opening,
    internalStatement: internal,
    sepidarStatement: sep.rows,
    internalFinalBalance: internalFinal,
    sepidarFinalBalance: sepidarFinal,
    matchedItems: matched,
    onlyInInternal: [...onlyInternal, ...amountMismatches.map((d) => d.internal!).filter(Boolean)],
    onlyInSepidar: onlySepidar,
    amountMismatches,
    dateMismatches,
    finalBalanceDifference: internalFinal - sepidarFinal,
    sepidarAvailable: sep.available,
    sepidarErrorMessage: sep.error,
  };
}

export function exportStatementToExcel(
  comparison: BeneficiaryStatementComparison,
  which: "internal" | "sepidar",
) {
  const rows = which === "internal" ? comparison.internalStatement : comparison.sepidarStatement;
  const data = rows.map((r) => ({
    تاریخ: formatJalaliDate(r.date),
    "شماره سند": r.documentNumber || "",
    شرح: r.description,
    بدهکار: r.debit,
    بستانکار: r.credit,
    مانده: r.balance,
    ...(which === "sepidar"
      ? {
          "کد معین": r.dlCode || "",
          "عنوان معین": r.dlTitle || "",
          "کد تفصیل": r.slCode || "",
          "عنوان تفصیل": r.slTitle || "",
          "صادرکننده": r.issuerEntityName || "",
        }
      : { منبع: r.source || "" }),
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, which === "internal" ? "برنامه" : "سپیدار");
  const fname = `statement-${comparison.beneficiary.name}-${which}.xlsx`;
  XLSX.writeFile(wb, fname);
}
