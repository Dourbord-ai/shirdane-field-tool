// ---------------------------------------------------------------------------
// MixedInvoiceForm
// ---------------------------------------------------------------------------
// New normalized invoice composer. Unlike the legacy NewInvoice form (where
// a single global `product_type` controls the whole document and a separate
// per-product subform renders), this form lets each row carry its OWN
// product_type and renders ONLY that row's detail fields.
//
// Persistence layout (per the M-normalize plan):
//   - factors                       → invoice header (one row per invoice)
//   - factor_items                  → shared row fields (one row per line)
//   - factor_item_<type>_details    → product-specific detail (one per item)
//
// A deferred constraint trigger on factor_items enforces "exactly one
// matching detail row per product_type" — so we wrap the inserts in an
// ordering where item → detail are written back-to-back for each row and
// commit at the end.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Plus, Trash2 } from "lucide-react";
import SearchableSelect from "@/components/SearchableSelect";
import JalaliDatePicker from "@/components/JalaliDatePicker";
import { JalaliDate } from "@/lib/jalali";
import { jalaliToGregorianTimestamp, jalaliToGregorianDate } from "@/lib/dateUtils";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";
// Reusable enterprise medicine picker (server-side search across the new
// medicine_products catalog). Designed as a global component so it can later
// power treatments / prescriptions / inventory the same way.
import MedicineProductPicker, { MedicineProduct } from "@/components/medicine/MedicineProductPicker";
// Same architecture as MedicineProductPicker: per-field server-side search
// over feed_products, snapshot the full row into the invoice line on save.
import FeedProductPicker, { FeedProduct } from "@/components/feed/FeedProductPicker";
// Tasks 2+3 — related-costs + per-source settlement workflow lives inside
// the invoice form. The three blocks below are pure presentation; all state
// and persistence is owned by this component.
import InvoiceRelatedCostsBlock from "@/components/invoices/sections/InvoiceRelatedCostsBlock";
import InvoiceSettlementSourcesBlock from "@/components/invoices/sections/InvoiceSettlementSourcesBlock";
import InvoiceReviewDialog from "@/components/invoices/sections/InvoiceReviewDialog";
import {
  deriveSources,
  validateSources,
  buildRpcItemsPayload,
  applyAutoAmountTypes,
  type DraftCost,
  type SettlementSource,
} from "@/lib/finance/invoiceSettlementBuilder";
import { insertManyRelatedCosts, type RelatedCostInput } from "@/lib/finance/relatedCosts";

// ---------------------------------------------------------------------------
// Static option lists. These are intentionally local to the new form so
// future Sepidar account-mapping work on the normalized path doesn't have to
// touch the giant legacy file.
// ---------------------------------------------------------------------------
const INVOICE_TYPES = [
  { label: "خرید", value: "buy" },
  { label: "فروش", value: "sell" },
];

// All product types accepted by the factor_items CHECK constraint (after the
// extension migration). The labels are Persian for the operator UI.
const PRODUCT_TYPES = [
  { label: "دام", value: "livestock" },
  { label: "خوراک", value: "feed" },
  { label: "دارو", value: "medicine" },
  { label: "اسپرم", value: "sperm" },
  { label: "کود دامی", value: "manure" },
  { label: "خدمات", value: "services" },
  { label: "شیر", value: "milk" },
  { label: "کرایه", value: "rental" },
  { label: "سایر", value: "other" },
];

const TAX_OPTIONS = [
  { label: "دارد", value: "yes" },
  { label: "ندارد", value: "no" },
];

// ---------------------------------------------------------------------------
// Row model
// ---------------------------------------------------------------------------
// We keep every row as a `details` bag whose shape changes with product_type.
// This avoids 9 different row interfaces while still letting the UI render
// per-type fields. We validate the bag at save-time when we map it onto the
// strongly-typed detail tables.
// ---------------------------------------------------------------------------
type ProductType = (typeof PRODUCT_TYPES)[number]["value"];

interface MixedRow {
  // Stable client-only key; replaced by the DB-generated UUID on save.
  uid: string;
  product_type: ProductType;
  // Shared factor_items fields (the same for every product_type).
  quantity: string;
  unit: string;
  unit_price: string;
  discount_amount: string;
  tax_amount: string;
  description: string;
  // Per-product detail bag. Keys vary per product_type — see renderRowDetails.
  details: Record<string, string>;
  // Medicine-only snapshot of the chosen catalog row. We keep the FULL object
  // here (rather than just the FK id) so the info panel can render
  // synchronously and the save handler can emit every snapshot column
  // without re-querying the catalog.
  medicineProduct?: MedicineProduct | null;
  // Feed-only snapshot — identical pattern to medicineProduct. Populated by
  // <FeedProductPicker> when product_type === 'feed' and consumed by the
  // save handler to snapshot every nutritional column onto the invoice line.
  feedProduct?: FeedProduct | null;
}

// Helper: produce a fresh blank row for a given product_type. We default to
// livestock so the first row already shows livestock fields.
const blankRow = (product_type: ProductType = "livestock"): MixedRow => ({
  uid: crypto.randomUUID(),
  product_type,
  quantity: "",
  unit: "",
  unit_price: "",
  discount_amount: "0",
  tax_amount: "0",
  description: "",
  details: {},
  medicineProduct: null,
  feedProduct: null,
});

