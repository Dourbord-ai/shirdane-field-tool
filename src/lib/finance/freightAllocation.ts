// ---------------------------------------------------------------------------
// Task 6 — Pure allocator for freight trips.
//
// One trip has ONE total_amount (driver fee). It is split across N invoices
// using one of three methods (by_weight | by_invoice_amount | manual).
//
// Why a separate, pure module:
//   - Same formula is needed in three places: the editor preview, the save
//     RPC wrapper, and (later) unit tests. Centralizing prevents drift.
//   - No React, no Supabase — trivially testable.
//   - Returns integer Rial only. The last allocation row absorbs the
//     rounding remainder so SUM(shares) == total_amount EXACTLY.
//
// Scope guard: this module only computes shares. It never touches the DB,
// never triggers settlements, never recomputes cost-price.
// ---------------------------------------------------------------------------

export type AllocationMethod = "by_weight" | "by_invoice_amount" | "manual";

/** What the allocator needs to know about each invoice attached to a trip. */
export interface AllocationInput {
  /** Local id — pass through to the result so callers can match rows. */
  key: string;
  /** Weight in kg. Used when method = 'by_weight'. */
  cargo_weight_kg?: number | null;
  /** Invoice payable amount. Used when method = 'by_invoice_amount'. */
  invoice_payable_amount?: number | null;
  /** Operator-typed share. Used when method = 'manual'. */
  manual_share_amount?: number | null;
}

/** One allocation result per input, in the SAME order as the input. */
export interface AllocationResult {
  key: string;
  /** Computed integer-Rial share. Always >= 0. */
  allocated_amount: number;
  /** Percentage of total (0..100, two-decimal). Useful for the preview UI. */
  percentage: number;
  /** Audit basis written to factor_related_costs.freight_trip_share_basis. */
  basis: "weight" | "amount" | "manual";
}

/** Aggregate report returned alongside the per-row results. */
export interface AllocationReport {
  /** Mirrors the input total_amount for convenience. */
  total: number;
  /** Sum of allocated_amount across results. By construction == total. */
  allocated: number;
  /** total - allocated. Should be 0 after last-row absorption. */
  remainder: number;
  /** True when the inputs were insufficient to compute (see notes). */
  hasError: boolean;
  /** Persian-friendly error message when hasError = true. */
  errorMessage: string | null;
}

/**
 * Coerce loosely-typed numeric input to a non-negative finite number.
 * Empty/null/NaN/negative all collapse to 0 so the allocator never divides
 * by a bad weight and never produces a negative share.
 */
