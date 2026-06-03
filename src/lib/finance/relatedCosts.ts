// ---------------------------------------------------------------------------
// Phase 7 — Related costs for invoices/factors.
//
// Why this file exists:
//   Purchase (and other) factors often carry secondary costs — freight,
//   weighing, unloading, transport insurance, commissions, misc fees — that
//   need to be tracked as STRUCTURED records (not free-text and not just
//   attachments). Those rows must later (a) feed into cost-price math and
//   (b) be able to generate settlement items for the third parties involved.
//
// Why a thin lib (not inline in components):
//   - The component layer should not own the vocabulary or the
//     draft-building rules. Keeping them here makes it easy to unit-test and
//     reuse from non-UI code paths (reports, importers, future RPCs).
//   - Settlement integration in this phase is ONLY a draft builder — we do
//     NOT touch the existing settlement execution / voucher / Sepidar code.
// ---------------------------------------------------------------------------

import { supabase } from "@/integrations/supabase/client";

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/**
 * High-level cost buckets. Mirrored by a CHECK constraint in the DB so the UI
 * MUST stick to this set. New buckets require a migration + this constant.
 */
export const COST_CATEGORIES = [
  "freight",     // حمل (راننده، کرایه)
  "logistics",   // باسکول، تخلیه، بارگیری
  "insurance",   // بیمه حمل
  "storage",     // انبارداری
  "commission",  // کمیسیون / واسطه‌گری
  "misc",        // متفرقه
] as const;
export type CostCategory = typeof COST_CATEGORIES[number];

/**
 * Suggested sub-types per category. Stored as free text in the DB so future
 * additions don't need migrations — the UI uses this map only as a seed for
 * dropdowns and the quick-add buttons.
 */
export const COST_TYPES_BY_CATEGORY: Record<CostCategory, string[]> = {
  freight:    ["driver", "waybill", "fuel_surcharge"],
  logistics:  ["unloading", "loading", "weighing"],
  insurance:  ["transport_insurance"],
  storage:    ["storage_fee"],
  commission: ["commission"],
  misc:       ["misc"],
};

/** Persian labels for category/type — used by both the form and the read views. */
export const COST_CATEGORY_LABEL: Record<CostCategory, string> = {
  freight: "حمل",
  logistics: "لجستیک",
  insurance: "بیمه",
  storage: "انبارداری",
  commission: "کمیسیون",
  misc: "متفرقه",
};

export const COST_TYPE_LABEL: Record<string, string> = {
  driver: "راننده",
  waybill: "بارنامه",
  fuel_surcharge: "سوخت",
  unloading: "تخلیه",
  loading: "بارگیری",
  weighing: "باسکول",
  transport_insurance: "بیمه حمل",
  storage_fee: "انبارداری",
  commission: "کمیسیون",
  misc: "متفرقه",
};

// ---------------------------------------------------------------------------
// Row type — mirror of the DB columns, with `party` joined name as optional
// convenience for the table view.
// ---------------------------------------------------------------------------

export interface RelatedCost {
  id: string;
  factor_id: string;
  cost_category: CostCategory;
  cost_type: string;
  amount: number;
  party_id: string | null;
  description: string | null;
  source_document_number: string | null;
  payment_required: boolean;
  attachment_path: string | null;
  vehicle_plate: string | null;
  driver_name: string | null;
  cost_date: string;                          // ISO string from PG (timestamptz)
  // Reserved for a future phase: once a settlement request item is created
  // from this cost row, the resulting item's id will be stored here so we
  // can avoid duplicate settlement generation and trace cost → payment.
  settlement_request_item_id: string | null;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
}

/** Insert/update payload — omit server-managed columns. */
export type RelatedCostInput = Omit<
  RelatedCost,
  "id" | "created_at" | "updated_at" | "is_deleted" | "settlement_request_item_id"
> & { id?: string };

// ---------------------------------------------------------------------------
// CRUD helpers
// ---------------------------------------------------------------------------

/**
 * List all non-deleted related-cost rows for a factor, newest first.
 * Joined party name is exposed via a side query to keep the type narrow and
 * avoid coupling to finance_parties' shape from here.
 */
