// ---------------------------------------------------------------------------
// FeedProductPicker
// ---------------------------------------------------------------------------
// Enterprise-grade feed selector backed by the new `public.feed_products`
// catalog. Mirrors the architecture of <MedicineProductPicker> so both
// product domains feel identical to operators:
//
//   - Never loads the full catalog (could be 1k–10k+ rows).
//   - Per-field server-side filtering across 9 Persian + English columns
//     (commercial name FA/EN, feed name FA/EN, company FA/EN, category
//     FA/EN, feed code) — every non-empty input becomes one AND-combined
//     `ilike` predicate, capped at 20 results.
//   - 300ms debounce + request-token guard so a stale slow response can
//     never overwrite a fresher one.
//   - Rich result cards with title + subtitle + tone-aware badges
//     (product_type, company, feed_form) instead of a plain dropdown.
//   - After selection, an info panel summarises every nutritional column
//     and surfaces a yellow «verify_label_required» warning banner.
//
// Persistence contract:
//   - Controlled via `value` (feed_product_id) and `selected` (full snapshot
//     of the chosen catalog row). The parent re-uses the snapshot to render
//     the info panel after a page reload without re-querying the catalog.
//   - `onSelect` fires with the FULL catalog row so the parent can copy
//     every snapshot field into its own state (and persist them on save —
//     see the feed-snapshot block in MixedInvoiceForm.handleSubmit).
//
// Designed to be reused later in feed purchase invoices, feed sales
// invoices, feed inventory, ration formulation, TMR mixing, feed cost
// reports, and the IOFC dashboard. None of the props are invoice-specific.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X, AlertTriangle, CheckCircle2, Wheat } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Type contract — only the columns the picker actually reads/displays. The
// full row is forwarded to the parent on selection, so the parent can pluck
// any extra fields it needs to snapshot into its own detail table.
// ---------------------------------------------------------------------------
export interface FeedProduct {
  id: number;
  feed_code: string | null;
  name_fa: string | null;
  name_en: string | null;
  product_type: string | null;
  category_fa: string | null;
  category_en: string | null;
  company_name_fa: string | null;
  company_name_en: string | null;
  company_country: string | null;
  commercial_product_name_fa: string | null;
  commercial_product_name_en: string | null;
  feed_form: string | null;
  target_group: string | null;
  // Nutritional snapshot fields — surfaced in the info panel and snapshotted
  // by parents onto the invoice line so historic rows stay correct even if
  // the catalog row is later edited.
  dry_matter: number | null;
  crude_protein: number | null;
  ndf: number | null;
  adf: number | null;
  starch: number | null;
  fat: number | null;
  nel_mcal_kg: number | null;
  calcium: number | null;
  phosphorus: number | null;
  recommended_inclusion_min_percent: number | null;
  recommended_inclusion_max_percent: number | null;
  label_verification_status: string | null;
}

interface Props {
  // Controlled value: the currently chosen feed_product_id (or null).
  value: number | null;
  // Full snapshot of the chosen catalog row so the info panel renders
  // synchronously on remount without a network call.
  selected?: FeedProduct | null;
  // Fires when the operator picks a feed — parent persists the snapshot.
  onSelect: (feed: FeedProduct) => void;
  // Optional clear handler so the parent can null its FK.
  onClear?: () => void;
}

// ---------------------------------------------------------------------------
// Per-field filter contract. One input per searchable column gives the
// operator the ability to combine constraints (e.g. category "علوفه" +
// company "خوراک پارس") which is impossible with a single fuzzy box.
// ---------------------------------------------------------------------------
export type FeedFilters = {
  name_fa: string;
  name_en: string;
  commercial_fa: string;
  commercial_en: string;
  company_fa: string;
  company_en: string;
  category_fa: string;
  category_en: string;
  feed_code: string;
};

const EMPTY_FILTERS: FeedFilters = {
  name_fa: "",
  name_en: "",
  commercial_fa: "",
  commercial_en: "",
  company_fa: "",
  company_en: "",
  category_fa: "",
  category_en: "",
  feed_code: "",
};

// Filter key → actual DB column. Single source of truth so the input loop,
// query builder, and labels never drift out of sync when columns evolve.
const FILTER_COLUMNS: Record<keyof FeedFilters, string> = {
  name_fa: "name_fa",
  name_en: "name_en",
  commercial_fa: "commercial_product_name_fa",
  commercial_en: "commercial_product_name_en",
  company_fa: "company_name_fa",
  company_en: "company_name_en",
  category_fa: "category_fa",
  category_en: "category_en",
  feed_code: "feed_code",
};

