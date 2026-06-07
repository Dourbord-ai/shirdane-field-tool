// ============================================================================
// src/lib/finance/rollback.ts
// ----------------------------------------------------------------------------
// Central application-level rollback orchestrator.
//
// Architectural contract (DO NOT VIOLATE):
//   A) Load entity from Supabase.
//   B) Find related sepidar_voucher_id / sepidar_extra_data_id.
//   C) If sepidar_voucher_id exists, call bridge.RollbackSepidarVoucher FIRST.
//   D) ONLY IF Sepidar deletion succeeds (result_code 0 or 2), mutate Supabase.
//   E) Recompute affected party balances.
//   F) Insert immutable audit row in finance_rollback_audit.
//
// Idempotency:
//   The SP returns result_code = 2 when the voucher is already gone. We treat
//   that as success and continue the Supabase cleanup so partially-failed
//   rollbacks can be retried safely.
//
// Auditability rule (per user instruction):
//   We NEVER null sepidar_voucher_id on the source entity after rollback.
//   Instead we set sepidar_status = 'rolled_back' / 'deleted' / 'failed' and
//   stamp rollback_at / rollback_by / rollback_reason. This preserves the
//   original voucher reference for future investigations.
//
// Phase 3 (entity handlers) is intentionally NOT implemented here yet — the
// orchestrator only exposes the contract and the Sepidar call. Entity
// handlers will be filled in once we have audited every balance/report path
// for safe voucher voiding (see plan in chat).
// ============================================================================

import { supabase } from "@/integrations/supabase/client";
import { getSession } from "@/lib/auth";

// ----------------------------------------------------------------------------
// Public types
// ----------------------------------------------------------------------------

// All entity types supported by the orchestrator. Keep in sync with the
// CHECK constraint on finance_rollback_audit.entity_type.
export type RollbackEntityType =
  | "factor"
  | "payment_request"
  | "receive_identification"
  | "payment_allocation"
  | "bank_transfer"
  | "party_transfer"
  | "check";

// 'rollback' = full reversal, 'cancel' = soft cancel (entity-specific).
export type RollbackAction = "rollback" | "cancel";

// Raw response shape returned by the sepidar-rollback-voucher edge function.
// Mirrors what bridge.RollbackSepidarVoucher returns:
//   result_code = 0  → deleted now
//   result_code = 2  → already deleted (idempotent success)
//   result_code = -1 → SP threw / rolled back
export interface SepidarRollbackResult {
  success: boolean;
  result_code: number;
  message: string;
  sepidar_voucher_id: number | null;
  rawError?: string;
  // The full SP recordset row, useful for the audit log snapshot.
  data?: Record<string, unknown>;
}

// Input for the central orchestrator.
export interface RollbackFinanceOperationInput {
  entityType: RollbackEntityType;
  entityId: string;
  // Free-text justification — required by the UI. The audit row stores this
  // verbatim into rollback_reason.
  reason: string;
  // 'rollback' (default) does the full reversal. 'cancel' is a softer state
  // some entity handlers will use (e.g. factor → draft instead of cancelled).
  action?: RollbackAction;
}

export interface RollbackFinanceOperationResult {
  ok: boolean;
  // The Sepidar SP outcome (null when the entity had no voucher to roll back).
  sepidarResult: SepidarRollbackResult | null;
  // The new status the orchestrator set on the source entity (for UI toasts).
  newStatus: string | null;
  // Audit row id when an audit entry was inserted.
  auditId: string | null;
  // When ok=false, a human-readable Persian error to surface in toasts.
  error?: string;
}

// ----------------------------------------------------------------------------
// Low-level Sepidar call
// ----------------------------------------------------------------------------

/**
 * Calls the `sepidar-rollback-voucher` edge function which in turn invokes
 * the SQL Server procedure `bridge.RollbackSepidarVoucher`.
 *
 * Returns the normalized response. Does NOT touch any Supabase tables — that
 * responsibility lives in `rollbackFinanceOperation` below.
 */
export async function rollbackSepidarVoucher(args: {
  sepidarVoucherId: number;
  // FMK.ExtraData PK hint. The SP also cleans by EntityRef so this is optional.
  extraDataId?: number | null;
  // Whether to also delete the RPA "intent" headers. Defaults to true because
  // every voucher currently created by this app has a corresponding RPA row.
  deleteRpaHeaders?: boolean;
}): Promise<SepidarRollbackResult> {
  // Defensive: never call the SP with an invalid id — the SP returns
  // result_code=1 in that case but we'd rather fail fast.
  if (!args.sepidarVoucherId || args.sepidarVoucherId <= 0) {
    return {
      success: false,
      result_code: -1,
      message: "شناسه سند سپیدار نامعتبر است.",
      sepidar_voucher_id: null,
    };
  }

  // Invoke the edge function. We do NOT use the `sepidar.ts` `callEdge`
  // wrapper because that helper rejects on success=false; here we WANT the
  // raw response (so the orchestrator can branch on result_code).
  const { data, error } = await supabase.functions.invoke("sepidar-rollback-voucher", {
    body: {
      sepidarVoucherId: args.sepidarVoucherId,
      extraDataId: args.extraDataId ?? null,
      // Default true — matches current bridge.CreateBankVoucher behavior.
      deleteRpaHeaders: args.deleteRpaHeaders ?? true,
    },
  });

  if (error) {
    // Network / function-level error.
    return {
      success: false,
      result_code: -1,
      message: error.message || "خطای ارتباط با سرویس بازگشت سند سپیدار.",
      sepidar_voucher_id: args.sepidarVoucherId,
    };
  }

  const resp = (data ?? {}) as Partial<SepidarRollbackResult> & Record<string, unknown>;
  return {
    success: Boolean(resp.success),
    result_code: Number(resp.result_code ?? -1),
    message: String(resp.message ?? ""),
    sepidar_voucher_id: Number(resp.sepidar_voucher_id ?? args.sepidarVoucherId),
    rawError: (resp.rawError as string) || undefined,
    data: (resp.data as Record<string, unknown>) || undefined,
  };
}

