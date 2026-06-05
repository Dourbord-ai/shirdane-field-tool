// ---------------------------------------------------------------------------
// Task 7 — Freight Trip → Settlement Request integration.
//
// This module is the freight-trip mirror of `invoiceSettlementBuilder.ts`.
// It is deliberately tiny because a trip has exactly ONE settlement source
// (the driver / freight party), so we don't need the multi-source
// reconciliation machinery used on the invoice side. We DO reuse the same
// `SettlementSource` / `PaymentDraft` shapes so the existing
// `SettlementSourceCard` component renders the editor without any new UI.
//
// Why a separate file (instead of bolting onto invoiceSettlementBuilder)?
//   1. Scope isolation — invoice-form code must not branch on "is this a trip?"
//   2. Different validation surface — the trip's source has no related cost
//      draft, no seller fallback, and a fixed kind/subject_type.
//   3. Future evolution — when trips eventually allow multiple settlement
//      requests, this file is the natural place to grow without touching
//      the invoice flow.
//
// SCOPE GUARDRAILS (per approved plan):
//   - No changes to submit_payment_request RPC.
//   - No changes to amount_type_code / paymentAmountTypes.ts.
//   - No bank allocation / Sepidar / voucher / settlement execution touches.
//   - One trip → one settlement request (1:1) for v1. A future enhancement
//     to allow multiple requests per trip will require a dedicated link
//     table (e.g. freight_trip_settlement_requests) and dropping the
//     freight_trips.settlement_request_id column.
//   - trip.status = "settled" is NOT set by this module. It should
//     eventually be derived from settlement execution state (see future
//     work in jsdoc on markTripSettlementCreated).
// ---------------------------------------------------------------------------

import { supabase } from "@/integrations/supabase/client";
import {
  buildRpcItemsPayload,
  validateSources,
  SOURCE_KIND_LABEL_FA,
  type SettlementSource,
  type PaymentDraft,
  type ValidationError,
  type RpcItemPayload,
} from "@/lib/finance/invoiceSettlementBuilder";
import { jalaliToGregorianDate } from "@/lib/dateUtils";
import type { FreightTrip } from "@/lib/finance/freightTrips";

// ---------------------------------------------------------------------------
// Initial source factory
// ---------------------------------------------------------------------------

/**
 * Build the seed `SettlementSource` for the trip's freight charge.
 *
 * Choices (and why):
 *   - `source_id = "freight-trip-<tripId>"` — namespaced so future grouping
 *     in the settlement dashboard can distinguish trip-derived items from
 *     per-invoice freight cost items (which use `freight-<costDraftId>`).
 *   - `kind = "freight"` — same kind used by per-invoice freight cost
 *     sources, so `settlement_subject_type` resolves to "freight" and the
 *     dashboard's existing category mapper buckets it correctly.
 *   - `settlement_requirement = "requires_settlement"` — the operator only
 *     reaches this dialog by clicking "ثبت درخواست تسویه کرایه سفر", so
 *     the explicit intent is already established; the radio remains
 *     editable but defaults to ON.
 *   - One default payment row equal to the full total — matches the
 *     invoice editor's pattern, operator can split via the existing
 *     "تعداد پرداخت" + "تقسیم خودکار" controls in `SettlementSourceCard`.
 */
export function buildInitialFreightTripSource(
  trip: FreightTrip,
  partyLabel: string | null,
): SettlementSource {
  // We coerce to Number defensively — Postgres numeric arrives as string
  // in some contexts and the rest of the source machinery expects number.
  const total = Number(trip.total_amount) || 0;

  // Seed a single payment for the full amount. The `_draftId` must be
  // unique so React's list rendering inside `SettlementSourceCard` is
  // stable across re-renders.
  const seedPayment: PaymentDraft = {
    _draftId: cryptoRandom(),
    amount: total,
    due_date: "", // operator must pick a Jalali date
    payment_method: "", // operator must pick a method
    settlement_subject_type: "freight", // matches subjectTypeForKind("freight")
    amount_type_key: "creditor", // sensible default; operator can change
    details: {},
    execution_priority: 3,
  };

  return {
    source_id: `freight-trip-${trip.id}`,
    kind: "freight",
    // We mark the origin as a synthetic cost so the existing RPC builder
    // skips the `source_related_cost_id` injection (no DB cost draft id
    // exists — the trip's per-invoice materialized cost rows are NOT the
    // settlement subject; the trip itself is).
    origin: { type: "cost", costDraftId: `freight-trip-${trip.id}` },
    party_id: trip.driver_party_id,
    party_label: partyLabel,
    total,
    settlement_requirement: "requires_settlement",
    // false so the source card's "تقسیم خودکار" still works the first
    // time the operator changes payment count.
    user_dirty: false,
    payments: [seedPayment],
  };
}