// Persian labels above each per-field input. We keep these collocated with
// FILTER_COLUMNS so renaming a column is a one-spot edit.
const FILTER_LABELS: Record<keyof FeedFilters, string> = {
  name_fa: "نام خوراک (فارسی)",
  name_en: "نام خوراک (انگلیسی)",
  commercial_fa: "نام تجاری (فارسی)",
  commercial_en: "نام تجاری (انگلیسی)",
  company_fa: "نام شرکت (فارسی)",
  company_en: "نام شرکت (انگلیسی)",
  category_fa: "دسته‌بندی (فارسی)",
  category_en: "دسته‌بندی (انگلیسی)",
  feed_code: "کد خوراک",
};

// Comma / open-paren / close-paren carry special meaning inside PostgREST
// filter expressions; strip them before they hit the URL builder.
const sanitize = (v: string) => v.replace(/[,()]/g, " ").trim();

// Common SELECT list for both search and frequently-used queries — sharing
// the projection guarantees the FeedProduct type stays satisfied in both
// code paths.
const SELECT_COLUMNS =
  "id, feed_code, name_fa, name_en, product_type, category_fa, category_en, " +
  "company_name_fa, company_name_en, company_country, " +
  "commercial_product_name_fa, commercial_product_name_en, feed_form, target_group, " +
  "dry_matter, crude_protein, ndf, adf, starch, fat, nel_mcal_kg, calcium, phosphorus, " +
  "recommended_inclusion_min_percent, recommended_inclusion_max_percent, " +
  "label_verification_status";

async function searchFeedProducts(filters: FeedFilters): Promise<FeedProduct[]> {
  // Collect only the filters the operator actually filled in. We deliberately
  // refuse to fetch anything when zero filters are active so the picker
  // cannot accidentally pull the whole catalog.
  const active = (Object.keys(FILTER_COLUMNS) as (keyof FeedFilters)[])
    .map((k) => ({ col: FILTER_COLUMNS[k], val: sanitize(filters[k]) }))
    .filter((f) => f.val.length > 0);

  if (active.length === 0) return [];

  // Build the query incrementally — each .ilike() stacks a new AND predicate
  // server-side. The trigram indexes added by the matching migration keep
  // this fast even at 10k+ rows.
  let q = supabase
    .from("feed_products" as never)
    .select(SELECT_COLUMNS)
    .eq("is_active", true);
  for (const f of active) q = q.ilike(f.col, `%${f.val}%`) as never;
  // Cap at 20 rows — the spec requires "max 20 results" to keep the result
  // pane readable; the operator narrows with additional filters if needed.
  const { data, error } = await q.limit(20);
  if (error) {
    // eslint-disable-next-line no-console
    console.error("[FeedProductPicker] search failed", error);
    return [];
  }
  return (data ?? []) as unknown as FeedProduct[];
}

// ---------------------------------------------------------------------------
// Small presentation helpers
// ---------------------------------------------------------------------------

// Prefer Persian, fall back to English — used for every label so the UI is
// always Persian-first per the project's RTL contract.
const pickFa = (fa?: string | null, en?: string | null) =>
  (fa && fa.trim()) || (en && en.trim()) || "";

// Format a numeric nutrient with at most one decimal. Returns "" so the
// InfoCell hides empty values automatically.
const fmtNum = (v: number | null | undefined) =>
  v === null || v === undefined ? "" : Number(v).toLocaleString("fa-IR", { maximumFractionDigits: 2 });

