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
  assigning: "در حال تخصیص",
  assigned: "تخصیص شده",
  rejected: "رد شده",
  cancelled: "لغو شده",
  partially_assigned: "تخصیص ناقص",
};

export const RECEIVE_ID_STATUS_LABEL: Record<string, string> = {
  pending_approval: "در انتظار تایید",
  approved: "تایید شده",
  sync_failed: "خطای سپیدار",
  rejected: "رد شده",
  cancelled: "لغو شده",
};

// Payment request header statuses
export const PAYMENT_REQUEST_STATUS_LABEL: Record<string, string> = {
  draft: "پیش‌نویس",
  pending_approval: "در انتظار تایید مدیریت",
  approved: "تایید شده",
  partially_paid: "پرداخت ناقص",
  paid: "پرداخت کامل",
  rejected: "رد شده",
  cancelled: "لغو شده",
};

// Payment request item statuses
export const PAYMENT_ITEM_STATUS_LABEL: Record<string, string> = {
  pending_approval: "در انتظار تایید",
  approved: "تایید شده",
  partially_paid: "پرداخت ناقص",
  paid: "پرداخت شده",
  sync_failed: "خطای ثبت سند",
  cancelled: "لغو شده",
  rejected: "رد شده",
};

// Payment allocation statuses
export const PAYMENT_ALLOCATION_STATUS_LABEL: Record<string, string> = {
  pending_sync: "در انتظار ثبت سند",
  synced: "ثبت سند شده",
  sync_failed: "خطای ثبت سپیدار",
  cancelled: "لغو شده",
};

export function receiveIdStatusLabel(s: string | null | undefined): string {
  return (s && RECEIVE_ID_STATUS_LABEL[s]) || s || "—";
}

export const SEPIDAR_STATUS_LABEL: Record<string, string> = {
  not_synced: "ثبت نشده در سپیدار",
  syncing: "در حال ثبت",
  synced: "ثبت شده در سپیدار",
  failed: "خطا در ثبت",
  deleted_from_sepidar: "حذف شده از سپیدار",
};

// Approval workflow for finance_parties (beneficiaries)
export const PARTY_APPROVAL_STATUS_LABEL: Record<string, string> = {
  draft: "پیش‌نویس",
  pending_approval: "در انتظار تایید مدیریت",
  approved: "تایید اطلاعات شده",
  synced_to_sepidar: "ثبت‌شده در سپیدار",
  rejected: "رد شده",
  sync_failed: "خطا در ثبت سپیدار",
  inactive: "غیرفعال",
};

export function partyApprovalLabel(s: string | null | undefined): string {
  return (s && PARTY_APPROVAL_STATUS_LABEL[s]) || "—";
}

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

// ---------- Beneficiary (party) Sepidar sync — placeholder bridge ----------
// Represents legacy stored procedure: SpAddSepidarBankParty
// Returns: sepidar_party_id, sepidar_dl_id, sepidar_dl_code,
// sepidar_account_id, sepidar_full_name, sepidar_sync_status, error_message
export interface SepidarPartyResponse {
  sepidar_party_id: number | null;
  sepidar_dl_id: number | null;
  sepidar_dl_code: number | null;
  sepidar_account_id: number | null;
  sepidar_full_name: string | null;
  sepidar_sync_status: "synced" | "failed";
  error_message: string | null;
}

// Placeholder bridge — does NOT call SQL Server. Simulates success-shape only.
// Replace with real Sepidar Bridge call later.
async function callSepidarBridgeAddParty(
  party: { id: string; full_name: string },
): Promise<SepidarPartyResponse> {
  // Simulate latency for UX
  await new Promise((r) => setTimeout(r, 600));
  return {
    sepidar_party_id: null,
    sepidar_dl_id: null,
    sepidar_dl_code: null,
    sepidar_account_id: null,
    sepidar_full_name: party.full_name,
    sepidar_sync_status: "failed",
    error_message: "پل سپیدار هنوز متصل نشده است (placeholder)",
  };
}

