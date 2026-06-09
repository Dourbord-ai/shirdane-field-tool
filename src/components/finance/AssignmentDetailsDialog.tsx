// =============================================================================
// AssignmentDetailsDialog.tsx
// -----------------------------------------------------------------------------
// Modal shown when an operator clicks "جزئیات" on an *assigned* bank transaction
// in the BankTransactionsTab list. It looks up the related operation using the
// transaction's (assigned_operation_type, assigned_operation_id) tuple and
// renders a small summary so the operator does not need to leave the screen.
//
// READ-ONLY: no mutation, no assignment changes, no sync logic. We only run
// SELECT queries scoped to the single related row. The four supported types
// are: 'payment_allocation', 'receive_identification', 'bank_transfer'. Any
// other type renders a "not supported yet" message — see the spec.
// =============================================================================
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, ExternalLink } from "lucide-react";
import { RollbackButton } from "@/components/finance/RollbackConfirmDialog";
import type { RollbackEntityType } from "@/lib/finance/rollback";
import { MoneyCell, JalaliDateCell, FinanceStatusBadge } from "@/components/finance/atoms";
// (useNavigate no longer needed: the "go to related tab" button now opens a
// NEW browser tab via window.open(...) instead of doing in-page routing, so
// the operator's current view of the bank-transactions list is preserved.)

// Props are intentionally minimal: we only need the assignment tuple to drive
// the lookup. The parent owns open/close state via the `txId` presence pattern.
//
// `hideNavButton` lets a destination tab reuse this dialog as a read-only
// detail panel WITHOUT re-rendering the "go to related tab" button (which
// would point right back at itself and create a confusing loop).
interface Props {
  open: boolean;
  onClose: () => void;
  operationType: string | null;
  operationId: string | null;
  hideNavButton?: boolean;
  // Fired after a successful in-dialog rollback so the host tab can refresh
  // its list. The dialog also auto-closes on success.
  onRollbackSuccess?: () => void;
}

// Shape we render after normalising each operation type into a common view-model.
// Keeping it flat makes the JSX trivially uniform regardless of source table.
interface DetailsView {
  typeLabel: string;
  refNumber?: string | null;   // human-readable identifier (title / id)
  partyName?: string | null;   // beneficiary / counterparty
  amount?: number | null;
  date?: string | null;
  status?: string | null;
  description?: string | null;
  // Pre-built deep link URL to the related tab / record. We compute this in
  // the data-loading branches because only there do we know the *real* target
  // id (for payment_allocation the target is the parent payment_request_id,
  // not the allocation id). Empty → no nav button is rendered.
  navUrl?: string;
  // Rollback config — populated only for operations that are currently
  // eligible for rollback (already synced to Sepidar AND not already
  // cancelled/rolled_back). When present, the dialog renders the same
  // RollbackButton used in the list view, with identical handler/metadata.
  rollback?: {
    entityType: RollbackEntityType;
    entityId: string;
    operationLabel: string;
    amount?: number | null;
    partyLabel?: string | null;
    bankLabel?: string | null;
    sepidarVoucherId?: string | number | null;
  };
}

// Friendly Persian label per operation type — used in the dialog title.
const TYPE_LABEL: Record<string, string> = {
  payment_allocation: "تخصیص پرداخت",
  receive_identification: "شناسایی دریافت",
  bank_transfer: "انتقال بین بانکی",
  bank_fee: "کارمزد بانکی",
};

