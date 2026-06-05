// ---------------------------------------------------------------------------
// Invoice ↔ Settlement linkage helpers.
//
// `finance_payment_requests.source_factor_id` is the AUTHORITATIVE link
// from a payment request to the invoice that produced it. The DB enforces
// uniqueness via `ux_finance_payment_requests_source_factor_active`
// (partial unique index on active, non-deleted rows), so this module is
// purely a thin read-side helper used by:
//
//   - InvoiceSettlementSummaryCard  → displays the linked request
//   - PaymentRequestsTab            → renders "وابسته به فاکتور" badge
//   - MixedInvoiceForm              → pre-flight duplicate check before RPC
//
// We deliberately keep this small and side-effect-free so it can be reused
// from any surface without dragging React/state along.
// ---------------------------------------------------------------------------

import { supabase } from "@/integrations/supabase/client";

// Minimal shape needed by the summary card + badge. We avoid pulling the
// full payment-request row to keep the round-trip cheap when the card is
// embedded inside every expanded invoice row.
export interface InvoiceLinkedSettlement {
  id: string;
  status: string;
  total_amount: number | null;
  confirmed_amount: number | null;
  payment_status: string | null;
  created_at: string | null;
  item_count: number;
}

/**
 * Fetch the active (non-deleted) settlement request linked to the given
 * invoice id, plus its item count. Returns `null` when no link exists —
 * which is the normal case for invoices saved without settlement (Rule 5
 * of the dependency model: those invoices remain flexible).
 *
 * Two queries are issued in sequence rather than one PostgREST `select`
 * with a relation join because `count` on an embedded resource requires
 * extra grants we don't want to maintain just for this card.
 */
export async function fetchInvoiceLinkedSettlement(
  factorId: string,
): Promise<InvoiceLinkedSettlement | null> {
  // 1. Header row — `maybeSingle` so "no link" returns null instead of error.
  const { data: header, error } = await supabase
    .from("finance_payment_requests")
    .select("id,status,total_amount,confirmed_amount,payment_status,created_at")
    .eq("source_factor_id", factorId)
    .eq("is_deleted", false)
    .maybeSingle();

  if (error || !header) return null;

  // 2. Cheap item-count via head=true (no rows returned, just the count
  //    header). Settlement items aren't soft-deleted in this flow.
  const { count } = await supabase
    .from("finance_payment_request_items")
    .select("id", { count: "exact", head: true })
    .eq("payment_request_id", header.id)
    .eq("is_deleted", false);

  return {
    id: header.id,
    status: header.status,
    total_amount: header.total_amount,
    confirmed_amount: header.confirmed_amount,
    payment_status: header.payment_status,
    created_at: header.created_at,
    item_count: count ?? 0,
  };
}

/**
 * Batch lookup: given a list of payment-request ids, return the
 * source_factor_id and invoice_number for each one that is invoice-owned.
 *
 * Used by PaymentRequestsTab to render the "وابسته به فاکتور <number>"
 * badge without doing N+1 round-trips per card.
 */
export interface RequestInvoiceLink {
  requestId: string;
  factorId: string;
  invoiceNumber: string | null;
}

export async function fetchInvoiceLinksForRequests(
  requestIds: string[],
): Promise<Map<string, RequestInvoiceLink>> {
  const out = new Map<string, RequestInvoiceLink>();
  if (requestIds.length === 0) return out;

  // Pull the link column for the supplied request ids. We filter by NOT
  // NULL so legacy independent requests aren't included.
  const { data: rows } = await supabase
    .from("finance_payment_requests")
    .select("id,source_factor_id")
    .in("id", requestIds)
    .not("source_factor_id", "is", null);

  const factorIds = Array.from(
    new Set((rows || []).map((r) => r.source_factor_id).filter(Boolean) as string[]),
  );
  if (factorIds.length === 0) return out;

  // Second round-trip to resolve invoice_number — cheaper than embedding.
  const { data: factors } = await supabase
    .from("factors")
    .select("id,invoice_number")
    .in("id", factorIds);

  const invoiceByFactor = new Map<string, string | null>(
    (factors || []).map((f) => [f.id, (f.invoice_number ?? null) as string | null]),
  );

  for (const r of rows || []) {
    if (!r.source_factor_id) continue;
    out.set(r.id, {
      requestId: r.id,
      factorId: r.source_factor_id,
      invoiceNumber: invoiceByFactor.get(r.source_factor_id) ?? null,
    });
  }
  return out;
}