// ---------------------------------------------------------------------------
// Trip-level validation
// ---------------------------------------------------------------------------

/**
 * Trip-level guards that must pass BEFORE any per-payment validation. We
 * surface these as `ValidationError` so the dialog can render them in the
 * same list as the per-payment errors emitted by `validateSources`.
 *
 * Any failure here disables the submit button.
 */
export function validateFreightTripSettlement(
  trip: FreightTrip,
  source: SettlementSource,
): ValidationError[] {
  const errors: ValidationError[] = [];

  // Lifecycle guard — the dialog should not even open in other statuses,
  // but a tab race could change it under us.
  if (trip.status !== "allocated") {
    errors.push({
      source_id: source.source_id,
      message: "ایجاد درخواست تسویه فقط برای سرویس‌های در وضعیت «تخصیص‌یافته» مجاز است.",
    });
  }

  // The "payment_required" flag is the operator's explicit declaration
  // that this trip's freight needs settlement. Without it the source
  // should not exist.
  if (!trip.payment_required) {
    errors.push({
      source_id: source.source_id,
      message: "این سرویس به عنوان «بدون نیاز به پرداخت» علامت خورده است.",
    });
  }

  // The settlement request must point at a party — we can't post a
  // settlement item without one.
  if (!trip.driver_party_id) {
    errors.push({
      source_id: source.source_id,
      message: "طرف‌حساب راننده / شرکت حمل برای این سرویس مشخص نیست.",
    });
  }

  // Defensive — total_amount is non-null in DB but we don't trust UI
  // round-trips with numeric→string coercions.
  if (!(Number(trip.total_amount) > 0)) {
    errors.push({
      source_id: source.source_id,
      message: "مبلغ کل کرایه باید بزرگ‌تر از صفر باشد.",
    });
  }

  // Reuse the invoice-side validator for per-payment + Σ-equals-total
  // checks. Passing `null` as financePartyId is safe because the only
  // branch that uses it is `kind === "seller"`, which never applies here.
  errors.push(...validateSources([source], null));

  return errors;
}

// ---------------------------------------------------------------------------
// RPC payload + submit orchestration
// ---------------------------------------------------------------------------

/**
 * Build the wire payload for `submit_payment_request`. We delegate to the
 * existing `buildRpcItemsPayload` so the item shape stays in lockstep with
 * the invoice flow; we then override `description`, `source_kind` and
 * `source_reference` per-item so the dashboard can group by trip code.
 */
export function buildFreightTripRpcItems(
  source: SettlementSource,
  trip: FreightTrip,
): RpcItemPayload[] {
  // costIdByDraftId is empty — there is no real cost draft id for a trip
  // source; the trip itself is the subject. `buildRpcItemsPayload` will
  // therefore set `source_related_cost_id = null` for every row.
  // Freight trips are NOT invoice-owned, so source_factor_id stays null —
  // the invoice↔settlement dependency rules do not apply to this flow.
  const base = buildRpcItemsPayload([source], {}, null, null);

  const tripCode = trip.trip_code || trip.id.slice(0, 8);

  // Replace the auto-generated description/details with trip-specific
  // values so the future settlement dashboard can group by trip_code
  // without parsing free-text.
  return base.map((item, idx) => ({
    ...item,
    description: [
      "تسویه کرایه سفر",
      `سرویس: ${tripCode}`,
      source.payments.length > 1 ? `پرداخت ${idx + 1}/${source.payments.length}` : null,
    ].filter(Boolean).join(" — "),
    details: {
      ...(item.details || {}),
      // These three keys are the documented grouping contract on the
      // dashboard side. We pin them explicitly so any future change in
      // `buildRpcItemsPayload`'s defaults can't break trip grouping.
      source_kind: "freight_trip",
      source_reference: tripCode,
      freight_trip_id: trip.id,
    },
  }));
}

