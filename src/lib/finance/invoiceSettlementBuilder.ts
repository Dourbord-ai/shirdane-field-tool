// ---------------------------------------------------------------------------
// Tasks 2 + 3 — Pure helpers for the invoice-form settlement workflow.
//
// This module is intentionally PURE (no React, no supabase) so it can be:
//   - unit-tested in isolation
//   - re-used by future surfaces (importers, RPCs, edit-mode)
//   - reasoned about without mocking the database
//
// It owns the data shapes used by InvoiceSettlementSourcesBlock + friends,
// the reconciliation rules between cost drafts and their derived sources,
// the per-source allocation math, the validation rules, and the
// payload-builder that turns the sources into the `p_items` payload
// expected by the existing `submit_payment_request` RPC.
// ---------------------------------------------------------------------------

import type { RelatedCostInput } from "@/lib/finance/relatedCosts";
import { validateDetails, type SettlementItemDetails } from "@/lib/finance/settlementItemDetails";
import { buildPaymentRequestItemAmountType, type PaymentAmountTypeKey } from "@/lib/paymentAmountTypes";
import type { PaymentMethod, SettlementSubjectType } from "@/lib/finance/settlementItemTypes";

// ---------------------------------------------------------------------------
// Drafts held in MixedInvoiceForm state
// ---------------------------------------------------------------------------

/** A related-cost row that has not yet been written to the DB. */
export type DraftCost = RelatedCostInput & { _draftId: string };

/**
 * One payment line inside a source. Mirrors the columns the
 * PaymentRequestsTab dialog already collects so the RPC payload builder is
 * a trivial 1:1 projection.
 */
export interface PaymentDraft {
  _draftId: string;
  amount: number;
  /** Jalali "YYYY/MM/DD" — converted to Gregorian at submit time. */
  due_date: string;
  payment_method: PaymentMethod | "";
  /** Defaults to "main_invoice" for seller, otherwise mirrors source kind. */
  settlement_subject_type: SettlementSubjectType;
  /** Business basis of the request amount — drives Sepidar treatment. */
  amount_type_key: PaymentAmountTypeKey;
  details: SettlementItemDetails;
  execution_priority: 1 | 2 | 3 | 4;
}

/**
 * A settlement source is the atomic unit of settlement configuration.
 * One source per (seller + each related-cost draft). Each source has its
 * OWN requirement flag, payment list, and allocation summary.
 *
 * The user-visible enum `settlement_requirement` (per the final brief)
 * replaces the previous boolean `settlement_enabled` so the choice is
 * explicit and reviewable.
 */
export type SettlementRequirement = "requires_settlement" | "no_settlement";

export type SourceKind = "seller" | "freight" | "weighing" | "unloading" | "misc";

export interface SettlementSource {
  /**
   * Stable identifier — survives renames/reorders. Format:
   *   seller-main | <kind>-<costDraftId>
   * Also persisted into every emitted item's `details.source_reference`
   * for future dashboard/reporting use.
   */
  source_id: string;
  kind: SourceKind;
  origin:
    | { type: "seller" }
    | { type: "cost"; costDraftId: string };
  /** Default party — mirrors origin; user-editable. */
  party_id: string | null;
  /** Display-only party name snapshot for the review dialog. */
  party_label: string | null;
  /** Default total — mirrors origin; user-editable. */
  total: number;
  /** Explicit requirement choice; replaces the prior boolean enabled flag. */
  settlement_requirement: SettlementRequirement;
  /**
   * True once the user has manually edited the source's total or payments.
   * Prevents `deriveSources` from clobbering user edits when the underlying
   * origin (e.g. cost amount) changes.
   */
  user_dirty: boolean;
  payments: PaymentDraft[];
}

// ---------------------------------------------------------------------------
// Kind classification
// ---------------------------------------------------------------------------

/** Classify a cost draft into one of the four cost-source kinds. */
export function kindForCost(draft: Pick<DraftCost, "cost_category" | "cost_type">): Exclude<SourceKind, "seller"> {
  if (draft.cost_category === "freight") return "freight";
  if (draft.cost_type === "weighing") return "weighing";
  if (draft.cost_type === "unloading") return "unloading";
  return "misc";
}

/** Persian label per kind — used by source-card headers + review dialog. */
export const SOURCE_KIND_LABEL_FA: Record<SourceKind, string> = {
  seller: "فروشنده فاکتور",
  freight: "حمل",
  weighing: "باسکول",
  unloading: "تخلیه",
  misc: "متفرقه",
};

/** Map source kind → settlement_subject_type stored on each emitted item. */
export function subjectTypeForKind(kind: SourceKind): SettlementSubjectType {
  switch (kind) {
    case "seller":   return "main_invoice";
    case "freight":  return "freight";
    case "weighing": return "weighing";
    case "unloading":return "unloading";
    case "misc":     return "misc";
  }
}

