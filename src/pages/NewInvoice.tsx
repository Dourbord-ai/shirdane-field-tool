import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import SearchableSelect from "@/components/SearchableSelect";
import JalaliDatePicker from "@/components/JalaliDatePicker";
import { JalaliDate, toPersianDigits } from "@/lib/jalali";
import { Separator } from "@/components/ui/separator";
import { supabase } from "@/integrations/supabase/client";
import { Plus, Trash2 } from "lucide-react";

// ---- static data ----
const productTypes = [
  { label: "اسپرم", value: "sperm" },
  { label: "شیر", value: "milk" },
  { label: "خوراک", value: "feed" },
  { label: "دارو", value: "medicine" },
  { label: "دام", value: "livestock" },
  { label: "سایر", value: "other" },
];

const invoiceTypesMap: Record<string, { label: string; value: string }[]> = {
  sperm: [{ label: "خرید", value: "buy" }],
  milk: [
    { label: "قبض مراکز خرید شیر", value: "milk_receipt" },
    { label: "فروش خورده", value: "retail_sell" },
  ],
  feed: [{ label: "خرید", value: "buy" }],
  medicine: [{ label: "خرید", value: "buy" }],
  livestock: [{ label: "خرید", value: "buy" }, { label: "فروش", value: "sell" }],
  other: [{ label: "خرید", value: "buy" }, { label: "فروش", value: "sell" }],
};

const taxOptions = [
  { label: "دارد", value: "yes" },
  { label: "ندارد", value: "no" },
];

const sellerTypeOptions = [
  { label: "شرکت", value: "company" },
  { label: "شخص", value: "person" },
];

const companyList = [
  { label: "داروخانه دکتر بایرامی", value: "bayerami" },
  { label: "اتحادیه قزوین", value: "qazvin_union" },
];

const milkCompanyList = [
  { label: "شرکت پگاه فارس", value: "pegah_fars" },
  { label: "شرکت رامک", value: "ramak" },
  { label: "پگاه + رامک", value: "pegah_ramak" },
];

const settlementTypes = [
  { label: "نقدی", value: "cash" },
  { label: "پس پرداخت", value: "deferred" },
  { label: "چک", value: "cheque" },
  { label: "نقد - پس چک", value: "cash_cheque" },
];

interface ProductRow {
  id: string;
  spermCode: string;
  quantity: string;
  unitPrice: string;
  description: string;
}

const createRow = (): ProductRow => ({
  id: Date.now().toString() + Math.random().toString(36).slice(2),
  spermCode: "",
  quantity: "",
  unitPrice: "",
  description: "",
});

interface InvoiceData {
  productType: string;
  invoiceType: string;
  date: JalaliDate | null;
  invoiceNumber: string;
  tax: string;
  sellerType: string;
  company: string;
  settlement: string;
  discount: string;
  shipping: string;
  // Milk-specific
  deliveryDate: JalaliDate | null;
  isBuyerCompany: boolean;
  milkCompany: string;
  quantityKg: string;
  quantityLiter: string;
  milkSample: string;
  fat: string;
  protein: string;
  total: string;
  somatic: string;
  pricePerKg: string;
  milkDescription: string;
}

const initial: InvoiceData = {
  productType: "",
  invoiceType: "",
  date: null,
  invoiceNumber: "",
  tax: "",
  sellerType: "",
  company: "",
  settlement: "",
  discount: "",
  shipping: "",
  deliveryDate: null,
  isBuyerCompany: false,
  milkCompany: "",
  quantityKg: "",
  quantityLiter: "",
  milkSample: "0.97",
  fat: "",
  protein: "",
  total: "",
  somatic: "",
  pricePerKg: "",
  milkDescription: "",
};

function formatRial(n: number): string {
  return toPersianDigits(n.toLocaleString("en-US")) + " ریال";
}

