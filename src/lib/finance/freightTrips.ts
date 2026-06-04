// ---------------------------------------------------------------------------
// Task 6 — Freight Trips data access layer.
//
// Thin wrappers around the two new tables (freight_trips +
// freight_trip_invoices) plus the helpers that materialize / detach the
// per-invoice cost rows in factor_related_costs.
//
// Why a dedicated lib (vs inline supabase calls in pages):
//   - One place that knows the trip lifecycle: draft → allocated →
//     settlement_created → settled → cancelled.
//   - One place to apply the allocator and write the per-invoice
//     factor_related_costs rows atomically (best-effort; full atomicity
//     would require an RPC — flagged in the migration plan).
//   - Keeps page components free of DB shape coupling.
// ---------------------------------------------------------------------------

import { supabase } from "@/integrations/supabase/client";
import { allocate, type AllocationMethod, type AllocationInput } from "./freightAllocation";

// ===========================================================================
// Types
// ===========================================================================

/** Lifecycle states of a freight trip. Mirrors the DB CHECK constraint. */
export type FreightTripStatus =
  | "draft"
  | "allocated"
  | "settlement_created"
  | "settled"
  | "cancelled";

/** Persian labels for the status pill in list/detail pages. */
export const FREIGHT_TRIP_STATUS_LABEL: Record<FreightTripStatus, string> = {
  draft: "پیش‌نویس",
  allocated: "تخصیص‌یافته",
  settlement_created: "درخواست تسویه ثبت شد",
  settled: "تسویه شده",
  cancelled: "لغو شده",
};

/** Header row of one freight trip. */
export interface FreightTrip {
  id: string;
  trip_code: string | null;
  trip_date: string;
  driver_party_id: string | null;
  vehicle_plate: string | null;
  vehicle_type: string | null;
  origin_location_id: string | null;
  destination_location_id: string | null;
  origin_text: string | null;
  destination_text: string | null;
  route_distance_km: number | null;
  total_amount: number;
  allocation_method: AllocationMethod;
  payment_required: boolean;
  notes: string | null;
  status: FreightTripStatus;
  created_at: string;
  updated_at: string;
  is_deleted: boolean;
}

/** One link row — connects a trip to one invoice. */
export interface FreightTripInvoice {
  id: string;
  trip_id: string;
  factor_id: string;
  cargo_weight_kg: number | null;
  manual_share_amount: number | null;
  allocated_amount: number;
  related_cost_id: string | null;
  notes: string | null;
  is_deleted: boolean;
}

// Draft shapes used by the editor form before save.
export interface FreightTripDraft {
  trip_code: string | null;
  trip_date: string;
  driver_party_id: string | null;
  vehicle_plate: string | null;
  vehicle_type: string | null;
  origin_location_id: string | null;
  destination_location_id: string | null;
  origin_text: string | null;
  destination_text: string | null;
  route_distance_km: number | null;
  total_amount: number;
  allocation_method: AllocationMethod;
  payment_required: boolean;
  notes: string | null;
}

export interface FreightTripInvoiceDraft {
  factor_id: string;
  cargo_weight_kg: number | null;
  manual_share_amount: number | null;
}

// ===========================================================================
// Reads
// ===========================================================================

/** List all non-deleted trips, newest first. Used by the list page. */
export async function listFreightTrips(): Promise<FreightTrip[]> {
  // Filter on the partial-index column so the planner uses it. We sort by
  // trip_date desc because operators expect the most recent trip on top.
  const { data, error } = await supabase
    .from("freight_trips")
    .select("*")
    .eq("is_deleted", false)
    .order("trip_date", { ascending: false })
    .limit(500);
  if (error) throw error;
  return (data as FreightTrip[]) ?? [];
}

/** Read one trip + its invoice links. Used by the detail/editor pages. */
export async function getFreightTripWithInvoices(
  tripId: string,
): Promise<{ trip: FreightTrip; invoices: FreightTripInvoice[] }> {
  const [t, l] = await Promise.all([
    supabase.from("freight_trips").select("*").eq("id", tripId).maybeSingle(),
    supabase
      .from("freight_trip_invoices")
      .select("*")
      .eq("trip_id", tripId)
      .eq("is_deleted", false),
  ]);
  if (t.error) throw t.error;
  if (l.error) throw l.error;
  if (!t.data) throw new Error("سرویس حمل یافت نشد");
  return {
    trip: t.data as FreightTrip,
    invoices: (l.data as FreightTripInvoice[]) ?? [],
  };
}

/**
 * Active-trip lookup for an invoice — used by the per-invoice freight
 * editor to warn operators when the invoice already belongs to a trip.
 * Returns null when no active link exists.
 */
export async function findActiveTripForInvoice(
  factorId: string,
): Promise<{ trip: FreightTrip; link: FreightTripInvoice } | null> {
  const { data, error } = await supabase
    .from("freight_trip_invoices")
    .select("*, trip:freight_trips!inner(*)")
    .eq("factor_id", factorId)
    .eq("is_deleted", false)
    .eq("trip.is_deleted", false)
    .neq("trip.status", "cancelled")
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = data as any;
  return { trip: row.trip as FreightTrip, link: row as FreightTripInvoice };
}

