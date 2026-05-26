// Finance module shared utilities
import { supabase } from "@/integrations/supabase/client";
import { gregorianToJalali, formatJalali, toPersianDigits } from "@/lib/jalali";
import { getReadableFinanceError } from "@/lib/financeErrors";

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
  // Legacy imported rows may still carry `draft`; in this flow it means
  // "awaiting management approval" — surface the same Persian label so the
  // user never sees the technical word «پیش‌نویس».
  draft: "در انتظار تایید",
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

// ---------------------------------------------------------------------------
// Payment-completion status (separate from the approval lifecycle above).
// Lives on the new `payment_status` column of `finance_payment_requests`.
// We surface ONLY these three buckets in the UI — they map 1:1 to the DB.
// ---------------------------------------------------------------------------
export const PAYMENT_STATUS_LABEL: Record<string, string> = {
  unpaid: "پرداخت نشده",
  partial_payment: "پرداخت ناقص",
  full_payment: "پرداخت کامل",
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

// ---------- Sepidar voucher sync (real bridge) ----------
// Backwards-compatible wrapper kept for the legacy call sites in VouchersTab,
// PartyTransferTab, BankTransferTab. It now forwards to the real edge function
// via `syncVoucherToSepidar`. The `op` argument is retained so log lines /
// retry buttons keep the same signature, but every operation maps to the same
// `post_voucher` SP call — there is no separate "retry" path on the bridge.
export async function sepidarSyncPlaceholder(voucher_id: string, _op: string) {
  // Delegate to the real implementation. We intentionally do NOT pre-insert a
  // sync-log row here anymore — the edge function writes the authoritative
  // success/failure log itself, so doing it twice would just create noise.
  return await syncVoucherToSepidar(voucher_id);
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
  // status_code distinguishes a fresh create from a duplicate-link.
  // 'created' = SP inserted a new Sepidar party.
  // 'exists'  = SP found a match by national code / id and returned the
  //             existing Sepidar IDs (treated as success — no error).
  // null      = legacy SP that doesn't emit status_code yet.
  status_code?: "created" | "exists" | null;
  error_message: string | null;
}

// Real bridge call: invokes the `sepidar-create-beneficiary` Edge Function
// which executes `bridge.CreateBeneficiary` on ShirdaneBridge (SQL Server
// 2008 compatible). Do NOT call `sepidar-beneficiaries` here — that one is
// read-only and serves a different flow.
async function callSepidarBridgeAddParty(
  party: {
    id: string;
    full_name: string;
    ownership_type?: string | null;
    national_code?: string | null;
    national_id?: string | null;
    economic_code?: string | null;
    mobile?: string | null;
    telephone?: string | null;
    address?: string | null;
    postal_code?: string | null;
    description?: string | null;
  },
): Promise<SepidarPartyResponse> {
  // Forward only fields the SP needs. Everything else stays local-only.
  const { data, error } = await supabase.functions.invoke(
    "sepidar-create-beneficiary",
    {
      body: {
        partyId: party.id,
        fullName: party.full_name,
        ownershipType: party.ownership_type ?? null,
        nationalCode: party.national_code ?? null,
        nationalId: party.national_id ?? null,
        economicCode: party.economic_code ?? null,
        mobile: party.mobile ?? null,
        telephone: party.telephone ?? null,
        address: party.address ?? null,
        postalCode: party.postal_code ?? null,
        description: party.description ?? null,
      },
    },
  );

  // Transport-level failure (function unreachable, 5xx, etc.).
  if (error) {
    return {
      sepidar_party_id: null, sepidar_dl_id: null, sepidar_dl_code: null,
      sepidar_account_id: null, sepidar_full_name: null,
      sepidar_sync_status: "failed",
      status_code: null,
      error_message: getReadableFinanceError(error),
    };
  }

  // Application-level failure (SP raised an error, missing ids, …).
  const resp = (data ?? {}) as {
    success?: boolean; message?: string;
    status_code?: "created" | "exists" | null;
    sepidar_party_id?: number | null;
    sepidar_dl_id?: number | null;
    sepidar_dl_code?: number | null;
    sepidar_account_id?: number | null;
    sepidar_full_name?: string | null;
  };
  if (!resp.success || resp.sepidar_party_id == null) {
    return {
      sepidar_party_id: null, sepidar_dl_id: null, sepidar_dl_code: null,
      sepidar_account_id: null, sepidar_full_name: null,
      sepidar_sync_status: "failed",
      status_code: null,
      error_message: resp.message || "خطای نامشخص در ایجاد ذینفع سپیدار",
    };
  }

  // Both 'created' and 'exists' are success. 'exists' means the SP matched
  // by national code / national id and returned the existing Sepidar IDs
  // so we link the local row to the pre-existing Sepidar party.
  return {
    sepidar_party_id: resp.sepidar_party_id ?? null,
    sepidar_dl_id: resp.sepidar_dl_id ?? null,
    sepidar_dl_code: resp.sepidar_dl_code ?? null,
    sepidar_account_id: resp.sepidar_account_id ?? null,
    sepidar_full_name: resp.sepidar_full_name ?? null,
    sepidar_sync_status: "synced",
    status_code: resp.status_code ?? "created",
    error_message: null,
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
    // Forward the full identity payload so the SP can populate Sepidar
    // properly (national codes, contact info, address, …).
    response = await callSepidarBridgeAddParty({
      id: partyId,
      full_name: fullName,
      ownership_type: (party as never as { ownership_type?: string | null }).ownership_type ?? null,
      national_code: party.national_code ?? null,
      national_id: party.national_id ?? null,
      economic_code: (party as never as { economic_code?: string | null }).economic_code ?? null,
      mobile: party.mobile ?? null,
      telephone: party.telephone ?? null,
      address: party.address ?? null,
      postal_code: party.postal_code ?? null,
      description: party.description ?? null,
    });
  } catch (e: unknown) {
    response = {
      sepidar_party_id: null, sepidar_dl_id: null, sepidar_dl_code: null,
      sepidar_account_id: null, sepidar_full_name: null,
      sepidar_sync_status: "failed",
      status_code: null,
      error_message: e instanceof Error ? e.message : "خطای نامشخص",
    };
  }

  // Log the call. We keep operation_type stable for legacy compatibility
  // but tag the response_payload with status_code so we can tell apart:
  //   - 'created' → SP inserted a new Sepidar party
  //   - 'exists'  → SP matched by national code and linked existing IDs
  await supabase.from("finance_sepidar_sync_logs").insert({
    party_id: partyId,
    entity_type: "party",
    operation_type:
      response.status_code === "exists"
        ? "SpAddSepidarBankParty:link-existing"
        : "SpAddSepidarBankParty",
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
  sepidar_party_id?: number | null;
  sepidar_account_id?: number | null;
  sepidar_sync_status?: string | null;
}): boolean {
  return (
    p.sepidar_party_id != null &&
    p.sepidar_account_id != null &&
    p.sepidar_sync_status === "synced"
  );
}

/**
 * Lenient check used by the UI to decide whether to show the
 * "ثبت در سپیدار" button at all.  Legacy/imported parties may have any of
 * the Sepidar id columns populated without a clean `synced` status, but for
 * the operator they are effectively "already in Sepidar" and the registration
 * button must be suppressed in favour of a readonly badge.
 */
export function isPartySyncedInSepidar(p: {
  sepidar_party_id?: number | null;
  sepidar_dl_id?: number | null;
  sepidar_account_id?: number | null;
  sepidar_sync_status?: string | null;
}): boolean {
  return (
    p.sepidar_sync_status === "synced" ||
    p.sepidar_party_id != null ||
    p.sepidar_dl_id != null ||
    p.sepidar_account_id != null
  );
}

export async function assertPartiesReadyForPosting(partyIds: string[]): Promise<void> {
  const ids = Array.from(new Set(partyIds.filter(Boolean)));
  if (ids.length === 0) return;
  const { data, error } = await supabase
    .from("finance_parties")
    .select("id, sepidar_party_id, sepidar_account_id, sepidar_sync_status, first_name, last_name, company_name, ownership_type")
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

// ---------- Voucher → Sepidar (real bridge) ----------
// The previous placeholder has been removed. This now calls the
// `sepidar-post-voucher` Edge Function, which in turn invokes the SQL Server
// bridge stored procedure and updates `finance_vouchers.sepidar_*` columns
// server-side. We still surface a `{status, error_message}` shape so existing
// call sites in this file keep working without changes.
export interface SepidarVoucherResponse {
  status: "synced" | "failed";
  error_message: string | null;
}

export async function syncVoucherToSepidar(voucherId: string): Promise<SepidarVoucherResponse> {
  // Invoke the Edge Function. We do NOT pre-flip `sepidar_sync_status` here —
  // the function itself sets `syncing`, then `synced`/`failed`, so the DB is
  // the single source of truth and we avoid an extra round-trip.
  try {
    const { data, error } = await supabase.functions.invoke("sepidar-post-voucher", {
      body: { voucher_id: voucherId },
    });

    // Network/transport error from supabase-js (function unreachable, 5xx, etc.).
    if (error) {
      const msg = error.message || "ارتباط با تابع سپیدار برقرار نشد.";
      return { status: "failed", error_message: msg };
    }

    // The edge function returns `{ success, message, rawError? }`. When the
    // bridge SP reports a business failure, `success` is false and `message`
    // is already a Persian, user-facing string.
    const ok = (data as { success?: boolean } | null)?.success === true;
    if (ok) return { status: "synced", error_message: null };

    // Surface the Sepidar raw error alongside the generic Persian message
    // so operators can see the actual SQL Server / bridge reason in the UI
    // and in the persisted voucher.sepidar_error_message column.
    const payload = (data ?? {}) as { message?: string; rawError?: string };
    const friendly = payload.message || "ثبت سند در سپیدار ناموفق بود.";
    const composed = payload.rawError && payload.rawError !== friendly
      ? `${friendly} (${payload.rawError})`
      : friendly;
    return { status: "failed", error_message: composed };
  } catch (e) {
    // Defensive catch — supabase-js shouldn't throw here, but if Deno
    // serialization or a CORS preflight breaks we still need to mark failure.
    const msg = e instanceof Error ? e.message : "خطای ناشناخته در اتصال به سپیدار.";
    return { status: "failed", error_message: msg };
  }
}


// ---------- Trusted beneficiary learning ----------
// After a successful manual receive identification, persist the
// (matchtype, matchcontent) → finance_party_id mapping in
// bankpartyaccountinfos so future deposits from the same card/sheba/account
// can be auto-identified by DepositAI (which currently stops at
// `party_not_found` whenever finance_party_id is NULL).
//
// We read the source identifier from the bank transaction's
// ai_verify_payload (written when the operator verified the account before
// assignment). Shape: { type: "1"|"2"|"3", number: string, bankCode?: string }
// and the verified owner/bank name from ai_verified_result when available.
//
// Idempotent: relies on idx_bankpartyaccountinfos_type_content
// (UNIQUE on matchtype, matchcontent). If a row already exists, we UPDATE
// finance_party_id (and refresh matchname/matchbankname only when empty);
// otherwise we INSERT a new trusted row with status='trusted_manual'.
//
// Returns true when a mapping was upserted, false when there was nothing to
// persist (no payload, missing fields, or DB error). Never throws — this
// is a best-effort side-effect that must not block the main approval flow.
async function saveTrustedBeneficiaryMapping(
  bankTransactionId: string,
  partyId: string,
): Promise<boolean> {
  try {
    // Pull the verify payload + verified result snapshot from the bank tx
    const { data: tx } = await supabase
      .from("finance_bank_transactions")
      .select("ai_verify_payload, ai_verified_result")
      .eq("id", bankTransactionId)
      .maybeSingle();

    // Narrow the jsonb columns to the shapes we expect
    const payload = (tx?.ai_verify_payload ?? null) as
      | { type?: string | number; number?: string; bankCode?: string | null }
      | null;
    const verified = (tx?.ai_verified_result ?? null) as
      | { name?: string; bankName?: string }
      | null;

    if (!payload) return false;
    const matchtype = payload.type != null ? String(payload.type) : "";
    const matchcontent = payload.number ? String(payload.number) : "";
    // Without a (type, content) pair we cannot honor the unique index
    if (!matchtype || !matchcontent) return false;

    // Look up existing row by the unique (matchtype, matchcontent) pair
    const { data: existing } = await supabase
      .from("bankpartyaccountinfos")
      .select("id, matchname, matchbankname")
      .eq("matchtype", matchtype)
      .eq("matchcontent", matchcontent)
      .maybeSingle();

    if (existing?.id) {
      // Row exists → only update finance_party_id (+ fill in name/bank fields
      // if they were empty). Status is intentionally left alone so we don't
      // clobber operator-curated values.
      const patch: Record<string, unknown> = { finance_party_id: partyId };
      if (!existing.matchname && verified?.name) patch.matchname = verified.name;
      if (!existing.matchbankname && verified?.bankName)
        patch.matchbankname = verified.bankName;
      await supabase
        .from("bankpartyaccountinfos")
        .update(patch)
        .eq("id", existing.id);
      return true;
    }

    // No row → insert a fresh trusted mapping
    await supabase.from("bankpartyaccountinfos").insert({
      matchtype,
      matchcontent,
      finance_party_id: partyId,
      matchname: verified?.name ?? null,
      matchbankname: verified?.bankName ?? null,
      status: "trusted_manual",
    });
    return true;
  } catch {
    // Never let a learning failure break the main approval flow
    return false;
  }
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
  // Allow: pending_approval (manual approval), sync_failed (manual retry),
  // and approved-but-unposted (auto-identified rows created via the
  // auto_create_receive_identification RPC that still need Sepidar posting).
  const alreadySynced = ri.sepidar_sync_status === "synced";
  const approvedUnposted =
    ri.status === "approved" && !alreadySynced;
  if (
    ri.status !== "pending_approval" &&
    ri.status !== "sync_failed" &&
    !approvedUnposted
  ) {
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
  // ---------------------------------------------------------------------
  // Recompute item statuses and the request header's payment lifecycle.
  //
  // IMPORTANT: the approved/payable total is the sum of APPROVED items
  // only — never the original `total_amount` (which still includes
  // rejected items). The DB trigger `fn_finance_recalc_payment_request`
  // is the source of truth and keeps `confirmed_amount`, `remaining_amount`
  // and `payment_status` in sync; we still re-read the header afterwards
  // so the request lifecycle bucket (`status`) tracks item-level paid
  // progress correctly.
  // ---------------------------------------------------------------------
  const { data: items } = await supabase
    .from("finance_payment_request_items")
    .select("id, amount, paid_amount, status")
    .eq("payment_request_id", payment_request_id);
  const list = (items || []) as { id: string; amount: number | null; paid_amount: number | null; status: string | null }[];
  // Track whether every APPROVED item is fully paid (rejected items don't count).
  let approvedCount = 0;
  let approvedAllPaid = true;
  let anyPaid = false;
  for (const it of list) {
    const amt = Number(it.amount || 0);
    const paid = Number(it.paid_amount || 0);
    const remaining = Math.max(0, amt - paid);
    // Only progress approved-family items; never overwrite a rejected status.
    if (["approved", "partially_paid", "paid", "sync_failed"].includes(String(it.status))) {
      approvedCount += 1;
      let nextStatus = it.status || "approved";
      if (paid > 0 && paid + 1e-6 < amt) nextStatus = "partially_paid";
      else if (paid + 1e-6 >= amt && amt > 0) nextStatus = "paid";
      if (nextStatus !== it.status) {
        await supabase
          .from("finance_payment_request_items")
          .update({ remaining_amount: remaining, status: nextStatus })
          .eq("id", it.id);
      } else {
        await supabase
          .from("finance_payment_request_items")
          .update({ remaining_amount: remaining })
          .eq("id", it.id);
      }
      if (nextStatus !== "paid") approvedAllPaid = false;
    }
    if (paid > 0) anyPaid = true;
  }

  // Header request-level approval lifecycle (NOT payment completion).
  // The DB trigger already wrote confirmed_amount / total_paid_amount /
  // remaining_amount / payment_status — we only adjust the approval
  // status bucket so the UI keeps showing paid / partially_paid once
  // money starts flowing against approved items.
  const { data: header } = await supabase
    .from("finance_payment_requests")
    .select("status")
    .eq("id", payment_request_id)
    .maybeSingle();
  let headerStatus = header?.status || "approved";
  if (approvedCount > 0 && approvedAllPaid) headerStatus = "paid";
  else if (anyPaid) headerStatus = "partially_paid";
  await supabase
    .from("finance_payment_requests")
    .update({ status: headerStatus })
    .eq("id", payment_request_id);
}


export async function createPaymentAllocation(input: CreatePaymentAllocationInput): Promise<{ id: string; ok: boolean; error?: string }> {
  // Load item + request. We pull `confirmed_amount` so the payable cap
  // matches the DB trigger (`fn_finance_payment_allocations_guard`) which
  // uses COALESCE(NULLIF(confirmed_amount,0), amount, 0).
  const { data: item } = await supabase
    .from("finance_payment_request_items")
    .select("id, payment_request_id, party_id, amount, confirmed_amount, paid_amount, amount_type_code, status")
    .eq("id", input.payment_request_item_id)
    .maybeSingle();
  if (!item) throw new Error("ردیف درخواست یافت نشد");
  if (!["approved", "partially_paid", "sync_failed"].includes(String(item.status))) {
    throw new Error("ردیف درخواست در وضعیت قابل پرداخت نیست (نیاز به تایید مدیریت)");
  }
  // Approved payable for THIS item = confirmed_amount when > 0, else the
  // originally requested amount. Never the raw `amount` alone, otherwise a
  // partially-rejected item could be over-allocated.
  const itemPayable = Number(item.confirmed_amount || 0) || Number(item.amount || 0);
  const itemRemaining = Math.max(0, itemPayable - Number(item.paid_amount || 0));
  if (input.amount <= 0) throw new Error("مبلغ تخصیص باید بزرگ‌تر از صفر باشد.");
  if (itemRemaining <= 0) throw new Error("این ردیف مانده قابل پرداختی ندارد.");
  if (input.amount - 1e-6 > itemRemaining) {
    throw new Error("مبلغ تراکنش از مانده قابل پرداخت این درخواست بیشتر است.");
  }

  // -------------------------------------------------------------------
  // Request-level overpayment guard. Approved payable amount = sum of
  // approved items (kept in `confirmed_amount` by the DB trigger). We
  // deliberately do NOT fall back to total_amount — rejected items must
  // never count as payable.
  // -------------------------------------------------------------------
  const { data: header } = await supabase
    .from("finance_payment_requests")
    .select("confirmed_amount, total_paid_amount, status")
    .eq("id", item.payment_request_id)
    .maybeSingle();
  const approvedAmount = Number(header?.confirmed_amount || 0);
  const alreadyPaid = Number(header?.total_paid_amount || 0);
  if (approvedAmount <= 0) {
    throw new Error("هیچ آیتم تأیید شده‌ای برای این درخواست وجود ندارد.");
  }
  if (alreadyPaid + Number(input.amount) > approvedAmount + 1e-6) {
    throw new Error("مبلغ تراکنش از مانده قابل پرداخت این درخواست بیشتر است.");
  }


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
  // -------------------------------------------------------------------
  // Approve the request header. We DO NOT recompute confirmed_amount or
  // payment_status here — the DB trigger fn_finance_recalc_payment_request
  // already does that whenever item statuses change, and item promotion
  // below will fire it again. This keeps a single source of truth and
  // ensures rejected items are excluded from the approved payable total.
  // -------------------------------------------------------------------
  await supabase
    .from("finance_payment_requests")
    .update({
      status: "approved",
      approved_at: new Date().toISOString(),
    })
    .eq("id", payment_request_id);

  // Promote items still pending_approval → approved. The items trigger
  // will then recompute confirmed_amount / remaining_amount / payment_status
  // based ONLY on approved (non-deleted) items.
  await supabase
    .from("finance_payment_request_items")
    .update({ status: "approved" })
    .eq("payment_request_id", payment_request_id)
    .in("status", ["pending_approval", "pending"]);
}