// ---------------------------------------------------------------------------
// Source reconciliation
// ---------------------------------------------------------------------------

export interface DeriveSourcesInput {
  financePartyId: string | null;
  financePartyLabel: string | null;
  invoicePayable: number;
  costDrafts: DraftCost[];
}

/**
 * Reconcile the current source list against the live invoice + cost-drafts:
 *
 *   - Always include exactly one seller source ("seller-main").
 *   - One cost source per cost draft, keyed by "<kind>-<costDraftId>".
 *   - For sources whose `user_dirty=false` we re-mirror origin values
 *     (party_id/total) and rebalance the single auto-payment, so the UI
 *     stays in lock-step with cost edits.
 *   - For `user_dirty=true` sources we preserve the user's values verbatim
 *     and let the allocation summary surface any resulting drift.
 *   - Sources whose origin no longer exists (cost draft deleted) are dropped.
 */
export function deriveSources(
  input: DeriveSourcesInput,
  existing: SettlementSource[],
): SettlementSource[] {
  const byId = new Map(existing.map((s) => [s.source_id, s]));
  const next: SettlementSource[] = [];

  // ---- Seller source ----
  const sellerExisting = byId.get("seller-main");
  if (sellerExisting) {
    if (sellerExisting.user_dirty) {
      next.push(sellerExisting);
    } else {
      next.push({
        ...sellerExisting,
        party_id: input.financePartyId,
        party_label: input.financePartyLabel,
        total: input.invoicePayable,
        payments: rebalanceAuto(sellerExisting.payments, input.invoicePayable),
      });
    }
  } else {
    next.push(makeSellerSource(input));
  }

  // ---- Cost sources (preserve declaration order of cost drafts) ----
  for (const cost of input.costDrafts) {
    const kind = kindForCost(cost);
    const id = `${kind}-${cost._draftId}`;
    const prev = byId.get(id);
    if (prev) {
      if (prev.user_dirty) {
        next.push(prev);
      } else {
        next.push({
          ...prev,
          party_id: cost.party_id,
          party_label: cost.driver_name || null,
          total: Number(cost.amount) || 0,
          payments: rebalanceAuto(prev.payments, Number(cost.amount) || 0),
        });
      }
    } else {
      next.push(makeCostSource(cost, kind));
    }
  }

  return next;
}

function makeSellerSource(input: DeriveSourcesInput): SettlementSource {
  const total = input.invoicePayable || 0;
  return {
    source_id: "seller-main",
    kind: "seller",
    origin: { type: "seller" },
    party_id: input.financePartyId,
    party_label: input.financePartyLabel,
    total,
    settlement_requirement: "no_settlement", // explicit opt-in per brief
    user_dirty: false,
    payments: [defaultPayment(total)],
  };
}

function makeCostSource(cost: DraftCost, kind: Exclude<SourceKind, "seller">): SettlementSource {
  const total = Number(cost.amount) || 0;
  return {
    source_id: `${kind}-${cost._draftId}`,
    kind,
    origin: { type: "cost", costDraftId: cost._draftId },
    party_id: cost.party_id,
    party_label: cost.driver_name || null,
    total,
    // Seed from the cost's payment_required flag for ergonomics, but once
    // here it becomes its OWN field — toggling payment_required later does
    // not change settlement_requirement (the explicit decoupling per brief).
    settlement_requirement: cost.payment_required ? "requires_settlement" : "no_settlement",
    user_dirty: false,
    payments: [defaultPayment(total)],
  };
}

function defaultPayment(amount: number): PaymentDraft {
  return {
    _draftId: cryptoRandom(),
    amount,
    due_date: "",
    payment_method: "",
    settlement_subject_type: "main_invoice",
    amount_type_key: "creditor",
    details: {},
    execution_priority: 3,
  };
}