export async function listRelatedCosts(factorId: string): Promise<RelatedCost[]> {
  // Using `eq("is_deleted", false)` so soft-deleted rows stay invisible
  // without us having to filter on the client. Order by cost_date desc so
  // the table reads as a small chronological ledger.
  const { data, error } = await supabase
    .from("factor_related_costs")
    .select("*")
    .eq("factor_id", factorId)
    .eq("is_deleted", false)
    .order("cost_date", { ascending: false });
  if (error) throw error;
  return (data as RelatedCost[]) ?? [];
}

/**
 * Insert or update a related-cost row. We pick which based on the presence
 * of `id` in the payload so the editor component stays a single dialog.
 */
export async function upsertRelatedCost(input: RelatedCostInput): Promise<void> {
  // Strip undefineds so PG defaults (e.g. cost_date = now()) kick in
  // when the form leaves them blank.
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (v !== undefined) clean[k] = v;
  }
  if (input.id) {
    // UPDATE path: never overwrite payment_required silently — the form
    // is responsible for sending the right value.
    const { id, ...rest } = clean as { id: string } & Record<string, unknown>;
    const { error } = await supabase
      .from("factor_related_costs")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update(rest as any)
      .eq("id", id);
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from("factor_related_costs")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .insert(clean as any);
    if (error) throw error;
  }
}

/**
 * Soft-delete a row (sets is_deleted=true). We never hard-delete because
 * a settlement_request_item_id may already reference this row in a future
 * phase, and hard deletion would lose the audit trail.
 */