export default function NewInvoice() {
  const navigate = useNavigate();
  const [data, setData] = useState<InvoiceData>(initial);
  const [rows, setRows] = useState<ProductRow[]>([createRow()]);
  const [submitted, setSubmitted] = useState(false);
  const [spermOptions, setSpermOptions] = useState<{ label: string; value: string }[]>([]);

  // Fetch sperms from Supabase
  useEffect(() => {
    const fetchSperms = async () => {
      const { data: sperms } = await supabase.from("sperms").select("*").order("id");
      if (sperms) {
        setSpermOptions(
          sperms.map((s) => ({
            label: `${s.code || ""} - ${s.name || ""}`.trim(),
            value: s.id.toString(),
          }))
        );
      }
    };
    fetchSperms();
  }, []);

  const set = <K extends keyof InvoiceData>(key: K, val: InvoiceData[K]) =>
    setData((prev) => ({ ...prev, [key]: val }));

  const updateRow = (rowId: string, field: keyof ProductRow, value: string) => {
    setRows((prev) =>
      prev.map((r) => (r.id === rowId ? { ...r, [field]: value } : r))
    );
  };

  const addRow = () => setRows((prev) => [...prev, createRow()]);

  const removeRow = (rowId: string) => {
    if (rows.length <= 1) return;
    setRows((prev) => prev.filter((r) => r.id !== rowId));
  };

  const isMilk = data.productType === "milk";
  const isMilkReceipt = isMilk && data.invoiceType === "milk_receipt";
  const isMilkRetail = isMilk && data.invoiceType === "retail_sell";
  const isSperm = data.productType === "sperm";

  // Auto-calculate liter from kg using sample
  const milkSample = parseFloat(data.milkSample) || 0.97;
  const quantityKg = parseFloat(data.quantityKg) || 0;
  const autoLiter = milkSample > 0 ? Math.round((quantityKg / milkSample) * 100) / 100 : 0;
  const milkPricePerKg = parseInt(data.pricePerKg) || 0;
  const milkTotal = Math.round(quantityKg * milkPricePerKg);
  const milkDiscount = parseInt(data.discount) || 0;
  const milkShipping = parseInt(data.shipping) || 0;
  const milkTaxAmount = data.tax === "yes" ? Math.round(milkTotal * 0.1) : 0;
  const milkPayable = isMilkRetail
    ? milkTotal - milkDiscount + milkShipping + milkTaxAmount
    : milkTotal + milkTaxAmount;

  // Non-milk calculations (multi-row)
  const rowTotals = rows.map((r) => (parseInt(r.quantity) || 0) * (parseInt(r.unitPrice) || 0));
  const totalProduct = rowTotals.reduce((a, b) => a + b, 0);
  const discount = parseInt(data.discount) || 0;
  const shipping = parseInt(data.shipping) || 0;
  const taxAmount = data.tax === "yes" ? Math.round(totalProduct * 0.1) : 0;
  const payable = totalProduct - discount + shipping + taxAmount;

  const invoiceTypes = data.productType ? (invoiceTypesMap[data.productType] || []) : [];

  // Visibility logic
  const showInvoiceType = !!data.productType;
  const showDate = !!data.invoiceType;
  const showInvoiceNumber = !!data.date;
  const showTax = !!data.invoiceNumber;

  // Milk flow
  const showDeliveryDate = isMilk && !!data.tax;
  const showBuyer = isMilk && !!data.deliveryDate;
  const showMilkCompany = isMilk && data.isBuyerCompany;
  const showMilkDetails = isMilk && (data.isBuyerCompany ? !!data.milkCompany : showBuyer);
  const showMilkPreview = showMilkDetails && !!data.settlement && quantityKg > 0 && milkPricePerKg > 0;

  // Non-milk flow
  const showSellerType = !isMilk && !!data.tax;
  const showCompany = showSellerType && data.sellerType === "company";
  const showProductDetails = !isMilk && (data.sellerType === "person" || (data.sellerType === "company" && !!data.company));
  const hasValidRows = rows.some((r) => (parseInt(r.quantity) || 0) > 0 && (parseInt(r.unitPrice) || 0) > 0);
  const showPreview = showProductDetails && !!data.settlement && hasValidRows;

  const handleSubmit = async () => {
    const finalTotal = isMilk ? milkTotal : totalProduct;
    const finalTax = isMilk ? milkTaxAmount : taxAmount;
    const finalPayable = isMilk ? milkPayable : payable;
    const finalDiscount = isMilk ? milkDiscount : discount;
    const finalShipping = isMilk ? milkShipping : shipping;

    // Format dates to string
    const formatDate = (d: JalaliDate | null) =>
      d ? `${d.year}/${d.month}/${d.day}` : null;

    // 1) Insert factor header
    const { data: factor, error: factorError } = await supabase
      .from("factors")
      .insert({
        product_type: data.productType,
        invoice_type: data.invoiceType,
        invoice_date: formatDate(data.date),
        invoice_number: data.invoiceNumber || null,
        delivery_date: formatDate(data.deliveryDate),
        tax: data.tax || "ندارد",
        buyer_type: isMilk
          ? (data.isBuyerCompany ? "company" : "person")
          : data.sellerType || null,
        company: isMilk ? data.milkCompany : data.company || null,
        discount: finalDiscount,
        shipping: finalShipping,
        tax_amount: finalTax,
        total_amount: finalTotal,
        payable_amount: finalPayable,
        settlement_type: data.settlement || null,
        settlement_date: null,
        settlement_number: null,
        description: isMilk
          ? data.milkDescription
          : rows.map((r) => r.description).filter(Boolean).join(" | ") || null,
      })
      .select()
      .single();

    if (factorError || !factor) {
      console.error("Factor insert error:", factorError);
      alert("خطا در ثبت فاکتور: " + (factorError?.message || "Unknown"));
      return;
    }

    // 2) Insert line items into their respective table
    if (isSperm && rows.length > 0) {
      const spermRows = rows
        .filter((r) => r.spermCode || (parseInt(r.quantity) || 0) > 0)
        .map((r) => {
          const selectedSperm = spermOptions.find((s) => s.value === r.spermCode);
          return {
            factor_id: factor.id,
            sperm_code: selectedSperm ? selectedSperm.label.split(" - ")[0]?.trim() : r.spermCode,
            sperm_name: selectedSperm ? selectedSperm.label.split(" - ")[1]?.trim() : null,
            quantity: parseInt(r.quantity) || 0,
            unit_price: parseInt(r.unitPrice) || 0,
            row_total: (parseInt(r.quantity) || 0) * (parseInt(r.unitPrice) || 0),
            description: r.description || null,
          };
        });

      if (spermRows.length > 0) {
        const { error: itemsError } = await supabase.from("spermbuy").insert(spermRows);
        if (itemsError) {
          console.error("Spermbuy insert error:", itemsError);
        }
      }
    }

    // Insert milk line item
    if (isMilk && quantityKg > 0) {
      const { error: milkError } = await supabase.from("milk").insert({
        factor_id: factor.id,
        quantity_kg: quantityKg,
        quantity_liter: autoLiter,
        milk_sample: milkSample,
        fat: parseFloat(data.fat) || 0,
        protein: parseFloat(data.protein) || 0,
        total: parseFloat(data.total) || 0,
        somatic: parseFloat(data.somatic) || 0,
        price_per_kg: milkPricePerKg,
        row_total: milkTotal,
        description: data.milkDescription || null,
      });
      if (milkError) {
        console.error("Milk insert error:", milkError);
      }
    }

    setSubmitted(true);
    setTimeout(() => navigate("/invoices"), 1200);
  };

  if (submitted) {
    return (
      <div className="py-20 text-center animate-fade-in">
        <div className="w-16 h-16 mx-auto rounded-full bg-primary/10 flex items-center justify-center mb-4">
          <span className="text-3xl">✓</span>
        </div>
        <h2 className="text-heading text-foreground">فاکتور با موفقیت ثبت شد</h2>
        <p className="text-body text-muted-foreground mt-2">در حال انتقال به لیست فاکتورها...</p>
      </div>
    );
  }

  return (
    <div className="py-6 space-y-4 animate-fade-in">
      <h1 className="text-heading text-foreground">ثبت فاکتور جدید</h1>

      {/* Product Type */}
      <SearchableSelect
        label="نوع محصول"
        options={productTypes}
        value={data.productType}
        onChange={(v) => {
          setData({ ...initial, productType: v });
          setRows([createRow()]);
        }}
        placeholder="انتخاب نوع محصول..."
      />

      {/* Invoice Type */}
      {showInvoiceType && (
        <div className="animate-fade-in">
          <SearchableSelect
            label="نوع فاکتور"
            options={invoiceTypes}
            value={data.invoiceType}
            onChange={(v) => set("invoiceType", v)}
            placeholder="انتخاب نوع فاکتور..."
          />
        </div>
      )}

      {/* Date */}
      {showDate && (
        <div className="animate-fade-in">
          <JalaliDatePicker
            label="تاریخ فاکتور"
            value={data.date}
            onChange={(v) => set("date", v)}
          />
        </div>
      )}

      {/* Invoice Number / Receipt Number */}
      {showInvoiceNumber && (
        <div className="animate-fade-in space-y-2">
          <label className="block text-sm font-medium text-foreground">
            {isMilk ? "شماره قبض" : "شماره فاکتور"}
          </label>
          <Input
            value={data.invoiceNumber}
            onChange={(e) => set("invoiceNumber", e.target.value)}
            placeholder={isMilk ? "شماره قبض را وارد کنید..." : "شماره فاکتور را وارد کنید..."}
            className="rounded-xl touch-target"
          />
        </div>
      )}

      {/* Tax */}
      {showTax && (
        <div className="animate-fade-in">
          <SearchableSelect
            label="مالیات"
            options={taxOptions}
            value={data.tax}
            onChange={(v) => set("tax", v)}
            placeholder="آیا مالیات دارد؟"
          />
        </div>
      )}

      {/* ===== MILK FLOW ===== */}
      {showDeliveryDate && (
        <div className="animate-fade-in">
          <JalaliDatePicker
            label="تاریخ تحویل"
            value={data.deliveryDate}
            onChange={(v) => set("deliveryDate", v)}
          />
        </div>
      )}

      {showBuyer && (
        <div className="animate-fade-in space-y-3">
          <label className="block text-sm font-medium text-foreground">خریدار</label>
          <div className="flex items-center gap-3">
            <Checkbox
              id="buyerCompany"
              checked={data.isBuyerCompany}
              onCheckedChange={(checked) => {
                set("isBuyerCompany", !!checked);
                if (!checked) set("milkCompany", "");
              }}
            />
            <label htmlFor="buyerCompany" className="text-sm text-foreground cursor-pointer">
              شرکت
            </label>
          </div>
        </div>
      )}

      {showMilkCompany && (
        <div className="animate-fade-in">
          <SearchableSelect
            label="لیست شرکت‌ها"
            options={milkCompanyList}
            value={data.milkCompany}
            onChange={(v) => set("milkCompany", v)}
            placeholder="انتخاب شرکت..."
          />
        </div>
      )}

      {showMilkDetails && (
        <div className="animate-fade-in space-y-4">
          <Separator />

          {/* Quantity KG */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-foreground">مقدار به کیلو</label>
            <Input
              type="number"
              value={data.quantityKg}
              onChange={(e) => set("quantityKg", e.target.value)}
              placeholder="مقدار به کیلوگرم..."
              className="rounded-xl touch-target"
              min="0"
            />
          </div>

          {/* Milk Receipt only fields */}
          {isMilkReceipt && (
            <>
              <div className="space-y-2">
                <label className="block text-sm font-medium text-foreground">مقدار به لیتر</label>
                <div className="flex gap-2 items-center">
                  <Input
                    value={quantityKg > 0 ? toPersianDigits(autoLiter.toString()) : ""}
                    readOnly
                    placeholder="خودکار محاسبه می‌شود"
                    className="rounded-xl touch-target bg-muted/50 flex-1"
                  />
                  <div className="flex items-center gap-1 text-xs text-muted-foreground whitespace-nowrap">
                    <span>نمونه:</span>
                    <Input
                      type="number"
                      value={data.milkSample}
                      onChange={(e) => set("milkSample", e.target.value)}
                      className="rounded-lg w-16 h-8 text-center text-xs"
                      step="0.01"
                      min="0"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-medium text-foreground">چربی</label>
                <Input type="number" value={data.fat} onChange={(e) => set("fat", e.target.value)} placeholder="درصد چربی..." className="rounded-xl touch-target" step="0.01" min="0" />
              </div>
              <div className="space-y-2">
                <label className="block text-sm font-medium text-foreground">پروتئین</label>
                <Input type="number" value={data.protein} onChange={(e) => set("protein", e.target.value)} placeholder="درصد پروتئین..." className="rounded-xl touch-target" step="0.01" min="0" />
              </div>
              <div className="space-y-2">
                <label className="block text-sm font-medium text-foreground">توتال</label>
                <Input type="number" value={data.total} onChange={(e) => set("total", e.target.value)} placeholder="توتال..." className="rounded-xl touch-target" step="0.01" min="0" />
              </div>
              <div className="space-y-2">
                <label className="block text-sm font-medium text-foreground">سماتیک</label>
                <Input type="number" value={data.somatic} onChange={(e) => set("somatic", e.target.value)} placeholder="سماتیک..." className="rounded-xl touch-target" min="0" />
              </div>
            </>
          )}

          {/* Price per KG */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-foreground">قیمت هر کیلو ریال</label>
            <Input type="number" value={data.pricePerKg} onChange={(e) => set("pricePerKg", e.target.value)} placeholder="قیمت هر کیلو..." className="rounded-xl touch-target" min="0" />
          </div>

          {quantityKg > 0 && milkPricePerKg > 0 && (
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">مبلغ کل فاکتور</span>
                <span className="text-body-lg font-bold text-primary">{formatRial(milkTotal)}</span>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <label className="block text-sm font-medium text-foreground">توضیحات</label>
            <Textarea value={data.milkDescription} onChange={(e) => set("milkDescription", e.target.value)} placeholder="توضیحات اضافی..." className="rounded-xl min-h-[80px]" />
          </div>

          <SearchableSelect label="نحوه تسویه" options={settlementTypes} value={data.settlement} onChange={(v) => set("settlement", v)} placeholder="نوع تسویه..." />
        </div>
      )}

      {/* Milk Preview */}
      {showMilkPreview && (
        <div className="animate-fade-in space-y-4 mt-6">
          <Separator />
          <div className="rounded-2xl border-2 border-dashed border-primary/30 bg-card p-5 space-y-4">
            <h2 className="text-body-lg font-bold text-foreground text-center border-b border-border pb-3">پیش‌نمایش فاکتور</h2>
            <div className="space-y-3 text-sm">
              <Row label="مبلغ کل فاکتور" value={formatRial(milkTotal)} />
              {isMilkRetail && (
                <>
                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-foreground">تخفیف (ریال)</label>
                    <Input type="number" value={data.discount} onChange={(e) => set("discount", e.target.value)} placeholder="۰" className="rounded-xl touch-target" min="0" />
                  </div>
                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-foreground">کرایه حمل و نقل (ریال)</label>
                    <Input type="number" value={data.shipping} onChange={(e) => set("shipping", e.target.value)} placeholder="۰" className="rounded-xl touch-target" min="0" />
                  </div>
                </>
              )}
              {data.tax === "yes" && <Row label="مبلغ مالیات (۱۰٪)" value={formatRial(milkTaxAmount)} highlight />}
              <Separator />
              <Row label="مبلغ قابل پرداخت" value={formatRial(milkPayable)} bold />
            </div>
          </div>
          <Button onClick={handleSubmit} className="w-full touch-target rounded-xl gap-2 text-body font-bold transition-all duration-200 hover:shadow-[0_4px_20px_-4px_hsl(142_50%_36%/0.3)]" size="lg">
            ثبت نهایی
          </Button>
        </div>
      )}

      {/* ===== NON-MILK FLOW ===== */}
      {showSellerType && (
        <div className="animate-fade-in">
          <SearchableSelect label="فروشنده" options={sellerTypeOptions} value={data.sellerType} onChange={(v) => { set("sellerType", v); set("company", ""); }} placeholder="نوع فروشنده..." />
        </div>
      )}

      {showCompany && (
        <div className="animate-fade-in">
          <SearchableSelect label="لیست شرکت‌ها" options={companyList} value={data.company} onChange={(v) => set("company", v)} placeholder="انتخاب شرکت..." />
        </div>
      )}

      {showProductDetails && (
        <div className="animate-fade-in space-y-4">
          <Separator />

          {/* Product rows header */}
          <div className="flex items-center justify-between">
            <h2 className="text-body font-bold text-foreground">اقلام فاکتور</h2>
            <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded-lg">
              {toPersianDigits(rows.length.toString())} ردیف
            </span>
          </div>

          {/* Product rows */}
          <div className="space-y-3">
            {rows.map((row, index) => (
              <div
                key={row.id}
                className="rounded-2xl border-2 border-accent/30 bg-accent/5 p-4 space-y-3 relative"
              >
                {/* Row header */}
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-accent bg-accent/10 px-2.5 py-1 rounded-lg">
                    ردیف {toPersianDigits((index + 1).toString())}
                  </span>
                  {rows.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeRow(row.id)}
                      className="p-2 rounded-lg text-destructive/70 hover:text-destructive hover:bg-destructive/10 transition-colors"
                      aria-label="حذف ردیف"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>

                {/* Sperm code select */}
                {isSperm && (
                  <SearchableSelect
                    label="کد و نام اسپرم"
                    options={spermOptions}
                    value={row.spermCode}
                    onChange={(v) => updateRow(row.id, "spermCode", v)}
                    placeholder="انتخاب اسپرم..."
                  />
                )}

                {/* Quantity & Unit price side by side on mobile */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-foreground">تعداد</label>
                    <Input
                      type="number"
                      value={row.quantity}
                      onChange={(e) => updateRow(row.id, "quantity", e.target.value)}
                      placeholder="تعداد..."
                      className="rounded-xl touch-target text-sm"
                      min="0"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-foreground">قیمت واحد (ریال)</label>
                    <Input
                      type="number"
                      value={row.unitPrice}
                      onChange={(e) => updateRow(row.id, "unitPrice", e.target.value)}
                      placeholder="قیمت واحد..."
                      className="rounded-xl touch-target text-sm"
                      min="0"
                    />
                  </div>
                </div>

                {/* Row total */}
                {rowTotals[index] > 0 && (
                  <div className="flex justify-between items-center bg-accent/10 rounded-xl px-3 py-2">
                    <span className="text-xs text-muted-foreground">جمع ردیف</span>
                    <span className="text-sm font-bold text-accent">{formatRial(rowTotals[index])}</span>
                  </div>
                )}

                {/* Description */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-foreground">توضیحات</label>
                  <Input
                    value={row.description}
                    onChange={(e) => updateRow(row.id, "description", e.target.value)}
                    placeholder="توضیحات ردیف..."
                    className="rounded-xl touch-target text-sm"
                  />
                </div>
              </div>
            ))}
          </div>

          {/* Add row button */}
          <Button
            type="button"
            variant="outline"
            onClick={addRow}
            className="w-full touch-target rounded-xl gap-2 border-dashed border-2 border-accent/40 text-accent hover:bg-accent/10 hover:text-accent"
          >
            <Plus className="w-5 h-5" />
            ردیف جدید
          </Button>

          {/* Grand total of all rows */}
          {totalProduct > 0 && (
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">قیمت کل</span>
                <span className="text-body-lg font-bold text-primary">{formatRial(totalProduct)}</span>
              </div>
            </div>
          )}

          {/* Settlement */}
          <SearchableSelect label="نوع تسویه" options={settlementTypes} value={data.settlement} onChange={(v) => set("settlement", v)} placeholder="نوع تسویه..." />
        </div>
      )}

      {/* Non-milk Preview */}
      {showPreview && (
        <div className="animate-fade-in space-y-4 mt-6">
          <Separator />
          <div className="rounded-2xl border-2 border-dashed border-primary/30 bg-card p-5 space-y-4">
            <h2 className="text-body-lg font-bold text-foreground text-center border-b border-border pb-3">پیش‌نمایش فاکتور</h2>
            <div className="space-y-3 text-sm">
              <Row label="مبلغ کل فاکتور" value={formatRial(totalProduct)} />
              <div className="space-y-2">
                <label className="block text-sm font-medium text-foreground">تخفیف (ریال)</label>
                <Input type="number" value={data.discount} onChange={(e) => set("discount", e.target.value)} placeholder="۰" className="rounded-xl touch-target" min="0" />
              </div>
              <div className="space-y-2">
                <label className="block text-sm font-medium text-foreground">کرایه حمل و نقل (ریال)</label>
                <Input type="number" value={data.shipping} onChange={(e) => set("shipping", e.target.value)} placeholder="۰" className="rounded-xl touch-target" min="0" />
              </div>
              {data.tax === "yes" && <Row label="مبلغ مالیات (۱۰٪)" value={formatRial(taxAmount)} highlight />}
              <Separator />
              <Row label="مبلغ قابل پرداخت" value={formatRial(payable)} bold />
            </div>
          </div>
          <Button onClick={handleSubmit} className="w-full touch-target rounded-xl gap-2 text-body font-bold transition-all duration-200 hover:shadow-[0_4px_20px_-4px_hsl(142_50%_36%/0.3)]" size="lg">
            ثبت نهایی
          </Button>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, bold, highlight }: { label: string; value: string; bold?: boolean; highlight?: boolean }) {
  return (
    <div className={cn("flex justify-between items-center py-2", bold && "border-t-2 border-primary/20 pt-3")}>
      <span className={cn("text-muted-foreground", bold && "font-bold text-foreground")}>{label}</span>
      <span className={cn(
        "font-medium",
        bold ? "text-primary text-lg font-bold" : highlight ? "text-accent font-bold" : "text-foreground"
      )}>
        {value}
      </span>
    </div>
  );
}