// ===========================================================================
// Writes — create / update / cancel / detach
// ===========================================================================

/**
 * Create a brand-new trip in DRAFT state. We do NOT materialize cost rows
 * here — that happens when the operator clicks "تخصیص" (allocate).
 */
export async function createTripDraft(
  draft: FreightTripDraft,
  invoiceDrafts: FreightTripInvoiceDraft[],
): Promise<string> {
  // Insert the header first so we get the trip id for the children.
  const { data: tripRow, error: tripErr } = await supabase
    .from("freight_trips")
    .insert({
      ...draft,
      status: "draft",
    })
    .select("id")
    .single();
  if (tripErr || !tripRow) throw tripErr ?? new Error("ایجاد سرویس ناموفق بود");

  const tripId = (tripRow as { id: string }).id;

  // Best-effort children. If any fail, we keep the header so the operator
  // can fix the offending invoice without re-typing the whole form.
  if (invoiceDrafts.length) {
    const { error: liErr } = await supabase.from("freight_trip_invoices").insert(
      invoiceDrafts.map((d) => ({
        trip_id: tripId,
        factor_id: d.factor_id,
        cargo_weight_kg: d.cargo_weight_kg,
        manual_share_amount: d.manual_share_amount,
        allocated_amount: 0,
      })),
    );
    if (liErr) throw liErr;
  }

  return tripId;
}

/**
 * Replace the link set for a trip. We soft-delete missing links and upsert
 * the rest. Only callable while status='draft' OR status='allocated' AND no
 * settlement request exists — the page-level guard enforces that.
 */
export async function replaceTripInvoices(
  tripId: string,
  invoiceDrafts: FreightTripInvoiceDraft[],
): Promise<void> {
  // Fetch existing active links so we know which to keep, update, delete.
  const { data: existing, error: exErr } = await supabase
    .from("freight_trip_invoices")
    .select("id, factor_id")
    .eq("trip_id", tripId)
    .eq("is_deleted", false);
  if (exErr) throw exErr;

  const byFactor = new Map(((existing as { id: string; factor_id: string }[]) ?? []).map((r) => [r.factor_id, r.id]));
  const keptFactorIds = new Set(invoiceDrafts.map((d) => d.factor_id));

  // Soft-delete links not present in the new set. We use the soft-delete
  // path so the FK on the materialized cost row sets to null cleanly.
  const toDelete = [...byFactor.entries()].filter(([f]) => !keptFactorIds.has(f));
  for (const [, id] of toDelete) {
    await supabase.from("freight_trip_invoices").update({ is_deleted: true }).eq("id", id);
    // Also detach the materialized cost row, if any.
    await supabase
      .from("factor_related_costs")
      .update({ is_deleted: true })
      .eq("freight_trip_invoice_id", id);
  }

  // Upsert kept/added links.
  for (const d of invoiceDrafts) {
    const existingId = byFactor.get(d.factor_id);
    if (existingId) {
      await supabase
        .from("freight_trip_invoices")
        .update({
          cargo_weight_kg: d.cargo_weight_kg,
          manual_share_amount: d.manual_share_amount,
        })
        .eq("id", existingId);
    } else {
      await supabase.from("freight_trip_invoices").insert({
        trip_id: tripId,
        factor_id: d.factor_id,
        cargo_weight_kg: d.cargo_weight_kg,
        manual_share_amount: d.manual_share_amount,
        allocated_amount: 0,
      });
    }
  }
}

/** Update the header. Caller is responsible for checking lifecycle gates. */
export async function updateTripHeader(
  tripId: string,
  patch: Partial<FreightTripDraft>,
): Promise<void> {
  const { error } = await supabase
    .from("freight_trips")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .update(patch as any)
    .eq("id", tripId);
  if (error) throw error;
}

/**
 * Run the allocator for a trip, then write the per-invoice cost rows.
 *
 * Steps:
 *   1. Load trip + links + invoice payable amounts (for by_invoice_amount).
 *   2. Compute shares with `allocate(...)`.
 *   3. Update each link's allocated_amount.
 *   4. For each link: upsert a factor_related_costs row tagged with the
 *      trip + link ids and `payment_required = trip.payment_required`. The
 *      partial unique index on freight_trip_invoice_id guarantees 1:1.
 *   5. Bump trip.status from 'draft' → 'allocated' (idempotent).
 *
 * Returns the allocator report so the caller can surface the SUM check
 * (especially relevant when method='manual').
 */