export async function syncPartyToSepidar(partyId: string): Promise<SepidarPartyResponse> {
  const { data: party, error } = await supabase
    .from("finance_parties")
    .select("*")
    .eq("id", partyId)
    .maybeSingle();
  if (error || !party) throw error || new Error("ذینفع یافت نشد");
  if (party.approval_status !== "approved" && party.approval_status !== "sync_failed") {
    throw new Error("ابتدا اطلاعات ذینفع باید تایید شود");
  }

  // Mark as syncing + bump attempts
  const attempts = (party.sepidar_sync_attempts ?? 0) + 1;
  await supabase
    .from("finance_parties")
    .update({ sepidar_sync_status: "syncing", sepidar_sync_attempts: attempts })
    .eq("id", partyId);

  const fullName = partyName(party as never);
  const requestPayload = {
    procedure: "SpAddSepidarBankParty",
    party_id: partyId,
    full_name: fullName,
    national_code: party.national_code,
    national_id: party.national_id,
    ownership_type: party.ownership_type,
  };

  let response: SepidarPartyResponse;
  try {
    response = await callSepidarBridgeAddParty({ id: partyId, full_name: fullName });
  } catch (e: unknown) {
    response = {
      sepidar_party_id: null, sepidar_dl_id: null, sepidar_dl_code: null,
      sepidar_account_id: null, sepidar_full_name: null,
      sepidar_sync_status: "failed",
      error_message: e instanceof Error ? e.message : "خطای نامشخص",
    };
  }

  // Log the call
  await supabase.from("finance_sepidar_sync_logs").insert({
    party_id: partyId,
    entity_type: "party",
    operation_type: "SpAddSepidarBankParty",
    request_payload: requestPayload as never,
    response_payload: response as never,
    status: response.sepidar_sync_status === "synced" ? "success" : "failed",
    error_message: response.error_message,
  } as never);

  if (response.sepidar_sync_status === "synced") {
    await supabase
      .from("finance_parties")
      .update({
        sepidar_party_id: response.sepidar_party_id,
        sepidar_dl_id: response.sepidar_dl_id,
        sepidar_dl_code: response.sepidar_dl_code,
        sepidar_account_id: response.sepidar_account_id,
        sepidar_full_name: response.sepidar_full_name,
        sepidar_sync_status: "synced",
        approval_status: "synced_to_sepidar",
        sepidar_synced_at: new Date().toISOString(),
        sepidar_error_message: null,
      })
      .eq("id", partyId);
  } else {
    await supabase
      .from("finance_parties")
      .update({
        sepidar_sync_status: "failed",
        approval_status: "sync_failed",
        sepidar_error_message: response.error_message,
      })
      .eq("id", partyId);
  }

  return response;
}

// Validation: a beneficiary cannot be used in final voucher posting unless
// it is fully synced to Sepidar with all required ids present.
export function isPartyReadyForPosting(p: {
  approval_status?: string | null;
  sepidar_party_id?: number | null;
  sepidar_dl_id?: number | null;
  sepidar_account_id?: number | null;
}): boolean {
  return (
    p.approval_status === "synced_to_sepidar" &&
    p.sepidar_party_id != null &&
    p.sepidar_dl_id != null &&
    p.sepidar_account_id != null
  );
}

export async function assertPartiesReadyForPosting(partyIds: string[]): Promise<void> {
  const ids = Array.from(new Set(partyIds.filter(Boolean)));
  if (ids.length === 0) return;
  const { data, error } = await supabase
    .from("finance_parties")
    .select("id, approval_status, sepidar_party_id, sepidar_dl_id, sepidar_account_id, first_name, last_name, company_name, ownership_type")
    .in("id", ids);
  if (error) throw error;
  const blocked = (data || []).filter((p) => !isPartyReadyForPosting(p as never));
  if (blocked.length > 0) {
    const names = blocked.map((p) => partyName(p as never)).join("، ");
    throw new Error(`ذینفعان زیر در سپیدار ثبت نشده‌اند و قابل ارسال در سند نیستند: ${names}`);
  }
}

