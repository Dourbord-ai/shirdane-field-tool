// ---------------------------------------------------------------------------
// MedicineProductPicker
// ---------------------------------------------------------------------------
// Enterprise-grade medicine selector for invoices, treatments, prescriptions
// and inventory. Built once, reused everywhere.
//
// Why a bespoke component (not <SearchableSelect>):
//   - We must NEVER load the full catalog (2.5k → 10k+ rows).
//   - Users need to search simultaneously across 7 Persian + English columns.
//   - Each result must render as a rich card (commercial name, ingredient,
//     company, dosage form, category, withdrawal periods).
//   - After selection we must show a verification banner when the catalog
//     entry has `label_verification_status = 'verify_label_required'`.
//
// Persistence contract:
//   - The picker is "controlled" via `value` (the medicine_product_id) and
//     `selected` (a snapshot of the chosen catalog row, so the parent can
//     render the info panel even after a page refresh without re-fetching).
//   - `onSelect` fires with the FULL catalog row so the parent can copy
//     snapshot fields into its own state and persist them on save.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X, Sparkles, AlertTriangle, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Type contract with the database
// ---------------------------------------------------------------------------
// We only declare the columns the picker actually reads / displays. The full
// row is forwarded to the parent via onSelect, so the parent can pluck any
// additional fields it needs (e.g. withdrawal days for snapshotting).
// ---------------------------------------------------------------------------
export interface MedicineProduct {
  id: number;
  commercial_product_name_fa: string | null;
  commercial_product_name_en: string | null;
  name_fa: string | null;                 // active ingredient (Persian)
  name_en: string | null;                 // active ingredient (English)
  company_name_fa: string | null;
  company_name_en: string | null;
  company_country: string | null;
  category_fa: string | null;
  dosage_form: string | null;
  route_fa: string | null;
  route_en: string | null;
  milk_withdrawal_days: number | null;
  meat_withdrawal_days: number | null;
  label_verification_status: string | null;
}

interface Props {
  // Controlled value: the currently chosen medicine_product_id (or null).
  value: number | null;
  // The full snapshot of the chosen catalog row — so the parent doesn't have
  // to re-fetch on mount just to show the info panel of an existing line.
  selected?: MedicineProduct | null;
  // Fires when the operator picks a medicine. Parent persists snapshot.
  onSelect: (medicine: MedicineProduct) => void;
  // Optional clear handler so the parent can null its FK.
  onClear?: () => void;
}

// ---------------------------------------------------------------------------
// Server-side search with PER-FIELD filters (AND across columns).
// ---------------------------------------------------------------------------
// The operator gets one input per searchable column so they can narrow the
// catalog using whatever attribute they actually remember (commercial name in
// Persian, active ingredient in English, company, category, …). Each
// non-empty filter becomes its own `ilike` predicate, AND-combined by
// PostgREST. Trigram indexes on every column keep this fast at 10k+ rows.
// ---------------------------------------------------------------------------
export type MedicineFilters = {
  commercial_fa: string;
  commercial_en: string;
  ingredient_fa: string;
  ingredient_en: string;
  company_fa: string;
  company_en: string;
  category_fa: string;
};

const EMPTY_FILTERS: MedicineFilters = {
  commercial_fa: "",
  commercial_en: "",
  ingredient_fa: "",
  ingredient_en: "",
  company_fa: "",
  company_en: "",
  category_fa: "",
};

// Map UI filter keys → real DB column names. Keeping this map next to the
// type ensures the input loop, the query builder, and downstream rendering
// stay in lock-step (one place to edit when a column is added/renamed).
const FILTER_COLUMNS: Record<keyof MedicineFilters, string> = {
  commercial_fa: "commercial_product_name_fa",
  commercial_en: "commercial_product_name_en",
  ingredient_fa: "name_fa",
  ingredient_en: "name_en",
  company_fa: "company_name_fa",
  company_en: "company_name_en",
  category_fa: "category_fa",
};

