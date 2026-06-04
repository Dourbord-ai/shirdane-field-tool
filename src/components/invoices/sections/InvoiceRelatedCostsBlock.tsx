// ---------------------------------------------------------------------------
// Tasks 2+3 — Related-costs block, mounted inside MixedInvoiceForm.
//
// Behaviour mirrors the post-save RelatedCostsSection but works on local
// state (no DB writes). Rows are persisted only after the parent factor is
// saved, via `insertManyRelatedCosts` in MixedInvoiceForm.handleSubmit.
//
// We REUSE RelatedCostRowEditor with `mode="draft"` so the operator gets the
// exact same editor used everywhere else — including the quick-create driver
// flow. The editor calls `onDraftSave(payload)` instead of writing to PG.
// ---------------------------------------------------------------------------

import { useState } from "react";
import { ChevronDown, ChevronUp, Plus, Pencil, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import RelatedCostRowEditor from "@/components/finance/RelatedCostRowEditor";
import {
  COST_CATEGORY_LABEL,
  COST_TYPE_LABEL,
  type CostCategory,
  type RelatedCostInput,
} from "@/lib/finance/relatedCosts";
import type { DraftCost } from "@/lib/finance/invoiceSettlementBuilder";

interface Props {
  drafts: DraftCost[];
  onAdd: (input: RelatedCostInput) => void;
  onUpdate: (draftId: string, input: RelatedCostInput) => void;
  onDelete: (draftId: string) => void;
}

// Quick-add seeds — the four most common cost shapes. Each opens the editor
// pre-filled, so the operator only edits amount + party.
const QUICK_SEEDS: { label: string; seed: { cost_category: CostCategory; cost_type: string } }[] = [
  { label: "+ حمل (راننده)", seed: { cost_category: "freight", cost_type: "driver" } },
  { label: "+ باسکول",        seed: { cost_category: "logistics", cost_type: "weighing" } },
  { label: "+ تخلیه",         seed: { cost_category: "logistics", cost_type: "unloading" } },
  { label: "+ متفرقه",        seed: { cost_category: "misc", cost_type: "misc" } },
];

export default function InvoiceRelatedCostsBlock({ drafts, onAdd, onUpdate, onDelete }: Props) {
  const [open, setOpen] = useState(true);
  // editor state: either { mode:"add", seed } or { mode:"edit", draftId }
  const [editor, setEditor] = useState<
    | null
    | { mode: "add"; seed?: { cost_category: CostCategory; cost_type: string } }
    | { mode: "edit"; draftId: string }
  >(null);

  const sum = drafts.reduce((acc, d) => acc + (Number(d.amount) || 0), 0);

  // The editor reads `initial?` as a full RelatedCost row. We adapt our
  // DraftCost (which is RelatedCostInput + _draftId) into the RelatedCost
  // shape the editor expects by filling synthetic server-managed fields.
  // The editor only reads the fields it actually displays, so the synthetic
  // values never reach the DB.
  const draftToInitial = (d: DraftCost) => ({
    id: d._draftId,
    factor_id: "__draft__",
    cost_category: d.cost_category,
    cost_type: d.cost_type,
    amount: d.amount,
    party_id: d.party_id,
    description: d.description,
    source_document_number: d.source_document_number,
    payment_required: d.payment_required,
    attachment_path: d.attachment_path,
    vehicle_plate: d.vehicle_plate,
    driver_name: d.driver_name,
    cost_date: d.cost_date,
    settlement_request_item_id: null,
    is_deleted: false,
    created_at: d.cost_date,
    updated_at: d.cost_date,
    // Task 4 — pass through freight route fields so the editor can
    // re-render them when the operator opens an existing draft for editing.
    origin_location_id: d.origin_location_id ?? null,
    destination_location_id: d.destination_location_id ?? null,
    origin_text: d.origin_text ?? null,
    destination_text: d.destination_text ?? null,
    route_distance_km: d.route_distance_km ?? null,
    route_duration_minutes: d.route_duration_minutes ?? null,
    route_source: d.route_source ?? null,
    route_note: d.route_note ?? null,
    route_api_provider: d.route_api_provider ?? null,
    route_api_response: d.route_api_response ?? null,
    route_checked_at: d.route_checked_at ?? null,
    route_checked_by: d.route_checked_by ?? null,
    vehicle_type: d.vehicle_type ?? null,
    cargo_weight: d.cargo_weight ?? null,
  });

  return (
    <Card className="p-4 space-y-3 bg-card border-border">
      <button
        type="button"
        className="w-full flex items-center justify-between"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-foreground">هزینه‌های وابسته</h2>
          <span className="text-xs text-muted-foreground">
            ({drafts.length} ردیف — {sum.toLocaleString("fa-IR")} ریال)
          </span>
        </span>
        {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>

      {open && (
        <div className="space-y-3">
          {/* Quick-add buttons — each opens the editor with the seed pre-filled */}
          <div className="flex flex-wrap gap-2">
            {QUICK_SEEDS.map((q) => (
              <Button
                key={q.label}
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => setEditor({ mode: "add", seed: q.seed })}
              >
                {q.label}
              </Button>
            ))}
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setEditor({ mode: "add" })}
            >
              <Plus className="w-3.5 h-3.5 ml-1" /> سایر هزینه
            </Button>
          </div>

          {/* Draft rows table */}
          {drafts.length === 0 ? (
            <p className="text-xs text-muted-foreground">هیچ هزینه وابسته‌ای ثبت نشده است.</p>
          ) : (
            <div className="rounded-md border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr className="text-xs text-muted-foreground">
                    <th className="text-right p-2">دسته / نوع</th>
                    <th className="text-right p-2">مبلغ</th>
                    <th className="text-right p-2">نیازمند پرداخت</th>
                    <th className="text-right p-2">توضیحات</th>
                    <th className="text-right p-2"> </th>
                  </tr>
                </thead>
                <tbody>
                  {drafts.map((d) => (
                    <tr key={d._draftId} className="border-t border-border">
                      <td className="p-2">
                        {COST_CATEGORY_LABEL[d.cost_category]} / {COST_TYPE_LABEL[d.cost_type] ?? d.cost_type}
                      </td>
                      <td className="p-2">{(Number(d.amount) || 0).toLocaleString("fa-IR")}</td>
                      <td className="p-2">{d.payment_required ? "بله" : "خیر"}</td>
                      <td className="p-2 text-xs text-muted-foreground">{d.description || "—"}</td>
                      <td className="p-2 text-end">
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => setEditor({ mode: "edit", draftId: d._draftId })}
                          aria-label="ویرایش"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => onDelete(d._draftId)}
                          aria-label="حذف"
                        >
                          <Trash2 className="w-3.5 h-3.5 text-destructive" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Editor — mounted only when active. mode="draft" prevents DB writes. */}
      {editor && editor.mode === "add" && (
        <RelatedCostRowEditor
          mode="draft"
          factorId="__draft__"
          seed={editor.seed}
          onClose={() => setEditor(null)}
          onDraftSave={(input) => onAdd(input)}
        />
      )}
      {editor && editor.mode === "edit" && (() => {
        const d = drafts.find((x) => x._draftId === editor.draftId);
        if (!d) return null;
        return (
          <RelatedCostRowEditor
            mode="draft"
            factorId="__draft__"
            initial={draftToInitial(d)}
            onClose={() => setEditor(null)}
            onDraftSave={(input) => onUpdate(editor.draftId, input)}
          />
        );
      })()}
    </Card>
  );
}
