// ============================================================================
// RollbackConfirmDialog
// ----------------------------------------------------------------------------
// Phase 4 — Generic confirmation dialog used by every entity detail screen
// (Factor / ReceiveIdentification / PaymentRequest / PaymentAllocation /
// BankTransfer / PartyTransfer / Check) before invoking
// `rollbackFinanceOperation`.
//
// Responsibilities (single source of truth for rollback UX):
//   1) Display the operation metadata so the operator knows EXACTLY which
//      voucher will be torn down (type, amount, party, bank, sepidar id).
//   2) Show a hard warning that the Sepidar voucher is deleted FIRST and that
//      Supabase cleanup only happens after the SP succeeds.
//   3) Require a non-empty rollback reason (also enforced in rollback.ts —
//      we duplicate it client-side for instant feedback).
//   4) Disable both action buttons while the rollback is in flight and show
//      a final success/failure toast.
//   5) Gate visibility / availability behind the existing admin OR
//      super_admin role check (with a stub for the future finance_manager
//      role).
//
// Why a single component instead of inline dialogs in every tab:
//   - Guarantees identical warnings / wording across the app.
//   - Centralizes the role gate so adding `finance_manager` later is a
//     one-line change.
//   - Keeps each entity surface free of rollback boilerplate.
// ============================================================================

import { useState, type ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AlertTriangle, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import {
  rollbackFinanceOperation,
  type RollbackEntityType,
} from "@/lib/finance/rollback";
import { getSession } from "@/lib/auth";
import { DEV_ACCESS_MODE } from "@/lib/devAccess";

// ---------------------------------------------------------------------------
// Role gate
// ---------------------------------------------------------------------------
// Allowed roles per spec: admin + super_admin. Designed to be extensible — to
// add `finance_manager` later just append it here. DEV_ACCESS_MODE bypass is
// kept to match the rest of the app's auth flow.
const ROLLBACK_ROLES = new Set(["admin", "super_admin"]);

export function canRollbackFinanceOps(): boolean {
  if (DEV_ACCESS_MODE) return true;
  const { user } = getSession();
  if (!user) return false;
  if (user.isSuperAdmin) return true;
  return !!user.role && ROLLBACK_ROLES.has(user.role);
}

// ---------------------------------------------------------------------------
// Metadata shape — every caller passes whatever fields it has. All optional
// so the dialog works even for entities that have e.g. no bank or no party.
// ---------------------------------------------------------------------------
export interface RollbackMetadata {
  operationLabel: string;            // e.g. "فاکتور فروش" / "انتقال بانکی"
  amount?: number | null;
  partyLabel?: string | null;
  bankLabel?: string | null;
  sepidarVoucherId?: string | number | null;
  extraLines?: { label: string; value: ReactNode }[];
  // Optional scope-specific confirmation question shown inside the dialog.
  confirmationQuestion?: string;
}

export interface RollbackConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityType: RollbackEntityType;
  entityId: string;
  metadata: RollbackMetadata;
  // Called AFTER a successful rollback so the caller can refetch / close the
  // detail panel. Not called on failure (operator may want to retry).
  onSuccess?: () => void;
}

// Tiny formatter — keeps the JSX readable. Uses Persian digits + thousands
// separator (Intl handles fa-IR grouping correctly).
function fmtMoney(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  return new Intl.NumberFormat("fa-IR").format(Number(v)) + " ریال";
}