export async function allocateTrip(tripId: string): Promise<{
  ok: boolean;
  message: string | null;
}> {
  const { trip, invoices } = await getFreightTripWithInvoices(tripId);

  // Pull payable amounts in one round-trip for the by_invoice_amount method.
  const factorIds = invoices.map((i) => i.factor_id);
  let payableMap = new Map<string, number>();
  if (factorIds.length) {
    const { data: facs, error: facErr } = await supabase
      .from("factors")
      .select("id, payable_amount, total_amount")
      .in("id", factorIds);
    if (facErr) throw facErr;
    payableMap = new Map(
      ((facs as { id: string; payable_amount: number | null; total_amount: number | null }[]) ?? [])
        .map((f) => [f.id, Number(f.payable_amount ?? f.total_amount ?? 0)]),
    );
  }

  const inputs: AllocationInput[] = invoices.map((l) => ({
    key: l.id,
    cargo_weight_kg: l.cargo_weight_kg,
    invoice_payable_amount: payableMap.get(l.factor_id) ?? 0,
    manual_share_amount: l.manual_share_amount,
  }));

  const { results, report } = allocate(trip.total_amount, trip.allocation_method, inputs);

  // For manual mismatch we DO NOT write — the caller surfaces the error
  // and lets the operator fix the shares first.
  if (report.hasError) {
    return { ok: false, message: report.errorMessage };
  }

  // Write each share + materialize the cost row.
  for (let i = 0; i < invoices.length; i++) {
    const link = invoices[i];
    const r = results[i];
    if (!r) continue;

    // 1) Update the link with the computed share.
    await supabase
      .from("freight_trip_invoices")
      .update({ allocated_amount: r.allocated_amount })
      .eq("id", link.id);

    // 2) Upsert the materialized cost row. The link.related_cost_id tells
    //    us whether one already exists from a previous allocate.
    const baseCost = {
      factor_id: link.factor_id,
      cost_category: "freight" as const,
      cost_type: "driver",
      amount: r.allocated_amount,
      party_id: trip.driver_party_id,
      description:
        `سهم سرویس حمل${trip.trip_code ? ` ${trip.trip_code}` : ""}` +
        ` (${trip.allocation_method === "by_weight" ? "وزنی" : trip.allocation_method === "manual" ? "دستی" : "مبلغی"})`,
      source_document_number: trip.trip_code,
      payment_required: trip.payment_required,
      attachment_path: null as string | null,
      vehicle_plate: trip.vehicle_plate,
      driver_name: null as string | null,
      cost_date: trip.trip_date,
      origin_location_id: trip.origin_location_id,
      destination_location_id: trip.destination_location_id,
      origin_text: trip.origin_text,
      destination_text: trip.destination_text,
      route_distance_km: trip.route_distance_km,
      route_duration_minutes: null,
      route_source: "manual" as const,
      route_note: null as string | null,
      vehicle_type: trip.vehicle_type,
      cargo_weight: link.cargo_weight_kg,
      freight_trip_id: trip.id,
      freight_trip_invoice_id: link.id,
      freight_trip_share_basis: r.basis,
    };

    if (link.related_cost_id) {
      await supabase
        .from("factor_related_costs")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .update(baseCost as any)
        .eq("id", link.related_cost_id);
    } else {
      const { data: ins, error: insErr } = await supabase
        .from("factor_related_costs")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .insert(baseCost as any)
        .select("id")
        .single();
      if (insErr) throw insErr;
      if (ins) {
        await supabase
          .from("freight_trip_invoices")
          .update({ related_cost_id: (ins as { id: string }).id })
          .eq("id", link.id);
      }
    }
  }

  // Move the trip out of 'draft' once cost rows are written.
  if (trip.status === "draft") {
    await supabase.from("freight_trips").update({ status: "allocated" }).eq("id", trip.id);
  }

  return { ok: true, message: null };
}

/**
 * Cancel a trip:
 *   - sets trip.status = 'cancelled'
 *   - soft-deletes all link rows
 *   - soft-deletes all materialized cost rows
 *
 * Blocked when status is 'settlement_created' or 'settled' (would require
 * voucher/bank rollback which is explicitly out of scope for Task 6).
 */
export async function cancelTrip(tripId: string): Promise<void> {
  const { trip, invoices } = await getFreightTripWithInvoices(tripId);
  if (trip.status === "settlement_created" || trip.status === "settled") {
    throw new Error(
      "این سرویس درخواست تسویه فعال دارد. ابتدا درخواست تسویه را لغو کنید.",
    );
  }
  await supabase.from("freight_trips").update({ status: "cancelled", is_deleted: true }).eq("id", tripId);
  for (const l of invoices) {
    await supabase.from("freight_trip_invoices").update({ is_deleted: true }).eq("id", l.id);
    if (l.related_cost_id) {
      await supabase
        .from("factor_related_costs")
        .update({ is_deleted: true })
        .eq("id", l.related_cost_id);
    }
  }
}

/** Mark trip as having a settlement request (called by the trip page). */
export async function markTripSettlementCreated(tripId: string): Promise<void> {
  const { error } = await supabase
    .from("freight_trips")
    .update({ status: "settlement_created" })
    .eq("id", tripId);
  if (error) throw error;
}
