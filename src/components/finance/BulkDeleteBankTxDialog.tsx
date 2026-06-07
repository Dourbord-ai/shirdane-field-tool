// ============================================================================
// BulkDeleteBankTxDialog
// ----------------------------------------------------------------------------
// Safe bulk soft-delete of bank transactions. Receives the FULL selected set
// (may include locked / assigned / legacy rows) and:
//
//   1) Classifies each row client-side into:
//        - deletable        → truly free (unassigned, no operation link, or
//                             only the harmless `bank_fee_candidate` marker)
//        - locked           → assigned / in-flight / has an operation link
//        - legacyLocked     → assigned BUT operation type+id are NULL — the
//                             legacy state called out in the RCA. Cannot be
//                             rolled back automatically.
//
//   2) Forces the operator to type a reason (≥ 3 chars). Reason is also
//      enforced server-side inside fn_finance_bulk_delete_bank_transactions.
//
//   3) Calls the SECURITY DEFINER RPC which re-locks each row, re-checks
//      eligibility, writes an audit row, and soft-deletes. The frontend
//      classification is purely UX — server is the source of truth.
//
//   4) Reports back deleted[] / blocked[] counts via toast and triggers the
//      parent's onDone (refetch + recalc bank KPI balances).
//
// Why client-side classification at all:
//   The operator must see, before confirming, exactly which rows will be
//   touched. Without it the spec's "نمایش تعداد قابل حذف / قفل‌شده" is not
//   possible. The server still has the final say.
// ============================================================================

import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { recalculateBankUnassignedBalances } from "@/lib/finance";
import { getSession } from "@/lib/auth";

// Minimal shape — caller already has full Tx objects but we only need these
// fields for classification + display.
export interface BulkDeleteTx {
  id: string;
  bank_id: string | null;
  transaction_type: string | null;
  deposit_amount: number | null;
  withdraw_amount: number | null;
  description: string | null;
  document_number: string | null;
  assignment_status: string | null;
  assigned_operation_type: string | null;
  assigned_operation_id: string | null;
}

interface Props {
  transactions: BulkDeleteTx[];
  onClose: () => void;
  onDone: () => void;
}

type Category = "deletable" | "locked" | "legacyLocked";

// Persian-friendly lookup for blocked categories shown in the table.
function categorize(t: BulkDeleteTx): Category {
  const status = t.assignment_status ?? "";
  const type = t.assigned_operation_type ?? null;
  const opId = t.assigned_operation_id ?? null;

  // Truly free: unassigned + no operation link. We tolerate the
  // `bank_fee_candidate` marker because it's a classification hint, not an
  // actual financial linkage — mirrored in the server-side RPC.
  if (
    status === "unassigned" &&
    !opId &&
    (!type || type === "bank_fee_candidate")
  ) {
    return "deletable";
  }

  // Legacy locked: assigned but operation metadata missing → cannot be
  // rolled back automatically. Spec requires a distinct message.
  if (status === "assigned" && !type && !opId) return "legacyLocked";

  // Everything else (assigning, assigned-with-op, any other state) is a
  // normal lock — operator must rollback the linked operation first.
  return "locked";
}

// RPC payload typing — matches jsonb_build_object output of
// fn_finance_bulk_delete_bank_transactions.
interface RpcResult {
  deleted: string[];
  blocked: Array<{
    id: string;
    reason: string;
    assignment_status?: string | null;
    assigned_operation_type?: string | null;
    assigned_operation_id?: string | null;
  }>;
  bank_ids: string[];
}