// Lightweight pill badge — kept inline so the picker is fully self-contained
// and trivial to lift into other surfaces (inventory, ration formulation, …).
function Badge({
  children,
  tone = "default",
}: {
  children: React.ReactNode;
  tone?: "default" | "primary" | "warning";
}) {
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
export default function FeedProductPicker({ value, selected, onSelect, onClear }: Props) {
  // Sheet open/close. Closed by default — the operator opens it by clicking
  // the trigger button (same UX as the medicine picker).
  const [open, setOpen] = useState(false);

  // Live filter state — one entry per searchable column. Stored in a single
  // object so the debounced effect can depend on the whole snapshot.
  const [filters, setFilters] = useState<FeedFilters>(EMPTY_FILTERS);
  const [results, setResults] = useState<FeedProduct[]>([]);
  const [loading, setLoading] = useState(false);

  // True when ≥1 filter has actual content. Drives whether we issue a query
  // and whether we show the idle hint vs the empty/results states.
  const anyFilterActive = useMemo(
    () => Object.values(filters).some((v) => v.trim().length > 0),
    [filters],
  );

  // Auto-focus first input on open + body-scroll lock so the underlying
  // invoice form doesn't shift around while the sheet is up.
  const firstInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!open) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const t = setTimeout(() => firstInputRef.current?.focus(), 120);
    return () => {
      document.body.style.overflow = original;
      clearTimeout(t);
    };
  }, [open]);

  // Standard a11y: Escape closes the sheet.
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [open]);

  // Debounced server-side search (300ms). A request token guards against
  // out-of-order responses: only the most recently-issued search may write
  // into results.
  const tokenRef = useRef(0);
  useEffect(() => {
    if (!open) return;
    if (!anyFilterActive) {
      // No filters → clear instantly, skip the network call.
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const myToken = ++tokenRef.current;
    const t = setTimeout(async () => {
      const rows = await searchFeedProducts(filters);
      if (myToken !== tokenRef.current) return; // a fresher search has started
      setResults(rows);
      setLoading(false);
    }, 300);
    return () => clearTimeout(t);
  }, [filters, anyFilterActive, open]);

  // Shared selection handler — closes the sheet and resets filters so the
  // next open starts from a clean slate.
  const handlePick = (f: FeedProduct) => {
    onSelect(f);
    setOpen(false);
    setFilters(EMPTY_FILTERS);
  };

  // Update a single filter field by key — keeps the JSX loop signature small.
  const setFilter = (k: keyof FeedFilters, v: string) =>
    setFilters((prev) => ({ ...prev, [k]: v }));

  // Trigger title — selected product name, or a prompt when nothing is picked.
  const triggerTitle = useMemo(() => {
    if (selected) {
      return (
        pickFa(selected.commercial_product_name_fa, selected.commercial_product_name_en) ||
        pickFa(selected.name_fa, selected.name_en) ||
        "خوراک انتخاب‌شده"
      );
    }
    return "انتخاب خوراک";
  }, [selected]);

  return (
    <div className="space-y-3" dir="rtl">
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
              {pickFa(selected.category_fa, selected.category_en)}
              {selected.company_name_fa ? ` • ${selected.company_name_fa}` : ""}
            </div>
          )}
        </div>
        <Search className="w-4 h-4 text-muted-foreground shrink-0" />
      </button>

      {/* ----------------- Info panel ----------------- */}
      {selected && (
        <div className="rounded-xl border border-border bg-card/60 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Wheat className="w-3.5 h-3.5 text-primary" />
              خوراک انتخاب شده
            </div>
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
            {pickFa(selected.commercial_product_name_fa, selected.commercial_product_name_en) ||
              pickFa(selected.name_fa, selected.name_en)}
          </div>
          {/* Compact key/value grid — exactly the fields the spec asks for.
              InfoCell hides itself for null values, so generic feeds (silage,
              barley, …) with no company/commercial info don't render empty
              boxes. */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
            <InfoCell label="نام خوراک / محصول" value={pickFa(selected.name_fa, selected.name_en)} />
            <InfoCell label="دسته‌بندی" value={pickFa(selected.category_fa, selected.category_en)} />
            <InfoCell label="شرکت سازنده" value={pickFa(selected.company_name_fa, selected.company_name_en)} />
            <InfoCell label="فرم محصول" value={selected.feed_form} />
            <InfoCell label="گروه هدف" value={selected.target_group} />
            <InfoCell label="ماده خشک (%)" value={fmtNum(selected.dry_matter)} />
            <InfoCell label="پروتئین خام (%)" value={fmtNum(selected.crude_protein)} />
            <InfoCell label="NDF (%)" value={fmtNum(selected.ndf)} />
            <InfoCell label="نشاسته (%)" value={fmtNum(selected.starch)} />
            <InfoCell label="چربی (%)" value={fmtNum(selected.fat)} />
            <InfoCell label="انرژی NEL (Mcal/kg)" value={fmtNum(selected.nel_mcal_kg)} />
            <InfoCell label="کلسیم (%)" value={fmtNum(selected.calcium)} />
            <InfoCell label="فسفر (%)" value={fmtNum(selected.phosphorus)} />
            <InfoCell
              label="بازه مصرف پیشنهادی (%)"
              // We combine min/max into a single "min – max" cell so it occupies
              // one grid slot. Falls back gracefully when either bound is null.
              value={(() => {
                const a = selected.recommended_inclusion_min_percent;
                const b = selected.recommended_inclusion_max_percent;
                if (a == null && b == null) return "";
                return `${fmtNum(a) || "—"} – ${fmtNum(b) || "—"}`;
              })()}
            />
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

      {/* ----------------- Search sheet ----------------- */}
      {open && (
        <div className="fixed inset-0 z-[100] flex items-end sm:items-center sm:justify-center" role="dialog" aria-modal="true">
          {/* Click-to-dismiss backdrop. */}
          <div
            className="absolute inset-0 bg-foreground/40 backdrop-blur-sm animate-fade-in"
            onClick={() => setOpen(false)}
          />

          <div className="relative w-full sm:max-w-3xl sm:rounded-2xl bg-card shadow-2xl flex flex-col h-[92vh] sm:h-[85vh] rounded-t-3xl animate-slide-up overflow-hidden">
            {/* Mobile drag-handle affordance. */}
            <div className="flex justify-center pt-3 pb-1 sm:hidden">
              <div className="w-12 h-1.5 rounded-full bg-muted-foreground/30" />
            </div>

            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-border">
              <h3 className="text-base font-bold text-foreground flex items-center gap-2">
                <Wheat className="w-4 h-4 text-primary" />
                انتخاب خوراک
              </h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="p-2 rounded-xl hover:bg-muted transition-colors"
                aria-label="بستن"
              >
                <X className="w-5 h-5 text-foreground" />
              </button>
            </div>

            {/* ----------------- Per-field filter grid -----------------
                One input per searchable column. Operators rarely remember a
                product by every attribute, so any combination is honoured
                (AND-combined server-side). */}
            <div className="px-4 py-3 border-b border-border bg-muted/20 space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-[11px] text-muted-foreground">
                  هر فیلد را به‌تنهایی یا ترکیبی پر کنید — جستجو هم‌زمان روی همه فیلدها انجام می‌شود.
                </div>
                {anyFilterActive && (
                  <button
                    type="button"
                    onClick={() => setFilters(EMPTY_FILTERS)}
                    className="text-[11px] text-muted-foreground hover:text-destructive flex items-center gap-1"
                  >
                    <X className="w-3 h-3" />
                    پاک کردن فیلترها
                  </button>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {(Object.keys(FILTER_COLUMNS) as (keyof FeedFilters)[]).map((k, idx) => (
                  <div key={k} className="space-y-1">
                    <label className="block text-[10px] text-muted-foreground px-1">
                      {FILTER_LABELS[k]}
                    </label>
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-background border border-border focus-within:border-primary transition-colors">
                      <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      <input
                        // First field auto-focuses on open for fast typing.
                        ref={idx === 0 ? firstInputRef : undefined}
                        type="text"
                        value={filters[k]}
                        onChange={(e) => setFilter(k, e.target.value)}
                        // English-only fields use LTR so the caret sits naturally
                        // on the left while typing latin characters.
                        dir={k.endsWith("_en") || k === "feed_code" ? "ltr" : "rtl"}
                        placeholder={FILTER_LABELS[k]}
                        className="w-full bg-transparent text-xs text-foreground placeholder:text-muted-foreground/60 outline-none"
                      />
                      {filters[k] && (
                        <button type="button" onClick={() => setFilter(k, "")} aria-label="پاک کردن">
                          <X className="w-3 h-3 text-muted-foreground" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Results region */}
            <div className="flex-1 overflow-y-auto overscroll-contain">
              {loading && (
                <div className="py-10 text-center text-sm text-muted-foreground">در حال جستجو…</div>
              )}

              {!loading && anyFilterActive && results.length === 0 && (
                <div className="py-16 text-center text-sm text-muted-foreground">
                  خوراکی با این مشخصات یافت نشد
                </div>
              )}

              {!loading && results.length > 0 && (
                <ul className="divide-y divide-border/60">
                  {results.map((f) => {
                    // Title prefers the commercial name (what operators see on
                    // a bag label); falls back to the generic feed name for
                    // commodity feeds with no commercial branding.
                    const title =
                      pickFa(f.commercial_product_name_fa, f.commercial_product_name_en) ||
                      pickFa(f.name_fa, f.name_en);
                    const subtitle = pickFa(f.category_fa, f.category_en);
                    return (
                      <li key={f.id}>
                        <button
                          type="button"
                          onClick={() => handlePick(f)}
                          className={cn(
                            "w-full text-right px-5 py-3 flex items-start justify-between gap-3 transition-colors",
                            value === f.id
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
                              {f.product_type && <Badge tone="primary">{f.product_type}</Badge>}
                              {f.company_name_fa && <Badge>{f.company_name_fa}</Badge>}
                              {f.feed_form && <Badge>{f.feed_form}</Badge>}
                              {f.label_verification_status === "verify_label_required" && (
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

              {!loading && !anyFilterActive && (
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
// when there's no value so the layout stays compact for sparse catalog rows
// (e.g. generic silage with no company/feed_form fields).
function InfoCell({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="rounded-md bg-background/60 border border-border/60 px-2 py-1.5">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="text-xs text-foreground truncate">{value}</div>
    </div>
  );
}