/** Best-effort UUID — avoids importing crypto in non-DOM contexts. */
function cryptoRandom(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// ---------------------------------------------------------------------------
// Payment-count + auto split
// ---------------------------------------------------------------------------

/**
 * Even-split helper. Splits an integer Rial total into N parts; remainder
 * goes to the last part so the sum always equals `total`.
 */
export function splitAmountEvenly(total: number, n: number): number[] {
  if (n <= 0) return [];
  const t = Math.max(0, Math.floor(Number(total) || 0));
  const base = Math.floor(t / n);
  const out: number[] = new Array(n).fill(base);
  const remainder = t - base * n;
  if (n > 0) out[n - 1] = base + remainder;
  return out;
}

/**
 * Resize the payment list for a source without losing user-entered fields.
 * Adds blank rows when growing, trims from the end when shrinking, and
 * (when the source is NOT user_dirty) rebalances amounts via splitAmountEvenly.
 */
export function resizePayments(source: SettlementSource, count: number): SettlementSource {
  const c = Math.max(1, Math.min(20, Math.floor(count)));
  let payments = source.payments.slice(0, c);
  while (payments.length < c) payments.push(defaultPayment(0));
  if (!source.user_dirty) {
    const split = splitAmountEvenly(source.total, c);
    payments = payments.map((p, i) => ({ ...p, amount: split[i] }));
  }
  return { ...source, payments };
}

/** Re-run the even split (used by "تقسیم خودکار" button). */
export function rebalanceAuto(payments: PaymentDraft[], total: number): PaymentDraft[] {
  if (payments.length === 0) return [defaultPayment(total)];
  const split = splitAmountEvenly(total, payments.length);
  return payments.map((p, i) => ({ ...p, amount: split[i] }));
}

// ---------------------------------------------------------------------------
// Allocation summary
// ---------------------------------------------------------------------------

export interface Allocation {
  total: number;
  allocated: number;
  remaining: number;
}

export function computeAllocation(source: SettlementSource): Allocation {
  const total = Number(source.total) || 0;
  const allocated = source.payments.reduce((acc, p) => acc + (Number(p.amount) || 0), 0);
  return { total, allocated, remaining: total - allocated };
}

// ---------------------------------------------------------------------------
// Settlement-basis preview (per source)
// ---------------------------------------------------------------------------

/**
 * Per-source breakdown of business-basis amounts:
 *
 *   - debt:     amount_type_key === "creditor"   → بستانکار (debt settlement)
 *   - advance:  amount_type_key === "advance"    → پیش پرداخت
 *   - onAccount:amount_type_key === "on_account" → علی الحساب
 *
 * `mixed` is true when more than one of {debt, advance, onAccount} is
 * non-zero — the UI surfaces a "ترکیبی" badge so the operator notices.
 */
export interface BasisBreakdown {
  debt: number;
  advance: number;
  onAccount: number;
  mixed: boolean;
}

export function computeBasis(source: SettlementSource): BasisBreakdown {
  let debt = 0, advance = 0, onAccount = 0;
  for (const p of source.payments) {
    const a = Number(p.amount) || 0;
    if (p.amount_type_key === "creditor") debt += a;
    else if (p.amount_type_key === "advance") advance += a;
    else if (p.amount_type_key === "on_account") onAccount += a;
  }
  const nonZero = [debt, advance, onAccount].filter((v) => v > 0).length;
  return { debt, advance, onAccount, mixed: nonZero > 1 };
}

// ---------------------------------------------------------------------------
// Auto-assignment of amount_type_key (UAT Fix 1 — Issue 2)
//
// The operator no longer picks "creditor / advance / on_account" manually in
// the invoice settlement UI. Instead we derive each payment's basis from the
// party's CURRENT balance vs the payment amount:
//
//   - convention: finance_parties.balance is NEGATIVE when the party is a
//     creditor (i.e. we owe them). availableCreditor = abs(min(balance, 0)).
//   - we walk payments in order, consuming availableCreditor first:
//       payment.amount <= remaining availableCreditor  → "creditor"
//                                              otherwise → "on_account"
//   - "on_account" is the SAFE default — `validateCreditorBalance` only
//     runs for creditor items, and `submit_payment_request` already
//     accepts on_account items without balance preconditions.
//
// The function is pure and idempotent — call it on every derive/balance
// change and pass the result to display + RPC builders. Source state held
// by the form keeps an `amount_type_key` field for back-compat, but it is
// effectively ignored once this helper runs.
// ---------------------------------------------------------------------------
export function applyAutoAmountTypes(
  sources: SettlementSource[],
  partyBalances: Record<string, number>,
): SettlementSource[] {
  return sources.map((s) => {
    if (!s.party_id) return s;
    const bal = Number(partyBalances[s.party_id] ?? 0);
    // Negative balance means we owe them (creditor) → available pool.
    let available = bal < 0 ? Math.abs(bal) : 0;
    const payments = s.payments.map((p) => {
      const amt = Number(p.amount) || 0;
      let key: PaymentAmountTypeKey;
      if (amt > 0 && available + 1e-6 >= amt) {
        key = "creditor";
        available -= amt;
      } else {
        key = "on_account";
      }
      return { ...p, amount_type_key: key };
    });
    return { ...s, payments };
  });
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface ValidationError {
  source_id: string;
  payment_index?: number;
  message: string;
}

export function validateSources(
  sources: SettlementSource[],
  financePartyId: string | null,
): ValidationError[] {
  const errors: ValidationError[] = [];

  for (const s of sources) {
    if (s.settlement_requirement !== "requires_settlement") continue;

    // Brief: explicit guard — block when seller settlement requires settlement
    // but the invoice has no finance_party_id.
    if (s.kind === "seller" && !financePartyId) {
      errors.push({
        source_id: s.source_id,
        message: "تسویه فروشنده انتخاب شده اما طرف حساب فاکتور مشخص نیست.",
      });
      continue;
    }

    if (!s.party_id) {
      errors.push({ source_id: s.source_id, message: `طرف‌حساب منبع «${SOURCE_KIND_LABEL_FA[s.kind]}» مشخص نیست.` });
    }
    if (!(Number(s.total) > 0)) {
      errors.push({ source_id: s.source_id, message: `مبلغ کل منبع باید بزرگ‌تر از صفر باشد.` });
    }

    const alloc = computeAllocation(s);
    if (Math.abs(alloc.remaining) > 0.5) {
      errors.push({
        source_id: s.source_id,
        message: `تخصیص پرداخت‌های ${s.source_id} برابر مبلغ کل نیست (باقیمانده: ${alloc.remaining.toLocaleString("fa-IR")} ریال).`,
      });
    }

    for (let i = 0; i < s.payments.length; i++) {
      const p = s.payments[i];
      if (!(Number(p.amount) > 0)) {
        errors.push({ source_id: s.source_id, payment_index: i, message: `پرداخت ${i + 1}: مبلغ نامعتبر.` });
      }
      if (!p.due_date) {
        errors.push({ source_id: s.source_id, payment_index: i, message: `پرداخت ${i + 1}: تاریخ سررسید لازم است.` });
      }
      if (!p.payment_method) {
        errors.push({ source_id: s.source_id, payment_index: i, message: `پرداخت ${i + 1}: روش پرداخت لازم است.` });
      } else {
        // Method-specific validation (re-uses Task 1's check rules etc.).
        const det = validateDetails(p.payment_method, p.details);
        if (det) errors.push({ source_id: s.source_id, payment_index: i, message: `پرداخت ${i + 1}: ${det}` });
      }
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// RPC payload builder
// ---------------------------------------------------------------------------

/**
 * Build the `p_items` array for `submit_payment_request`. Only sources with
 * `settlement_requirement === "requires_settlement"` contribute items.
 *
 * `costIdByDraftId` maps a cost draft's local id to the actual DB id assigned
 * in step 4 of the save sequence; cost-derived items use it to populate
 * `source_related_cost_id`. Seller items always send null for that field.
 *
 * Each item carries a `source_reference` inside its `details` payload so the
 * future settlement dashboard can group + report by source without needing
 * a new column.
 */
export interface RpcItemPayload {
  party_id: string | null;
  amount: number;
  amount_type_code: number;
  amount_type: PaymentAmountTypeKey;
  description: string;
  payment_method: PaymentMethod | "";
  settlement_subject_type: SettlementSubjectType;
  due_date: string; // jalali "YYYY/MM/DD" — parent dialog already converts to Gregorian
  execution_priority: number;
  details: Record<string, unknown>;
  source_related_cost_id: string | null;
}

export function buildRpcItemsPayload(
  sources: SettlementSource[],
  costIdByDraftId: Record<string, string>,
  invoiceNumberForDesc: string | null,
): RpcItemPayload[] {
  const out: RpcItemPayload[] = [];
  for (const s of sources) {
    if (s.settlement_requirement !== "requires_settlement") continue;
    const subjectType = subjectTypeForKind(s.kind);
    const sourceRelatedCostId =
      s.origin.type === "cost" ? costIdByDraftId[s.origin.costDraftId] ?? null : null;

    s.payments.forEach((p, idx) => {
      const at = buildPaymentRequestItemAmountType(p.amount_type_key);
      // Inject the per-source reference + per-payment ordinal into details so
      // the historical jsonb payload remains the single source of truth for
      // grouping/reporting (no schema change needed).
      const details = {
        ...(p.details || {}),
        source_reference: s.source_id,
        source_kind: s.kind,
        payment_ordinal: idx + 1,
        payment_count: s.payments.length,
      };
      const desc = [
        SOURCE_KIND_LABEL_FA[s.kind],
        invoiceNumberForDesc ? `فاکتور: ${invoiceNumberForDesc}` : null,
        s.payments.length > 1 ? `پرداخت ${idx + 1}/${s.payments.length}` : null,
      ].filter(Boolean).join(" — ");

      out.push({
        party_id: s.party_id,
        amount: Number(p.amount) || 0,
        amount_type_code: at.amount_type_code,
        amount_type: at.amount_type,
        description: desc,
        payment_method: p.payment_method,
        settlement_subject_type: subjectType,
        due_date: p.due_date,
        execution_priority: p.execution_priority ?? 3,
        details,
        source_related_cost_id: sourceRelatedCostId,
      });
    });
  }
  return out;
}