// ---------- Bank unassigned balance recalculation ----------
export async function recalculateBankUnassignedBalances(bankId: string): Promise<void> {
  if (!bankId) return;
  const { data } = await supabase
    .from("finance_bank_transactions")
    .select("transaction_type, deposit_amount, withdraw_amount")
    .eq("bank_id", bankId)
    .eq("is_deleted", false)
    .in("assignment_status", ["unassigned", "assigning"]);
  let cred = 0;
  let deb = 0;
  for (const r of (data || []) as { transaction_type: string | null; deposit_amount: number | null; withdraw_amount: number | null }[]) {
    if (r.transaction_type === "deposit") cred += Number(r.deposit_amount || 0);
    else if (r.transaction_type === "withdraw") deb += Number(r.withdraw_amount || 0);
  }
  await supabase
    .from("finance_banks")
    .update({ unassigned_creditor_balance: cred, unassigned_debtor_balance: deb })
    .eq("id", bankId);
}

// ---------- Voucher → Sepidar placeholder ----------
export interface SepidarVoucherResponse {
  status: "synced" | "failed";
  error_message: string | null;
}

export async function syncVoucherToSepidar(voucherId: string): Promise<SepidarVoucherResponse> {
  await supabase
    .from("finance_vouchers")
    .update({ sepidar_sync_status: "syncing" })
    .eq("id", voucherId);

  // Placeholder: real Sepidar bridge not connected yet.
  await new Promise((r) => setTimeout(r, 400));
  const response: SepidarVoucherResponse = {
    status: "failed",
    error_message: "پل سپیدار هنوز متصل نشده است (placeholder)",
  };

  await supabase.from("finance_sepidar_sync_logs").insert({
    voucher_id: voucherId,
    operation_type: "post_voucher",
    request_payload: { voucher_id: voucherId } as never,
    response_payload: response as never,
    status: response.status === "synced" ? "success" : "failed",
    error_message: response.error_message,
  } as never);

  await supabase
    .from("finance_vouchers")
    .update({
      sepidar_sync_status: response.status,
      sepidar_error_message: response.error_message,
      status: response.status === "synced" ? "posted" : "draft",
    })
    .eq("id", voucherId);

  return response;
}

// ---------- Receive Identification workflow ----------
export interface CreateReceiveIdInput {
  bank_transaction_id: string;
  party_id: string;
  bank_id: string;
  amount: number;
  transaction_datetime: string | null;
  title: string;
  description?: string | null;
}

export async function createReceiveIdentification(input: CreateReceiveIdInput): Promise<{ id: string }> {
  // Block double-assignment
  const { data: tx } = await supabase
    .from("finance_bank_transactions")
    .select("assignment_status")
    .eq("id", input.bank_transaction_id)
    .maybeSingle();
  if (!tx) throw new Error("تراکنش یافت نشد");
  if (tx.assignment_status && tx.assignment_status !== "unassigned" && tx.assignment_status !== "rejected") {
    throw new Error("این تراکنش قبلاً به عملیات دیگری متصل شده است");
  }

  const { data: ri, error } = await supabase
    .from("finance_receive_identifications")
    .insert({
      title: input.title || "شناسایی دریافت",
      description: input.description ?? null,
      party_id: input.party_id,
      bank_id: input.bank_id,
      bank_transaction_id: input.bank_transaction_id,
      amount: input.amount,
      transaction_datetime: input.transaction_datetime,
      status: "pending_approval",
      sepidar_sync_status: "not_synced",
    })
    .select("id")
    .single();
  if (error || !ri) throw error || new Error("درج درخواست شناسایی دریافت ناموفق بود");

  await supabase
    .from("finance_bank_transactions")
    .update({
      assignment_status: "assigning",
      assigned_operation_type: "receive_identification",
      assigned_operation_id: ri.id,
    })
    .eq("id", input.bank_transaction_id);

  await recalculateBankUnassignedBalances(input.bank_id);
  return ri;
}

