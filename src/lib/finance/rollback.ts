// ============================================================================
// src/lib/finance/rollback.ts
// ----------------------------------------------------------------------------
// Phase 3 — Central application-level rollback orchestrator with entity
// handlers for: factor, receive_identification, payment_request,
// payment_allocation, bank_transfer, party_transfer, check.
//
// Architectural contract (DO NOT VIOLATE):
//   A) Load entity from Supabase + capture snapshot_before.
//   B) Find the linked finance_vouchers row (via entity.voucher_id).
//   C) If finance_vouchers.sepidar_voucher_id exists, call
//      bridge.RollbackSepidarVoucher FIRST (via sepidar-rollback-voucher
//      edge function). NO Supabase mutation may happen before this returns
//      success.
//   D) Treat result_code 0 (deleted now) AND 2 (already gone) as success.
//   E) Soft-delete the voucher (is_deleted=true) + stamp rollback metadata
//      on finance_vouchers (sepidar_status, rollback_at, rollback_by,
//      rollback_reason). NEVER null sepidar_voucher_id — auditability rule.
//   F) Update the source entity's lifecycle (cancel transfers / allocations,
//      revert check status, etc.). Soft-delete allocations on payment-request
//      rollback so fn_finance_recalc_payment_request rebases the request.
//   G) Recompute party balances. The voucher header trigger already does
//      this on is_deleted flip; we call recompute_party_balance() explicitly
//      as a safety net (no-op when balances are already correct).
//   H) Insert immutable audit row in finance_rollback_audit.
//
// Idempotency:
//   The SP returns result_code = 2 when the voucher is already gone. We treat
//   that as success and continue Supabase cleanup so partially-failed
//   rollbacks can be retried safely.
//
// Read paths affected:
//   The audit doc (docs/sepidar/rollback_impact_audit.md) confirms every
//   balance/report path already filters `finance_vouchers.is_deleted = false`,
//   so a soft-deleted voucher disappears from balances, statements, the
//   Sepidar comparison dialog and reports automatically.
// ============================================================================

import { supabase } from "@/integrations/supabase/client";
import { getSession } from "@/lib/auth";

// ----------------------------------------------------------------------------
// UUID guard
// ----------------------------------------------------------------------------
// Several columns we write to (finance_vouchers.rollback_by,
// finance_rollback_audit.performed_by, etc.) are typed as Postgres uuid.
// In dev/legacy sessions getSession().user?.id can be a non-uuid sentinel
// like "0" — sending that to PostgREST produces:
//   invalid input syntax for type uuid: "0"
// This helper normalizes any candidate into either a valid uuid string or
// null, so callers never have to remember the rule.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function toUuidOrNull(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s || s === "0") return null;
  return UUID_RE.test(s) ? s : null;
}


// ----------------------------------------------------------------------------
// Public types
// ----------------------------------------------------------------------------

// Keep in sync with the CHECK constraint on finance_rollback_audit.entity_type.
export type RollbackEntityType =
  | "factor"
  | "payment_request"
  | "receive_identification"
  | "payment_allocation"
  | "bank_transfer"
  | "party_transfer"
  | "check";

// 'rollback' = full reversal (default), 'cancel' = soft cancel.
export type RollbackAction = "rollback" | "cancel";

// Raw response shape returned by the sepidar-rollback-voucher edge function.
//   result_code = 0  → deleted now
//   result_code = 2  → already deleted (idempotent success)
//   result_code = -1 → SP threw / rolled back
export interface SepidarRollbackResult {
  success: boolean;
  result_code: number;
  message: string;
  sepidar_voucher_id: number | null;
  rawError?: string;
  data?: Record<string, unknown>;
}

export interface RollbackFinanceOperationInput {
  entityType: RollbackEntityType;
  entityId: string;
  // Operator-provided justification — stored verbatim into rollback_reason.
  reason: string;
  action?: RollbackAction;
}

export interface RollbackFinanceOperationResult {
  ok: boolean;
  sepidarResult: SepidarRollbackResult | null;
  newStatus: string | null;
  auditId: string | null;
  error?: string;
}

// ----------------------------------------------------------------------------
// Low-level Sepidar call
// ----------------------------------------------------------------------------

/**
 * Calls the `sepidar-rollback-voucher` edge function which in turn invokes
 * the SQL Server SP `bridge.RollbackSepidarVoucher`. Returns the normalized
 * response. Does NOT touch any Supabase tables — that lives in
 * `rollbackFinanceOperation` below.
 */