// ---------------------------------------------------------------------------
// Per-product detail field config
// ---------------------------------------------------------------------------
// For each product_type we declare:
//   - dbTable:    the matching detail table name
//   - fields:     ordered list of { key, label, type } pairs the UI renders
//
// At save time we copy `row.details[key]` into `{ [key]: value }` and insert
// into `dbTable`. Numeric keys are coerced via parseFloat. Date keys are
// passed through verbatim (the underlying detail tables use `date`/`text`
// columns that PostgREST happily parses ISO strings into).
// ---------------------------------------------------------------------------
type FieldType = "text" | "number" | "date";
interface DetailFieldDef {
  key: string;
  label: string;
  type: FieldType;
}
const DETAIL_CONFIG: Record<ProductType, { dbTable: string; fields: DetailFieldDef[] }> = {
  livestock: {
    dbTable: "factor_item_livestock_details",
    // cow_id is set by the master-table selector below — not editable here.
    fields: [
      { key: "weight", label: "وزن (kg)", type: "number" },
      { key: "off_unit_price", label: "قیمت پایه", type: "number" },
      { key: "delivery_cost", label: "هزینه تحویل", type: "number" },
      { key: "vat", label: "مالیات", type: "number" },
      { key: "payable_unit_price", label: "قیمت قابل پرداخت", type: "number" },
    ],
  },
  feed: {
    dbTable: "factor_item_feed_details",
    // feed_id + feed_name set by selector.
    fields: [
      { key: "batch_number", label: "شماره بچ", type: "text" },
      { key: "expire_date", label: "تاریخ انقضا", type: "date" },
      { key: "dry_matter_pct", label: "ماده خشک %", type: "number" },
    ],
  },
  medicine: {
    dbTable: "factor_item_medicine_details",
    // The medicine itself is chosen through the rich MedicineProductPicker
    // (rendered separately below). Every catalog-derived field — commercial
    // name, active ingredient, company, country, dosage form, route,
    // category, withdrawal periods — is snapshotted automatically from the
    // selected medicine_products row, so the operator only enters the
    // truly per-purchase fields (batch + expiry).
    fields: [
      { key: "batch_number", label: "شماره بچ", type: "text" },
      { key: "expire_date", label: "تاریخ انقضا", type: "date" },
    ],
  },
  sperm: {
    dbTable: "factor_item_sperm_details",
    // sperm_id + bull_code + bull_name set by selector.
    fields: [
      { key: "breed", label: "نژاد", type: "text" },
      { key: "batch_number", label: "شماره بچ", type: "text" },
      { key: "production_date", label: "تاریخ تولید", type: "date" },
    ],
  },
  manure: {
    dbTable: "factor_item_manure_details",
    fields: [
      { key: "manure_type", label: "نوع کود", type: "text" },
      { key: "moisture_pct", label: "رطوبت %", type: "number" },
      { key: "source_location", label: "مبدأ", type: "text" },
      { key: "destination", label: "مقصد", type: "text" },
      { key: "vehicle_plate", label: "پلاک خودرو", type: "text" },
    ],
  },
  services: {
    dbTable: "factor_item_service_details",
    fields: [
      { key: "service_code", label: "کد خدمت", type: "text" },
      { key: "service_name", label: "نام خدمت", type: "text" },
      { key: "provider_name", label: "ارائه‌دهنده", type: "text" },
      { key: "service_date", label: "تاریخ خدمت", type: "date" },
      { key: "hours", label: "ساعت", type: "number" },
      { key: "notes", label: "یادداشت", type: "text" },
    ],
  },
  milk: {
    dbTable: "factor_item_milk_details",
    fields: [
      { key: "weight_kg", label: "وزن (kg)", type: "number" },
      { key: "milk_sample", label: "نمونه شیر", type: "number" },
      { key: "liters", label: "لیتر", type: "number" },
      { key: "price_per_kg", label: "قیمت / kg", type: "number" },
      { key: "buyer_company", label: "خریدار", type: "text" },
    ],
  },
  rental: {
    dbTable: "factor_item_rental_details",
    fields: [
      { key: "purpose", label: "موضوع", type: "text" },
      { key: "driver_name", label: "نام راننده", type: "text" },
      { key: "vehicle_plate", label: "پلاک خودرو", type: "text" },
      { key: "start_date", label: "از تاریخ", type: "date" },
      { key: "end_date", label: "تا تاریخ", type: "date" },
      { key: "notes", label: "یادداشت", type: "text" },
    ],
  },
  other: {
    dbTable: "factor_item_other_details",
    fields: [
      { key: "item_name", label: "نام آیتم", type: "text" },
      { key: "notes", label: "یادداشت", type: "text" },
    ],
  },
};

// ---------------------------------------------------------------------------
// Master-table selector config (per row)
// ---------------------------------------------------------------------------
// For product types that have a master list (livestock, sperm, feed,
// medicine), each row renders a searchable dropdown at the top of its
// details block. Selecting an option writes the matching FK id (+ a few
// display fields) into the row.details bag so they round-trip into the
// matching factor_item_<type>_details table on save. Free-text entry is
// available only as a fallback for product types without a master table.
// ---------------------------------------------------------------------------
type MasterSource = "cows" | "sperms" | "feeds" | "medicines";
interface SelectorDef {
  label: string;          // UI label above the dropdown
  source: MasterSource;   // which master option list to render
  primaryKey: string;     // the FK detail key (also used as the dropdown's value)
  // Translate a master record into a partial detail bag patch.
  apply: (raw: Record<string, unknown>) => Record<string, string>;
}
const SELECTOR_CONFIG: Partial<Record<ProductType, SelectorDef>> = {
  livestock: {
    label: "انتخاب دام (پلاک)",
    source: "cows",
    primaryKey: "cow_id",
    apply: (c) => ({
      cow_id: String(c.id),
      _display: [c.bodynumber, c.earnumber].filter(Boolean).join(" / "),
    }),
  },
  sperm: {
    label: "انتخاب اسپرم",
    source: "sperms",
    primaryKey: "sperm_id",
    apply: (s) => ({
      sperm_id: String(s.id),
      bull_code: String(s.code ?? ""),
      bull_name: String(s.name ?? ""),
      _display: `${s.code ?? ""}${s.name ? " - " + s.name : ""}`.trim(),
    }),
  },
  // NOTE: feed intentionally has NO entry here. The feed product type uses
  // the bespoke <FeedProductPicker> (rich server-side search across 9
  // Persian/English columns + nutritional info panel + verification banner)
  // instead of the generic single-list dropdown — same approach as medicine.
  // NOTE: medicine intentionally has NO entry here. The medicine product
  // type uses the bespoke <MedicineProductPicker> (rich server-side search
  // across 7 Persian/English columns + verification banner + frequently
  // used chips) instead of the generic single-list dropdown.

};

// Detail-bag keys that must be coerced to number before insert (FK ids).
const NUMERIC_DETAIL_KEYS = new Set([
  "cow_id",
  "sperm_id",
  "feed_id",
  "medicine_id",
]);