export async function approveReceiveIdentification(receiveIdId: string): Promise<{ ok: boolean; error?: string }> {
  const { data: ri, error } = await supabase
    .from("finance_receive_identifications")
    .select("*")
    .eq("id", receiveIdId)
    .maybeSingle();
  if (error || !ri) throw error || new Error("درخواست یافت نشد");
  if (ri.status !== "pending_approval" && ri.status !== "sync_failed") {
    throw new Error("این درخواست در وضعیت قابل تایید نیست");
  }
  if (!ri.party_id || !ri.bank_id || !ri.bank_transaction_id) {
    throw new Error("اطلاعات درخواست ناقص است");
  }

  // Validate beneficiary is synced to Sepidar
  await assertPartiesReadyForPosting([ri.party_id]);

  // Validate bank is mapped to Sepidar
  const { data: bank } = await supabase
    .from("finance_banks")
    .select("sepidar_dl_id, sepidar_account_id, title, bank_name")
    .eq("id", ri.bank_id)
    .maybeSingle();
  if (!bank?.sepidar_dl_id || !bank?.sepidar_account_id) {
    throw new Error(`بانک «${bank?.title || bank?.bank_name || ""}» در سپیدار نگاشت نشده است`);
  }

  let voucherId = ri.voucher_id as string | null;
  if (!voucherId) {
    const v = await createVoucher({
      voucher_type: "receive_identification",
      source_operation_type: "receive_identification",
      source_operation_id: ri.id,
      title: ri.title || "شناسایی دریافت",
      description: ri.description,
      items: [
        { bank_id: ri.bank_id, account_type: "bank", debit: Number(ri.amount || 0), credit: 0, description: "بانک" },
        { party_id: ri.party_id, account_type: "party", debit: 0, credit: Number(ri.amount || 0), description: "ذینفع" },
      ],
    });
    voucherId = v.id;
    await supabase
      .from("finance_receive_identifications")
      .update({ voucher_id: voucherId })
      .eq("id", ri.id);
  }

  const sync = await syncVoucherToSepidar(voucherId);
  if (sync.status === "synced") {
    await supabase
      .from("finance_receive_identifications")
      .update({
        status: "approved",
        approved_at: new Date().toISOString(),
        sepidar_sync_status: "synced",
        sepidar_error_message: null,
        sepidar_sync_attempts: (ri.sepidar_sync_attempts ?? 0) + 1,
      })
      .eq("id", ri.id);
    await supabase
      .from("finance_bank_transactions")
      .update({
        assignment_status: "assigned",
        assigned_operation_type: "receive_identification",
        assigned_operation_id: ri.id,
      })
      .eq("id", ri.bank_transaction_id);

    // Update party balance
    const { data: party } = await supabase.from("finance_parties").select("balance").eq("id", ri.party_id).maybeSingle();
    const newBal = Number(party?.balance || 0) + Number(ri.amount || 0);
    await supabase.from("finance_parties").update({ balance: newBal }).eq("id", ri.party_id);

    await recalculateBankUnassignedBalances(ri.bank_id);
    return { ok: true };
  } else {
    await supabase
      .from("finance_receive_identifications")
      .update({
        status: "sync_failed",
        sepidar_sync_status: "failed",
        sepidar_error_message: sync.error_message,
        sepidar_sync_attempts: (ri.sepidar_sync_attempts ?? 0) + 1,
      })
      .eq("id", ri.id);
    // Transaction stays in 'assigning'
    return { ok: false, error: sync.error_message || "خطا در ثبت سپیدار" };
  }
}

export async function rejectReceiveIdentification(receiveIdId: string, reason: string): Promise<void> {
  const { data: ri } = await supabase
    .from("finance_receive_identifications")
    .select("bank_id, bank_transaction_id, status")
    .eq("id", receiveIdId)
    .maybeSingle();
  if (!ri) throw new Error("درخواست یافت نشد");
  if (ri.status === "approved") throw new Error("درخواست تایید شده قابل رد نیست");

  await supabase
    .from("finance_receive_identifications")
    .update({
      status: "rejected",
      rejected_at: new Date().toISOString(),
      rejection_reason: reason,
    })
    .eq("id", receiveIdId);

  if (ri.bank_transaction_id) {
    await supabase
      .from("finance_bank_transactions")
      .update({
        assignment_status: "unassigned",
        assigned_operation_type: null,
        assigned_operation_id: null,
      })
      .eq("id", ri.bank_transaction_id);
  }
  if (ri.bank_id) await recalculateBankUnassignedBalances(ri.bank_id);
}

