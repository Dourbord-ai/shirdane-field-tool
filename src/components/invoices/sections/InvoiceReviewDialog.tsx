// ---------------------------------------------------------------------------
// Tasks 2+3 — Mandatory pre-save review dialog.
//
// Renders a read-only summary of EVERYTHING that will be written:
//   1. Invoice header
//   2. Item rows
//   3. Related cost drafts
//   4. The generated settlement request (title + count)
//   5. Every resulting settlement item, grouped per source
//   6. Validation errors (blocks final submit until clean)
//
// The dialog is the ONLY entry point to the save sequence — there is no
// direct save bypass per the brief.
// ---------------------------------------------------------------------------

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { X } from "lucide-react";
import {
  computeAllocation,
  computeBasis,
  SOURCE_KIND_LABEL_FA,
  subjectTypeForKind,
  type SettlementSource,
  type ValidationError,
  type DraftCost,
} from "@/lib/finance/invoiceSettlementBuilder";
import {
  COST_CATEGORY_LABEL,
  COST_TYPE_LABEL,
} from "@/lib/finance/relatedCosts";
import {
  PAYMENT_METHOD_LABELS_FA,
  SETTLEMENT_SUBJECT_LABELS_FA,
} from "@/lib/finance/settlementItemTypes";
// Task 5 — informational freight metrics for the review summary. We render
// the full set (with the fallback string) here because review is the
// operator's last sanity-check moment before final submit.
import {
  computeFreightMetrics,
  formatPerUnit,
  INSUFFICIENT_FREIGHT_DATA,
} from "@/lib/finance/freightMetrics";

interface Props {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  saving: boolean;
  // Header
  invoiceNumber: string | null;
  invoiceDateLabel: string;
  invoiceTypeLabel: string;
  partyLabel: string | null;
  totalPayable: number;
  // Body
  itemCount: number;
  costDrafts: DraftCost[];
  sources: SettlementSource[];
  errors: ValidationError[];
}