// ----------------------------------------------------------------------------
// Audit helpers
// ----------------------------------------------------------------------------

interface AuditInsertInput {
  entityType: RollbackEntityType;
  entityId: string;
  action: RollbackAction;
  reason: string;
  oldStatus: string | null;
  newStatus: string | null;
  sepidarVoucherId: number | null;
  sepidarResult: SepidarRollbackResult | null;
  snapshotBefore: unknown;
  snapshotAfter: unknown;
  metadata?: Record<string, unknown>;
}

/**
 * Inserts an immutable audit row. Called ONLY after the Sepidar SP returned
 * success (or result_code=2). Returns the new row id or null on failure
 * (we don't want a failed audit insert to block the rest of the flow, but we
 * do surface the error to the console for ops investigation).
 */
async function insertRollbackAudit(input: AuditInsertInput): Promise<string | null> {
  // Resolve the operator from the API-based session (not auth.users).
  const performedBy = getSession().user?.id ?? null;

  const { data, error } = await supabase
    .from("finance_rollback_audit")
    .insert([
      {
        entity_type: input.entityType,
        entity_id: input.entityId,
        action: input.action,
        rollback_reason: input.reason,
        old_status: input.oldStatus,
        new_status: input.newStatus,
        sepidar_voucher_id: input.sepidarVoucherId,
        sepidar_delete_result: (input.sepidarResult as never) ?? null,
        snapshot_before: (input.snapshotBefore as never) ?? null,
        snapshot_after: (input.snapshotAfter as never) ?? null,
        performed_by: performedBy,
        metadata: (input.metadata ?? {}) as never,
      },
    ])
    .select("id")
    .single();

  if (error) {
    // Do not throw — the rollback itself already succeeded. Log loudly.
    // eslint-disable-next-line no-console
    console.error("[rollback audit] insert failed", error);
    return null;
  }
  return (data as { id: string } | null)?.id ?? null;
}

// ----------------------------------------------------------------------------
// Helper: did the SP succeed (including idempotent "already gone")?
// ----------------------------------------------------------------------------
//
// Exported because Phase 3 entity handlers will need the same predicate.
export function isSepidarRollbackOk(r: SepidarRollbackResult | null): boolean {
  if (!r) return true; // No voucher to roll back = trivially OK.
  // result_code 0 = deleted now, 2 = already gone. Both are success.
  return r.success === true && (r.result_code === 0 || r.result_code === 2);
}

// ----------------------------------------------------------------------------
// Central orchestrator — Phase 2 scaffold
// ----------------------------------------------------------------------------
//
// In Phase 2 we expose the public surface and the Sepidar call so the UI and
// other modules can already wire against the final signature. Per-entity
// Supabase mutation handlers (factor, payment_request, ...) land in Phase 3
// once we have audited every balance/report path for safe voucher voiding.
//
// Currently this function:
//   - Validates input.
//   - Returns a clear "not implemented" error for each entity type so callers
//     can detect the gap without crashing.
//   - Provides the exact integration shape Phase 3 handlers will fill in.
//
// Phase 3 handlers will follow this shape per entity:
//   1) Load entity + capture snapshotBefore.
//   2) If entity.sepidar_voucher_id, call rollbackSepidarVoucher().
//   3) Bail out if !isSepidarRollbackOk(sepidarResult).
//   4) Mutate Supabase (update lifecycle, void linked rows, unassign bank tx,
//      reset paid_amount, etc.) — preserving sepidar_voucher_id and stamping
//      sepidar_status / rollback_at / rollback_by / rollback_reason.
//   5) Recompute party balances (recompute_party_balance) and, where
//      relevant, fn_finance_recalc_payment_request.
//   6) Capture snapshotAfter and call insertRollbackAudit().
export async function rollbackFinanceOperation(
  input: RollbackFinanceOperationInput,
): Promise<RollbackFinanceOperationResult> {
  // ---- Basic validation -----------------------------------------------------
  if (!input.entityId) {
    return {
      ok: false,
      sepidarResult: null,
      newStatus: null,
      auditId: null,
      error: "شناسه موجودیت الزامی است.",
    };
  }
  if (!input.reason || input.reason.trim().length < 3) {
    return {
      ok: false,
      sepidarResult: null,
      newStatus: null,
      auditId: null,
      error: "ذکر دلیل بازگشت سند الزامی است.",
    };
  }

  // ---- Phase 3 dispatch (not implemented yet) -------------------------------
  // Intentionally returns a structured "not implemented" so the UI layer being
  // wired in Phase 4 can render a clear message instead of a runtime crash.
  return {
    ok: false,
    sepidarResult: null,
    newStatus: null,
    auditId: null,
    error: `هندلر بازگشت برای «${input.entityType}» هنوز پیاده‌سازی نشده است (Phase 3).`,
  };
}

// ----------------------------------------------------------------------------
// Re-export helpers for Phase 3 entity handlers and Phase 4 UI.
// ----------------------------------------------------------------------------
export const __internal = {
  insertRollbackAudit,
};
