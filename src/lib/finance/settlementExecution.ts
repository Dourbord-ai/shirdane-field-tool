// =============================================================================
// settlementExecution — Phase 8
// -----------------------------------------------------------------------------
// Client-side helpers + Persian labels for the new settlement-item execution
// layer. ALL state transitions go through SECURITY DEFINER RPCs added in the
// Phase 8 migration. The client never updates `execution_status` directly,
// because the BEFORE-UPDATE trigger validates the allowed-transition matrix
// and would reject ad-hoc edits anyway.
//
// What this file does NOT do (intentional, per Phase 8 scope):
//   - It does NOT touch amount_type_code, paymentAmountTypes, Sepidar,
//     voucher posting, bank-allocation or check lifecycle. Each of those
//     concerns lives in its own module; settlement only records "execution
//     happened" and hands off responsibility.
// =============================================================================
import { supabase } from "@/integrations/supabase/client";

// --- New execution statuses (string union) -----------------------------------
// Kept as text on the DB side (CHECK + validation trigger) so adding values
// later is a single migration without an enum alter. The order below is the
// same order we render in the progress summary.
export type ExecutionStatus =
  | "pending"
  | "ready_for_execution"
  | "in_progress"
  | "partially_executed"
  | "linked"
  | "executed"
  | "on_hold"
  | "cancelled"
  | "rejected";

// Persian labels for status badges. Centralised here so any new screen
// (timeline, summary, filter chips) renders the exact same wording.
export const EXECUTION_STATUS_LABELS_FA: Record<ExecutionStatus, string> = {
  pending: "در انتظار",
  ready_for_execution: "آماده اجرا",
  in_progress: "در حال اجرا",
  partially_executed: "اجرای جزئی",
  linked: "ارجاع‌شده",
  executed: "اجرا شده",
  on_hold: "متوقف",
  cancelled: "لغو شده",
  rejected: "رد شده",
};

// Convenience getter that tolerates legacy NULLs and unknown values without
// throwing — the UI prefers showing «—» to crashing on a bad row.
export function labelForExecutionStatus(s: string | null | undefined): string {
  if (!s) return "—";
  return EXECUTION_STATUS_LABELS_FA[s as ExecutionStatus] ?? s;
}

// Categorisation used by the request-level progress summary. Keeping this in
// one place prevents drift if someone later adds a status and forgets to
// update one of the chips.
export function categorizeStatus(s: string | null | undefined):
  | "executed"
  | "linked"
  | "in_progress"
  | "on_hold"
  | "cancelled"
  | "pending"
{
  switch (s) {
    case "executed":
    case "partially_executed":
      return "executed";
    case "linked":
      return "linked";
    case "in_progress":
    case "ready_for_execution":
      return "in_progress";
    case "on_hold":
      return "on_hold";
    case "cancelled":
    case "rejected":
      return "cancelled";
    default:
      return "pending";
  }
}

// --- RPC wrappers ------------------------------------------------------------
// All wrappers use `as never` for the function name because the auto-generated
// Supabase types haven't been regenerated yet (Phase 7B left the same pattern
// in place). The runtime call is unaffected.

export interface ExecutePayload {
  // Free-form per-method snapshot — written verbatim into
  // details.execution.{method}. Keep this small; structured fields per
  // method live inside the sub-dialogs.
  [k: string]: unknown;
}

/** bank_transfer / cashbox / barter / deferred-closure → status = 'executed' */
export async function executeSettlementItem(
  itemId: string,
  method: "bank_transfer" | "cashbox" | "barter" | "deferred",
  payload: ExecutePayload,
  note?: string,
) {
  const { data, error } = await (supabase.rpc as never as (
    n: string,
    a: unknown,
  ) => Promise<{ data: unknown; error: { message: string } | null }>)(
    "execute_settlement_item",
    { p_item_id: itemId, p_method: method, p_payload: payload, p_note: note ?? null },
  );
  if (error) throw new Error(error.message);
  return data;
}

/** check → creates finance_check_links row and sets status to 'linked'. */
export async function linkSettlementItemToCheck(
  itemId: string,
  checkId: string,
  note?: string,
) {
  const { data, error } = await (supabase.rpc as never as (
    n: string,
    a: unknown,
  ) => Promise<{ data: unknown; error: { message: string } | null }>)(
    "link_settlement_item_to_check",
    { p_item_id: itemId, p_check_id: checkId, p_note: note ?? null },
  );
  if (error) throw new Error(error.message);
  return data;
}

export async function cancelSettlementItem(itemId: string, reason: string) {
  const { error } = await (supabase.rpc as never as (
    n: string,
    a: unknown,
  ) => Promise<{ data: unknown; error: { message: string } | null }>)(
    "cancel_settlement_item",
    { p_item_id: itemId, p_reason: reason },
  );
  if (error) throw new Error(error.message);
}

export async function rejectSettlementItem(itemId: string, reason: string) {
  const { error } = await (supabase.rpc as never as (
    n: string,
    a: unknown,
  ) => Promise<{ data: unknown; error: { message: string } | null }>)(
    "reject_settlement_item",
    { p_item_id: itemId, p_reason: reason },
  );
  if (error) throw new Error(error.message);
}

export async function holdSettlementItem(itemId: string, reason: string) {
  const { error } = await (supabase.rpc as never as (
    n: string,
    a: unknown,
  ) => Promise<{ data: unknown; error: { message: string } | null }>)(
    "hold_settlement_item",
    { p_item_id: itemId, p_reason: reason },
  );
  if (error) throw new Error(error.message);
}

export async function resumeSettlementItem(itemId: string) {
  const { error } = await (supabase.rpc as never as (
    n: string,
    a: unknown,
  ) => Promise<{ data: unknown; error: { message: string } | null }>)(
    "resume_settlement_item",
    { p_item_id: itemId },
  );
  if (error) throw new Error(error.message);
}

/** Reopen a terminal item ('executed', 'linked', 'cancelled', 'rejected'). For
 *  'linked' the server also soft-breaks the active finance_check_links row so
 *  the partial unique index frees the slot WITHOUT losing audit history. */
export async function reopenSettlementItem(itemId: string, reason: string) {
  const { error } = await (supabase.rpc as never as (
    n: string,
    a: unknown,
  ) => Promise<{ data: unknown; error: { message: string } | null }>)(
    "reopen_settlement_item",
    { p_item_id: itemId, p_reason: reason },
  );
  if (error) throw new Error(error.message);
}

/** Deferred-items only: extends due_date. Does NOT change status — a tmdid
 *  (تمدید) is not an execution. */
export async function extendSettlementItemDueDate(
  itemId: string,
  newDueDateISO: string, // YYYY-MM-DD (Gregorian)
  note?: string,
) {
  const { error } = await (supabase.rpc as never as (
    n: string,
    a: unknown,
  ) => Promise<{ data: unknown; error: { message: string } | null }>)(
    "extend_settlement_item_due_date",
    { p_item_id: itemId, p_new_due_date: newDueDateISO, p_note: note ?? null },
  );
  if (error) throw new Error(error.message);
}