// Persian labels shown above each per-field input.
const FILTER_LABELS: Record<keyof MedicineFilters, string> = {
  commercial_fa: "نام تجاری (فارسی)",
  commercial_en: "نام تجاری (انگلیسی)",
  ingredient_fa: "ماده موثره (فارسی)",
  ingredient_en: "ماده موثره (انگلیسی)",
  company_fa: "نام شرکت (فارسی)",
  company_en: "نام شرکت (انگلیسی)",
  category_fa: "دسته‌بندی",
};

async function searchMedicineProducts(filters: MedicineFilters): Promise<MedicineProduct[]> {
  // Pick out only the filters the operator actually filled in. Commas and
  // parens are stripped because they carry special meaning inside PostgREST
  // filter expressions and would otherwise break the request.
  const active = (Object.keys(FILTER_COLUMNS) as (keyof MedicineFilters)[])
    .map((k) => ({ col: FILTER_COLUMNS[k], val: filters[k].replace(/[,()]/g, " ").trim() }))
    .filter((f) => f.val.length > 0);

  // No active filters → return nothing. We intentionally do NOT pull the
  // whole catalog: the picker is meant to be driven by at least one filter.
  if (active.length === 0) return [];

  // Build the query incrementally. Stacking `.ilike()` calls produces an
  // AND-combined predicate server-side — exactly the narrowing behaviour we
  // want when the operator types into multiple boxes at once.
  let q = supabase
    .from("medicine_products")
    .select(
      "id, commercial_product_name_fa, commercial_product_name_en, name_fa, name_en, company_name_fa, company_name_en, company_country, category_fa, dosage_form, route_fa, route_en, milk_withdrawal_days, meat_withdrawal_days, label_verification_status",
    )
    .eq("is_active", true);
  for (const f of active) q = q.ilike(f.col, `%${f.val}%`);
  const { data, error } = await q.limit(30);

  if (error) {
    // eslint-disable-next-line no-console
    console.error("[MedicineProductPicker] search failed", error);
    return [];
  }
  return (data ?? []) as MedicineProduct[];
}