function toNonNeg(v: number | null | undefined): number {
  if (v === null || v === undefined) return 0;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

/**
 * Allocate `total` across `inputs` using `method`.
 *
 * Returns BOTH a per-input result array AND an aggregate report. Callers
 * (the editor preview) typically display both; the save RPC wrapper only
 * cares about the per-input shares.
 *
 * Edge cases:
 *   - total <= 0:              every share is 0, hasError = true.
 *   - inputs empty:            no shares, hasError = true.
 *   - by_weight with Σw == 0:  every share is 0, hasError = true.
 *   - by_amount with Σa == 0:  every share is 0, hasError = true.
 *   - manual with Σm != total: shares == inputs, hasError = true, remainder
 *                              reports the mismatch so the UI can show a
 *                              clear diff to the operator before save.
 */
export function allocate(
  total: number,
  method: AllocationMethod,
  inputs: AllocationInput[],
): { results: AllocationResult[]; report: AllocationReport } {
  // Defensive coercion — callers may pass strings from form state.
  const t = Math.max(0, Math.round(Number(total) || 0));

  if (!inputs.length) {
    return {
      results: [],
      report: {
        total: t,
        allocated: 0,
        remainder: t,
        hasError: true,
        errorMessage: "هیچ فاکتوری برای تخصیص انتخاب نشده است",
      },
    };
  }

  if (t <= 0) {
    return {
      results: inputs.map((i) => ({
        key: i.key,
        allocated_amount: 0,
        percentage: 0,
        basis: method === "by_weight" ? "weight" : method === "manual" ? "manual" : "amount",
      })),
      report: {
        total: t,
        allocated: 0,
        remainder: 0,
        hasError: true,
        errorMessage: "مبلغ کل سرویس باید بزرگ‌تر از صفر باشد",
      },
    };
  }

  // -------------------------------------------------------------------------
  // Branch on method. Each branch produces `shares: number[]` in input order
  // BEFORE rounding + remainder absorption, then we converge into a single
  // post-processing block.
  // -------------------------------------------------------------------------

  let rawShares: number[] = [];
  let basis: AllocationResult["basis"] = "weight";
  let errorMessage: string | null = null;
  let hasError = false;

  if (method === "by_weight") {
    basis = "weight";
    const weights = inputs.map((i) => toNonNeg(i.cargo_weight_kg));
    const sumW = weights.reduce((a, b) => a + b, 0);
    if (sumW <= 0) {
      hasError = true;
      errorMessage = "برای تخصیص بر اساس وزن، وزن همه فاکتورها باید وارد شود";
      rawShares = inputs.map(() => 0);
    } else {
      rawShares = weights.map((w) => (t * w) / sumW);
    }
  } else if (method === "by_invoice_amount") {
    basis = "amount";
    const amounts = inputs.map((i) => toNonNeg(i.invoice_payable_amount));
    const sumA = amounts.reduce((a, b) => a + b, 0);
    if (sumA <= 0) {
      hasError = true;
      errorMessage = "مبلغ پرداختی فاکتورها برای تخصیص نسبتی صفر است";
      rawShares = inputs.map(() => 0);
    } else {
      rawShares = amounts.map((a) => (t * a) / sumA);
    }
  } else {
    // manual
    basis = "manual";
    const m = inputs.map((i) => toNonNeg(i.manual_share_amount));
    const sumM = m.reduce((a, b) => a + b, 0);
    rawShares = m;
    // The mismatch IS the error signal the UI cares about — we don't zero
    // out the shares, we surface the diff in the report so the operator
    // can fix the offending row.
    if (Math.round(sumM) !== t) {
      hasError = true;
      errorMessage =
        sumM > t
          ? `مجموع سهم‌ها ${Math.round(sumM).toLocaleString("fa-IR")} ریال بیشتر از مبلغ کل است`
          : `مجموع سهم‌ها ${Math.round(sumM).toLocaleString("fa-IR")} ریال کمتر از مبلغ کل است`;
    }
  }

  // -------------------------------------------------------------------------
  // Round to integer Rial. For non-manual methods, the last row absorbs the
  // rounding remainder so SUM(rounded) == t exactly. For manual we leave
  // the operator-typed numbers untouched (rounding them would silently
  // alter user input).
  // -------------------------------------------------------------------------
  const rounded = rawShares.map((s) => Math.round(s));

  if (method !== "manual" && !hasError) {
    const sumRounded = rounded.reduce((a, b) => a + b, 0);
    const diff = t - sumRounded;
    // Absorb into the last NON-ZERO share when possible; else just the last.
    if (diff !== 0) {
      let absorbIdx = rounded.length - 1;
      for (let i = rounded.length - 1; i >= 0; i--) {
        if (rounded[i] > 0) { absorbIdx = i; break; }
      }
      rounded[absorbIdx] += diff;
    }
  }

  const allocated = rounded.reduce((a, b) => a + b, 0);

  const results: AllocationResult[] = inputs.map((inp, i) => {
    const share = rounded[i] ?? 0;
    const pct = t > 0 ? (share / t) * 100 : 0;
    return {
      key: inp.key,
      allocated_amount: share,
      // Two-decimal precision keeps the preview readable while still showing
      // tiny shares (< 1%) as non-zero.
      percentage: Math.round(pct * 100) / 100,
      basis,
    };
  });

  return {
    results,
    report: {
      total: t,
      allocated,
      remainder: t - allocated,
      hasError,
      errorMessage,
    },
  };
}

/** Persian label per allocation method — used by the editor & detail page. */
export const ALLOCATION_METHOD_LABEL: Record<AllocationMethod, string> = {
  by_weight: "بر اساس وزن بار",
  by_invoice_amount: "بر اساس مبلغ فاکتور",
  manual: "تخصیص دستی",
};
