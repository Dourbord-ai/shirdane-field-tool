// ---------------------------------------------------------------------------
// Tasks 2+3 — One settlement source card.
//
// Each card represents ONE independent settlement source (seller, freight-N,
// weighing-N, …). The user picks `requires_settlement` vs `no_settlement`,
// the payment count, and fills each PaymentDraft. Allocation summary and
// settlement-basis breakdown badges sit in the header so drift is obvious.
// ---------------------------------------------------------------------------

import { useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import SettlementPaymentRowEditor from "./SettlementPaymentRowEditor";
import {
  SOURCE_KIND_LABEL_FA,
  computeAllocation,
  computeBasis,
  resizePayments,
  rebalanceAuto,
  type SettlementSource,
  type PaymentDraft,
  type ValidationError,
} from "@/lib/finance/invoiceSettlementBuilder";

interface Props {
  source: SettlementSource;
  errors: ValidationError[];
  onPatch: (patch: Partial<SettlementSource>) => void;
}

export default function SettlementSourceCard({ source, errors, onPatch }: Props) {
  const alloc = useMemo(() => computeAllocation(source), [source]);
  const basis = useMemo(() => computeBasis(source), [source]);
  const required = source.settlement_requirement === "requires_settlement";

  const updatePayment = (i: number, patch: Partial<PaymentDraft>) => {
    const next = source.payments.map((p, idx) => (idx === i ? { ...p, ...patch } : p));
    onPatch({ payments: next, user_dirty: true });
  };
  const removePayment = (i: number) => {
    if (source.payments.length <= 1) return;
    const next = source.payments.filter((_, idx) => idx !== i);
    onPatch({ payments: next, user_dirty: true });
  };

  const headerErr = errors.filter((e) => e.payment_index === undefined);
  const cardBorder = required
    ? (errors.length > 0 ? "border-destructive/60" : "border-primary/40")
    : "border-border";

  return (
    <div className={`rounded-md border ${cardBorder} p-3 space-y-3 bg-background/40`}>
      {/* Header row: kind + source_id + party + allocation badges */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-bold text-foreground">{SOURCE_KIND_LABEL_FA[source.kind]}</span>
          <span className="text-[10px] text-muted-foreground" dir="ltr">{source.source_id}</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <Badge variant="outline">کل: {alloc.total.toLocaleString("fa-IR")}</Badge>
          <Badge variant={alloc.allocated === alloc.total ? "default" : "secondary"}>
            تخصیص: {alloc.allocated.toLocaleString("fa-IR")}
          </Badge>
          {alloc.remaining !== 0 && (
            <Badge variant={required ? "destructive" : "secondary"}>
              باقی: {alloc.remaining.toLocaleString("fa-IR")}
            </Badge>
          )}
        </div>
      </div>

      {/* Party label snapshot */}
      <p className="text-xs text-muted-foreground">
        طرف‌حساب: {source.party_label || (source.party_id ? "—" : "(مشخص نشده)")}
      </p>

      {/* Requirement choice — explicit enum per brief */}
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <label className="flex items-center gap-1 cursor-pointer">
          <input
            type="radio"
            name={`req-${source.source_id}`}
            checked={required}
            onChange={() => onPatch({ settlement_requirement: "requires_settlement" })}
          />
          <span>نیازمند تسویه است</span>
        </label>
        <label className="flex items-center gap-1 cursor-pointer">
          <input
            type="radio"
            name={`req-${source.source_id}`}
            checked={!required}
            onChange={() => onPatch({ settlement_requirement: "no_settlement" })}
          />
          <span>نیازی به تسویه ندارد</span>
        </label>
      </div>

      {required && (
        <>
          {/* Editable total + payment count + auto-split */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <div className="space-y-1">
              <Label className="text-[11px]">مبلغ کل</Label>
              <Input
                type="number"
                inputMode="numeric"
                value={source.total || ""}
                onChange={(e) => onPatch({ total: Number(e.target.value) || 0, user_dirty: true })}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px]">تعداد پرداخت</Label>
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                max={20}
                value={source.payments.length}
                onChange={(e) => {
                  const n = Math.max(1, Math.min(20, Number(e.target.value) || 1));
                  const next = resizePayments(source, n);
                  onPatch({ payments: next.payments });
                }}
              />
            </div>
            <div className="space-y-1 col-span-2 flex items-end">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() =>
                  onPatch({ payments: rebalanceAuto(source.payments, source.total), user_dirty: false })
                }
              >
                تقسیم خودکار مبلغ
              </Button>
            </div>
          </div>

          {/* Settlement-basis preview — debt / advance / on-account split. */}
          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className="text-muted-foreground">مبنا:</span>
            {basis.debt > 0 && <Badge variant="outline">بستانکار: {basis.debt.toLocaleString("fa-IR")}</Badge>}
            {basis.advance > 0 && <Badge variant="outline">پیش‌پرداخت: {basis.advance.toLocaleString("fa-IR")}</Badge>}
            {basis.onAccount > 0 && <Badge variant="outline">علی‌الحساب: {basis.onAccount.toLocaleString("fa-IR")}</Badge>}
            {basis.mixed && <Badge variant="secondary">ترکیبی</Badge>}
            {basis.debt + basis.advance + basis.onAccount === 0 && (
              <span className="text-muted-foreground">—</span>
            )}
          </div>

          {/* Payment rows */}
          <div className="space-y-2">
            {source.payments.map((p, i) => (
              <SettlementPaymentRowEditor
                key={p._draftId}
                index={i}
                payment={p}
                partyId={source.party_id}
                removable={source.payments.length > 1}
                onChange={(patch) => updatePayment(i, patch)}
                onRemove={() => removePayment(i)}
              />
            ))}
          </div>

          {/* Source-level error list */}
          {headerErr.length > 0 && (
            <ul className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-[11px] text-destructive space-y-0.5">
              {headerErr.map((e, i) => <li key={i}>• {e.message}</li>)}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