// ---------------------------------------------------------------------------
// Fetch the "frequently used" chip strip.
// Strategy: pull the most recent factor_item_medicine_details rows that have
// a medicine_product_id, de-duplicate client-side, then resolve the catalog
// rows in a second batched query. Capped at 20 unique medicines.
// ---------------------------------------------------------------------------
async function fetchFrequentlyUsed(): Promise<MedicineProduct[]> {
  const { data: recent, error } = await supabase
    .from("factor_item_medicine_details")
    .select("medicine_product_id, created_at")
    .not("medicine_product_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(200); // grab a window, then de-dupe down to 20

  if (error || !recent) return [];

  // Preserve first-seen order while de-duplicating.
  const seen = new Set<number>();
  const ids: number[] = [];
  for (const r of recent as { medicine_product_id: number | null }[]) {
    const id = r.medicine_product_id;
    if (id && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
      if (ids.length >= 20) break;
    }
  }
  if (ids.length === 0) return [];

  const { data: prods } = await supabase
    .from("medicine_products")
    .select(
      "id, commercial_product_name_fa, commercial_product_name_en, name_fa, name_en, company_name_fa, company_name_en, company_country, category_fa, dosage_form, route_fa, route_en, milk_withdrawal_days, meat_withdrawal_days, label_verification_status",
    )
    .in("id", ids);

  // Re-order to match recency order.
  const byId = new Map<number, MedicineProduct>(
    ((prods ?? []) as MedicineProduct[]).map((p) => [p.id, p]),
  );
  return ids.map((id) => byId.get(id)).filter(Boolean) as MedicineProduct[];
}

// ---------------------------------------------------------------------------
// Tiny presentation helpers
// ---------------------------------------------------------------------------

// Always prefer Persian, fall back to English; useful for every label in this UI.
const pickFa = (fa?: string | null, en?: string | null) =>
  (fa && fa.trim()) || (en && en.trim()) || "";

// Lightweight pill badge — kept inline so the picker is fully self-contained
// and trivial to lift into other surfaces (treatments, prescriptions, …).
function Badge({ children, tone = "default" }: { children: React.ReactNode; tone?: "default" | "primary" | "warning" }) {
  const toneCls =
    tone === "primary"
      ? "bg-primary/15 text-primary border-primary/30"
      : tone === "warning"
      ? "bg-yellow-500/15 text-yellow-300 border-yellow-500/30"
      : "bg-muted/60 text-muted-foreground border-border";
  return (
    <span className={cn("inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium", toneCls)}>
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export default function MedicineProductPicker({ value, selected, onSelect, onClear }: Props) {
  // Sheet open/close state. The picker stays closed by default — the operator
  // clicks the trigger button to open the search sheet.
  const [open, setOpen] = useState(false);

  // Live search text + debounced query + result set.
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MedicineProduct[]>([]);
  const [loading, setLoading] = useState(false);

  // Frequently-used chips: lazy-loaded the first time the sheet opens so we
  // don't issue any DB calls until the operator actually needs the picker.
  const [frequent, setFrequent] = useState<MedicineProduct[]>([]);
  const frequentLoadedRef = useRef(false);

  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus the search input shortly after the sheet opens and lock body
  // scroll so the underlying invoice form doesn't move under the sheet.
  useEffect(() => {
    if (!open) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const t = setTimeout(() => inputRef.current?.focus(), 120);

    // Lazy-load the frequently-used chips once per component lifetime.
    if (!frequentLoadedRef.current) {
      frequentLoadedRef.current = true;
      fetchFrequentlyUsed().then(setFrequent);
    }
    return () => {
      document.body.style.overflow = original;
      clearTimeout(t);
    };
  }, [open]);

  // Close on Escape — standard a11y convention for modal sheets.
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [open]);

  // Live filter state — one entry per searchable column. We keep them in a
  // single object so the debounced effect can depend on the whole snapshot.
  const [filters, setFilters] = useState<MedicineFilters>(EMPTY_FILTERS);
  const [results, setResults] = useState<MedicineProduct[]>([]);
  const [loading, setLoading] = useState(false);

  // True when at least one filter has actual content. Drives whether we show
  // the "frequently used" chips (only on a fully empty form) or the results.
  const anyFilterActive = useMemo(
    () => Object.values(filters).some((v) => v.trim().length > 0),
    [filters],
  );

  // Frequently-used chips: lazy-loaded the first time the sheet opens so we
  // don't issue any DB calls until the operator actually needs the picker.
  const [frequent, setFrequent] = useState<MedicineProduct[]>([]);
  const frequentLoadedRef = useRef(false);

  const firstInputRef = useRef<HTMLInputElement>(null);

  // Auto-focus the first search input shortly after the sheet opens and
  // lock body scroll so the underlying invoice form doesn't shift around.
  useEffect(() => {
    if (!open) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const t = setTimeout(() => firstInputRef.current?.focus(), 120);

    // Lazy-load the frequently-used chips once per component lifetime.
    if (!frequentLoadedRef.current) {
      frequentLoadedRef.current = true;
      fetchFrequentlyUsed().then(setFrequent);
    }
    return () => {
      document.body.style.overflow = original;
      clearTimeout(t);
    };
  }, [open]);

  // Close on Escape — standard a11y convention for modal sheets.
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [open]);

  // Debounced server-side search (300ms). A ref-stored request token ensures
  // an in-flight slow response can never overwrite a fresher one.
  const tokenRef = useRef(0);
  useEffect(() => {
    if (!open) return;
    // No filters at all → clear results immediately, skip the network call.
    if (!anyFilterActive) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const myToken = ++tokenRef.current;
    const t = setTimeout(async () => {
      const rows = await searchMedicineProducts(filters);
      if (myToken !== tokenRef.current) return; // a newer search has started
      setResults(rows);
      setLoading(false);
    }, 300);
    return () => clearTimeout(t);
  }, [filters, anyFilterActive, open]);

  // Helper invoked from both the chip strip and the search results list.
  const handlePick = (m: MedicineProduct) => {
    onSelect(m);
    setOpen(false);
    setFilters(EMPTY_FILTERS);
  };

  // Update a single filter field by key — keeps the handler signature small
  // inside the JSX loop below.
  const setFilter = (k: keyof MedicineFilters, v: string) =>
    setFilters((prev) => ({ ...prev, [k]: v }));

  // Title of the trigger button — shows the selected medicine when known,
  // otherwise prompts the operator to open the picker.
  const triggerTitle = useMemo(() => {
    if (selected) return pickFa(selected.commercial_product_name_fa, selected.commercial_product_name_en);
    return "انتخاب دارو";
  }, [selected]);

  return (
    <div className="space-y-3">
      {/* ----------------- Trigger button ----------------- */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "w-full rounded-xl border-2 px-4 py-3 text-right flex items-center justify-between gap-3 transition-all",
          "focus:outline-none focus:ring-2 focus:ring-ring",
          selected
            ? "border-primary/40 bg-primary/5"
            : "border-input bg-background hover:border-primary/30",
        )}
      >
        <div className="flex-1 min-w-0">
          <div className={cn("text-sm font-semibold truncate", selected ? "text-foreground" : "text-muted-foreground")}>
            {triggerTitle}
          </div>
          {selected && (
            <div className="text-xs text-muted-foreground truncate">
              {pickFa(selected.name_fa, selected.name_en)}
              {selected.company_name_fa ? ` • ${selected.company_name_fa}` : ""}
            </div>
          )}
        </div>
        <Search className="w-4 h-4 text-muted-foreground shrink-0" />
      </button>

      {/* ----------------- Info panel (rendered outside the sheet) ----------------- */}
      {selected && (
        <div className="rounded-xl border border-border bg-card/60 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-xs text-muted-foreground">محصول انتخاب شده</div>
            {onClear && (
              <button
                type="button"
                onClick={onClear}
                className="text-xs text-muted-foreground hover:text-destructive flex items-center gap-1"
              >
                <X className="w-3 h-3" />
                حذف انتخاب
              </button>
            )}
          </div>
          <div className="text-sm font-bold text-foreground">
            {pickFa(selected.commercial_product_name_fa, selected.commercial_product_name_en)}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
            <InfoCell label="ماده موثره" value={pickFa(selected.name_fa, selected.name_en)} />
            <InfoCell label="شرکت" value={pickFa(selected.company_name_fa, selected.company_name_en)} />
            <InfoCell label="کشور" value={selected.company_country} />
            <InfoCell label="فرم دارویی" value={selected.dosage_form} />
            <InfoCell label="روش مصرف" value={pickFa(selected.route_fa, selected.route_en)} />
            <InfoCell label="دسته‌بندی" value={selected.category_fa} />
            <InfoCell label="منع مصرف شیر (روز)" value={selected.milk_withdrawal_days?.toString()} />
            <InfoCell label="منع مصرف گوشت (روز)" value={selected.meat_withdrawal_days?.toString()} />
          </div>

          {/* Yellow warning banner when label data hasn't been locally verified. */}
          {selected.label_verification_status === "verify_label_required" && (
            <div className="flex items-start gap-2 rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-2 text-xs text-yellow-300">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>اطلاعات این محصول هنوز به صورت محلی تایید نشده است.</span>
            </div>
          )}
          {selected.label_verification_status === "verified" && (
            <div className="flex items-center gap-2 text-xs text-primary">
              <CheckCircle2 className="w-3.5 h-3.5" />
              اطلاعات این محصول تایید شده است.
            </div>
          )}
        </div>
      )}

      {/* ----------------- Sheet ----------------- */}
      {open && (
        <div className="fixed inset-0 z-[100] flex items-end sm:items-center sm:justify-center" role="dialog" aria-modal="true">
          {/* Backdrop closes the sheet on click. */}
          <div
            className="absolute inset-0 bg-foreground/40 backdrop-blur-sm animate-fade-in"
            onClick={() => setOpen(false)}
          />

          <div className="relative w-full sm:max-w-2xl sm:rounded-2xl bg-card shadow-2xl flex flex-col h-[92vh] sm:h-[85vh] rounded-t-3xl animate-slide-up overflow-hidden">
            {/* Drag handle — mobile UX cue. */}
            <div className="flex justify-center pt-3 pb-1 sm:hidden">
              <div className="w-12 h-1.5 rounded-full bg-muted-foreground/30" />
            </div>

            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-border">
              <h3 className="text-base font-bold text-foreground">انتخاب دارو</h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="p-2 rounded-xl hover:bg-muted transition-colors"
                aria-label="بستن"
              >
                <X className="w-5 h-5 text-foreground" />
              </button>
            </div>

            {/* Search bar */}
            <div className="px-4 py-3 border-b border-border bg-muted/20">
              <div className="flex items-center gap-2 px-4 py-3 rounded-2xl bg-background border-2 border-border focus-within:border-primary transition-colors">
                <Search className="w-5 h-5 text-muted-foreground shrink-0" />
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="جستجو در نام تجاری، ماده موثره، شرکت یا دسته‌بندی…"
                  className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
                />
                {query && (
                  <button type="button" onClick={() => setQuery("")} aria-label="پاک کردن">
                    <X className="w-4 h-4 text-muted-foreground" />
                  </button>
                )}
              </div>
            </div>

            {/* Results region */}
            <div className="flex-1 overflow-y-auto overscroll-contain">
              {/* Frequently used — only when no active query, so the chips
                  don't compete visually with live search results. */}
              {!query && frequent.length > 0 && (
                <div className="px-4 py-3 border-b border-border/60">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
                    <Sparkles className="w-3.5 h-3.5 text-primary" />
                    داروهای پرمصرف
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {frequent.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => handlePick(m)}
                        className="px-3 py-1.5 rounded-full border border-border bg-background text-xs text-foreground hover:border-primary/40 hover:bg-primary/10 transition-colors"
                      >
                        {pickFa(m.commercial_product_name_fa, m.commercial_product_name_en)}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Loading / empty / results states */}
              {loading && (
                <div className="py-10 text-center text-sm text-muted-foreground">در حال جستجو…</div>
              )}

              {!loading && query && results.length === 0 && (
                <div className="py-16 text-center text-sm text-muted-foreground">
                  دارویی با این مشخصات یافت نشد
                </div>
              )}

              {!loading && results.length > 0 && (
                <ul className="divide-y divide-border/60">
                  {results.map((m) => {
                    const title = pickFa(m.commercial_product_name_fa, m.commercial_product_name_en);
                    const subtitle = pickFa(m.name_fa, m.name_en);
                    return (
                      <li key={m.id}>
                        <button
                          type="button"
                          onClick={() => handlePick(m)}
                          className={cn(
                            "w-full text-right px-5 py-3 flex items-start justify-between gap-3 transition-colors",
                            value === m.id
                              ? "bg-primary/10"
                              : "hover:bg-muted/40 active:bg-muted/60",
                          )}
                        >
                          <div className="flex-1 min-w-0 space-y-1">
                            <div className="text-sm font-bold text-foreground truncate">{title}</div>
                            {subtitle && (
                              <div className="text-xs text-muted-foreground truncate">{subtitle}</div>
                            )}
                            <div className="flex flex-wrap gap-1.5 pt-1">
                              {m.company_name_fa && <Badge>{m.company_name_fa}</Badge>}
                              {m.dosage_form && <Badge tone="primary">{m.dosage_form}</Badge>}
                              {m.category_fa && <Badge>{m.category_fa}</Badge>}
                              {m.label_verification_status === "verify_label_required" && (
                                <Badge tone="warning">تاییدنشده</Badge>
                              )}
                            </div>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}

              {/* Idle state (sheet open, no query, no chips loaded yet). */}
              {!loading && !query && frequent.length === 0 && (
                <div className="py-16 text-center text-sm text-muted-foreground">
                  برای شروع، عبارت موردنظر را تایپ کنید
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-5 py-2 border-t border-border bg-muted/20 text-[11px] text-muted-foreground text-center">
              حداکثر ۲۰ نتیجه نمایش داده می‌شود — برای نتایج دقیق‌تر، جستجو را محدودتر کنید.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Small read-only key/value cell used inside the info panel. Hides itself
// when there's no value so the layout stays compact for sparse catalog rows.
function InfoCell({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="rounded-md bg-background/60 border border-border/60 px-2 py-1.5">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="text-xs text-foreground truncate">{value}</div>
    </div>
  );
}
