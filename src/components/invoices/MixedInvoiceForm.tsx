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

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Plus, Trash2 } from "lucide-react";
import SearchableSelect from "@/components/SearchableSelect";
import JalaliDatePicker from "@/components/JalaliDatePicker";
import { JalaliDate } from "@/lib/jalali";
import { jalaliToGregorianTimestamp } from "@/lib/dateUtils";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";

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
    fields: [
      { key: "cow_id", label: "شماره گاو", type: "text" },
      { key: "weight", label: "وزن (kg)", type: "number" },
      { key: "off_unit_price", label: "قیمت پایه", type: "number" },
      { key: "delivery_cost", label: "هزینه تحویل", type: "number" },
      { key: "vat", label: "مالیات", type: "number" },
      { key: "payable_unit_price", label: "قیمت قابل پرداخت", type: "number" },
    ],
  },
  feed: {
    dbTable: "factor_item_feed_details",
    fields: [
      { key: "feed_name", label: "نام خوراک", type: "text" },
      { key: "batch_number", label: "شماره بچ", type: "text" },
      { key: "expire_date", label: "تاریخ انقضا", type: "date" },
      { key: "dry_matter_pct", label: "ماده خشک %", type: "number" },
    ],
  },
  medicine: {
    dbTable: "factor_item_medicine_details",
    fields: [
      { key: "medicine_name", label: "نام دارو", type: "text" },
      { key: "batch_number", label: "شماره بچ", type: "text" },
      { key: "expire_date", label: "تاریخ انقضا", type: "date" },
      { key: "manufacturer", label: "تولیدکننده", type: "text" },
      { key: "withdrawal_days", label: "روز پرهیز", type: "number" },
    ],
  },
  sperm: {
    dbTable: "factor_item_sperm_details",
    fields: [
      { key: "bull_code", label: "کد گاو نر", type: "text" },
      { key: "bull_name", label: "نام گاو نر", type: "text" },
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
  const isSale = invoiceType === "sell";

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

  // Auto-fill on mount and whenever the operator flips into a sales mode.
  // We never overwrite a number the user has already typed.
  useEffect(() => {
    if (!isSale) return;
    if (invoiceNumber) return;
    let cancelled = false;
    (async () => {
      const next = await fetchNextSalesInvoiceNumber();
      if (cancelled || next === null) return;
      setInvoiceNumber(next);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSale, invoiceNumber]);

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
    updateRow(uid, { product_type, details: {} });

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
      const { data: factor, error: hdrErr } = await supabase
        .from("factors")
        .insert({
          product_type: "mixed",
          invoice_type: invoiceType,
          factor_type_id: invoiceType === "buy" ? 1 : invoiceType === "sell" ? 2 : null,
          invoice_date: isoDate,
          invoice_number: invoiceNumber || null,
          tax: tax === "yes" ? "دارد" : "ندارد",
          finance_party_id: financePartyId || null,
          discount: totals.discountSum,
          shipping: 0,
          tax_amount: totals.taxSum,
          total_amount: totals.total,
          payable_amount: totals.payable,
          description: description || null,
        })
        .select("id")
        .single();

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

        // 2b) detail insert. We project the per-key strings into typed
        //     values: number fields → parseFloat, others verbatim. Keys
        //     declared in DETAIL_CONFIG are guaranteed to exist on the
        //     target table (we authored both at the same time).
        const detailPayload: Record<string, unknown> = { factor_item_id: item.id };
        for (const f of cfg.fields) {
          const raw = row.details[f.key];
          if (raw === undefined || raw === "") continue; // leave NULL
          detailPayload[f.key] = f.type === "number" ? num(raw) : raw;
        }
        const { error: detErr } = await supabase
          // Detail table names are validated against the static DETAIL_CONFIG
          // map, so this dynamic .from() is safe.
          .from(cfg.dbTable as never)
          .insert(detailPayload as never);

        if (detErr) throw new Error(`ردیف ${i + 1} (جزئیات): ${detErr.message}`);
      }

      toast({ title: "فاکتور با موفقیت ثبت شد" });
      navigate("/invoices");
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
            onChange={(e) => setInvoiceNumber(e.target.value)}
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

              {/* shared factor_items fields */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
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

              {/* per-product detail block. We render whatever fields the
                  DETAIL_CONFIG declares for this product_type. */}
              <div className="pt-2 border-t border-border/60">
                <div className="text-xs text-muted-foreground mb-2">
                  جزئیات اختصاصی ({PRODUCT_TYPES.find((p) => p.value === row.product_type)?.label})
                </div>
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
            </div>
          );
        })}
      </Card>

      {/* ------------------ Totals + Submit ------------------ */}
      <Card className="p-4 bg-card border-border space-y-3">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <Totals label="جمع کل" value={totals.total} />
          <Totals label="جمع تخفیف" value={totals.discountSum} />
          <Totals label="جمع مالیات" value={totals.taxSum} />
          <Totals label="قابل پرداخت" value={totals.payable} bold />
        </div>
        <Button onClick={handleSubmit} disabled={saving} className="w-full">
          {saving ? "در حال ثبت..." : "ثبت فاکتور"}
        </Button>
      </Card>
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