/**
 * End-to-end submit:
 *   1. Validate (caller should have already; we re-check defensively).
 *   2. Convert Jalali due dates → Gregorian ISO (RPC contract).
 *   3. Call `submit_payment_request` — it returns the new request UUID
 *      directly (see types.ts: Returns: string). We MUST use that return
 *      value; a "latest request by title" lookup is explicitly forbidden
 *      because it is racy and brittle.
 *   4. Link the new request id back to `freight_trips` with a conditional
 *      UPDATE so a two-tab race cannot produce a second link. The partial
 *      unique index `ux_freight_trips_settlement_request_active` is the
 *      DB-level backstop.
 *   5. Flip status to "settlement_created".
 *
 * Returns the new request id on success, throws on any failure.
 */
export async function submitFreightTripSettlement(
  trip: FreightTrip,
  source: SettlementSource,
): Promise<string> {
  // Step 1 — defensive validation.
  const errs = validateFreightTripSettlement(trip, source);
  if (errs.length > 0) {
    throw new Error(errs.map((e) => `• ${e.message}`).join("\n"));
  }

  // Pre-flight idempotency guard — block if a request was already linked
  // (e.g. earlier successful submit, refresh missed). The conditional
  // UPDATE in step 4 would also catch this, but failing fast here lets us
  // avoid creating an orphan request.
  if (trip.settlement_request_id) {
    throw new Error("درخواست تسویه قبلاً برای این سرویس ثبت شده است.");
  }

  // Step 2 — build items and convert Jalali → Gregorian for the wire.
  // The RPC expects Gregorian ISO dates (see MixedInvoiceForm submit).
  const items = buildFreightTripRpcItems(source, trip);
  const wireItems = items.map((i) => ({
    ...i,
    due_date: jalaliToGregorianDate(i.due_date || "") || "",
    // Mirror the status fields that the invoice path sets — keeps the
    // RPC's behaviour identical for downstream consumers (dashboard,
    // execution panel).
    status: "pending_approval",
    execution_status: "pending",
  }));

  const tripCode = trip.trip_code || trip.id.slice(0, 8);
  const requestPayload = {
    title: `تسویه کرایه سفر حمل ${tripCode}`,
    description: `تولید خودکار از سرویس حمل ${tripCode}`,
    request_type: "purchase",
    legacy_request_type_code: 2, // same code the invoice path uses
    status: "pending_approval",
  };

  // Step 3 — submit. The RPC returns the new request id as a plain string.
  const { data: requestId, error: rpcErr } = await supabase.rpc(
    "submit_payment_request" as never,
    { p_request: requestPayload, p_items: wireItems } as never,
  );
  if (rpcErr) throw rpcErr;
  // Type the RPC return defensively. types.ts declares it as `string` but
  // we narrow at runtime so a future RPC signature drift fails loudly
  // instead of silently writing `null` to the link column.
  if (typeof requestId !== "string" || !requestId) {
    throw new Error("RPC شناسه درخواست تسویه را برنگرداند.");
  }

  // Step 4 — link back with conditional UPDATE. The WHERE clause is the
  // application-level race guard; the partial unique index is the DB
  // backstop. If 0 rows are updated, the trip status changed under us —
  // we surface that as an error and leave the orphan request visible so
  // the operator can decide what to do (matches the Scenario-10 pattern
  // already established by the invoice flow).
  const { data: updated, error: linkErr } = await supabase
    .from("freight_trips")
    .update({
      settlement_request_id: requestId,
      status: "settlement_created",
    })
    .eq("id", trip.id)
    .eq("status", "allocated")
    .is("settlement_request_id", null)
    .select("id");
  if (linkErr) throw linkErr;
  if (!updated || updated.length === 0) {
    throw new Error(
      "درخواست تسویه ثبت شد ولی اتصال به سرویس ناموفق بود (احتمالاً وضعیت سرویس تغییر کرده). لطفاً صفحه را تازه‌سازی کنید.",
    );
  }

  return requestId;
}

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

/** Stable id generator — same fallback used by invoiceSettlementBuilder. */
function cryptoRandom(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// Re-export for the dialog convenience.
export { SOURCE_KIND_LABEL_FA };