export async function cancelReceiveIdentification(receiveIdId: string): Promise<void> {
  const { data: ri } = await supabase
    .from("finance_receive_identifications")
    .select("bank_id, bank_transaction_id, status")
    .eq("id", receiveIdId)
    .maybeSingle();
  if (!ri) throw new Error("درخواست یافت نشد");
  if (ri.status === "approved") throw new Error("درخواست تایید شده قابل لغو نیست");

  await supabase
    .from("finance_receive_identifications")
    .update({
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
    })
    .eq("id", receiveIdId);

  if (ri.bank_transaction_id) {
    await supabase
      .from("finance_bank_transactions")
      .update({
        assignment_status: "unassigned",
        assigned_operation_type: null,
        assigned_operation_id: null,
      })
      .eq("id", ri.bank_transaction_id);
  }
  if (ri.bank_id) await recalculateBankUnassignedBalances(ri.bank_id);
}

// ---------- Payment Allocation workflow ----------
export interface CreatePaymentAllocationInput {
  payment_request_id: string;
  payment_request_item_id: string;
  bank_transaction_id: string;
  amount: number;
}

function accountTypeForAmountTypeCode(code: number | null | undefined): string {
  if (code === 1) return "party_creditor";
  if (code === 2) return "party_prepayment";
  if (code === 3) return "party_on_account";
  return "party";
}

async function refreshPaymentRequestPaidTotals(payment_request_id: string): Promise<void> {
  // Sum paid_amount on items, and update item statuses + header status.
  const { data: items } = await supabase
    .from("finance_payment_request_items")
    .select("id, amount, paid_amount, status")
    .eq("payment_request_id", payment_request_id);
  const list = (items || []) as { id: string; amount: number | null; paid_amount: number | null; status: string | null }[];
  let totalPaid = 0;
  let allPaid = list.length > 0;
  let anyPaid = false;
  for (const it of list) {
    const amt = Number(it.amount || 0);
    const paid = Number(it.paid_amount || 0);
    totalPaid += paid;
    const remaining = Math.max(0, amt - paid);
    let nextStatus = it.status || "approved";
    if (paid > 0 && paid + 1e-6 < amt) nextStatus = "partially_paid";
    else if (paid + 1e-6 >= amt && amt > 0) nextStatus = "paid";
    if (nextStatus !== it.status || remaining !== Number(it.paid_amount || 0)) {
      await supabase
        .from("finance_payment_request_items")
        .update({ remaining_amount: remaining, status: nextStatus })
        .eq("id", it.id);
    }
    if (nextStatus !== "paid") allPaid = false;
    if (paid > 0) anyPaid = true;
  }
  const { data: header } = await supabase
    .from("finance_payment_requests")
    .select("total_amount, status")
    .eq("id", payment_request_id)
    .maybeSingle();
  const total = Number(header?.total_amount || 0);
  const remaining = Math.max(0, total - totalPaid);
  let headerStatus = header?.status || "approved";
  if (allPaid && list.length > 0) headerStatus = "paid";
  else if (anyPaid) headerStatus = "partially_paid";
  await supabase
    .from("finance_payment_requests")
    .update({ total_paid_amount: totalPaid, remaining_amount: remaining, status: headerStatus })
    .eq("id", payment_request_id);
}