// Numeric coercion helper used at save time. Empty string → null so the DB
// stores NULL (rather than 0) for fields the operator left blank.
const num = (v: string | undefined): number | null => {
  if (v === undefined || v === null || v === "") return null;
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function MixedInvoiceForm() {
  const navigate = useNavigate();

  // -----------------------------------------------------------------------
  // Header state. We intentionally omit the legacy global `product_type`
  // here — the whole point of the normalized flow is per-row product_type.
  // -----------------------------------------------------------------------
  const [invoiceType, setInvoiceType] = useState<string>("buy");
  const [invoiceDate, setInvoiceDate] = useState<JalaliDate | null>(null);
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [financePartyId, setFinancePartyId] = useState("");
  const [tax, setTax] = useState("no");
  const [description, setDescription] = useState("");

  // Rows: start with a single livestock row so the form is non-empty.
  const [rows, setRows] = useState<MixedRow[]>([blankRow("livestock")]);

  // ----- Tasks 2+3 state -----
  // Local-only related-cost draft rows. Persisted via insertManyRelatedCosts
  // immediately after the parent factor lands (step 4 of save sequence).
  const [costDrafts, setCostDrafts] = useState<DraftCost[]>([]);
  // Per-source settlement configuration. Reconciled from costDrafts + invoice
  // header on every change so user edits survive cost adds/deletes.
  const [sources, setSources] = useState<SettlementSource[]>([]);
  // Mandatory review dialog — the ONLY entry point into the save flow.
  const [reviewOpen, setReviewOpen] = useState(false);

  // -----------------------------------------------------------------------
  // Finance party options. Same query the legacy form uses, lifted here so
  // this component is self-contained.
  // -----------------------------------------------------------------------
  const [partyOptions, setPartyOptions] = useState<{ label: string; value: string }[]>([]);
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("finance_parties")
        .select("id, company_name, first_name, last_name, sepidar_full_name")
        .eq("is_deleted", false);
      if (!data) return;
      const opts = data.map((p) => {
        const person = [p.first_name, p.last_name].filter(Boolean).join(" ").trim();
        const label = p.sepidar_full_name || p.company_name || person || "(بدون نام)";
        return { label, value: p.id as string };
      });
      opts.sort((a, b) => a.label.localeCompare(b.label, "fa"));
      setPartyOptions(opts);
    })();
  }, []);

  // -----------------------------------------------------------------------
  // Master option lists for per-row selectors.
  //
  // We load each master table once on mount and keep:
  //   - `options`: the {label, value} shape SearchableSelect expects
  //   - `raw`:     a Map keyed by stringified id so we can look up the
  //                full record when an option is picked and project it
  //                into the row.details bag via SELECTOR_CONFIG.apply().
  // -----------------------------------------------------------------------
  type MasterBucket = {
    options: { label: string; value: string }[];
    raw: Map<string, Record<string, unknown>>;
  };
  const emptyBucket = (): MasterBucket => ({ options: [], raw: new Map() });
  const [masters, setMasters] = useState<Record<MasterSource, MasterBucket>>({
    cows: emptyBucket(),
    sperms: emptyBucket(),
    feeds: emptyBucket(),
    medicines: emptyBucket(),
  });

  useEffect(() => {
    (async () => {
      // Build a bucket from a raw rowset + a label projector.
      const buildBucket = (
        rows: Record<string, unknown>[] | null,
        toLabel: (r: Record<string, unknown>) => string,
      ): MasterBucket => {
        const opts: { label: string; value: string }[] = [];
        const raw = new Map<string, Record<string, unknown>>();
        (rows ?? []).forEach((r) => {
          const value = String(r.id);
          const label = toLabel(r) || "(بدون نام)";
          opts.push({ label, value });
          raw.set(value, r);
        });
        opts.sort((a, b) => a.label.localeCompare(b.label, "fa"));
        return { options: opts, raw };
      };

      // Fire all four master fetches in parallel — they're independent.
      const [cowsRes, spermsRes, feedsRes, medsRes] = await Promise.all([
        supabase.from("cows").select("id, bodynumber, earnumber").order("bodynumber"),
        // is_active matches the legacy sperms picker — inactive bulls hidden.
        supabase.from("sperms").select("id, code, name").eq("is_active", true).order("code"),
        supabase.from("feeds").select("id, name").order("name"),
        supabase.from("medicines").select("id, name").order("name"),
      ]);

      setMasters({
        cows: buildBucket(cowsRes.data as Record<string, unknown>[] | null, (c) => {
          // Label: "<bodynumber> / <earnumber>" so operators can scan by پلاک.
          const body = c.bodynumber ?? "";
          const ear = c.earnumber ?? "";
          if (body && ear) return `${body} / ${ear}`;
          return String(body || ear || "");
        }),
        sperms: buildBucket(spermsRes.data as Record<string, unknown>[] | null, (s) =>
          `${s.code ?? ""}${s.name ? " - " + s.name : ""}`.trim(),
        ),
        feeds: buildBucket(
          feedsRes.data as Record<string, unknown>[] | null,
          (f) => String(f.name ?? ""),
        ),
        medicines: buildBucket(
          medsRes.data as Record<string, unknown>[] | null,
          (m) => String(m.name ?? ""),
        ),
      });
    })();
  }, []);

  // -----------------------------------------------------------------------
  // Apply a master-table selection to a row. We delegate to the SELECTOR_CONFIG
  // `apply` function so each product type controls which detail keys it
  // populates (e.g. sperm sets sperm_id + bull_code + bull_name in one go).
  // The previous detail bag is preserved so user-entered extras (batch_number,
  // expire_date, …) survive a master-list change.
  // -----------------------------------------------------------------------
  const applyMasterSelection = (uid: string, product_type: ProductType, value: string) => {
    const sel = SELECTOR_CONFIG[product_type];
    if (!sel) return;
    const raw = masters[sel.source].raw.get(value);
    if (!raw) return;
    const patch = sel.apply(raw);
    setRows((prev) =>
      prev.map((row) =>
        row.uid === uid ? { ...row, details: { ...row.details, ...patch } } : row,
      ),
    );
  };

  // -----------------------------------------------------------------------
  // Sales invoice auto-numbering.
  //
  // Mirrors the legacy NewInvoice behavior: when invoice_type is a sale
  // ("sell"), we read recent factors and propose the next integer above the
  // current max. Purchase invoices keep the manual-entry behavior because
  // the printed number comes from the supplier.
  //
  // Concurrency: the final guard is the `factors_sales_invoice_number_unique`
  // partial unique index on the DB. The fetch below is a best-effort UX hint;
  // if a concurrent operator burns our number, the insert will reject and we
  // recover by re-fetching + retrying once inside handleSubmit.
  // -----------------------------------------------------------------------
  const isSale = invoiceType === "sell" || invoiceType === "retail_sell";

  const fetchNextSalesInvoiceNumber = async (): Promise<string | null> => {
    const { data: rows, error } = await supabase
      .from("factors")
      .select("invoice_number")
      .in("invoice_type", ["sell", "retail_sell"])
      .not("invoice_number", "is", null)
      .order("id", { ascending: false })
      .limit(500);
    if (error) return null;
    let max = 0;
    (rows ?? []).forEach((r: { invoice_number: string | null }) => {
      // Strip non-digits so e.g. "INV-1024" still contributes 1024.
      const raw = String(r.invoice_number ?? "").replace(/\D/g, "");
      const n = parseInt(raw, 10);
      if (!isNaN(n) && n > max) max = n;
    });
    return String(max + 1);
  };

  // Track whether the current invoice_number was generated by us vs typed by
  // the operator. We only want to auto-replace numbers we generated.
  const autoFilledRef = useRef(false);

  // React to invoice-type changes:
  //  - switching INTO a sale: fetch next sales number (replace any previously
  //    auto-filled purchase placeholder; preserve a manually typed value).
  //  - switching OUT of a sale: clear any auto-filled sales number so the
  //    operator can type the supplier's number.
  useEffect(() => {
    let cancelled = false;
    if (isSale) {
      // Skip if the operator already typed a number manually.
      if (invoiceNumber && !autoFilledRef.current) return;
      (async () => {
        const next = await fetchNextSalesInvoiceNumber();
        if (cancelled || next === null) return;
        autoFilledRef.current = true;
        setInvoiceNumber(next);
      })();
    } else {
      // Purchase: clear any number WE auto-filled. Keep manual entries.
      if (autoFilledRef.current) {
        autoFilledRef.current = false;
        setInvoiceNumber("");
      }
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSale]);

  // -----------------------------------------------------------------------
  // Row mutators. Each one returns a NEW array so React picks up the change.
  // -----------------------------------------------------------------------
  const addRow = () => setRows((r) => [...r, blankRow()]);
  const removeRow = (uid: string) =>
    setRows((r) => (r.length <= 1 ? r : r.filter((row) => row.uid !== uid)));
  const updateRow = (uid: string, patch: Partial<MixedRow>) =>
    setRows((r) => r.map((row) => (row.uid === uid ? { ...row, ...patch } : row)));
  const updateRowDetail = (uid: string, key: string, value: string) =>
    setRows((r) =>
      r.map((row) =>
        row.uid === uid ? { ...row, details: { ...row.details, [key]: value } } : row,
      ),
    );

  // Changing a row's product_type clears its detail bag — fields differ per
  // type and stale keys would silently fail validation.
  const changeRowType = (uid: string, product_type: ProductType) =>
    // Also drop the bespoke-picker snapshots (medicine + feed) so a leftover
    // FeedProduct from a previous selection doesn't get persisted when the
    // operator switches the row to a different product type.
    updateRow(uid, { product_type, details: {}, medicineProduct: null, feedProduct: null });

  // -----------------------------------------------------------------------
  // Totals (computed live). We sum row totals so the header stores a
  // realistic total_amount/payable_amount, matching the legacy form's
  // expectations downstream (Sepidar posting, reports, etc.).
  // -----------------------------------------------------------------------
  const totals = useMemo(() => {
    let total = 0;
    let taxSum = 0;
    let discountSum = 0;
    for (const r of rows) {
      const qty = num(r.quantity) ?? 0;
      const price = num(r.unit_price) ?? 0;
      const disc = num(r.discount_amount) ?? 0;
      const t = num(r.tax_amount) ?? 0;
      total += qty * price;
      discountSum += disc;
      taxSum += t;
    }
    const payable = total - discountSum + taxSum;
    return { total, discountSum, taxSum, payable };
  }, [rows]);

  // -----------------------------------------------------------------------
  // Tasks 2+3: reconcile settlement sources from header + cost drafts.
  //
  // We re-derive on every relevant change. The pure helper preserves any
  // user-edited values (user_dirty=true) so adding a cost or changing the
  // invoice payable doesn't wipe in-progress configuration.
  // -----------------------------------------------------------------------
  const partyLabel = useMemo(
    () => partyOptions.find((o) => o.value === financePartyId)?.label ?? null,
    [partyOptions, financePartyId],
  );
  useEffect(() => {
    setSources((prev) =>
      deriveSources(
        {
          financePartyId: financePartyId || null,
          financePartyLabel: partyLabel,
          invoicePayable: totals.payable,
          costDrafts,
        },
        prev,
      ),
    );
  }, [financePartyId, partyLabel, totals.payable, costDrafts]);

  // UAT Fix 1 — Issue 2: fetch current `balance` for every party referenced
  // by a settlement source so we can auto-derive each payment's
  // amount_type_key (creditor / on_account) without asking the operator.
  const [partyBalances, setPartyBalances] = useState<Record<string, number>>({});
  const partyIdsKey = sources.map((s) => s.party_id || "").join("|");
  useEffect(() => {
    const ids = Array.from(
      new Set(sources.map((s) => s.party_id).filter((x): x is string => !!x)),
    );
    if (ids.length === 0) {
      setPartyBalances({});
      return;
    }
    (async () => {
      const { data } = await supabase
        .from("finance_parties")
        .select("id, balance")
        .in("id", ids);
      if (!data) return;
      setPartyBalances(
        Object.fromEntries(data.map((r: { id: string; balance: number | null }) => [r.id, Number(r.balance) || 0])),
      );
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partyIdsKey]);

  // Derived view: same sources but with amount_type_key auto-assigned.
  // Display components, validation, and the RPC builder all consume this.
  const assignedSources = useMemo(
    () => applyAutoAmountTypes(sources, partyBalances),
    [sources, partyBalances],
  );

  // Live validation — surfaced in the source cards AND the review dialog.
  const settlementErrors = useMemo(
    () => validateSources(assignedSources, financePartyId || null),
    [assignedSources, financePartyId],
  );

  // ----- cost-draft mutators -----
  const addCostDraft = (input: RelatedCostInput) => {
    const _draftId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2);
    // _draftId stays local; factor_id is replaced at insert time.
    setCostDrafts((prev) => [...prev, { ...input, _draftId }]);
  };
  const updateCostDraft = (draftId: string, input: RelatedCostInput) =>
    setCostDrafts((prev) => prev.map((d) => (d._draftId === draftId ? { ...input, _draftId: draftId } : d)));
  const deleteCostDraft = (draftId: string) =>
    setCostDrafts((prev) => prev.filter((d) => d._draftId !== draftId));

  // ----- source patcher -----
  const patchSource = (sourceId: string, patch: Partial<SettlementSource>) =>
    setSources((prev) => prev.map((s) => (s.source_id === sourceId ? { ...s, ...patch } : s)));


  // -----------------------------------------------------------------------
  // Submit handler. Sequence:
  //   1. Insert factor header → get factor_id
  //   2. For each row: insert factor_items → insert matching detail
  //   3. On any error, surface a toast (best-effort cleanup is left to a
  //      future iteration since the deferred trigger will already reject
  //      partial inserts in a single transaction-equivalent batch).
  // -----------------------------------------------------------------------
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    // --- minimal validation -------------------------------------------
    if (!invoiceDate) {
      toast({ title: "تاریخ فاکتور را وارد کنید", variant: "destructive" });
      return;
    }
    if (rows.length === 0) {
      toast({ title: "حداقل یک ردیف لازم است", variant: "destructive" });
      return;
    }

    setSaving(true);
    try {
      // Convert the Jalali picker → Gregorian timestamp expected by
      // `factors.invoice_date` (timestamptz).
      const isoDate = jalaliToGregorianTimestamp(
        `${invoiceDate.year}/${invoiceDate.month}/${invoiceDate.day}`,
        "00:00",
      );

      // 1) Header insert. We deliberately set `product_type='mixed'` on the
      //    header so legacy code paths that branch on factors.product_type
      //    can recognize the new normalized invoices and skip per-product
      //    handling. (Existing factors retain their original value.)
      //
      //    For sales invoices the DB has a partial unique index on
      //    invoice_number. If a concurrent operator just claimed our
      //    auto-suggested number, we recover ONCE: re-fetch the next number,
      //    update local state so the UI reflects it, and retry the insert.
      const buildHeader = (number: string | null) => ({
        product_type: "mixed",
        invoice_type: invoiceType,
        factor_type_id: invoiceType === "buy" ? 1 : invoiceType === "sell" ? 2 : null,
        invoice_date: isoDate,
        invoice_number: number,
        tax: tax === "yes" ? "دارد" : "ندارد",
        finance_party_id: financePartyId || null,
        discount: totals.discountSum,
        shipping: 0,
        tax_amount: totals.taxSum,
        total_amount: totals.total,
        payable_amount: totals.payable,
        description: description || null,
      });

      let { data: factor, error: hdrErr } = await supabase
        .from("factors")
        .insert(buildHeader(invoiceNumber || null))
        .select("id")
        .single();

      // Duplicate-key recovery (sales only). We match the same regex the
      // legacy form used so behavior is consistent.
      if (
        hdrErr &&
        isSale &&
        /factors_sales_invoice_number_unique|duplicate key/i.test(hdrErr.message ?? "")
      ) {
        const next = await fetchNextSalesInvoiceNumber();
        if (next) {
          autoFilledRef.current = true;
          setInvoiceNumber(next);
        }
        toast({
          title: "شماره فاکتور تکراری است",
          description:
            "شماره فاکتور تکراری است، لطفاً شماره جدید دریافت کنید یا صفحه را تازه‌سازی کنید.",
          variant: "destructive",
        });
        setSaving(false);
        return;
      }

      if (hdrErr || !factor) throw hdrErr ?? new Error("factor insert failed");

      // 2) Per-row inserts. We loop sequentially so each error message is
      //    attributable to a specific row index, which is invaluable for
      //    debugging trigger violations.
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const cfg = DETAIL_CONFIG[row.product_type];

        // 2a) shared row insert
        const { data: item, error: itemErr } = await supabase
          .from("factor_items")
          .insert({
            factor_id: factor.id,
            row_number: i + 1,
            product_type: row.product_type,
            quantity: num(row.quantity) ?? 0,
            unit: row.unit || null,
            unit_price: num(row.unit_price) ?? 0,
            discount_amount: num(row.discount_amount) ?? 0,
            tax_amount: num(row.tax_amount) ?? 0,
            total_amount:
              (num(row.quantity) ?? 0) * (num(row.unit_price) ?? 0) -
              (num(row.discount_amount) ?? 0) +
              (num(row.tax_amount) ?? 0),
            description: row.description || null,
          })
          .select("id")
          .single();

        if (itemErr || !item) throw new Error(`ردیف ${i + 1}: ${itemErr?.message ?? "خطا"}`);

        // 2b) detail insert. We project ALL keys present in row.details
        //     (both selector-assigned FK ids like cow_id/sperm_id and
        //     operator-entered fields declared in DETAIL_CONFIG). Numeric
        //     coercion is driven by either NUMERIC_DETAIL_KEYS (for FK ids
        //     set by the master-table selector) or the field's declared
        //     type in DETAIL_CONFIG. Keys starting with "_" are UI-only
        //     (e.g. _display) and skipped.
        const detailPayload: Record<string, unknown> = { factor_item_id: item.id };
        const fieldTypes = new Map(cfg.fields.map((f) => [f.key, f.type] as const));
        for (const [key, raw] of Object.entries(row.details)) {
          if (key.startsWith("_")) continue;          // UI-only helper key
          if (raw === undefined || raw === "") continue; // leave NULL
          const declaredType = fieldTypes.get(key);
          const isNumeric = NUMERIC_DETAIL_KEYS.has(key) || declaredType === "number";
          detailPayload[key] = isNumeric ? num(raw) : raw;
        }

        // Medicine-specific: snapshot every catalog-derived column from the
        // chosen medicine_products row into factor_item_medicine_details, so
        // the invoice line history stays correct even if the catalog row
        // gets edited or deactivated later.
        if (row.product_type === "medicine" && row.medicineProduct) {
          const m = row.medicineProduct;
          // medicine_name kept for backward compatibility with legacy code
          // that reads the old text column (display fallback).
          detailPayload.medicine_product_id = m.id;
          detailPayload.medicine_name =
            m.commercial_product_name_fa ?? m.commercial_product_name_en ?? null;
          detailPayload.commercial_product_name_fa = m.commercial_product_name_fa;
          detailPayload.commercial_product_name_en = m.commercial_product_name_en;
          detailPayload.active_ingredient_fa = m.name_fa;
          detailPayload.active_ingredient_en = m.name_en;
          detailPayload.company_name_fa = m.company_name_fa;
          detailPayload.company_name_en = m.company_name_en;
          detailPayload.company_country = m.company_country;
          detailPayload.dosage_form = m.dosage_form;
          detailPayload.route_fa = m.route_fa;
          detailPayload.category_fa = m.category_fa;
          detailPayload.milk_withdrawal_days = m.milk_withdrawal_days;
          detailPayload.meat_withdrawal_days = m.meat_withdrawal_days;
          detailPayload.label_verification_status = m.label_verification_status;
          // Legacy `manufacturer` column kept populated from the new
          // company_name_fa so any existing reports continue to render.
          if (!detailPayload.manufacturer) {
            detailPayload.manufacturer = m.company_name_fa ?? m.company_name_en ?? null;
          }
        }

        // Feed-specific: snapshot ONLY fields that physically exist on the
        // factor_item_feed_details table. The schema (allowlist below) is the
        // single source of truth — we NEVER spread row.feedProduct or any
        // master-table object directly. This prevents PostgREST errors like
        // "column category_en/feed_product_id not found" when the master
        // feed_products table has columns the detail table does not.
        if (row.product_type === "feed" && row.feedProduct) {
          const f = row.feedProduct as unknown as Record<string, unknown>;

          // Legacy display column: derive a single readable feed_name from
          // the best available name on the master row.
          const feedName =
            (f.commercial_product_name_fa as string | null) ??
            (f.name_fa as string | null) ??
            (f.commercial_product_name_en as string | null) ??
            (f.name_en as string | null) ??
            null;

          // Approved snapshot columns — must exactly match the columns that
          // physically exist in public.factor_item_feed_details. Anything
          // not listed here is intentionally dropped from the payload.
          const FACTOR_ITEM_FEED_DETAIL_ALLOWED_COLUMNS = [
            "factor_item_id",
            "feed_id",
            "feed_name",
            "batch_number",
            "expire_date",
            "dry_matter_pct",
            "warehouse_id",
            "created_at",
            "feed_code",
            "name_en",
            "name_fa",
            "product_type",
            "category_en",
            "category_fa",
            "company_code",
            "company_name_en",
            "company_name_fa",
            "company_country",
            "commercial_product_name_en",
            "commercial_product_name_fa",
            "product_name_type",
            "feed_form",
            "target_group",
            "recommended_inclusion_min_percent",
            "recommended_inclusion_max_percent",
            "dry_matter",
            "crude_protein",
            "rup",
            "rdp",
            "ndf",
            "adf",
            "lignin",
            "starch",
            "sugar",
            "fat",
            "ash",
            "nel_mcal_kg",
            "me_mcal_kg",
            "calcium",
            "phosphorus",
            "magnesium",
            "potassium",
            "sodium",
            "chloride",
            "sulfur",
            "vitamin_a",
            "vitamin_d",
            "vitamin_e",
            "source_system",
            "label_verification_status",
            "source_confidence",
            "market_scope",
            "is_active",
            "notes",
            "updated_at",
          ] as const;

          // Build raw payload: existing detailPayload (factor_item_id + any
          // operator-entered fields like feed_id/batch_number/etc) merged
          // with the master-row snapshot fields. We deliberately list each
          // snapshot key — no spreads.
          const rawFeedPayload: Record<string, unknown> = {
            ...detailPayload,
            feed_name: detailPayload.feed_name ?? feedName,
            feed_code: f.feed_code,
            name_fa: f.name_fa,
            name_en: f.name_en,
            product_type: f.product_type,
            category_fa: f.category_fa,
            category_en: f.category_en,
            company_code: f.company_code,
            company_name_fa: f.company_name_fa,
            company_name_en: f.company_name_en,
            company_country: f.company_country,
            commercial_product_name_fa: f.commercial_product_name_fa,
            commercial_product_name_en: f.commercial_product_name_en,
            product_name_type: f.product_name_type,
            feed_form: f.feed_form,
            target_group: f.target_group,
            recommended_inclusion_min_percent: f.recommended_inclusion_min_percent,
            recommended_inclusion_max_percent: f.recommended_inclusion_max_percent,
            dry_matter: f.dry_matter,
            crude_protein: f.crude_protein,
            rup: f.rup,
            rdp: f.rdp,
            ndf: f.ndf,
            adf: f.adf,
            lignin: f.lignin,
            starch: f.starch,
            sugar: f.sugar,
            fat: f.fat,
            ash: f.ash,
            nel_mcal_kg: f.nel_mcal_kg,
            me_mcal_kg: f.me_mcal_kg,
            calcium: f.calcium,
            phosphorus: f.phosphorus,
            magnesium: f.magnesium,
            potassium: f.potassium,
            sodium: f.sodium,
            chloride: f.chloride,
            sulfur: f.sulfur,
            vitamin_a: f.vitamin_a,
            vitamin_d: f.vitamin_d,
            vitamin_e: f.vitamin_e,
            source_system: f.source_system,
            label_verification_status: f.label_verification_status,
            source_confidence: f.source_confidence,
            market_scope: f.market_scope,
            is_active: f.is_active,
            notes: f.notes,
          };

          // Allowlist filter: drop anything not in the table, and drop
          // undefined values so we don't accidentally null out columns.
          const safeFeedPayload = Object.fromEntries(
            Object.entries(rawFeedPayload).filter(
              ([key, value]) =>
                (FACTOR_ITEM_FEED_DETAIL_ALLOWED_COLUMNS as readonly string[]).includes(key) &&
                value !== undefined,
            ),
          );

          // If nothing useful beyond factor_item_id survives, skip the
          // detail insert entirely — factors + factor_items already saved,
          // and the snapshot is optional per product spec.
          const usefulKeys = Object.keys(safeFeedPayload).filter(
            (k) => k !== "factor_item_id",
          );
          if (usefulKeys.length === 0) {
            continue;
          }

          const { error: detErr } = await supabase
            .from("factor_item_feed_details")
            .insert(safeFeedPayload as never);

          // Detail snapshot is optional — log but do not fail the factor.
          if (detErr) {
            // eslint-disable-next-line no-console
            console.warn(
              `[factor_item_feed_details] row ${i + 1} snapshot skipped:`,
              detErr.message,
            );
          }
          continue;
        }

        const { error: detErr } = await supabase
          // Detail table names are validated against the static DETAIL_CONFIG
          // map, so this dynamic .from() is safe.
          .from(cfg.dbTable as never)
          .insert(detailPayload as never);

        if (detErr) throw new Error(`ردیف ${i + 1} (جزئیات): ${detErr.message}`);
      }


      // ----------------------------------------------------------------
      // Step 4 — persist related-cost drafts.
      // We collect input-order ids so step 5 can wire each item back to its
      // source via `source_related_cost_id`. Partial failures are tolerated:
      // a missing id only blocks step 6 if that cost backs an enabled source.
      // ----------------------------------------------------------------
      const costIdByDraftId: Record<string, string> = {};
      let skipSettlementDueToCostFailure = false;
      if (costDrafts.length > 0) {
        // Strip the local-only _draftId before insert (insertManyRelatedCosts
        // ignores `id` automatically; we additionally drop `factor_id` because
        // the helper sets the real one from its first arg).
        const stripped = costDrafts.map(({ _draftId: _d, factor_id: _f, ...rest }) => rest);
        const res = await insertManyRelatedCosts(factor.id, stripped);
        res.ids.forEach((id, i) => {
          if (id) costIdByDraftId[costDrafts[i]._draftId] = id;
        });
        if (res.failed.length > 0) {
          // If any failed cost is referenced by an enabled source, skip
          // step 6 so we don't emit orphan items.
          const failedDraftIds = new Set(res.failed.map((f) => costDrafts[f.index]._draftId));
          const blocks = sources.some(
            (s) =>
              s.settlement_requirement === "requires_settlement" &&
              s.origin.type === "cost" &&
              failedDraftIds.has(s.origin.costDraftId),
          );
          skipSettlementDueToCostFailure = blocks;
          toast({
            title: "برخی هزینه‌های وابسته ذخیره نشدند",
            description: res.failed.map((f) => `ردیف ${f.index + 1}: ${f.message}`).join(" | "),
            variant: "destructive",
          });
        }
      }

      // ----------------------------------------------------------------
      // Steps 5+6 — build settlement payload and submit atomically.
      // Skipped when zero sources require settlement OR when a cost
      // failure invalidated the linkage.
      // ----------------------------------------------------------------
      // Track outcome flags so the final user-facing toast accurately
      // describes which save phases succeeded. This is the core of the
      // Scenario-10 fix: we must not show a generic success toast (or
      // navigate away silently) when settlement RPC failed.
      let settlementAttempted = false;
      let settlementFailed = false;
      let settlementErrorMessage: string | null = null;
      const costsAttempted = costDrafts.length > 0;

      const itemsPayload = buildRpcItemsPayload(
        assignedSources,
        costIdByDraftId,
        invoiceNumber || null,
      );
      if (itemsPayload.length > 0 && !skipSettlementDueToCostFailure) {
        settlementAttempted = true;
        const requestPayload = {
          title: `تسویه فاکتور ${invoiceNumber ?? ""}`.trim(),
          description: `تولید خودکار از فاکتور ${invoiceNumber ?? factor.id}`,
          request_type: "purchase",
          legacy_request_type_code: 2,
          status: "pending_approval",
        };
        // Convert Jalali "YYYY/MM/DD" → Gregorian ISO for the wire shape the
        // RPC expects (matches what PaymentRequestsTab does).
        const wireItems = itemsPayload.map((i) => ({
          ...i,
          due_date: jalaliToGregorianDate(i.due_date || "") || "",
          status: "pending_approval",
          execution_status: "pending",
        }));
        const { error: rpcErr } = await supabase.rpc(
          "submit_payment_request" as never,
          { p_request: requestPayload, p_items: wireItems } as never,
        );
        if (rpcErr) {
          // Factor + costs remain persisted. Mark failure so the final
          // toast accurately reflects partial success and we do NOT
          // navigate away silently. User can retry settlement creation
          // from PaymentRequestsTab on the invoice detail page.
          settlementFailed = true;
          settlementErrorMessage = rpcErr.message || null;
        }
      }

      // ----------------------------------------------------------------
      // Final user-facing outcome. Four distinct cases, per the spec:
      //   1) invoice only saved
      //   2) invoice + costs saved
      //   3) invoice + costs + settlement saved
      //   4) invoice + costs saved but settlement FAILED  ← Scenario 10
      // In case 4 we stay on the form (do not navigate) so the user can
      // see the error and decide what to do next.
      // ----------------------------------------------------------------
      if (settlementFailed) {
        toast({
          title: "فاکتور و هزینه‌های وابسته ثبت شدند، اما درخواست تسویه ایجاد نشد.",
          description: settlementErrorMessage
            ? `خطای درخواست تسویه: ${settlementErrorMessage}`
            : "می‌توانید بعداً از صفحه جزئیات فاکتور، درخواست تسویه را ایجاد کنید.",
          variant: "destructive",
        });
        // Intentionally do NOT navigate away — user must see the failure
        // and can navigate manually when ready.
      } else if (settlementAttempted) {
        toast({
          title: "فاکتور، هزینه‌های وابسته و درخواست تسویه با موفقیت ثبت شدند",
        });
        navigate("/invoices");
      } else if (costsAttempted) {
        toast({ title: "فاکتور و هزینه‌های وابسته با موفقیت ثبت شدند" });
        navigate("/invoices");
      } else {
        toast({ title: "فاکتور با موفقیت ثبت شد" });
        navigate("/invoices");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast({ title: "ثبت فاکتور ناموفق بود", description: message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };


  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------
  return (
    <div className="space-y-6 animate-fade-in">
      {/* ------------------ Header ------------------ */}
      <Card className="p-4 space-y-4 bg-card border-border">
        <h2 className="text-lg font-semibold text-foreground">اطلاعات فاکتور</h2>

        {/* invoice type */}
        <SearchableSelect
          label="نوع فاکتور"
          options={INVOICE_TYPES}
          value={invoiceType}
          onChange={setInvoiceType}
          placeholder="انتخاب نوع فاکتور..."
        />

        {/* invoice date */}
        <JalaliDatePicker label="تاریخ فاکتور" value={invoiceDate} onChange={setInvoiceDate} />

        {/* finance party (counterparty) */}
        <SearchableSelect
          label="طرف مالی"
          options={partyOptions}
          value={financePartyId}
          onChange={setFinancePartyId}
          placeholder="انتخاب طرف مالی..."
        />

        {/* invoice number */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-foreground">شماره فاکتور</label>
          <Input
            value={invoiceNumber}
            onChange={(e) => {
              // Manual edit by the operator → drop the auto-filled flag so
              // type toggles don't blow their value away.
              autoFilledRef.current = false;
              setInvoiceNumber(e.target.value);
            }}
            placeholder="مثلاً 1024"
          />
        </div>

        {/* tax mode */}
        <SearchableSelect
          label="مالیات"
          options={TAX_OPTIONS}
          value={tax}
          onChange={setTax}
          placeholder="..."
        />

        {/* description */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-foreground">توضیحات</label>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="توضیحات اختیاری..."
          />
        </div>
      </Card>

      {/* ------------------ Rows ------------------ */}
      <Card className="p-4 space-y-4 bg-card border-border">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">اقلام فاکتور</h2>
          <Button type="button" variant="secondary" size="sm" onClick={addRow}>
            <Plus className="ms-1 h-4 w-4" />
            افزودن ردیف
          </Button>
        </div>

        {rows.map((row, idx) => {
          const cfg = DETAIL_CONFIG[row.product_type];
          return (
            <div
              key={row.uid}
              // Each row gets its own bordered card so the operator can
              // visually scan a long mixed invoice.
              className="rounded-md border border-border p-3 space-y-3 bg-background/40"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">ردیف {idx + 1}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => removeRow(row.uid)}
                  disabled={rows.length <= 1}
                  aria-label="حذف ردیف"
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>

              {/* product_type dropdown — the key driver of this row's UI. */}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-foreground">نوع محصول</label>
                <Select
                  value={row.product_type}
                  onValueChange={(v) => changeRowType(row.uid, v as ProductType)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRODUCT_TYPES.map((p) => (
                      <SelectItem key={p.value} value={p.value}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* ---------------------------------------------------------
                  Per-product item selector + extra detail fields.
                  Rendered BEFORE the shared quantity/price block so the
                  operator's mental flow is: pick type → pick the actual
                  item → only then enter quantity/price for it.
                  --------------------------------------------------------- */}
              <div className="pt-2 border-t border-border/60">
                <div className="text-xs text-muted-foreground mb-2">
                  جزئیات اختصاصی ({PRODUCT_TYPES.find((p) => p.value === row.product_type)?.label})
                </div>

                {/* Medicine + Feed product types use bespoke enterprise
                    pickers (rich server-side search, info panel, verification
                    banner). All other "selectable" product types fall back
                    to the generic <SearchableSelect> driven by
                    SELECTOR_CONFIG. */}
                {row.product_type === "medicine" ? (
                  <div className="mb-3">
                    <MedicineProductPicker
                      value={row.medicineProduct?.id ?? null}
                      selected={row.medicineProduct ?? null}
                      onSelect={(m) => updateRow(row.uid, { medicineProduct: m })}
                      onClear={() => updateRow(row.uid, { medicineProduct: null })}
                    />
                  </div>
                ) : row.product_type === "feed" ? (
                  <div className="mb-3">
                    <FeedProductPicker
                      value={row.feedProduct?.id ?? null}
                      selected={row.feedProduct ?? null}
                      onSelect={(f) => updateRow(row.uid, { feedProduct: f })}
                      onClear={() => updateRow(row.uid, { feedProduct: null })}
                    />
                  </div>
                ) : (
                  (() => {
                    // Render the generic master-table selector when one is defined.
                    const sel = SELECTOR_CONFIG[row.product_type];
                    if (!sel) return null;
                    const bucket = masters[sel.source];
                    const selectedValue = row.details[sel.primaryKey] ?? "";
                    const display = row.details._display;
                    return (
                      <div className="mb-3">
                        <SearchableSelect
                          label={sel.label}
                          options={bucket.options}
                          value={selectedValue}
                          onChange={(v) => applyMasterSelection(row.uid, row.product_type, v)}
                          placeholder={
                            bucket.options.length
                              ? "جستجو و انتخاب..."
                              : "در حال بارگذاری..."
                          }
                        />
                        {display && (
                          <div className="mt-1 text-xs text-primary">
                            انتخاب‌شده: {display}
                          </div>
                        )}
                      </div>
                    );
                  })()
                )}

                {/* Extra per-product fields (batch/expiry, weights, etc.). */}
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {cfg.fields.map((f) => (
                    <DynamicField
                      key={f.key}
                      def={f}
                      value={row.details[f.key] ?? ""}
                      onChange={(v) => updateRowDetail(row.uid, f.key, v)}
                    />
                  ))}
                </div>
              </div>

              {/* ---------------------------------------------------------
                  Shared factor_items fields (quantity / unit / price /
                  discount / tax / description) — moved BELOW the product
                  picker so the operator only deals with pricing AFTER the
                  actual item is locked in.
                  --------------------------------------------------------- */}
              <div className="pt-2 border-t border-border/60 grid grid-cols-2 md:grid-cols-4 gap-3">
                <FieldNumber
                  label="تعداد"
                  value={row.quantity}
                  onChange={(v) => updateRow(row.uid, { quantity: v })}
                />
                <FieldText
                  label="واحد"
                  value={row.unit}
                  onChange={(v) => updateRow(row.uid, { unit: v })}
                />
                <FieldNumber
                  label="قیمت واحد"
                  value={row.unit_price}
                  onChange={(v) => updateRow(row.uid, { unit_price: v })}
                />
                <FieldNumber
                  label="تخفیف"
                  value={row.discount_amount}
                  onChange={(v) => updateRow(row.uid, { discount_amount: v })}
                />
                <FieldNumber
                  label="مالیات ردیف"
                  value={row.tax_amount}
                  onChange={(v) => updateRow(row.uid, { tax_amount: v })}
                />
                <div className="col-span-2 md:col-span-3">
                  <FieldText
                    label="توضیح ردیف"
                    value={row.description}
                    onChange={(v) => updateRow(row.uid, { description: v })}
                  />
                </div>
              </div>

              {/* Per-row total — computed live from quantity × unit_price
                  minus discount plus tax. Helps the operator sanity-check
                  before adding more rows. */}
              <div className="pt-2 border-t border-border/60 flex items-center justify-between text-sm">
                <span className="text-muted-foreground">جمع ردیف</span>
                <span className="font-semibold text-foreground">
                  {(
                    (parseFloat(row.quantity || "0") || 0) *
                      (parseFloat(row.unit_price || "0") || 0) -
                    (parseFloat(row.discount_amount || "0") || 0) +
                    (parseFloat(row.tax_amount || "0") || 0)
                  ).toLocaleString("fa-IR")}
                </span>
              </div>

            </div>
          );
        })}
      </Card>

      {/* ------------------ Tasks 2+3: Related Costs ------------------ */}
      <InvoiceRelatedCostsBlock
        drafts={costDrafts}
        onAdd={addCostDraft}
        onUpdate={updateCostDraft}
        onDelete={deleteCostDraft}
      />

      {/* ------------------ Tasks 2+3: Settlement Sources ------------------ */}
      <InvoiceSettlementSourcesBlock
        sources={assignedSources}
        errors={settlementErrors}
        onPatchSource={patchSource}
      />

      {/* ------------------ Totals + Submit ------------------ */}
      <Card className="p-4 bg-card border-border space-y-3">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <Totals label="جمع کل" value={totals.total} />
          <Totals label="جمع تخفیف" value={totals.discountSum} />
          <Totals label="جمع مالیات" value={totals.taxSum} />
          <Totals label="قابل پرداخت" value={totals.payable} bold />
        </div>
        {/* The review dialog is mandatory — clicking here only OPENS it.
            Actual save runs from inside the dialog's "ثبت نهایی" button. */}
        <Button
          onClick={() => {
            if (!invoiceDate) {
              toast({ title: "تاریخ فاکتور را وارد کنید", variant: "destructive" });
              return;
            }
            setReviewOpen(true);
          }}
          disabled={saving}
          className="w-full"
        >
          پیش‌نمایش و ثبت نهایی
        </Button>
      </Card>

      <InvoiceReviewDialog
        open={reviewOpen}
        onClose={() => setReviewOpen(false)}
        onConfirm={async () => {
          await handleSubmit();
          setReviewOpen(false);
        }}
        saving={saving}
        invoiceNumber={invoiceNumber || null}
        invoiceDateLabel={
          invoiceDate ? `${invoiceDate.year}/${invoiceDate.month}/${invoiceDate.day}` : "—"
        }
        invoiceTypeLabel={INVOICE_TYPES.find((t) => t.value === invoiceType)?.label ?? invoiceType}
        partyLabel={partyLabel}
        totalPayable={totals.payable}
        itemCount={rows.length}
        costDrafts={costDrafts}
        sources={sources}
        errors={settlementErrors}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tiny presentational helpers. Extracted so the main render stays scannable.
// ---------------------------------------------------------------------------
function FieldText({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1">
      <label className="block text-xs font-medium text-foreground">{label}</label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function FieldNumber({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1">
      <label className="block text-xs font-medium text-foreground">{label}</label>
      <Input
        // We keep the input as a free-form text and coerce at save time —
        // <input type=number> in RTL Persian UIs is fiddly with separators.
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

// Render any DETAIL_CONFIG field by its declared type. Date fields fall back
// to a plain HTML `date` input so we don't pull the heavy Jalali picker into
// every detail row.
function DynamicField({
  def,
  value,
  onChange,
}: {
  def: DetailFieldDef;
  value: string;
  onChange: (v: string) => void;
}) {
  if (def.type === "number") return <FieldNumber label={def.label} value={value} onChange={onChange} />;
  if (def.type === "date") {
    return (
      <div className="space-y-1">
        <label className="block text-xs font-medium text-foreground">{def.label}</label>
        <Input type="date" value={value} onChange={(e) => onChange(e.target.value)} />
      </div>
    );
  }
  return <FieldText label={def.label} value={value} onChange={onChange} />;
}

function Totals({ label, value, bold }: { label: string; value: number; bold?: boolean }) {
  return (
    <div className="rounded-md bg-background/40 border border-border/60 p-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={bold ? "text-foreground font-semibold" : "text-foreground"}>
        {value.toLocaleString("fa-IR")}
      </div>
    </div>
  );
}