export async function rollbackSepidarVoucher(args: {
  sepidarVoucherId: number;
  // FMK.ExtraData PK hint. The SP cleans by EntityRef too so this is optional.
  extraDataId?: number | null;
  // Whether to also delete RPA intent headers. Defaults to true to mirror
  // bridge.CreateBankVoucher behavior.
  deleteRpaHeaders?: boolean;
}): Promise<SepidarRollbackResult> {
  // Defensive: never call the SP with an invalid id.
  if (!args.sepidarVoucherId || args.sepidarVoucherId <= 0) {
    return {
      success: false,
      result_code: -1,
      message: "شناسه سند سپیدار نامعتبر است.",
      sepidar_voucher_id: null,
    };
  }

  const { data, error } = await supabase.functions.invoke("sepidar-rollback-voucher", {
    body: {
      sepidarVoucherId: args.sepidarVoucherId,
      extraDataId: args.extraDataId ?? null,
      deleteRpaHeaders: args.deleteRpaHeaders ?? true,
    },
  });

  if (error) {
    return {
      success: false,
      result_code: -1,
      message: error.message || "خطای ارتباط با سرویس بازگشت سند سپیدار.",
      sepidar_voucher_id: args.sepidarVoucherId,
    };
  }

  // The edge function may return an object OR an array (mssql recordset).
  // Normalize to a single row before reading flags.
  const raw = data as unknown;
  const resp = (Array.isArray(raw) ? raw[0] : raw ?? {}) as Partial<SepidarRollbackResult> & Record<string, unknown>;

  // Normalize success across truthy variants the SP / wrappers can emit:
  //   true | 1 | "1" | "true"  → success
  const rawSuccess = resp.success as unknown;
  const successNormalized =
    rawSuccess === true ||
    rawSuccess === 1 ||
    rawSuccess === "1" ||
    rawSuccess === "true";

  return {
    success: successNormalized,
    result_code: Number(resp.result_code ?? -1),
    message: String(resp.message ?? ""),
    sepidar_voucher_id: Number(resp.sepidar_voucher_id ?? args.sepidarVoucherId),
    rawError: (resp.rawError as string) || undefined,
    data: (resp.data as Record<string, unknown>) || undefined,
  };
}

/**
 * Predicate exported because every entity handler uses the same rule.
 * Accepts every documented "deleted / already-gone" code the SP can return:
 *   - result_code 0 = deleted now (legacy)
 *   - result_code 1 = deleted now (current SP)
 *   - result_code 2 = already gone (idempotent)
 * Also tolerates result_code missing when success flag is explicitly true.
 */
export function isSepidarRollbackOk(r: SepidarRollbackResult | null): boolean {
  if (!r) return true; // No voucher to roll back = trivially OK.
  if (!r.success) return false;
  const code = r.result_code;
  return code === 0 || code === 1 || code === 2 || Number.isNaN(code) || code === -1
    ? code !== -1 || r.success === true
    : false;
}


// ----------------------------------------------------------------------------
// Internal helpers
// ----------------------------------------------------------------------------

// Shape of the voucher row we need for the orchestration.
interface VoucherRow {
  id: string;
  sepidar_voucher_id: number | null;
  sepidar_extra_data_id: number | null;
  status: string | null;
  is_deleted: boolean | null;
  sepidar_status: string | null;
}

// Load a voucher row by id, or null if missing.
async function loadVoucherById(voucherId: string | null | undefined): Promise<VoucherRow | null> {
  if (!voucherId) return null;
  const { data, error } = await supabase
    .from("finance_vouchers")
    .select(
      "id, sepidar_voucher_id, sepidar_extra_data_id, status, is_deleted, sepidar_status",
    )
    .eq("id", voucherId)
    .maybeSingle();
  if (error) {
    // eslint-disable-next-line no-console
    console.error("[rollback] loadVoucherById failed", error);
    return null;
  }
  return (data as unknown as VoucherRow) ?? null;
}

// Capture the parties that a voucher touches BEFORE we soft-delete it, so we
// can call recompute_party_balance() afterwards and refresh their cached
// balances. (The DB trigger already does this on is_deleted flip — this is a
// safety net.)
async function partiesTouchedByVoucher(voucherId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("finance_voucher_items")
    .select("party_id")
    .eq("voucher_id", voucherId);
  if (error) {
    // eslint-disable-next-line no-console
    console.error("[rollback] partiesTouchedByVoucher failed", error);
    return [];
  }
  const set = new Set<string>();
  for (const row of (data as { party_id: string | null }[] | null) ?? []) {
    if (row.party_id) set.add(row.party_id);
  }
  return Array.from(set);
}

// Best-effort party balance recompute. Failures are logged but never abort
// the rollback — the DB trigger has already done the heavy lifting.
async function recomputePartyBalances(partyIds: string[]): Promise<void> {
  if (!partyIds.length) return;
  await Promise.all(
    partyIds.map(async (pid) => {
      const { error } = await supabase.rpc("recompute_party_balance", { p_party_id: pid });
      if (error) {
        // eslint-disable-next-line no-console
        console.warn("[rollback] recompute_party_balance failed", pid, error);
      }
    }),
  );
}

