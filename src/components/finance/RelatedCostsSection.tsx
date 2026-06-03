// ---------------------------------------------------------------------------
// Phase 7 — Related costs section, embedded in the invoice detail view.
//
// Renders the list of structured related-cost rows for a single factor, plus
// quick-add buttons for the most common cases and a "ثبت درخواست تسویه"
// action that builds a settlement draft (no DB writes here) and hands it to
// the existing PaymentRequests dialog via sessionStorage + navigation.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Receipt, Truck, Scale, PackageOpen, FileSpreadsheet, Link2, CheckCircle2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { supabase } from "@/integrations/supabase/client";

import {
  COST_CATEGORY_LABEL,
  COST_TYPE_LABEL,
  buildSettlementDraftFromInvoice,
  listRelatedCosts,
  softDeleteRelatedCost,
  stashSettlementDraft,
  sumForCostPrice,
  type CostCategory,
  type RelatedCost,
} from "@/lib/finance/relatedCosts";

import RelatedCostRowEditor from "@/components/finance/RelatedCostRowEditor";

// Tiny number formatter to keep this file independent from app-wide helpers.
// Mirrors the existing Persian-digit + thousands-separator style.
function formatRial(n: number): string {
  const s = (Math.round(Number(n) || 0)).toLocaleString("en-US");
  // Convert ASCII digits → Persian for visual consistency with the rest of
  // the invoice view (which uses toPersianDigits everywhere).
  const fa = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"];
  return s.replace(/\d/g, (d) => fa[Number(d)]) + " ریال";
}

// Pretty-print the timestamptz cost_date as a short date (intentionally not
// Jalali here — the invoice header already shows the Jalali invoice date,
// and the cost row's exact ordering matters more than locale).
function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface InvoiceLite {
  id: string;
  invoice_number: string | null;
  finance_party_id: string | null;
  total_amount: number | null;
  payable_amount: number | null;
}