export async function createPaymentAllocation(input: CreatePaymentAllocationInput): Promise<{ id: string; ok: boolean; error?: string }> {
  // Load item + request
  const { data: item } = await supabase
    .from("finance_payment_request_items")
    .select("id, payment_request_id, party_id, amount, paid_amount, amount_type_code, status")
    .eq("id", input.payment_request_item_id)
    .maybeSingle();
  if (!item) throw new Error("ردیف درخواست یافت نشد");
  if (!["approved", "partially_paid", "sync_failed"].includes(String(item.status))) {
    throw new Error("ردیف درخواست در وضعیت قابل پرداخت نیست (نیاز به تایید مدیریت)");
  }
  const itemRemaining = Number(item.amount || 0) - Number(item.paid_amount || 0);
  if (input.amount <= 0) throw new Error("مبلغ تخصیص باید بزرگ‌تر از صفر باشد");
  if (input.amount - 1e-6 > itemRemaining) throw new Error("مبلغ تخصیص از مانده ردیف بیشتر است");

  // Validate party Sepidar-ready
  if (!item.party_id) throw new Error("ذینفع ردیف نامعتبر است");
  await assertPartiesReadyForPosting([item.party_id]);

  // Load bank transaction
  const { data: tx } = await supabase
    .from("finance_bank_transactions")
    .select("id, bank_id, transaction_type, withdraw_amount, assignment_status")
    .eq("id", input.bank_transaction_id)
    .maybeSingle();
  if (!tx) throw new Error("تراکنش بانکی یافت نشد");
  if (tx.transaction_type !== "withdraw") throw new Error("فقط تراکنش برداشت قابل اتصال است");
  if (tx.assignment_status !== "unassigned") throw new Error("تراکنش قبلاً به عملیات دیگری متصل شده است");
  if (input.amount - 1e-6 > Number(tx.withdraw_amount || 0)) throw new Error("مبلغ تخصیص از مبلغ تراکنش بیشتر است");

  // Validate bank Sepidar mapping
  const { data: bank } = await supabase
    .from("finance_banks")
    .select("id, sepidar_dl_id, sepidar_account_id, title, bank_name")
    .eq("id", tx.bank_id)
    .maybeSingle();
  if (!bank?.sepidar_dl_id || !bank?.sepidar_account_id) {
    throw new Error(`بانک «${bank?.title || bank?.bank_name || ""}» در سپیدار نگاشت نشده است`);
  }

  // Create allocation row
  const { data: alloc, error: aerr } = await supabase
    .from("finance_payment_allocations")
    .insert({
      payment_request_id: input.payment_request_id,
      payment_request_item_id: input.payment_request_item_id,
      bank_transaction_id: input.bank_transaction_id,
      bank_id: tx.bank_id,
      party_id: item.party_id,
      amount: input.amount,
      status: "pending_sync",
      sepidar_sync_status: "not_synced",
    })
    .select("id")
    .single();
  if (aerr || !alloc) throw aerr || new Error("درج تخصیص ناموفق بود");

  // Mark transaction assigning
  await supabase
    .from("finance_bank_transactions")
    .update({
      assignment_status: "assigning",
      assigned_operation_type: "payment_allocation",
      assigned_operation_id: alloc.id,
    })
    .eq("id", input.bank_transaction_id);

  // Create internal voucher (debit party-account, credit bank)
  const accountType = accountTypeForAmountTypeCode(item.amount_type_code as number | null);
  const v = await createVoucher({
    voucher_type: "payment_allocation",
    source_operation_type: "payment_allocation",
    source_operation_id: alloc.id,
    title: "پرداخت ذینفع",
    description: null,
    items: [
      { party_id: item.party_id, account_type: accountType, debit: input.amount, credit: 0, description: "بدهکار ذینفع" },
      { bank_id: tx.bank_id, account_type: "bank", debit: 0, credit: input.amount, description: "بانک" },
    ],
  });
  await supabase.from("finance_payment_allocations").update({ voucher_id: v.id }).eq("id", alloc.id);

  // Sync to Sepidar (placeholder)
  const sync = await syncVoucherToSepidar(v.id);
  if (sync.status === "synced") {
    await supabase
      .from("finance_payment_allocations")
      .update({ status: "synced", sepidar_sync_status: "synced", sepidar_error_message: null })
      .eq("id", alloc.id);
    await supabase
      .from("finance_bank_transactions")
      .update({ assignment_status: "assigned" })
      .eq("id", input.bank_transaction_id);
    // Update item paid_amount
    const newPaid = Number(item.paid_amount || 0) + Number(input.amount);
    await supabase
      .from("finance_payment_request_items")
      .update({ paid_amount: newPaid })
      .eq("id", input.payment_request_item_id);
    // Reduce party balance (we paid them — balance moves toward zero / debit)
    const { data: party } = await supabase.from("finance_parties").select("balance").eq("id", item.party_id).maybeSingle();
    const newBal = Number(party?.balance || 0) + Number(input.amount); // creditor (negative) → adding moves toward 0
    await supabase.from("finance_parties").update({ balance: newBal }).eq("id", item.party_id);
    await refreshPaymentRequestPaidTotals(input.payment_request_id);
    await recalculateBankUnassignedBalances(tx.bank_id);
    return { id: alloc.id, ok: true };
  } else {
    await supabase
      .from("finance_payment_allocations")
      .update({ status: "sync_failed", sepidar_sync_status: "failed", sepidar_error_message: sync.error_message })
      .eq("id", alloc.id);
    // tx stays 'assigning'
    await recalculateBankUnassignedBalances(tx.bank_id);
    return { id: alloc.id, ok: false, error: sync.error_message || "خطا در ثبت سپیدار" };
  }
}