// Soft-delete the voucher + stamp the rollback metadata. Returns true on
// success. This is the single "void the voucher" primitive used by every
// entity handler.
async function softDeleteVoucherWithRollbackMeta(args: {
  voucherId: string;
  reason: string;
  performedBy: string | null;
  // 'rolled_back' for full reversal; 'deleted' if we ever support a destructive
  // path. We default to 'rolled_back' to preserve original Sepidar reference.
  newSepidarStatus?: "rolled_back" | "deleted" | "failed";
}): Promise<boolean> {
  const { error } = await supabase
    .from("finance_vouchers")
    .update({
      // Soft-delete is the universal "remove from balances/reports" flag —
      // every read path already filters on this (see rollback_impact_audit.md).
      is_deleted: true,
      // Rollback metadata — keeps sepidar_voucher_id intact for auditability.
      sepidar_status: args.newSepidarStatus ?? "rolled_back",
      rollback_at: new Date().toISOString(),
      // Defensive UUID guard — column is uuid, so any non-uuid sentinel
      // must collapse to null instead of triggering a 22P02 from PostgREST.
      rollback_by: toUuidOrNull(args.performedBy),
      rollback_reason: args.reason,

      // Also mark the internal voucher status so VouchersTab badges read it.
      status: "cancelled",
      updated_at: new Date().toISOString(),
    })
    .eq("id", args.voucherId);
  if (error) {
    // eslint-disable-next-line no-console
    console.error("[rollback] softDeleteVoucherWithRollbackMeta failed", error);
    return false;
  }
  return true;
}

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
  performedBy: string | null;
}

// Inserts an immutable audit row. Called ONLY after Sepidar succeeded so the
// audit log never records phantom rollbacks. Failures are logged loudly but
// never throw — the rollback itself already succeeded.
async function insertRollbackAudit(input: AuditInsertInput): Promise<string | null> {
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
        // Defensive UUID guard — performed_by is uuid in Postgres.
        performed_by: toUuidOrNull(input.performedBy),

        metadata: (input.metadata ?? {}) as never,
      },
    ])
    .select("id")
    .single();

  if (error) {
    // eslint-disable-next-line no-console
    console.error("[rollback audit] insert failed", error);
    return null;
  }
  return (data as { id: string } | null)?.id ?? null;
}

// Common error-result helper to keep handler bodies compact.
function fail(error: string, sepidarResult: SepidarRollbackResult | null = null): RollbackFinanceOperationResult {
  return { ok: false, sepidarResult, newStatus: null, auditId: null, error };
}

// ----------------------------------------------------------------------------
// Entity handlers
// ----------------------------------------------------------------------------
//
// Every handler follows the A→H contract from the file header. The handler
// returns the final RollbackFinanceOperationResult; the dispatcher just
// validates inputs and routes here.

/**
 * Factor (invoice) rollback.
 * Strategy: soft-delete the voucher; flip factors.lifecycle_state to
 * 'rolled_back'; preserve factors.sepidar_voucher_id for audit.
 */
async function rollbackFactor(
  input: RollbackFinanceOperationInput,
  performedBy: string | null,
): Promise<RollbackFinanceOperationResult> {
  // A) Load entity.
  const { data: factor, error: loadErr } = await supabase
    .from("factors")
    .select(
      "id, lifecycle_state, voucher_id, sepidar_voucher_id, sync_status, payable_amount, finance_party_id",
    )
    .eq("id", input.entityId)
    .maybeSingle();
  if (loadErr || !factor) return fail("فاکتور یافت نشد.");

  const snapshotBefore = factor;
  const oldStatus = (factor.lifecycle_state as string | null) ?? null;

  // B) Find linked voucher.
  const voucher = await loadVoucherById(factor.voucher_id as string | null);

  // C) Sepidar first — if there is a voucher with a Sepidar id, kill it.
  let sepidarResult: SepidarRollbackResult | null = null;
  if (voucher?.sepidar_voucher_id) {
    sepidarResult = await rollbackSepidarVoucher({
      sepidarVoucherId: voucher.sepidar_voucher_id,
      extraDataId: voucher.sepidar_extra_data_id,
    });
    if (!isSepidarRollbackOk(sepidarResult)) {
      return fail(
        `حذف سند سپیدار ناموفق بود: ${sepidarResult.message || "خطای ناشناخته"}`,
        sepidarResult,
      );
    }
  }

  // E) Soft-delete the voucher (and capture parties for recompute).
  const partyIds = voucher ? await partiesTouchedByVoucher(voucher.id) : [];
  if (voucher) {
    const ok = await softDeleteVoucherWithRollbackMeta({
      voucherId: voucher.id,
      reason: input.reason,
      performedBy,
    });
    if (!ok) return fail("به‌روزرسانی سند داخلی ناموفق بود.", sepidarResult);
  }

  // F) Update entity lifecycle. We do NOT clear factors.sepidar_voucher_id
  // — that is preserved per auditability rule.
  const newStatus = "rolled_back";
  const { data: afterFactor, error: updErr } = await supabase
    .from("factors")
    .update({
      lifecycle_state: newStatus,
      sync_status: "rolled_back",
      updated_at: new Date().toISOString(),
    })
    .eq("id", factor.id)
    .select()
    .maybeSingle();
  if (updErr) {
    // eslint-disable-next-line no-console
    console.error("[rollback factor] update failed", updErr);
  }

  // G) Recompute affected party balances.
  await recomputePartyBalances(partyIds);

  // H) Audit.
  const auditId = await insertRollbackAudit({
    entityType: "factor",
    entityId: factor.id,
    action: input.action ?? "rollback",
    reason: input.reason,
    oldStatus,
    newStatus,
    sepidarVoucherId: voucher?.sepidar_voucher_id ?? null,
    sepidarResult,
    snapshotBefore,
    snapshotAfter: afterFactor ?? null,
    metadata: { voucherId: voucher?.id ?? null, recomputedParties: partyIds },
    performedBy,
  });

  return { ok: true, sepidarResult, newStatus, auditId };
}