export default function RelatedCostsSection({ invoice }: { invoice: InvoiceLite }) {
  // -------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------
  const [rows, setRows] = useState<RelatedCost[]>([]);
  const [loading, setLoading] = useState(false);

  // The editor is one dialog shared by add + edit; we toggle its mode by
  // passing either `initial` (edit) or `seed` (add) — never both.
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorInitial, setEditorInitial] = useState<RelatedCost | undefined>(undefined);
  const [editorSeed, setEditorSeed] = useState<{ cost_category?: CostCategory; cost_type?: string } | undefined>(undefined);

  const navigate = useNavigate();

  // Fetcher pulled out so the "saved" callback and the mount effect share
  // the exact same code path — avoids subtle drift between the two.
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listRelatedCosts(invoice.id);
      setRows(data);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "خطا در بارگذاری هزینه‌ها";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [invoice.id]);

  useEffect(() => { void reload(); }, [reload]);

  // -------------------------------------------------------------------------
  // Quick-add helpers — each button pre-fills the editor with a sensible
  // category/type pair so the operator can jump straight to amount + party.
  // -------------------------------------------------------------------------
  function openAdd(seed?: { cost_category?: CostCategory; cost_type?: string }) {
    setEditorInitial(undefined);
    setEditorSeed(seed);
    setEditorOpen(true);
  }

  function openEdit(row: RelatedCost) {
    setEditorInitial(row);
    setEditorSeed(undefined);
    setEditorOpen(true);
  }

  async function handleDelete(row: RelatedCost) {
    // Soft delete — see lib note. Confirm to avoid accidents.
    if (!confirm("این هزینه حذف شود؟")) return;
    try {
      await softDeleteRelatedCost(row.id);
      toast.success("حذف شد");
      void reload();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "خطا در حذف";
      toast.error(msg);
    }
  }

  // -------------------------------------------------------------------------
  // Settlement draft action.
  //
  // We never auto-create settlement requests. This handler only builds the
  // draft, validates that something is actually payable, stashes it for the
  // PRDialog consumer, and navigates the operator to the PaymentRequests
  // tab where they review and submit.
  // -------------------------------------------------------------------------
  function handleGenerateSettlement() {
    const draft = buildSettlementDraftFromInvoice(invoice, rows);
    if (draft.items.length === 0) {
      toast.error("هیچ آیتم قابل تسویه‌ای پیدا نشد (طرف‌حساب مشخص یا نیازمند پرداخت).");
      return;
    }
    stashSettlementDraft(draft);
    toast.success(`${draft.items.length} آیتم پیش‌نویس آماده شد — در حال انتقال...`);
    // The finance page hosts the tabs; we hint the target tab via the
    // hash so PaymentRequestsTab can auto-select. PRDialog reads the
    // sessionStorage seed when it opens.
    navigate("/finance#payment-requests");
  }

  // -------------------------------------------------------------------------
  // Derived totals — surfaced so the operator sees both the gross sum
  // (cost-price impact) and the payable subset at a glance.
  // -------------------------------------------------------------------------
  const totalAll = sumForCostPrice(rows);
  const totalPayable = rows
    .filter((r) => r.payment_required)
    .reduce((s, r) => s + (Number(r.amount) || 0), 0);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <div className="mt-4 rounded-xl border border-border bg-card/40 p-3">
      <Separator className="mb-3" />
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
          <Receipt className="w-4 h-4 text-primary" />
          هزینه‌های وابسته
        </h3>
        <Button size="sm" variant="outline" onClick={handleGenerateSettlement}>
          ثبت درخواست تسویه
        </Button>
      </div>

      {/* Quick-add toolbar — the four most common cases get their own button
          per the Phase 7 spec. "متفرقه" maps to misc/misc. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => openAdd({ cost_category: "freight", cost_type: "driver" })}
        >
          <Truck className="w-4 h-4 ml-1" /> افزودن هزینه حمل
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => openAdd({ cost_category: "logistics", cost_type: "weighing" })}
        >
          <Scale className="w-4 h-4 ml-1" /> افزودن هزینه باسکول
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => openAdd({ cost_category: "logistics", cost_type: "unloading" })}
        >
          <PackageOpen className="w-4 h-4 ml-1" /> افزودن هزینه تخلیه
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => openAdd({ cost_category: "misc", cost_type: "misc" })}
        >
          <FileSpreadsheet className="w-4 h-4 ml-1" /> افزودن هزینه متفرقه
        </Button>
      </div>

      {/* Row list */}
      {loading ? (
        <p className="text-xs text-muted-foreground py-4 text-center">در حال بارگذاری...</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-muted-foreground py-4 text-center">هزینه وابسته‌ای ثبت نشده است.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <div
              key={r.id}
              className="bg-secondary/40 rounded-lg p-3 flex flex-col gap-1 text-sm"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="px-2 py-0.5 rounded-md bg-primary/10 text-primary text-[10px] font-bold">
                    {COST_CATEGORY_LABEL[r.cost_category]}
                  </span>
                  <span className="text-foreground truncate">
                    {COST_TYPE_LABEL[r.cost_type] ?? r.cost_type}
                  </span>
                  {!r.payment_required && (
                    <span className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground text-[10px]">
                      بدون پرداخت
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => openEdit(r)}
                    className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground"
                    aria-label="ویرایش"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleDelete(r)}
                    className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                    aria-label="حذف"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{formatDate(r.cost_date)}</span>
                <span className="font-bold text-foreground">{formatRial(r.amount)}</span>
              </div>
              {(r.source_document_number || r.description || r.vehicle_plate || r.driver_name) && (
                <div className="text-xs text-muted-foreground space-y-0.5 mt-0.5">
                  {r.source_document_number && <div>سند: {r.source_document_number}</div>}
                  {r.vehicle_plate && <div>پلاک: {r.vehicle_plate}</div>}
                  {r.driver_name && <div>راننده: {r.driver_name}</div>}
                  {r.description && <div>{r.description}</div>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Totals strip — split into "gross" (cost-price impact) and "payable"
          (subset that will be considered when generating settlement items). */}
      {rows.length > 0 && (
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-md border border-border p-2 flex justify-between">
            <span className="text-muted-foreground">جمع هزینه‌ها</span>
            <span className="font-bold text-foreground">{formatRial(totalAll)}</span>
          </div>
          <div className="rounded-md border border-border p-2 flex justify-between">
            <span className="text-muted-foreground">قابل تسویه</span>
            <span className="font-bold text-primary">{formatRial(totalPayable)}</span>
          </div>
        </div>
      )}

      {editorOpen && (
        <RelatedCostRowEditor
          factorId={invoice.id}
          initial={editorInitial}
          seed={editorSeed}
          onClose={() => setEditorOpen(false)}
          onSaved={() => void reload()}
        />
      )}
    </div>
  );
}
