// =============================================================================
// EditItemAmountDialog
// =============================================================================
// Allows the operator to safely edit the amount of a payment-request item.
//
// The financial guard is enforced server-side by the RPC
// `fn_finance_update_payment_request_item_amount`, which:
//   • locks the item + request row,
//   • re-computes `paid_amount` from active allocations,
//   • rejects new_amount < paid_amount,
//   • updates both `amount` and `confirmed_amount`,
//   • runs the existing recalc functions for the item and the request,
//   • writes an immutable row into `finance_payment_item_amount_audit`.
//
// We mirror the most important checks client-side (status whitelist + min
// amount) ONLY to give immediate feedback. The RPC remains the single source
// of truth — any client guard could be bypassed by a hand-crafted request,
// which is exactly why the RPC re-validates everything inside a transaction.
// =============================================================================

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { formatMoney, parseMoney } from "@/lib/finance";
import { toastFinanceError } from "@/lib/financeErrors";
import { toast } from "sonner";
import { AlertTriangle, Save } from "lucide-react";

// Subset of the item shape we need. Importing the full PRItemFull would
// create a cyclic dependency with PaymentRequestsTab, so we redefine the
// narrow contract here.
export interface EditableItem {
  id: string;
  amount: number;
  confirmed_amount: number | null;
  paid_amount: number | null;
  status: string | null;
}

// Whitelist that mirrors the RPC. We keep this here so the button can decide
// when to render at all. Keep in sync with the SQL function.
//   - approved / partially_paid / sync_failed → free edit (≥ paid_amount)
//   - paid → only allowed when the new amount strictly increases above paid
export const EDITABLE_ITEM_STATUSES = new Set([
  "approved",
  "partially_paid",
  "sync_failed",
  "paid",
]);

// Mirrors the RPC guard on the parent request.status. A request that is
// cancelled / rejected / closed cannot have any item amount edited.
export const LOCKED_REQUEST_STATUSES = new Set([
  "cancelled",
  "rejected",
  "closed",
]);

export function canEditItemAmount(itemStatus: string | null | undefined, requestStatus: string | null | undefined): boolean {
  if (!itemStatus) return false;
  if (!EDITABLE_ITEM_STATUSES.has(itemStatus)) return false;
  if (requestStatus && LOCKED_REQUEST_STATUSES.has(requestStatus)) return false;
  return true;
}

interface Props {
  item: EditableItem;
  // Parent request status — used only for an extra client-side guard message.
  requestStatus?: string | null;
  onClose: () => void;
  // Called only after a successful update; parent reloads the items + header.
  onSaved: () => void | Promise<void>;
}