export async function softDeleteRelatedCost(id: string): Promise<void> {
  const { error } = await supabase
    .from("factor_related_costs")
    .update({ is_deleted: true })
    .eq("id", id);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Sum used by cost-price calculations. ALL non-deleted rows are summed,
 * regardless of payment_required — `payment_required = false` still means
 * "this cost was paid in another channel; count it toward cost price but
 * don't create a settlement item for it" (per Phase 7 spec).
 *
 * NOTE: this helper is exported but intentionally NOT wired into the
 * existing pricing pipeline yet. That rollout is a separate phase to avoid
 * silently changing historical totals.
 */
export function sumForCostPrice(rows: RelatedCost[]): number {
  return rows.reduce((acc, r) => acc + (Number(r.amount) || 0), 0);
}

/**
 * Settlement draft item — intentionally minimal. The actual PRDialog has a
 * much richer per-row shape (payment_method, due_date, details, etc.). The
 * draft only fills the fields the operator can know from the invoice + cost
 * rows; everything else is left for the operator to confirm in the dialog.
 */
export interface SettlementDraftItem {
  party_id: string;
  amount: number;
  // Description text built per spec: includes category, type, document
  // number and invoice number so the operator can scan a long list and
  // match each line back to its source.
  description: string;
  // Provenance for debugging / future deduplication:
  source: {
    factor_id: string;
    invoice_number: string | null;
    related_cost_id?: string;   // present for cost-derived rows
    role: "seller" | "freight_driver" | "weighing_provider" | "unloading_provider" | "other_cost";
  };
}

export interface SettlementDraft {
  title: string;
  description: string;
  items: SettlementDraftItem[];
}

/**
 * Map a cost row to a settlement role label. This is what lets the
 * description string read like "حمل / راننده — بارنامه ۱۲۳ — فاکتور ۴۵۶".
 */
function roleFor(row: RelatedCost): SettlementDraftItem["source"]["role"] {
  if (row.cost_category === "freight") return "freight_driver";
  if (row.cost_type === "weighing") return "weighing_provider";
  if (row.cost_type === "unloading") return "unloading_provider";
  return "other_cost";
}

/**
 * Build the human-readable description string per the Phase 7 spec:
 *   "<categoryLabel> / <typeLabel> — سند: <doc#> — فاکتور: <invoice#>"
 * Missing pieces are omitted gracefully so the line never reads "—  — —".
 */
function buildCostDescription(row: RelatedCost, invoiceNumber: string | null): string {
  const cat = COST_CATEGORY_LABEL[row.cost_category] ?? row.cost_category;
  const typ = COST_TYPE_LABEL[row.cost_type] ?? row.cost_type;
  const parts: string[] = [`${cat} / ${typ}`];
  if (row.source_document_number) parts.push(`سند: ${row.source_document_number}`);
  if (invoiceNumber) parts.push(`فاکتور: ${invoiceNumber}`);
  if (row.description) parts.push(row.description);
  return parts.join(" — ");
}

/**
 * Build a settlement draft from an invoice + its related-cost rows.
 *
 *   - Always emits a seller item (so the operator doesn't have to re-pick
 *     the seller and the invoice payable). The amount uses the factor's
 *     payable_amount or total_amount as best-effort default.
 *   - Emits one item per related-cost row WHERE payment_required = true AND
 *     party_id is set. Rows with payment_required=false are intentionally
 *     skipped — they're cost-price-only.
 *   - This function does NOT touch the database. The caller stashes the
 *     draft (e.g. sessionStorage) and opens the existing PRDialog for the
 *     operator to review/edit/submit.
 */
export function buildSettlementDraftFromInvoice(
  invoice: {
    id: string;
    invoice_number: string | null;
    finance_party_id: string | null;
    total_amount: number | null;
    payable_amount: number | null;
  },
  rows: RelatedCost[],
): SettlementDraft {
  const items: SettlementDraftItem[] = [];

  // -- Seller item ---------------------------------------------------------
  // Only emit when the invoice has a resolved local party. Pre-validation
  // invoices (finance_party_id = NULL) cannot generate a settlement seller
  // line until the operator runs FixPartyPanel.
  if (invoice.finance_party_id) {
    const sellerAmount =
      Number(invoice.payable_amount) ||
      Number(invoice.total_amount) ||
      0;
    items.push({
      party_id: invoice.finance_party_id,
      amount: sellerAmount,
      description: `فروشنده — فاکتور: ${invoice.invoice_number ?? "—"}`,
      source: {
        factor_id: invoice.id,
        invoice_number: invoice.invoice_number,
        role: "seller",
      },
    });
  }

  // -- Cost-derived items --------------------------------------------------
  for (const r of rows) {
    if (!r.payment_required) continue;          // cost-price only
    if (!r.party_id) continue;                  // cannot pay an unknown party
    if (r.settlement_request_item_id) continue; // already linked → skip
    items.push({
      party_id: r.party_id,
      amount: Number(r.amount) || 0,
      description: buildCostDescription(r, invoice.invoice_number),
      source: {
        factor_id: invoice.id,
        invoice_number: invoice.invoice_number,
        related_cost_id: r.id,
        role: roleFor(r),
      },
    });
  }

  return {
    title: `تسویه فاکتور ${invoice.invoice_number ?? ""}`.trim(),
    description: `تولید خودکار از فاکتور ${invoice.invoice_number ?? invoice.id}`,
    items,
  };
}

// ---------------------------------------------------------------------------
// Hand-off contract for the settlement dialog (no execution here)
// ---------------------------------------------------------------------------

/**
 * SessionStorage key used to hand a SettlementDraft from the invoice page
 * to PaymentRequestsTab's PRDialog. Chosen as a constant so both ends agree
 * without an import cycle.
 */
export const SETTLEMENT_DRAFT_STORAGE_KEY = "finance:pr_seed_draft_v1";

/** Stash a draft and return a URL the caller can navigate to. */
export function stashSettlementDraft(draft: SettlementDraft): void {
  try {
    sessionStorage.setItem(SETTLEMENT_DRAFT_STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // sessionStorage may be unavailable (private mode / SSR). Swallow —
    // the caller will simply see an empty PRDialog and can build the
    // request manually.
  }
}

/** Read+clear the stashed draft (call once on PRDialog open). */
export function consumeSettlementDraft(): SettlementDraft | null {
  try {
    const raw = sessionStorage.getItem(SETTLEMENT_DRAFT_STORAGE_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(SETTLEMENT_DRAFT_STORAGE_KEY);
    return JSON.parse(raw) as SettlementDraft;
  } catch {
    return null;
  }
}
