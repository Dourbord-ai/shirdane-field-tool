/**
 * Centralized Sepidar bridge client (frontend).
 * - Frontend NEVER touches SQL Server directly.
 * - Each call goes through a Supabase Edge Function that invokes a `bridge.*` SP.
 * - Every operation is mirrored to `finance_sepidar_logs` (best-effort, non-blocking).
 *
 * TODO (after DEV_ACCESS_MODE off): wire permissions:
 *   finance.sepidar.view_statement / view_balance / create_voucher /
 *   allocate_transaction / view_voucher_status
 */
import { supabase } from "@/integrations/supabase/client";
import { getReadableFinanceError } from "@/lib/financeErrors";

type Json = Record<string, unknown>;

async function logOp(
  operation: string,
  request_payload: Json,
  response_payload: Json | null,
  success: boolean,
  raw_error: string | null,
): Promise<void> {
  try {
    await supabase.from("finance_sepidar_logs").insert({
      operation,
      request_payload,
      response_payload: response_payload ?? null,
      success,
      raw_error,
    });
  } catch (e) {
    // never block the caller for logging failures
    // eslint-disable-next-line no-console
    console.warn("[sepidar log] failed", e);
  }
}

async function callEdge<T extends Json = Json>(
  functionName: string,
  body: Json,
): Promise<T> {
  const { data, error } = await supabase.functions.invoke(functionName, { body });
  if (error) {
    const msg = getReadableFinanceError(error);
    await logOp(functionName, body, (data as Json) ?? null, false, msg);
    throw new Error(msg);
  }
  const resp = (data ?? {}) as Json & { success?: boolean; message?: string; rawError?: string };
  if (resp.success === false) {
    const msg = (resp.message as string) || "خطای نامشخص از سپیدار";
    await logOp(functionName, body, resp, false, (resp.rawError as string) || msg);
    throw new Error(msg);
  }
  await logOp(functionName, body, resp, true, null);
  return resp as T;
}

// ----------------- Public API -----------------

export interface SepidarBalanceResponse {
  success: true;
  balance: number;
  data: Json;
}
export async function getSepidarBeneficiaryBalance(partyId: number): Promise<SepidarBalanceResponse> {
  if (!partyId || partyId <= 0) throw new Error("شناسه ذینفع سپیدار وارد نشده است.");
  return callEdge<SepidarBalanceResponse>("sepidar-beneficiary-balance", { partyId });
}

export interface SepidarStatementResponse {
  success: true;
  rowCount: number;
  data: Json[];
}
export async function getSepidarBeneficiaryStatement(
  partyId: number,
  fromDate?: string | null,
  toDate?: string | null,
): Promise<SepidarStatementResponse> {
  if (!partyId || partyId <= 0) throw new Error("شناسه ذینفع سپیدار وارد نشده است.");
  return callEdge<SepidarStatementResponse>("sepidar-beneficiary-statement", {
    partyId,
    fromDate: fromDate ?? null,
    toDate: toDate ?? null,
  });
}

export interface CreateVoucherInput {
  paymentRequestId?: string | null;
  paymentRequestItemId?: string | null;
  partyId: number;
  amount: number;
  paymentType?: string | null; // creditor | prepayment | on_account (or Persian)
  description?: string | null;
  voucherDate?: string | null; // shamsi or iso
}
export interface CreateVoucherResponse {
  success: true;
  voucherId: number | string | null;
  voucherNumber: number | string | null;
  data: Json;
}
export async function createSepidarPaymentVoucher(input: CreateVoucherInput): Promise<CreateVoucherResponse> {
  if (!input.partyId || input.partyId <= 0) throw new Error("شناسه ذینفع سپیدار وارد نشده است.");
  if (!input.amount || input.amount <= 0) throw new Error("مبلغ سند نامعتبر است.");
  return callEdge<CreateVoucherResponse>("sepidar-create-payment-voucher", input as unknown as Json);
}

export interface AllocateTransactionInput {
  paymentRequestItemId?: string | null;
  transactionId?: string | number | null;
  amount: number;
  voucherId?: string | number | null;
}
export interface AllocateTransactionResponse {
  success: true;
  allocationId: number | string | null;
  data: Json;
}
export async function allocateSepidarPaymentTransaction(
  input: AllocateTransactionInput,
): Promise<AllocateTransactionResponse> {
  if (!input.amount || input.amount <= 0) throw new Error("مبلغ تخصیص نامعتبر است.");
  return callEdge<AllocateTransactionResponse>("sepidar-allocate-payment-transaction", input as unknown as Json);
}

export interface VoucherStatusResponse {
  success: true;
  status: string | number | null;
  data: Json;
}
export async function getSepidarVoucherStatus(voucherId: number | string): Promise<VoucherStatusResponse> {
  const id = Number(voucherId);
  if (!id || id <= 0) throw new Error("شناسه سند سپیدار نامعتبر است.");
  return callEdge<VoucherStatusResponse>("sepidar-voucher-status", { voucherId: id });
}

// ----------------- Helpers -----------------

/**
 * Returns true if the requested amount is allowed by Sepidar balance for the
 * given amount-type code. Only `creditor` (1) is enforced.
 */
export function shouldEnforceSepidarBalance(amountTypeCode: number | null | undefined): boolean {
  return Number(amountTypeCode) === 1;
}