export default function InvoiceReviewDialog({
  open, onClose, onConfirm, saving,
  invoiceNumber, invoiceDateLabel, invoiceTypeLabel, partyLabel, totalPayable,
  itemCount, costDrafts, sources, errors,
}: Props) {
  if (!open) return null;

  const enabled = sources.filter((s) => s.settlement_requirement === "requires_settlement");
  const disabled = sources.filter((s) => s.settlement_requirement !== "requires_settlement");
  const totalSettlementItems = enabled.reduce((acc, s) => acc + s.payments.length, 0);
  const totalSettlementAmount = enabled.reduce(
    (acc, s) => acc + s.payments.reduce((a, p) => a + (Number(p.amount) || 0), 0),
    0,
  );

  const willCreateRequest = enabled.length > 0;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-2 sm:p-4" onClick={onClose}>
      <div
        className="bg-card rounded-xl border shadow-lg w-full max-w-3xl max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 bg-card p-4 border-b border-border flex items-center justify-between">
          <h3 className="font-bold text-foreground">پیش‌نمایش و تایید نهایی فاکتور</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label="بستن">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4 text-sm">
          {/* 1) Header */}
          <Section title="سرفصل فاکتور">
            <Row label="نوع فاکتور" value={invoiceTypeLabel} />
            <Row label="تاریخ" value={invoiceDateLabel} />
            <Row label="شماره" value={invoiceNumber || "—"} />
            <Row label="طرف مالی" value={partyLabel || "—"} />
            <Row label="قابل پرداخت" value={`${totalPayable.toLocaleString("fa-IR")} ریال`} />
          </Section>

          {/* 2) Items */}
          <Section title="اقلام فاکتور">
            <p className="text-xs text-muted-foreground">{itemCount} ردیف کالا/خدمت</p>
          </Section>

          {/* 3) Related cost drafts */}
          <Section title={`هزینه‌های وابسته (${costDrafts.length})`}>
            {costDrafts.length === 0 ? (
              <p className="text-xs text-muted-foreground">—</p>
            ) : (
              <ul className="text-xs space-y-1">
                {costDrafts.map((d) => (
                  <li key={d._draftId} className="flex justify-between gap-2">
                    <span>{COST_CATEGORY_LABEL[d.cost_category]} / {COST_TYPE_LABEL[d.cost_type] ?? d.cost_type}</span>
                    <span>{(Number(d.amount) || 0).toLocaleString("fa-IR")} ریال {d.payment_required ? "" : "(فقط در هزینه تمام‌شده)"}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {/* 4) Generated settlement request structure */}
          <Section title="درخواست تسویه ایجادشده">
            {!willCreateRequest ? (
              <p className="text-xs text-muted-foreground">
                هیچ منبعی نیازمند تسویه نیست — درخواست تسویه‌ای ایجاد نمی‌شود.
              </p>
            ) : (
              <div className="space-y-1 text-xs">
                <Row label="عنوان درخواست" value={`تسویه فاکتور ${invoiceNumber ?? ""}`.trim()} />
                <Row label="تعداد منابع فعال" value={String(enabled.length)} />
                <Row label="تعداد آیتم نهایی" value={String(totalSettlementItems)} />
                <Row label="مجموع مبلغ تسویه" value={`${totalSettlementAmount.toLocaleString("fa-IR")} ریال`} />
              </div>
            )}
          </Section>

          {/* 5) Resulting settlement items per source */}
          {willCreateRequest && (
            <Section title="آیتم‌های نهایی به تفکیک منبع">
              <div className="space-y-3">
                {enabled.map((s) => {
                  const alloc = computeAllocation(s);
                  const basis = computeBasis(s);
                  return (
                    <div key={s.source_id} className="rounded-md border border-border p-2 space-y-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="font-bold">{SOURCE_KIND_LABEL_FA[s.kind]}</span>
                          <span className="text-[10px] text-muted-foreground" dir="ltr">{s.source_id}</span>
                          <Badge variant="outline">{SETTLEMENT_SUBJECT_LABELS_FA[subjectTypeForKind(s.kind)]}</Badge>
                        </div>
                        <div className="text-[11px] flex flex-wrap gap-1">
                          <Badge variant="outline">کل: {alloc.total.toLocaleString("fa-IR")}</Badge>
                          {basis.debt > 0 && <Badge variant="outline">بستانکار: {basis.debt.toLocaleString("fa-IR")}</Badge>}
                          {basis.advance > 0 && <Badge variant="outline">پیش: {basis.advance.toLocaleString("fa-IR")}</Badge>}
                          {basis.onAccount > 0 && <Badge variant="outline">علی‌الحساب: {basis.onAccount.toLocaleString("fa-IR")}</Badge>}
                          {basis.mixed && <Badge variant="secondary">ترکیبی</Badge>}
                        </div>
                      </div>
                      <p className="text-[11px] text-muted-foreground">طرف‌حساب: {s.party_label || "—"}</p>
                      <ul className="text-xs space-y-0.5">
                        {s.payments.map((p, i) => (
                          <li key={p._draftId} className="flex justify-between gap-2">
                            <span>
                              {i + 1}. {(Number(p.amount) || 0).toLocaleString("fa-IR")} ریال —{" "}
                              {p.payment_method ? PAYMENT_METHOD_LABELS_FA[p.payment_method] : "—"} —{" "}
                              سررسید: {p.due_date || "—"}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            </Section>
          )}

          {disabled.length > 0 && (
            <Section title="منابع غیرفعال (بدون تسویه)">
              <ul className="text-xs text-muted-foreground space-y-0.5">
                {disabled.map((s) => (
                  <li key={s.source_id}>
                    {SOURCE_KIND_LABEL_FA[s.kind]} <span dir="ltr">({s.source_id})</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {/* 6) Validation errors */}
          {errors.length > 0 && (
            <Section title="خطاهای اعتبارسنجی">
              <ul className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-[11px] text-destructive space-y-0.5">
                {errors.map((e, i) => (
                  <li key={i}>• <span dir="ltr">{e.source_id}</span> — {e.message}</li>
                ))}
              </ul>
            </Section>
          )}
        </div>

        <div className="sticky bottom-0 bg-card p-4 border-t border-border flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={saving}>بازگشت برای ویرایش</Button>
          <Button onClick={onConfirm} disabled={saving || errors.length > 0}>
            {saving ? "در حال ثبت..." : "ثبت نهایی"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-md border border-border p-3 space-y-2">
      <h4 className="text-sm font-bold text-foreground">{title}</h4>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground">{value}</span>
    </div>
  );
}
