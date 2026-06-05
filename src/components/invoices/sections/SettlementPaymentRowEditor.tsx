// ---------------------------------------------------------------------------
// Tasks 2+3 — One payment row inside a SettlementSourceCard.
//
// This is a controlled component: parent owns the PaymentDraft and applies
// every patch via `onChange`. We delegate method-specific input rendering to
// SettlementItemDetailsForm so we get the EXACT same fields (including
// Task 1's payee_national_id rule) as the post-save PaymentRequestsTab.
// ---------------------------------------------------------------------------

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";
import ShamsiDatePicker from "@/components/ShamsiDatePicker";
import SettlementItemDetailsForm from "@/components/finance/SettlementItemDetailsForm";
// UAT Fix 1 — Issue 2: amount_type_key is now auto-derived from party
// balance (see applyAutoAmountTypes). We no longer expose a manual selector
// in this row editor; the read-only basis preview lives on the source card.
import {
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS_FA,
  type PaymentMethod,
} from "@/lib/finance/settlementItemTypes";
import type { PaymentDraft } from "@/lib/finance/invoiceSettlementBuilder";

interface Props {
  index: number;
  payment: PaymentDraft;
  partyId: string | null;
  removable: boolean;
  onChange: (patch: Partial<PaymentDraft>) => void;
  onRemove: () => void;
}

export default function SettlementPaymentRowEditor({
  index, payment, partyId, removable, onChange, onRemove,
}: Props) {
  return (
    <div className="rounded-md border border-border p-2 space-y-2 bg-background/40">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-foreground">پرداخت {index + 1}</span>
        {removable && (
          <Button size="icon" variant="ghost" onClick={onRemove} aria-label="حذف">
            <Trash2 className="w-3.5 h-3.5 text-destructive" />
          </Button>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <div className="space-y-1">
          <Label className="text-[11px]">مبلغ (ریال)</Label>
          <Input
            type="number"
            inputMode="numeric"
            value={payment.amount || ""}
            onChange={(e) => onChange({ amount: Number(e.target.value) || 0 })}
          />
        </div>

        <div className="space-y-1">
          <Label className="text-[11px]">سررسید</Label>
          <ShamsiDatePicker
            value={payment.due_date}
            onChange={(j) => onChange({ due_date: j })}
          />
        </div>

        <div className="space-y-1">
          <Label className="text-[11px]">روش پرداخت</Label>
          <select
            value={payment.payment_method || ""}
            onChange={(e) => onChange({ payment_method: e.target.value as PaymentMethod, details: {} })}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">انتخاب…</option>
            {PAYMENT_METHODS.filter((m) => m !== "legacy").map((m) => (
              <option key={m} value={m}>{PAYMENT_METHOD_LABELS_FA[m]}</option>
            ))}
          </select>
        </div>

        {/* UAT Fix 1 — Issue 2: manual "مبنا" selector removed. The basis
            (creditor / advance / on_account) is auto-derived from the party
            balance and shown read-only in the source-card header. */}
      </div>

      {/* Per-method details — reuses the post-save form so behaviour stays
          consistent (including Task 1's payee_national_id rule on checks). */}
      {payment.payment_method && (
        <SettlementItemDetailsForm
          paymentMethod={payment.payment_method}
          value={payment.details}
          onChange={(next) => onChange({ details: next })}
          partyId={partyId}
        />
      )}
    </div>
  );
}
