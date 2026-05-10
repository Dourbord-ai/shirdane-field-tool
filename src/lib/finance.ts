// Finance module shared utilities
import { supabase } from "@/integrations/supabase/client";
import { gregorianToJalali, formatJalali, toPersianDigits } from "@/lib/jalali";

// ---------- Money ----------
export function formatMoney(n: number | string | null | undefined): string {
  if (n == null || n === "") return "۰";
  const num = typeof n === "string" ? Number(n) : n;
  if (!isFinite(num)) return "۰";
  const sign = num < 0 ? "-" : "";
  const abs = Math.abs(num);
  const [intPart, decPart] = abs.toFixed(2).split(".");
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, "،");
  const out = decPart && decPart !== "00" ? `${grouped}.${decPart}` : grouped;
  return sign + toPersianDigits(out);
}

export function parseMoney(s: string): number {
  if (!s) return 0;
  // Convert Persian/Arabic digits then strip non-numeric except dot/minus
  const fa = "۰۱۲۳۴۵۶۷۸۹";
  const ar = "٠١٢٣٤٥٦٧٨٩";
  let normalized = String(s);
  for (let i = 0; i < 10; i++) {
    normalized = normalized.replace(new RegExp(fa[i], "g"), String(i));
    normalized = normalized.replace(new RegExp(ar[i], "g"), String(i));
  }
  normalized = normalized.replace(/[،,\s]/g, "");
  const n = Number(normalized);
  return isFinite(n) ? n : 0;
}

// ---------- Date ----------
export function formatJalaliDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  const j = gregorianToJalali(d.getFullYear(), d.getMonth() + 1, d.getDate());
  const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return `${toPersianDigits(formatJalali(j))} ${toPersianDigits(time)}`;
}

export function formatJalaliDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  const j = gregorianToJalali(d.getFullYear(), d.getMonth() + 1, d.getDate());
  return toPersianDigits(formatJalali(j));
}

// ---------- Status labels ----------
export const OP_STATUS_LABEL: Record<string, string> = {
  draft: "پیش‌نویس",
  pending_approval: "در انتظار تایید",
  approved: "تایید مدیریت",
  rejected: "رد شده",
  posted: "ثبت سند شده",
  cancelled: "لغو شده",
  deleted: "حذف شده",
  pending: "در انتظار",
  paid: "پرداخت شده",
};

export const ASSIGNMENT_STATUS_LABEL: Record<string, string> = {
  unassigned: "تخصیص نشده",
  assigned: "تخصیص شده",
  partially_assigned: "تخصیص ناقص",
};

export const SEPIDAR_STATUS_LABEL: Record<string, string> = {
  not_synced: "ثبت نشده در سپیدار",
  syncing: "در حال ثبت",
  synced: "ثبت شده در سپیدار",
  failed: "خطا در ثبت",
  deleted_from_sepidar: "حذف شده از سپیدار",
};

// ---------- Party display ----------
export function partyName(p: {
  ownership_type?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  company_name?: string | null;
}): string {
  if (p.ownership_type === "legal") return p.company_name || "—";
  return [p.first_name, p.last_name].filter(Boolean).join(" ") || p.company_name || "—";
}

// ---------- Voucher creation ----------
export interface VoucherItemInput {
  party_id?: string | null;
  bank_id?: string | null;
  account_type?: string | null;
  debit?: number;
  credit?: number;
  description?: string | null;
}

export async function createVoucher(opts: {
  voucher_type: string;
  source_operation_type: string;
  source_operation_id: string;
  voucher_date?: string;
  title: string;
  description?: string | null;
  items: VoucherItemInput[];
  created_by?: string | null;
}): Promise<{ id: string; voucher_number: number | null }> {
  const totalDebit = opts.items.reduce((s, i) => s + (i.debit || 0), 0);
  const totalCredit = opts.items.reduce((s, i) => s + (i.credit || 0), 0);
  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    throw new Error(`سند نامتوازن است: بدهکار ${totalDebit} ≠ بستانکار ${totalCredit}`);
  }
  const { data: voucher, error } = await supabase
    .from("finance_vouchers")
    .insert({
      voucher_type: opts.voucher_type,
      source_operation_type: opts.source_operation_type,
      source_operation_id: opts.source_operation_id,
      voucher_date: opts.voucher_date || new Date().toISOString(),
      title: opts.title,
      description: opts.description ?? null,
      status: "draft",
      sepidar_sync_status: "not_synced",
      created_by: opts.created_by ?? null,
    })
    .select("id, voucher_number")
    .single();
  if (error || !voucher) throw error || new Error("voucher insert failed");

  const items = opts.items.map((it, idx) => ({
    voucher_id: voucher.id,
    row_number: idx + 1,
    party_id: it.party_id ?? null,
    bank_id: it.bank_id ?? null,
    account_type: it.account_type ?? null,
    debit: it.debit ?? 0,
    credit: it.credit ?? 0,
    description: it.description ?? null,
  }));
  const { error: itemsErr } = await supabase.from("finance_voucher_items").insert(items);
  if (itemsErr) throw itemsErr;
  return voucher;
}

// ---------- Sepidar placeholder ----------
export async function sepidarSyncPlaceholder(voucher_id: string, op: string) {
  await supabase.from("finance_sepidar_sync_logs").insert({
    voucher_id,
    operation_type: op,
    request_payload: { placeholder: true },
    response_payload: { placeholder: true, message: "Sepidar bridge not yet connected" },
    status: "pending",
    error_message: null,
  });
  await supabase
    .from("finance_vouchers")
    .update({ sepidar_sync_status: "syncing", sepidar_sync_attempts: 1 })
    .eq("id", voucher_id);
}