export async function retryPaymentAllocationSync(allocationId: string): Promise<{ ok: boolean; error?: string }> {
  const { data: alloc } = await supabase
    .from("finance_payment_allocations")
    .select("*")
    .eq("id", allocationId)
    .maybeSingle();
  if (!alloc) throw new Error("تخصیص یافت نشد");
  if (alloc.status === "synced") return { ok: true };
  if (alloc.status === "cancelled") throw new Error("تخصیص لغو شده است");
  if (!alloc.voucher_id) throw new Error("سند داخلی یافت نشد");
  const sync = await syncVoucherToSepidar(alloc.voucher_id);
  if (sync.status === "synced") {
    await supabase
      .from("finance_payment_allocations")
      .update({ status: "synced", sepidar_sync_status: "synced", sepidar_error_message: null })
      .eq("id", allocationId);
    await supabase
      .from("finance_bank_transactions")
      .update({ assignment_status: "assigned" })
      .eq("id", alloc.bank_transaction_id);
    const { data: item } = await supabase
      .from("finance_payment_request_items")
      .select("paid_amount")
      .eq("id", alloc.payment_request_item_id)
      .maybeSingle();
    const newPaid = Number(item?.paid_amount || 0) + Number(alloc.amount);
    await supabase.from("finance_payment_request_items").update({ paid_amount: newPaid }).eq("id", alloc.payment_request_item_id);
    const { data: party } = await supabase.from("finance_parties").select("balance").eq("id", alloc.party_id).maybeSingle();
    const newBal = Number(party?.balance || 0) + Number(alloc.amount);
    await supabase.from("finance_parties").update({ balance: newBal }).eq("id", alloc.party_id);
    await refreshPaymentRequestPaidTotals(alloc.payment_request_id);
    await recalculateBankUnassignedBalances(alloc.bank_id);
    return { ok: true };
  }
  await supabase
    .from("finance_payment_allocations")
    .update({ status: "sync_failed", sepidar_sync_status: "failed", sepidar_error_message: sync.error_message })
    .eq("id", allocationId);
  return { ok: false, error: sync.error_message || "خطا در ثبت سپیدار" };
}

export async function cancelPaymentAllocation(allocationId: string): Promise<void> {
  const { data: alloc } = await supabase
    .from("finance_payment_allocations")
    .select("*")
    .eq("id", allocationId)
    .maybeSingle();
  if (!alloc) throw new Error("تخصیص یافت نشد");
  if (alloc.status === "synced") throw new Error("تخصیص ثبت‌شده قابل لغو نیست");
  await supabase
    .from("finance_payment_allocations")
    .update({ status: "cancelled" })
    .eq("id", allocationId);
  if (alloc.bank_transaction_id) {
    await supabase
      .from("finance_bank_transactions")
      .update({ assignment_status: "unassigned", assigned_operation_type: null, assigned_operation_id: null })
      .eq("id", alloc.bank_transaction_id);
  }
  if (alloc.bank_id) await recalculateBankUnassignedBalances(alloc.bank_id);
  await refreshPaymentRequestPaidTotals(alloc.payment_request_id);
}

export async function approvePaymentRequest(payment_request_id: string): Promise<void> {
  await supabase
    .from("finance_payment_requests")
    .update({ status: "approved", approved_at: new Date().toISOString() })
    .eq("id", payment_request_id);
  // Promote items pending_approval → approved
  await supabase
    .from("finance_payment_request_items")
    .update({ status: "approved" })
    .eq("payment_request_id", payment_request_id)
    .in("status", ["pending_approval", "pending"]);
}