/**
 * Receive identification rollback.
 * Strategy: soft-delete the voucher; mark RI cancelled (preserve voucher_id).
 */
async function rollbackReceiveIdentification(
  input: RollbackFinanceOperationInput,
  performedBy: string | null,
): Promise<RollbackFinanceOperationResult> {
  const { data: ri, error: loadErr } = await supabase
    .from("finance_receive_identifications")
    .select("id, status, voucher_id, party_id, amount, bank_transaction_id")
    .eq("id", input.entityId)
    .maybeSingle();
  if (loadErr || !ri) return fail("شناسایی واریز یافت نشد.");

  const snapshotBefore = ri;
  const oldStatus = (ri.status as string | null) ?? null;
  const voucher = await loadVoucherById(ri.voucher_id as string | null);

  let sepidarResult: SepidarRollbackResult | null = null;
  if (voucher?.sepidar_voucher_id) {
    sepidarResult = await rollbackSepidarVoucher({
      sepidarVoucherId: voucher.sepidar_voucher_id,
      extraDataId: voucher.sepidar_extra_data_id,
    });
    if (!isSepidarRollbackOk(sepidarResult)) {
      return fail(`حذف سند سپیدار ناموفق بود: ${sepidarResult.message}`, sepidarResult);
    }
  }

  const partyIds = voucher ? await partiesTouchedByVoucher(voucher.id) : [];
  if (voucher) {
    const ok = await softDeleteVoucherWithRollbackMeta({
      voucherId: voucher.id,
      reason: input.reason,
      performedBy,
    });
    if (!ok) return fail("به‌روزرسانی سند داخلی ناموفق بود.", sepidarResult);
  }

  const newStatus = "cancelled";
  const { data: afterRi } = await supabase
    .from("finance_receive_identifications")
    .update({
      status: newStatus,
      cancelled_at: new Date().toISOString(),
      cancelled_by: performedBy,
      sepidar_sync_status: "rolled_back",
      updated_at: new Date().toISOString(),
    })
    .eq("id", ri.id)
    .select()
    .maybeSingle();

  await recomputePartyBalances(partyIds);

  const auditId = await insertRollbackAudit({
    entityType: "receive_identification",
    entityId: ri.id,
    action: input.action ?? "rollback",
    reason: input.reason,
    oldStatus,
    newStatus,
    sepidarVoucherId: voucher?.sepidar_voucher_id ?? null,
    sepidarResult,
    snapshotBefore,
    snapshotAfter: afterRi ?? null,
    metadata: { voucherId: voucher?.id ?? null, recomputedParties: partyIds },
    performedBy,
  });

  return { ok: true, sepidarResult, newStatus, auditId };
}

/**
 * Payment allocation rollback — handles a SINGLE allocation row.
 * Strategy: roll back the linked voucher, then mark the allocation cancelled
 * + is_deleted=true. The trigger `trg_finance_payment_allocations_recalc`
 * auto-reruns fn_finance_recalc_payment_request to rebase the parent request.
 */
