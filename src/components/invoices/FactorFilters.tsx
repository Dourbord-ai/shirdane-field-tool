// =============================================================================
// FactorFilters
// =============================================================================
// Advanced server-side filter panel for the Invoices (factors) list. The
// component is purely controlled — its parent owns the filter state and is
// responsible for syncing it to URL search params, so refresh / share-link
// scenarios "just work". All filtering happens server-side via the
// `list_factors_filtered` RPC, so this component just *describes* the filter
// inputs and never touches the data itself.
//
// Layout strategy:
//   - On lg+ screens we render the filter panel inline above the list as an
//     always-visible card (`hidden lg:block`).
//   - On smaller screens we collapse the entire panel behind a "فیلترهای
//     پیشرفته" button which expands a bottom-sheet-style drawer (`block
//     lg:hidden`). This keeps the mobile list scannable while still giving
//     full access to every filter dimension.
// =============================================================================

import { useState } from "react";
import { Filter, X, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import SearchableSelect from "@/components/SearchableSelect";
import ShamsiDatePicker from "@/components/ShamsiDatePicker";

// -----------------------------------------------------------------------------
// Public shape of the filter state. Parent stores this and passes it back in.
// Every field is optional / nullable because "no filter" is the default state.
// -----------------------------------------------------------------------------
export interface FactorFiltersValue {
  // Jalali "YYYY/MM/DD" strings — converted to Gregorian timestamptz at the
  // call boundary (the page-level RPC caller), not here.
  fromDate: string;
  toDate: string;
  invoiceNumber: string;
  // finance_parties.id (uuid) of the selected counterparty. Empty string = any.
  financePartyId: string;
  // 'purchase' | 'sale' | '' (= both directions)
  direction: "" | "purchase" | "sale";
  // Multi-select arrays of product_type values (e.g. ['feed','livestock']).
  productTypes: string[];
  // Multi-select arrays of derived_status values (see RPC for the mapping).
  statuses: string[];
}

export const EMPTY_FILTERS: FactorFiltersValue = {
  fromDate: "",
  toDate: "",
  invoiceNumber: "",
  financePartyId: "",
  direction: "",
  productTypes: [],
  statuses: [],
};

// -----------------------------------------------------------------------------
// Category chip definitions. The `value` MUST match what's stored in
// `factors.product_type` so the server-side filter works without any mapping.
// Legacy rows use product_type='legacy_product_*' and are intentionally NOT
// surfaced as choosable chips — they're still visible when no filter is set.
// -----------------------------------------------------------------------------
const PRODUCT_CHIPS: Array<{ label: string; value: string }> = [
  { label: "دام", value: "livestock" },
  { label: "خوراک", value: "feed" },
  { label: "دارو", value: "medicine" },
  { label: "اسپرم", value: "sperm" },
  { label: "شیر", value: "milk" },
  // Manure (کود دامی) — single category, direction lives in invoice_type
  // (buy/sell), same as خوراک. Use the direction filter alongside this chip
  // to narrow to purchases or sales.
  { label: "کود دامی", value: "manure" },
  { label: "خدمات", value: "services" },
  { label: "کرایه", value: "rental" },
  { label: "سایر", value: "other" },
];

// -----------------------------------------------------------------------------
// Status chips. The `value` matches the `derived_status` column produced by
// `list_factors_filtered` (see migration). Keep them aligned with the RPC.
// -----------------------------------------------------------------------------
const STATUS_CHIPS: Array<{ label: string; value: string }> = [
  { label: "پیش‌نویس / در انتظار تأیید", value: "draft" },
  { label: "تأیید شده", value: "approved" },
  { label: "لغو شده", value: "cancelled" },
  { label: "ثبت شده در سپیدار", value: "posted" },
  { label: "خطای ساخت سند", value: "voucher_failed" },
  { label: "خطای ثبت سپیدار", value: "sepidar_failed" },
];

interface Props {
  value: FactorFiltersValue;
  // Parent receives the *next* value and is expected to flush it to state +
  // URL search params. We never call this mid-typing for inputs that should
  // trigger expensive queries — the parent decides debounce/strategy.
  onChange: (next: FactorFiltersValue) => void;
  // Called when the user clicks "اعمال فیلتر" (submit). We keep this separate
  // from `onChange` so parents can choose to defer the actual RPC call until
  // the explicit submit instead of refetching on every keystroke.
  onApply: () => void;
  // Options for the counterparty selector — built once at the page level so
  // we don't fetch finance_parties separately per filter mount.
  partyOptions: Array<{ label: string; value: string }>;
  // Loading state of partyOptions, used to disable the selector gracefully.
  partyLoading?: boolean;
}

export default function FactorFilters({
  value,
  onChange,
  onApply,
  partyOptions,
  partyLoading = false,
}: Props) {
  // Mobile expansion state. Inline on lg+ so this only affects the drawer.
  const [mobileOpen, setMobileOpen] = useState(false);

  // ---------------------------------------------------------------------------
  // Convenience helpers — kept inline so the component remains self-contained.
  // ---------------------------------------------------------------------------
  // Toggle a value in a string[] filter (multi-select chips).
  const toggleIn = (arr: string[], v: string) =>
    arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];

  const clearAll = () => {
    onChange(EMPTY_FILTERS);
    // Apply immediately on clear — users almost always want to see the full
    // list right away after wiping filters.
    setTimeout(onApply, 0);
  };

  // ---------------------------------------------------------------------------
  // The actual filter body (rendered both inline on desktop and inside the
  // mobile drawer). Extracted so we don't duplicate JSX.
  // ---------------------------------------------------------------------------
  const Body = (
    <div className="space-y-4">
      {/* Date range — two Shamsi pickers side by side */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1.5">
            تاریخ از
          </label>
          <ShamsiDatePicker
            value={value.fromDate}
            onChange={(v) => onChange({ ...value, fromDate: v })}
            placeholder="انتخاب تاریخ شروع"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1.5">
            تاریخ تا
          </label>
          <ShamsiDatePicker
            value={value.toDate}
            onChange={(v) => onChange({ ...value, toDate: v })}
            placeholder="انتخاب تاریخ پایان"
          />
        </div>
      </div>

      {/* Factor number + counterparty */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1.5">
            شماره فاکتور
          </label>
          <Input
            value={value.invoiceNumber}
            onChange={(e) =>
              onChange({ ...value, invoiceNumber: e.target.value })
            }
            placeholder="مثلاً ۱۲۳۴"
            className="rounded-xl"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1.5">
            طرف حساب
          </label>
          <SearchableSelect
            options={[{ label: "همه طرف‌حساب‌ها", value: "" }, ...partyOptions]}
            value={value.financePartyId}
            onChange={(v) => onChange({ ...value, financePartyId: v })}
            placeholder={partyLoading ? "در حال بارگذاری…" : "همه طرف‌حساب‌ها"}
          />
        </div>
      </div>

      {/* Direction — segmented control */}
      <div>
        <label className="block text-xs font-medium text-muted-foreground mb-1.5">
          جهت فاکتور
        </label>
        <div className="inline-flex rounded-xl border border-border p-1 bg-background">
          {([
            { label: "همه", value: "" },
            { label: "خرید", value: "purchase" },
            { label: "فروش", value: "sale" },
          ] as const).map((opt) => (
            <button
              key={opt.value || "all"}
              type="button"
              onClick={() =>
                onChange({ ...value, direction: opt.value as FactorFiltersValue["direction"] })
              }
              className={cn(
                "px-4 py-1.5 rounded-lg text-sm font-medium transition-colors",
                value.direction === opt.value
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Category multi-select chips */}
      <div>
        <label className="block text-xs font-medium text-muted-foreground mb-1.5">
          دسته
        </label>
        <div className="flex flex-wrap gap-2">
          {PRODUCT_CHIPS.map((c) => {
            const active = value.productTypes.includes(c.value);
            return (
              <button
                key={c.value}
                type="button"
                onClick={() =>
                  onChange({
                    ...value,
                    productTypes: toggleIn(value.productTypes, c.value),
                  })
                }
                className={cn(
                  "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
                  active
                    ? "bg-primary/15 border-primary/30 text-primary"
                    : "bg-background border-border text-muted-foreground hover:text-foreground"
                )}
              >
                {c.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Status multi-select chips */}
      <div>
        <label className="block text-xs font-medium text-muted-foreground mb-1.5">
          وضعیت
        </label>
        <div className="flex flex-wrap gap-2">
          {STATUS_CHIPS.map((s) => {
            const active = value.statuses.includes(s.value);
            return (
              <button
                key={s.value}
                type="button"
                onClick={() =>
                  onChange({
                    ...value,
                    statuses: toggleIn(value.statuses, s.value),
                  })
                }
                className={cn(
                  "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
                  active
                    ? "bg-primary/15 border-primary/30 text-primary"
                    : "bg-background border-border text-muted-foreground hover:text-foreground"
                )}
              >
                {s.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Action row */}
      <div className="flex items-center gap-2 pt-2">
        <Button
          onClick={() => {
            onApply();
            setMobileOpen(false);
          }}
          className="rounded-xl bg-gradient-primary text-primary-foreground glow-primary flex-1 sm:flex-none"
        >
          اعمال فیلتر
        </Button>
        <Button
          onClick={clearAll}
          variant="outline"
          className="rounded-xl"
        >
          حذف فیلترها
        </Button>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop: inline panel always visible */}
      <div className="hidden lg:block rounded-2xl border border-border bg-card p-4">
        <div className="flex items-center gap-2 mb-3">
          <Filter className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-bold text-foreground">فیلترهای پیشرفته</h3>
        </div>
        {Body}
      </div>

      {/* Mobile: collapsed-by-default trigger + bottom drawer */}
      <div className="lg:hidden">
        <Button
          variant="outline"
          onClick={() => setMobileOpen((v) => !v)}
          className="rounded-xl w-full justify-between"
        >
          <span className="flex items-center gap-2">
            <Filter className="w-4 h-4" />
            فیلترهای پیشرفته
          </span>
          <ChevronDown
            className={cn(
              "w-4 h-4 transition-transform",
              mobileOpen && "rotate-180"
            )}
          />
        </Button>

        {mobileOpen && (
          <div className="mt-2 rounded-2xl border border-border bg-card p-4 animate-fade-in">
            {Body}
          </div>
        )}
      </div>
    </>
  );
}

// -----------------------------------------------------------------------------
// URL <-> filter state serialization helpers. Exported so the page component
// can call them from one place. We keep the keys short to make shared URLs
// readable.
// -----------------------------------------------------------------------------
export function filtersToSearchParams(v: FactorFiltersValue): URLSearchParams {
  const p = new URLSearchParams();
  if (v.fromDate) p.set("from", v.fromDate);
  if (v.toDate) p.set("to", v.toDate);
  if (v.invoiceNumber) p.set("num", v.invoiceNumber);
  if (v.financePartyId) p.set("party", v.financePartyId);
  if (v.direction) p.set("dir", v.direction);
  if (v.productTypes.length) p.set("cat", v.productTypes.join(","));
  if (v.statuses.length) p.set("status", v.statuses.join(","));
  return p;
}

export function searchParamsToFilters(sp: URLSearchParams): FactorFiltersValue {
  const dir = sp.get("dir");
  return {
    fromDate: sp.get("from") || "",
    toDate: sp.get("to") || "",
    invoiceNumber: sp.get("num") || "",
    financePartyId: sp.get("party") || "",
    direction:
      dir === "purchase" || dir === "sale" ? dir : "",
    productTypes: sp.get("cat")?.split(",").filter(Boolean) || [],
    statuses: sp.get("status")?.split(",").filter(Boolean) || [],
  };
}

// Returns true if at least one filter is active — used to know whether to
// render the "active filter chips" row above the list.
export function hasActiveFilters(v: FactorFiltersValue): boolean {
  return (
    !!v.fromDate ||
    !!v.toDate ||
    !!v.invoiceNumber ||
    !!v.financePartyId ||
    !!v.direction ||
    v.productTypes.length > 0 ||
    v.statuses.length > 0
  );
}