export function RollbackConfirmDialog({
  open,
  onOpenChange,
  entityType,
  entityId,
  metadata,
  onSuccess,
}: RollbackConfirmDialogProps) {
  // Local reason state — reset whenever the dialog is closed so the next
  // open starts from a clean slate.
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  // We DO NOT close the dialog on cancel-busy or on failure — the operator
  // may want to read the toast and retry / edit the reason.
  function handleOpenChange(next: boolean) {
    if (busy) return; // Block close while the SP/Supabase round-trip is live.
    if (!next) setReason("");
    onOpenChange(next);
  }

  async function handleConfirm() {
    // Client-side guard so the operator sees instant feedback instead of
    // waiting for the orchestrator to reject the call.
    if (reason.trim().length < 3) {
      toast.error("لطفاً دلیل بازگشت سند را به‌صورت معنادار وارد کنید.");
      return;
    }
    setBusy(true);
    try {
      const res = await rollbackFinanceOperation({
        entityType,
        entityId,
        reason: reason.trim(),
      });
      if (res.ok) {
        // result_code may surface a useful hint (0 = deleted now, 2 = was
        // already gone). We don't gate on it — both are success.
        toast.success("بازگشت سند با موفقیت انجام شد.");
        setReason("");
        onOpenChange(false);
        onSuccess?.();
      } else {
        toast.error(res.error || "بازگشت سند ناموفق بود.");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "خطای نامشخص در بازگشت سند.");
    } finally {
      setBusy(false);
    }
  }

  // Guard: never even render the dialog content if the operator lacks the
  // role. The trigger button is also hidden — this is belt-and-suspenders.
  if (!canRollbackFinanceOps()) return null;

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent className="max-w-lg" dir="rtl">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-destructive">
            <RotateCcw className="w-5 h-5" />
            بازگشت / لغو {metadata.operationLabel}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3 text-right">
              {/* Metadata grid — only renders rows whose values exist. */}
              <div className="rounded-lg border bg-muted/30 p-3 grid grid-cols-2 gap-2 text-xs">
                <MetaRow label="نوع عملیات" value={metadata.operationLabel} />
                {metadata.amount != null && (
                  <MetaRow label="مبلغ" value={fmtMoney(metadata.amount)} />
                )}
                {metadata.partyLabel && (
                  <MetaRow label="ذینفع" value={metadata.partyLabel} />
                )}
                {metadata.bankLabel && (
                  <MetaRow label="بانک" value={metadata.bankLabel} />
                )}
                {metadata.sepidarVoucherId != null && (
                  <MetaRow
                    label="شناسه سند سپیدار"
                    value={
                      <span className="font-mono">{String(metadata.sepidarVoucherId)}</span>
                    }
                  />
                )}
                {metadata.extraLines?.map((l) => (
                  <MetaRow key={l.label} label={l.label} value={l.value} />
                ))}
                <MetaRow
                  label="شناسه داخلی"
                  value={<span className="font-mono opacity-70">{entityId.slice(0, 8)}…</span>}
                />
              </div>

              {/* Hard warning panel — wording mandated by Phase 4 spec.
                  Highlighted with destructive tone so it cannot be missed. */}
              <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive flex gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <div className="font-bold">سند سپیدار ابتدا حذف می‌شود.</div>
                  <div>
                    فقط در صورت موفقیت حذف از سپیدار، وضعیت سند داخلی، مانده طرف
                    حساب و وضعیت موجودیت به‌روزرسانی می‌شود. شناسه سند سپیدار
                    برای پیگیری حفظ خواهد شد.
                  </div>
                </div>
              </div>

              {/* Reason input — required, controlled, autoFocus to push the
                  operator toward providing context immediately. */}
              <div className="space-y-1.5">
                <Label htmlFor="rollback-reason" className="text-xs">
                  دلیل بازگشت سند (الزامی)
                </Label>
                <Textarea
                  id="rollback-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="مثلاً «ثبت اشتباه طرف حساب در سپیدار»"
                  rows={3}
                  disabled={busy}
                  autoFocus
                />
              </div>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          {/* Cancel is disabled mid-flight to prevent partial-state confusion */}
          <AlertDialogCancel disabled={busy}>انصراف</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              // Prevent AlertDialog's default close-on-action. We close manually
              // only after a successful rollback so failures keep the dialog
              // open (operator can fix the reason and retry).
              e.preventDefault();
              void handleConfirm();
            }}
            disabled={busy || reason.trim().length < 3}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {busy && <Loader2 className="w-4 h-4 animate-spin ml-1" />}
            تایید بازگشت سند
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function MetaRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <span className="text-foreground">{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// RollbackButton — convenience wrapper that hides itself when the caller
// can't perform the rollback (role gate). Most callers want this; advanced
// callers can render the dialog directly and wire their own trigger.
// ---------------------------------------------------------------------------
export interface RollbackButtonProps
  extends Omit<RollbackConfirmDialogProps, "open" | "onOpenChange"> {
  label?: string;
  buttonVariant?: ButtonProps["variant"];
  buttonSize?: ButtonProps["size"];
  buttonClassName?: string;
}

export function RollbackButton({
  label = "بازگشت سند",
  buttonVariant = "outline",
  buttonSize = "sm",
  buttonClassName,
  ...dialogProps
}: RollbackButtonProps) {
  const [open, setOpen] = useState(false);
  // Hidden completely when the operator can't perform rollbacks — keeps the
  // detail panel clean for non-privileged users.
  if (!canRollbackFinanceOps()) return null;
  return (
    <>
      <Button
        type="button"
        variant={buttonVariant}
        size={buttonSize}
        className={buttonClassName}
        onClick={() => setOpen(true)}
      >
        <RotateCcw className="w-3.5 h-3.5 ml-1" />
        {label}
      </Button>
      <RollbackConfirmDialog
        {...dialogProps}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}