async function rollbackPaymentAllocation(
  input: RollbackFinanceOperationInput,
  performedBy: string | null,
): Promise<RollbackFinanceOperationResult> {
  const { data: alloc, error: loadErr } = await supabase
    .from("finance_payment_allocations")
    .select(
      "id, payment_request_id, payment_request_item_id, voucher_id, status, party_id, amount, is_deleted, bank_transaction_id",
    )
    .eq("id", input.entityId)
    .maybeSingle();
  if (loadErr || !alloc) return fail("تخصیص پرداخت یافت نشد.");

  const snapshotBefore = alloc;
  const oldStatus = (alloc.status as string | null) ?? null;
  const voucher = await loadVoucherById(alloc.voucher_id as string | null);

  let sepidarResult: SepidarRollbackResult | null = null;
  if (voucher?.sepidar_voucher_id) {
    sepidarResult = await rollbackSepidarVoucher({
      sepidarVoucherId: voucher.sepidar_voucher_id,
      extraDataId: voucher.sepidar_extra_data_id,
    });
    if (!isSepidarRollbackOk(sepidarResult)) {
      return fail(`حذف سند سپیدار ناموفق بود: ${sepidarResult.message}`, sepidarResult);
    }
  }

  const partyIds = voucher ? await partiesTouchedByVoucher(voucher.id) : [];
  if (voucher) {
    const ok = await softDeleteVoucherWithRollbackMeta({
      voucherId: voucher.id,
      reason: input.reason,
      performedBy,
    });
    if (!ok) return fail("به‌روزرسانی سند داخلی ناموفق بود.", sepidarResult);
  }

  // Cancel the allocation. fn_finance_payment_allocations_recalc lives on
  // INSERT/UPDATE/DELETE so updating status here automatically recalcs the
  // parent payment_request_item + payment_request.
  const newStatus = "cancelled";
  const { data: afterAlloc } = await supabase
    .from("finance_payment_allocations")
    .update({
      status: newStatus,
      is_deleted: true,
      sepidar_sync_status: "rolled_back",
      updated_at: new Date().toISOString(),
    })
    .eq("id", alloc.id)
    .select()
    .maybeSingle();

  // ----------------------------------------------------------------------
  // STATE RECOVERY (Phase 4.1 fix): the bank transaction that was attached
  // to this allocation MUST be released back to the unassigned pool so the
  // operator can re-attach it (the "اتصال تراکنش" / connect-transaction
  // button only appears when assignment_status='unassigned'). Without this
  // the rollback leaves an orphan link: allocation is cancelled but the
  // bank tx still points at it and is invisible in selectors.
  //
  // Idempotency rules:
  //   • Use scoped equality (.eq on assigned_operation_type/id) so we only
  //     release the row when it's STILL pointing at this allocation. If the
  //     operator has manually re-routed the tx in the meantime we leave it.
  //   • Run even when the allocation was already cancelled — the rollback
  //     "resume" path must still restore the tx (per user spec).
  //   • Errors are logged but do not abort the rollback — the voucher and
  //     allocation are already cancelled and the operator can re-trigger
  //     the resume to retry the tx release.
  // ----------------------------------------------------------------------
  const releasedBankTxIds: string[] = [];
  let bankTxRepaired = false;
  if (alloc.bank_transaction_id) {
    const bankTxId = alloc.bank_transaction_id as string;
    // Inspect current state so we can record whether this was an in-flight
    // rollback (state was still attached) or a resume repair (state was
    // already inconsistent).
    const { data: btBefore } = await supabase
      .from("finance_bank_transactions")
      .select("id, assignment_status, assigned_operation_type, assigned_operation_id")
      .eq("id", bankTxId)
      .maybeSingle();

    const stillLinked =
      btBefore?.assigned_operation_type === "payment_allocation" &&
      btBefore?.assigned_operation_id === alloc.id;

    if (stillLinked) {
      const { error: btErr } = await supabase
        .from("finance_bank_transactions")
        .update({
          assignment_status: "unassigned",
          assigned_operation_type: null,
          assigned_operation_id: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", bankTxId)
        // Defensive scope — only release if it still points here. Prevents
        // accidentally unassigning a tx the operator re-routed mid-flow.
        .eq("assigned_operation_type", "payment_allocation")
        .eq("assigned_operation_id", alloc.id);
      if (btErr) {
        // eslint-disable-next-line no-console
        console.error("[rollback payment_allocation] bank tx release failed", btErr);
      } else {
        releasedBankTxIds.push(bankTxId);
        // If the allocation was ALREADY cancelled before this run (i.e. a
        // resume), the tx release is technically a "repair" — flag it so
        // the audit row records the recovery action.
        if (alloc.is_deleted || oldStatus === "cancelled") bankTxRepaired = true;
      }
    }
  }

  // Belt-and-suspenders: explicitly recalc the request too. This is what
  // flips payment_status back from 'paid' / 'partially_paid' to a state
  // that re-enables the "connect transaction" button on the request row.
  if (alloc.payment_request_id) {
    await supabase.rpc("fn_finance_recalc_payment_request", {
      p_request_id: alloc.payment_request_id as string,
    });
  }

  await recomputePartyBalances(partyIds);

  const auditId = await insertRollbackAudit({
    entityType: "payment_allocation",
    entityId: alloc.id,
    // If we only performed the bank-tx repair (allocation was already
    // cancelled coming in), label this run as 'rollback_repair' in the
    // audit metadata so operators can distinguish resume runs from first
    // rollbacks. The DB column `action` remains 'rollback'/'cancel' per
    // the CHECK constraint; the repair flag lives in metadata.
    action: input.action ?? "rollback",
    reason: input.reason,
    oldStatus,
    newStatus,
    sepidarVoucherId: voucher?.sepidar_voucher_id ?? null,
    sepidarResult,
    snapshotBefore,
    snapshotAfter: afterAlloc ?? null,
    metadata: {
      voucherId: voucher?.id ?? null,
      paymentRequestId: alloc.payment_request_id,
      recomputedParties: partyIds,
      releasedBankTxIds,
      // Marker used by the future audit viewer to badge "repair" runs.
      repairAction: bankTxRepaired ? "rollback_repair" : null,
    },
    performedBy,
  });

  return { ok: true, sepidarResult, newStatus, auditId };
}

/**
 * Payment request rollback — cancels ALL live allocations under the request
 * and rolls back each allocation's voucher in turn. Then marks the request
 * itself as cancelled. We do NOT short-circuit on the first failure — once a
 * Sepidar deletion fails we abort to avoid drift.
 */
async function rollbackPaymentRequest(
  input: RollbackFinanceOperationInput,
  performedBy: string | null,
): Promise<RollbackFinanceOperationResult> {
  const { data: pr, error: loadErr } = await supabase
    .from("finance_payment_requests")
    .select(
      "id, status, total_amount, total_paid_amount, payment_status, is_deleted",
    )
    .eq("id", input.entityId)
    .maybeSingle();
  if (loadErr || !pr) return fail("درخواست پرداخت یافت نشد.");
  if (pr.is_deleted) return fail("این درخواست قبلاً حذف شده است.");

  const snapshotBefore = pr;
  const oldStatus = (pr.status as string | null) ?? null;

  // Load every live allocation for this request.
  const { data: allocs, error: allocErr } = await supabase
    .from("finance_payment_allocations")
    .select("id, voucher_id, status, is_deleted")
    .eq("payment_request_id", pr.id)
    .neq("status", "cancelled")
    .eq("is_deleted", false);
  if (allocErr) return fail("بارگذاری تخصیص‌ها ناموفق بود.");

  const sepidarResults: SepidarRollbackResult[] = [];
  const cancelledAllocIds: string[] = [];

  // Roll back each allocation independently. We bail on first failure to
  // avoid partial drift; the operator can retry (the SP is idempotent).
  for (const alloc of (allocs as { id: string; voucher_id: string | null }[]) ?? []) {
    const res = await rollbackPaymentAllocation(
      { entityType: "payment_allocation", entityId: alloc.id, reason: input.reason, action: "rollback" },
      performedBy,
    );
    if (res.sepidarResult) sepidarResults.push(res.sepidarResult);
    if (!res.ok) {
      return fail(
        `بازگشت یکی از تخصیص‌ها ناموفق بود (${alloc.id}): ${res.error ?? ""}`,
        res.sepidarResult,
      );
    }
    cancelledAllocIds.push(alloc.id);
  }

  // Mark the request itself as cancelled.
  const newStatus = "cancelled";
  const { data: afterPr } = await supabase
    .from("finance_payment_requests")
    .update({
      status: newStatus,
      updated_at: new Date().toISOString(),
    })
    .eq("id", pr.id)
    .select()
    .maybeSingle();

  // Explicit recalc — the trigger has already done it per allocation, but
  // this guarantees the request totals are clean post-cancellation.
  await supabase.rpc("fn_finance_recalc_payment_request", { p_request_id: pr.id });

  // We did not call the Sepidar SP for the request itself (it never has a
  // voucher of its own). The audit row records the aggregate of allocation
  // results so the operator can drill down.
  const auditId = await insertRollbackAudit({
    entityType: "payment_request",
    entityId: pr.id,
    action: input.action ?? "rollback",
    reason: input.reason,
    oldStatus,
    newStatus,
    sepidarVoucherId: null,
    sepidarResult: null,
    snapshotBefore,
    snapshotAfter: afterPr ?? null,
    metadata: {
      cancelledAllocations: cancelledAllocIds,
      sepidarResults,
    },
    performedBy,
  });

  return { ok: true, sepidarResult: null, newStatus, auditId };
}

/**
 * Bank transfer rollback. Soft-delete voucher; mark transfer cancelled.
 * We intentionally do NOT touch finance_bank_transactions: the bank import is
 * the source of truth for what really hit the account. The matched txs simply
 * become "unmatched" once the transfer is cancelled (read paths already
 * respect is_deleted on the transfer).
 */
async function rollbackBankTransfer(
  input: RollbackFinanceOperationInput,
  performedBy: string | null,
): Promise<RollbackFinanceOperationResult> {
  const { data: bt, error: loadErr } = await supabase
    .from("finance_bank_transfers")
    .select("id, status, voucher_id, from_amount, to_amount, is_deleted")
    .eq("id", input.entityId)
    .maybeSingle();
  if (loadErr || !bt) return fail("انتقال بین‌بانکی یافت نشد.");

  const snapshotBefore = bt;
  const oldStatus = (bt.status as string | null) ?? null;
  const voucher = await loadVoucherById(bt.voucher_id as string | null);

  let sepidarResult: SepidarRollbackResult | null = null;
  if (voucher?.sepidar_voucher_id) {
    sepidarResult = await rollbackSepidarVoucher({
      sepidarVoucherId: voucher.sepidar_voucher_id,
      extraDataId: voucher.sepidar_extra_data_id,
    });
    if (!isSepidarRollbackOk(sepidarResult)) {
      return fail(`حذف سند سپیدار ناموفق بود: ${sepidarResult.message}`, sepidarResult);
    }
  }

  const partyIds = voucher ? await partiesTouchedByVoucher(voucher.id) : [];
  if (voucher) {
    const ok = await softDeleteVoucherWithRollbackMeta({
      voucherId: voucher.id,
      reason: input.reason,
      performedBy,
    });
    if (!ok) return fail("به‌روزرسانی سند داخلی ناموفق بود.", sepidarResult);
  }

  const newStatus = "cancelled";
  const { data: afterBt } = await supabase
    .from("finance_bank_transfers")
    .update({
      status: newStatus,
      is_deleted: true,
      updated_at: new Date().toISOString(),
    })
    .eq("id", bt.id)
    .select()
    .maybeSingle();

  await recomputePartyBalances(partyIds);

  const auditId = await insertRollbackAudit({
    entityType: "bank_transfer",
    entityId: bt.id,
    action: input.action ?? "rollback",
    reason: input.reason,
    oldStatus,
    newStatus,
    sepidarVoucherId: voucher?.sepidar_voucher_id ?? null,
    sepidarResult,
    snapshotBefore,
    snapshotAfter: afterBt ?? null,
    metadata: { voucherId: voucher?.id ?? null, recomputedParties: partyIds },
    performedBy,
  });

  return { ok: true, sepidarResult, newStatus, auditId };
}

/**
 * Party transfer rollback. Same shape as bank transfer.
 */
async function rollbackPartyTransfer(
  input: RollbackFinanceOperationInput,
  performedBy: string | null,
): Promise<RollbackFinanceOperationResult> {
  const { data: pt, error: loadErr } = await supabase
    .from("finance_party_transfers")
    .select("id, status, voucher_id, amount, from_party_id, to_party_id, is_deleted")
    .eq("id", input.entityId)
    .maybeSingle();
  if (loadErr || !pt) return fail("انتقال بین ذینفعان یافت نشد.");

  const snapshotBefore = pt;
  const oldStatus = (pt.status as string | null) ?? null;
  const voucher = await loadVoucherById(pt.voucher_id as string | null);

  let sepidarResult: SepidarRollbackResult | null = null;
  if (voucher?.sepidar_voucher_id) {
    sepidarResult = await rollbackSepidarVoucher({
      sepidarVoucherId: voucher.sepidar_voucher_id,
      extraDataId: voucher.sepidar_extra_data_id,
    });
    if (!isSepidarRollbackOk(sepidarResult)) {
      return fail(`حذف سند سپیدار ناموفق بود: ${sepidarResult.message}`, sepidarResult);
    }
  }

  // Pull parties from the voucher items AND fall back to the transfer's own
  // from/to so a partyless voucher (rare) still recomputes correctly.
  const partyIdSet = new Set<string>();
  if (voucher) (await partiesTouchedByVoucher(voucher.id)).forEach((p) => partyIdSet.add(p));
  if (pt.from_party_id) partyIdSet.add(pt.from_party_id as string);
  if (pt.to_party_id) partyIdSet.add(pt.to_party_id as string);
  const partyIds = Array.from(partyIdSet);

  if (voucher) {
    const ok = await softDeleteVoucherWithRollbackMeta({
      voucherId: voucher.id,
      reason: input.reason,
      performedBy,
    });
    if (!ok) return fail("به‌روزرسانی سند داخلی ناموفق بود.", sepidarResult);
  }

  const newStatus = "cancelled";
  const { data: afterPt } = await supabase
    .from("finance_party_transfers")
    .update({
      status: newStatus,
      is_deleted: true,
      updated_at: new Date().toISOString(),
    })
    .eq("id", pt.id)
    .select()
    .maybeSingle();

  await recomputePartyBalances(partyIds);

  const auditId = await insertRollbackAudit({
    entityType: "party_transfer",
    entityId: pt.id,
    action: input.action ?? "rollback",
    reason: input.reason,
    oldStatus,
    newStatus,
    sepidarVoucherId: voucher?.sepidar_voucher_id ?? null,
    sepidarResult,
    snapshotBefore,
    snapshotAfter: afterPt ?? null,
    metadata: { voucherId: voucher?.id ?? null, recomputedParties: partyIds },
    performedBy,
  });

  return { ok: true, sepidarResult, newStatus, auditId };
}

/**
 * Check rollback (V1 — registered & delivered only).
 *
 * "registered" in our terminology means the check was created with no party
 * effect yet (status in {received, issued, in_cashbox}).
 * "delivered" means the check is in state {delivered, transferred_to_party,
 * deposited_to_bank} — a party/bank effect has been posted to Sepidar via
 * fn_finance_check_post_voucher, and finance_checks.voucher_id is non-null.
 *
 * Strategy:
 *   - If a voucher exists, soft-delete it (Sepidar SP first).
 *   - Set check.status = 'cancelled' + cancelled_date + cancel_reason.
 *   - Append a finance_check_events row so the timeline reflects the void.
 *
 * V1 explicitly excludes cleared / bounced checks — those need a different
 * reversal flow and will be added in V2.
 */
async function rollbackCheck(
  input: RollbackFinanceOperationInput,
  performedBy: string | null,
): Promise<RollbackFinanceOperationResult> {
  const { data: chk, error: loadErr } = await supabase
    .from("finance_checks")
    .select(
      "id, status, direction, voucher_id, party_id, bank_id, amount, check_number, party_effected_at, bank_effected_at",
    )
    .eq("id", input.entityId)
    .maybeSingle();
  if (loadErr || !chk) return fail("چک یافت نشد.");

  const snapshotBefore = chk;
  const oldStatus = (chk.status as string | null) ?? null;

  // V1 guard: only registered + delivered states are rollback-eligible.
  const allowedStates = new Set([
    "received",
    "issued",
    "in_cashbox",
    "delivered",
    "transferred_to_party",
    "deposited_to_bank",
  ]);
  if (!oldStatus || !allowedStates.has(oldStatus)) {
    return fail(
      `بازگشت چک در وضعیت «${oldStatus ?? "نامشخص"}» در نسخه فعلی پشتیبانی نمی‌شود.`,
    );
  }

  const voucher = await loadVoucherById(chk.voucher_id as string | null);

  let sepidarResult: SepidarRollbackResult | null = null;
  if (voucher?.sepidar_voucher_id) {
    sepidarResult = await rollbackSepidarVoucher({
      sepidarVoucherId: voucher.sepidar_voucher_id,
      extraDataId: voucher.sepidar_extra_data_id,
    });
    if (!isSepidarRollbackOk(sepidarResult)) {
      return fail(`حذف سند سپیدار ناموفق بود: ${sepidarResult.message}`, sepidarResult);
    }
  }

  const partyIds = voucher ? await partiesTouchedByVoucher(voucher.id) : [];
  if (voucher) {
    const ok = await softDeleteVoucherWithRollbackMeta({
      voucherId: voucher.id,
      reason: input.reason,
      performedBy,
    });
    if (!ok) return fail("به‌روزرسانی سند داخلی ناموفق بود.", sepidarResult);
  }

  const newStatus = "cancelled";
  const { data: afterChk } = await supabase
    .from("finance_checks")
    .update({
      status: newStatus,
      cancelled_date: new Date().toISOString().slice(0, 10),
      cancel_reason: input.reason,
      updated_at: new Date().toISOString(),
    })
    .eq("id", chk.id)
    .select()
    .maybeSingle();

  // Append a timeline event (best-effort — schema may vary, log on failure).
  try {
    await supabase.from("finance_check_events").insert([
      {
        check_id: chk.id,
        event_type: "cancelled",
        event_date: new Date().toISOString(),
        description: `بازگشت چک: ${input.reason}`,
        created_by: performedBy,
      },
    ]);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("[rollback check] event insert failed", e);
  }

  await recomputePartyBalances(partyIds);

  const auditId = await insertRollbackAudit({
    entityType: "check",
    entityId: chk.id,
    action: input.action ?? "rollback",
    reason: input.reason,
    oldStatus,
    newStatus,
    sepidarVoucherId: voucher?.sepidar_voucher_id ?? null,
    sepidarResult,
    snapshotBefore,
    snapshotAfter: afterChk ?? null,
    metadata: { voucherId: voucher?.id ?? null, recomputedParties: partyIds },
    performedBy,
  });

  return { ok: true, sepidarResult, newStatus, auditId };
}

// ----------------------------------------------------------------------------
// Central orchestrator
// ----------------------------------------------------------------------------

/**
 * Dispatches rollback to the appropriate entity handler. UI code should
 * always call THIS function and never the individual handlers — keeps the
 * authorization / validation path centralized.
 */
export async function rollbackFinanceOperation(
  input: RollbackFinanceOperationInput,
): Promise<RollbackFinanceOperationResult> {
  // ---- Basic validation ----------------------------------------------------
  if (!input.entityId) return fail("شناسه موجودیت الزامی است.");
  if (!input.reason || input.reason.trim().length < 3) {
    return fail("ذکر دلیل بازگشت سند الزامی است.");
  }

  // Resolve operator from the API-based session (not auth.users — we use a
  // custom app_users table). This becomes rollback_by + performed_by.
  // Guard against non-uuid sentinels (e.g. dev mode "0") that would explode
  // PostgREST when written to uuid columns. toUuidOrNull → null fallback.
  const performedBy = toUuidOrNull(getSession().user?.id);


  // ---- Dispatch ------------------------------------------------------------
  switch (input.entityType) {
    case "factor":
      return rollbackFactor(input, performedBy);
    case "receive_identification":
      return rollbackReceiveIdentification(input, performedBy);
    case "payment_allocation":
      return rollbackPaymentAllocation(input, performedBy);
    case "payment_request":
      return rollbackPaymentRequest(input, performedBy);
    case "bank_transfer":
      return rollbackBankTransfer(input, performedBy);
    case "party_transfer":
      return rollbackPartyTransfer(input, performedBy);
    case "check":
      return rollbackCheck(input, performedBy);
    default:
      return fail(`نوع موجودیت ناشناخته: ${String(input.entityType)}`);
  }
}

// ----------------------------------------------------------------------------
// Re-exports for tests / future UI work.
// ----------------------------------------------------------------------------
export const __internal = {
  insertRollbackAudit,
  softDeleteVoucherWithRollbackMeta,
  partiesTouchedByVoucher,
  recomputePartyBalances,
  loadVoucherById,
};