export default function AssignmentDetailsDialog({ open, onClose, operationType, operationId, hideNavButton = false }: Props) {
  // Three-state UI: loading spinner / error message / data view. We reset on
  // every open so a previous error doesn't leak into a new lookup.
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<DetailsView | null>(null);

  useEffect(() => {
    if (!open) return;
    setView(null);
    setError(null);

    // Guard: missing id → can't query, show a friendly message instead of
    // hitting Supabase with a null filter (which would 400).
    if (!operationType || !operationId) {
      setError("شناسه عملیات مرتبط ثبت نشده است.");
      return;
    }

    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        // Branch per operation type. Each branch performs a single, minimal
        // SELECT then normalises into the DetailsView shape used by the JSX.
        if (operationType === "payment_allocation") {
          const { data, error } = await supabase
            .from("finance_payment_allocations")
            .select(
              "id, amount, allocation_datetime, status, payment_request_id, party_id, " +
                "finance_payment_requests(id, title, status, payment_status, description), " +
                "finance_parties(first_name, last_name, company_name)",
            )
            .eq("id", operationId)
            .maybeSingle();
          if (error) throw error;
          if (!data) throw new Error("رکورد تخصیص پرداخت یافت نشد.");
          const d: any = data;
          // The PostgREST join returns the parent row as a nested object when
          // it's a many-to-one relation. We pluck the few fields we need.
          const pr: any = d.finance_payment_requests || {};
          const p: any = d.finance_parties || {};
          const pn = [p.first_name, p.last_name].filter(Boolean).join(" ").trim() || p.company_name || null;
          // Resolve the parent payment_request_id — that's the entity the
          // destination tab needs to open (an "allocation" alone isn't a row
          // in PaymentRequestsTab; the request is). Fall back to pr.id from
          // the join if the FK column itself is null for any reason.
          const targetPrId = d.payment_request_id || pr.id || null;
          setView({
            typeLabel: TYPE_LABEL[operationType],
            refNumber: pr.title || pr.id || d.payment_request_id,
            partyName: pn,
            amount: Number(d.amount) || 0,
            date: d.allocation_datetime,
            status: d.status,
            description: pr.description,
            navUrl: targetPrId
              ? `/finance?tab=payment-requests&paymentRequestId=${encodeURIComponent(targetPrId)}`
              : undefined,
          });
        } else if (operationType === "receive_identification") {
          const { data, error } = await supabase
            .from("finance_receive_identifications")
            .select(
              "id, title, amount, transaction_datetime, status, description, party_id, " +
                "finance_parties(first_name, last_name, company_name)",
            )
            .eq("id", operationId)
            .maybeSingle();
          if (error) throw error;
          if (!data) throw new Error("رکورد شناسایی دریافت یافت نشد.");
          const d: any = data;
          const p: any = d.finance_parties || {};
          const pn = [p.first_name, p.last_name].filter(Boolean).join(" ").trim() || p.company_name || null;
          setView({
            typeLabel: TYPE_LABEL[operationType],
            refNumber: d.title || d.id,
            partyName: pn,
            amount: Number(d.amount) || 0,
            date: d.transaction_datetime,
            status: d.status,
            description: d.description,
            navUrl: `/finance?tab=receive-id&receiveId=${encodeURIComponent(d.id)}`,
          });
        } else if (operationType === "bank_transfer") {
          const { data, error } = await supabase
            .from("finance_bank_transfers")
            .select(
              "id, from_amount, to_amount, transfer_datetime, status, description, " +
                "from_bank:from_bank_id(title), to_bank:to_bank_id(title)",
            )
            .eq("id", operationId)
            .maybeSingle();
          if (error) throw error;
          if (!data) throw new Error("رکورد انتقال بانکی یافت نشد.");
          const d: any = data;
          const fb: any = d.from_bank || {};
          const tb: any = d.to_bank || {};
          setView({
            typeLabel: TYPE_LABEL[operationType],
            refNumber: d.id,
            // For a bank-transfer there is no party; we surface the two banks
            // as the "counterparty" line so the operator gets context.
            partyName: `${fb.title || "—"} ← ${tb.title || "—"}`,
            amount: Number(d.from_amount ?? d.to_amount) || 0,
            date: d.transfer_datetime,
            status: d.status,
            description: d.description,
            navUrl: `/finance?tab=bank-transfer&transferId=${encodeURIComponent(d.id)}`,
          });

        } else {
          // Unknown / future operation type — render a friendly placeholder.
          setError("جزئیات این نوع تخصیص هنوز پشتیبانی نمی‌شود.");
        }
      } catch (e: any) {
        setError(e?.message || "خطا در دریافت جزئیات.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, operationType, operationId]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>جزئیات عملیات مرتبط</DialogTitle>
          <DialogDescription>
            اطلاعات عملیاتی که این تراکنش بانکی به آن تخصیص یافته است.
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin ml-2" /> در حال بارگذاری…
          </div>
        )}

        {!loading && error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {!loading && view && (
          <div className="space-y-3 text-sm">
            <Row label="نوع عملیات" value={view.typeLabel} />
            <Row label="شناسه / عنوان" value={view.refNumber || "—"} />
            {view.partyName && <Row label="ذینفع / طرف حساب" value={view.partyName} />}
            <Row
              label="مبلغ"
              value={<MoneyCell value={view.amount ?? 0} />}
            />
            <Row label="تاریخ" value={<JalaliDateCell value={view.date} withTime />} />
            <Row label="وضعیت" value={<FinanceStatusBadge status={view.status} />} />
            {view.description && (
              <div>
                <div className="text-xs text-muted-foreground mb-1">توضیحات</div>
                <div className="rounded-md border bg-muted/30 p-2 whitespace-pre-wrap text-foreground">
                  {view.description}
                </div>
              </div>
            )}
            {view.navUrl && !hideNavButton && (
              <div className="pt-2 flex justify-end">
                {/* Open the deep-linked destination in a NEW browser tab so
                    the operator's place in the bank-transactions list is
                    preserved (no navigation in the current tab). We use
                    `noopener,noreferrer` for the standard security hygiene:
                    the opened tab cannot access window.opener and no
                    Referer header is leaked. */}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    window.open(view.navUrl!, "_blank", "noopener,noreferrer");
                  }}
                >
                  <ExternalLink className="w-3.5 h-3.5 ml-1" />
                  رفتن به تب مرتبط (تب جدید)
                </Button>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// Small helper to keep the label/value rows visually consistent without
// pulling in a table component for what is essentially a key-value list.
function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  );
}
