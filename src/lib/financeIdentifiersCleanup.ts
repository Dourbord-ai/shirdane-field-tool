// ============================================================================
// Cleanup helper for finance_bank_tx_identifiers rows.
//
// Use this to wipe stale/bad identifier rows so the auto-process pipeline
// re-extracts from scratch on the next run. The reuse path (see
// autoProcessUnassigned.tryBeneficiaryDeposit) will skip extraction whenever
// identifier rows already exist; deleting them is the explicit "force
// re-extraction" lever.
//
// Exposed on window for quick console usage:
//   window.financeResetIdentifiers(["<txId>", ...])
//   window.financeResetIdentifiers()  // no-arg = explicit no-op for safety
// ============================================================================

import { supabase } from "@/integrations/supabase/client";

// Delete identifier rows for the provided bank-transaction ids. Returns the
// number of ids requested + any error encountered. We intentionally require
// an explicit list of ids — there is NO "delete all" path, because that
// would nuke history for the whole tenant.
export async function resetIdentifiersForTransactions(
  bankTransactionIds: string[],
): Promise<{ requested: number; ok: boolean; error?: string }> {
  // Guard: empty/invalid input is a no-op. We never accept "all".
  if (!Array.isArray(bankTransactionIds) || bankTransactionIds.length === 0) {
    // eslint-disable-next-line no-console
    console.warn(
      "[AutoProcess] resetIdentifiers: no ids provided — refusing to act",
    );
    return { requested: 0, ok: false, error: "no ids provided" };
  }

  // eslint-disable-next-line no-console
  console.log("[AutoProcess] resetIdentifiers: deleting rows", {
    bankTransactionIds,
    count: bankTransactionIds.length,
  });

  const { error } = await supabase
    .from("finance_bank_tx_identifiers")
    .delete()
    .in("bank_transaction_id", bankTransactionIds);

  if (error) {
    // eslint-disable-next-line no-console
    console.error("[AutoProcess] resetIdentifiers: delete failed", error);
    return { requested: bankTransactionIds.length, ok: false, error: error.message };
  }

  // eslint-disable-next-line no-console
  console.log("[AutoProcess] resetIdentifiers: done", {
    requested: bankTransactionIds.length,
  });
  return { requested: bankTransactionIds.length, ok: true };
}

// Register a window helper so operators can call it directly from DevTools
// without importing anything. Mirrors the financeAutoProcessDebug pattern.
if (typeof window !== "undefined") {
  const w = window as unknown as {
    financeResetIdentifiers?: (ids?: string[]) => Promise<unknown>;
  };
  w.financeResetIdentifiers = (ids?: string[]) =>
    resetIdentifiersForTransactions(ids ?? []);
}