export default function EditItemAmountDialog({ item, requestStatus, onClose, onSaved }: Props) {
  // Authoritative "paid amount" cached on the row. The RPC re-derives this
  // value from `finance_payment_allocations`, but for the UI hint the cached
  // column is fine and is updated by the existing recalc trigger.
  const paidAmount = Math.max(0, Number(item.paid_amount || 0));

  // Pre-fill with the current effective amount the recalc function uses,
  // i.e. confirmed_amount when > 0, else amount. This matches what the user
  // sees in the row.
  const currentAmount = Number(item.confirmed_amount || 0) > 0
    ? Number(item.confirmed_amount)
    : Number(item.amount || 0);

  // The numeric value the user is typing. We store a number (not a string)
  // because `parseMoney` already normalises Persian digits / separators.
  const [newAmount, setNewAmount] = useState<number>(currentAmount);
  const [reason, setReason] = useState<string>("");
  const [busy, setBusy] = useState(false);

  // Re-seed inputs if the parent passes a different item (defensive).
  useEffect(() => {
    setNewAmount(currentAmount);
    setReason("");
  }, [item.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Compute the minimum acceptable value the UI should display. For a "paid"
  // item the RPC requires a STRICT increase, so the minimum hint is
  // paid_amount + 1 ریال (the actual comparison uses an epsilon).
  const isPaidOnly = item.status === "paid";
  const minAllowed = isPaidOnly ? paidAmount + 1 : paidAmount;

  // Client-side violation flags drive inline hints + disable Save. The RPC
  // still re-validates everything before committing.
  const belowPaid = newAmount + 1e-6 < paidAmount;
  const paidNeedsIncrease = isPaidOnly && newAmount <= paidAmount + 1e-6;
  const invalidPositive = !newAmount || newAmount <= 0;
  const blocked = invalidPositive || belowPaid || paidNeedsIncrease;

  async function submit() {
    if (busy || blocked) return;
    setBusy(true);
    try {
      // Call the SECURITY DEFINER RPC. We pass `null` for reason when blank
      // so the audit row stores NULL rather than an empty string.
      const { data, error } = await supabase.rpc(
        "fn_finance_update_payment_request_item_amount",
        {
          p_item_id: item.id,
          p_new_amount: newAmount,
          p_reason: reason.trim() || null,
        }
      );
      if (error) {
        // The RPC raises Persian messages already (after the `:` prefix in
        // the code tag). Strip the prefix so the toast shows clean text.
        const raw = error.message || "";
        const cleaned = raw.replace(/^[A-Z_]+:\s*/i, "");
        toast.error("ویرایش انجام نشد", { description: cleaned || raw });
        return;
      }
      toast.success("مبلغ آیتم با موفقیت ویرایش شد");
      // Surface the new server-side values to the parent. The parent reloads
      // its own queries; we don't have to pipe `data` through.
      void data;
      await onSaved();
      onClose();
    } catch (e: unknown) {
      // Network / unexpected errors → use the central finance error toast.
      toastFinanceError(toast, e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle>ویرایش مبلغ آیتم درخواست تسویه</DialogTitle>
          <DialogDescription>
            مبلغ جدید پس از ثبت، باعث بازمحاسبه وضعیت آیتم و درخواست خواهد شد.
            هیچ پرداخت یا تخصیص قبلی تغییر یا حذف نمی‌شود.
          </DialogDescription>
        </DialogHeader>

        {/* Snapshot panel — gives the user the context needed to choose a new
            value: the current effective amount, the cached paid_amount, and
            the minimum acceptable value (paid_amount, or paid_amount+1 for
            paid items where a strict increase is required). */}
        <div className="rounded-lg bg-muted/40 border p-3 grid grid-cols-2 gap-2 text-xs">
          <div className="flex justify-between">
            <span className="text-muted-foreground">مبلغ فعلی</span>
            <span className="font-bold">{formatMoney(currentAmount)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">پرداخت‌شده</span>
            <span className="font-bold">{formatMoney(paidAmount)}</span>
          </div>
          <div className="flex justify-between col-span-2">
            <span className="text-muted-foreground">حداقل مبلغ قابل ثبت</span>
            <span className="font-bold text-primary">
              {formatMoney(minAllowed)}
              {isPaidOnly && (
                <span className="text-[10px] text-muted-foreground"> (آیتم پرداخت‌شده، فقط افزایش)</span>
              )}
            </span>
          </div>
        </div>

        {/* New amount input. We use `parseMoney` so the user can paste values
            with separators or Persian digits and still produce a clean
            number. The input is forced to LTR so digits group correctly. */}
        <div className="space-y-1">
          <Label className="text-xs">مبلغ جدید (ریال)</Label>
          <Input
            dir="ltr"
            inputMode="numeric"
            value={newAmount || ""}
            onChange={(e) => setNewAmount(parseMoney(e.target.value))}
            disabled={busy}
          />
          {/* Inline contextual warnings. These never block the RPC — they
              just save a round-trip when the value is obviously wrong. */}
          {invalidPositive && (
            <p className="text-[11px] text-destructive flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" /> مبلغ باید عددی مثبت باشد.
            </p>
          )}
          {!invalidPositive && belowPaid && (
            <p className="text-[11px] text-destructive flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              مبلغ درخواستی نمی‌تواند کمتر از مبلغ پرداخت‌شده ({formatMoney(paidAmount)}) باشد.
            </p>
          )}
          {!invalidPositive && !belowPaid && paidNeedsIncrease && (
            <p className="text-[11px] text-destructive flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              برای آیتم پرداخت‌شده، مبلغ جدید باید از مبلغ پرداخت‌شده بیشتر باشد.
            </p>
          )}
        </div>

        {/* Optional free-text reason — stored verbatim in the audit row.
            Keeping this optional avoids blocking quick corrections, but it's
            strongly recommended for any non-trivial adjustment. */}
        <div className="space-y-1">
          <Label className="text-xs">دلیل تغییر (اختیاری)</Label>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="مثلاً: اصلاح مبلغ فاکتور پس از تطبیق با تأمین‌کننده"
            rows={2}
            disabled={busy}
          />
        </div>

        <div className="flex gap-2 justify-end pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            انصراف
          </Button>
          <Button onClick={submit} disabled={busy || blocked}>
            <Save className="w-4 h-4 ml-1" />
            ثبت تغییر مبلغ
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