export default function BulkDeleteBankTxDialog({ transactions, onClose, onDone }: Props) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  // Pre-compute the three buckets once per render. transactions is small
  // (UI-bound selection) so a useMemo is plenty.
  const buckets = useMemo(() => {
    const deletable: BulkDeleteTx[] = [];
    const locked: BulkDeleteTx[] = [];
    const legacyLocked: BulkDeleteTx[] = [];
    for (const t of transactions) {
      const c = categorize(t);
      if (c === "deletable") deletable.push(t);
      else if (c === "legacyLocked") legacyLocked.push(t);
      else locked.push(t);
    }
    return { deletable, locked, legacyLocked };
  }, [transactions]);

  // The user-typed reason is locally validated for instant feedback. The
  // server enforces the same rule, so this is just UX polish.
  const reasonOk = reason.trim().length >= 3;
  const canSubmit = !busy && reasonOk && buckets.deletable.length > 0;

  async function handleConfirm() {
    if (!canSubmit) return;
    setBusy(true);
    try {
      // The session user may not have a UUID id (legacy localStorage auth).
      // Server accepts NULL p_actor — audit row will simply have deleted_by
      // = NULL. We pass the id if present so audits are attributable.
      const { user } = getSession();
      const actor =
        user && /^[0-9a-fA-F-]{36}$/.test(user.id) ? user.id : null;

      const ids = buckets.deletable.map((t) => t.id);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.rpc as any)(
        "fn_finance_bulk_delete_bank_transactions",
        { p_ids: ids, p_actor: actor, p_reason: reason.trim() }
      );
      if (error) throw error;

      const res = (data ?? {}) as RpcResult;
      const deletedCount = res.deleted?.length ?? 0;
      const blockedCount = res.blocked?.length ?? 0;

      // Refresh KPI: unassigned-balance is derived from is_deleted=false
      // rows per bank, so every affected bank must be recomputed.
      const bankIds = res.bank_ids ?? [];
      await Promise.all(
        bankIds.map((bid) => recalculateBankUnassignedBalances(bid)),
      );

      if (deletedCount > 0 && blockedCount === 0) {
        toast.success(`حذف ${deletedCount} تراکنش با موفقیت انجام شد.`);
      } else if (deletedCount > 0 && blockedCount > 0) {
        toast.warning(
          `${deletedCount} حذف شد، ${blockedCount} مورد به‌دلیل تخصیص قفل بود و نادیده گرفته شد.`,
        );
      } else {
        toast.error("هیچ تراکنشی حذف نشد. همه‌ی موارد قفل بودند.");
      }

      onDone();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "خطای ناشناخته در حذف جمعی";
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-2xl" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <Trash2 className="w-5 h-5" />
            حذف جمعی تراکنش‌های بانکی
          </DialogTitle>
          <DialogDescription>
            حذف فقط برای تراکنش‌های تخصیص‌نشده انجام می‌شود. موارد قفل‌شده
            باید ابتدا به‌صورت موردی آزادسازی (rollback) شوند.
          </DialogDescription>
        </DialogHeader>

        {/* Summary chips — instant visual feedback. */}
        <div className="grid grid-cols-3 gap-2 text-xs">
          <SummaryChip
            label="قابل حذف"
            value={buckets.deletable.length}
            tone="ok"
          />
          <SummaryChip
            label="قفل‌شده (تخصیص فعال)"
            value={buckets.locked.length}
            tone="warn"
          />
          <SummaryChip
            label="Legacy قفل‌شده"
            value={buckets.legacyLocked.length}
            tone="warn"
          />
        </div>

        {/* Legacy-locked notice. Only rendered when relevant to keep the UI
            uncluttered. Wording matches the spec verbatim. */}
        {buckets.legacyLocked.length > 0 && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive flex gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              این تراکنش دارای تخصیص قدیمی است اما نوع عملیات مشخص نیست. حذف
              یا آزادسازی خودکار امکان‌پذیر نیست.
            </div>
          </div>
        )}

        {/* Blocked list — collapsible-feel via max-height. Lets the operator
            see exactly which rows are skipped so they can act on them later
            via the per-row rollback flow. */}
        {(buckets.locked.length > 0 || buckets.legacyLocked.length > 0) && (
          <div className="rounded-lg border bg-muted/30 max-h-48 overflow-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/60 sticky top-0">
                <tr className="text-right">
                  <th className="p-2">دلیل قفل</th>
                  <th className="p-2">وضعیت</th>
                  <th className="p-2">نوع عملیات</th>
                  <th className="p-2">شرح</th>
                </tr>
              </thead>
              <tbody>
                {[...buckets.locked, ...buckets.legacyLocked].map((t) => {
                  const cat = categorize(t);
                  return (
                    <tr key={t.id} className="border-t">
                      <td className="p-2">
                        {cat === "legacyLocked" ? "Legacy" : "تخصیص فعال"}
                      </td>
                      <td className="p-2">{t.assignment_status ?? "—"}</td>
                      <td className="p-2">
                        {t.assigned_operation_type ?? "—"}
                      </td>
                      <td className="p-2 truncate max-w-[260px]">
                        {t.description ?? "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Reason input — mandatory and server-enforced. */}
        <div className="space-y-1.5">
          <Label htmlFor="bulk-del-reason" className="text-xs">
            دلیل حذف (الزامی، حداقل ۳ کاراکتر)
          </Label>
          <Textarea
            id="bulk-del-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="مثلاً «تراکنش‌های آزمایشی import شده، حذف می‌شوند»"
            rows={3}
            disabled={busy}
            autoFocus
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            انصراف
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!canSubmit}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {busy && <Loader2 className="w-4 h-4 animate-spin ml-1" />}
            تایید حذف {buckets.deletable.length} تراکنش
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SummaryChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "ok" | "warn";
}) {
  // Two-tone palette using semantic tokens so the dialog respects the dark
  // theme. `ok` uses primary (agricultural green from the design system),
  // `warn` uses the destructive ramp for visual continuity with the spec's
  // warning panels.
  const cls =
    tone === "ok"
      ? "border-primary/30 bg-primary/10 text-primary"
      : "border-destructive/30 bg-destructive/10 text-destructive";
  return (
    <div className={`rounded-lg border p-2 text-center ${cls}`}>
      <div className="text-[10px] opacity-80">{label}</div>
      <div className="text-base font-bold">{value.toLocaleString("fa-IR")}</div>
    </div>
  );
}
