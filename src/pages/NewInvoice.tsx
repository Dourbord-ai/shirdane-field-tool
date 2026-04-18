import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  { label: "خدمات", value: "services" },
  { label: "کرایه", value: "rental" },
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
  services: [{ label: "خرید", value: "buy" }, { label: "فروش", value: "sell" }],
  rental: [{ label: "خرید", value: "buy" }, { label: "فروش", value: "sell" }],
};

const serviceSubTypeOptions = [
  { label: "معاینات", value: "examinations" },
  { label: "اجرت", value: "wage" },
  { label: "کارگر روز مزد", value: "daily_worker" },
];

const workModeOptions = [
  { label: "روزانه", value: "daily" },
  { label: "پیمان کاری", value: "contract" },
];

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

// ---- Row types ----
interface ProductRow {
  id: string;
  spermCode: string;
  itemName: string;
  quantity: string;
  unitPrice: string;
  description: string;
}

const createRow = (): ProductRow => ({
  id: Date.now().toString() + Math.random().toString(36).slice(2),
  spermCode: "",
  itemName: "",
  quantity: "",
  unitPrice: "",
  description: "",
});

interface FeedProductRow {
  id: string;
  feedName: string;
  weightKg: string;
  moistureLoss: string;
  pricePerKg: string;
  description: string;
}

const createFeedRow = (): FeedProductRow => ({
  id: Date.now().toString() + Math.random().toString(36).slice(2),
  feedName: "",
  weightKg: "",
  moistureLoss: "",
  pricePerKg: "",
  description: "",
});

interface MedicineProductRow {
  id: string;
  medicineName: string;
  medicineType: string;
  quantity: string;
  unitPrice: string;
  description: string;
}

const createMedicineRow = (): MedicineProductRow => ({
  id: Date.now().toString() + Math.random().toString(36).slice(2),
  medicineName: "",
  medicineType: "",
  quantity: "",
  unitPrice: "",
  description: "",
});

interface LivestockProductRow {
  id: string;
  animalNumber: string;
  earNumber: string;
  saleType: string;
  weightKg: string;
  pricePerKg: string;
  description: string;
}

const livestockSaleTypeOptions = [
  { label: "فروش", value: "sale" },
  { label: "تلفات", value: "loss" },
  { label: "کشتار", value: "slaughter" },
  { label: "سایر", value: "other" },
];

const createLivestockRow = (): LivestockProductRow => ({
  id: Date.now().toString() + Math.random().toString(36).slice(2),
  animalNumber: "",
  earNumber: "",
  saleType: "",
  weightKg: "",
  pricePerKg: "",
  description: "",
});

interface MilkProductRow {
  id: string;
  quantityKg: string;
  milkSample: string;
  fat: string;
  protein: string;
  total: string;
  somatic: string;
  pricePerKg: string;
  description: string;
}

const createMilkRow = (): MilkProductRow => ({
  id: Date.now().toString() + Math.random().toString(36).slice(2),
  quantityKg: "",
  milkSample: "0.97",
  fat: "",
  protein: "",
  total: "",
  somatic: "",
  pricePerKg: "",
  description: "",
});

interface ExaminationRow {
  id: string;
  itemName: string;
  quantity: string;
  unitPrice: string;
  description: string;
}

const createExaminationRow = (): ExaminationRow => ({
  id: Date.now().toString() + Math.random().toString(36).slice(2),
  itemName: "",
  quantity: "",
  unitPrice: "",
  description: "",
});

interface WageRow {
  id: string;
  purpose: string;
  workMode: string;
  startDate: JalaliDate | null;
  endDate: JalaliDate | null;
  paymentType: string;
  dailyAmount: string;
  contractAmount: string;
  accountHolder: string;
  ibanOrCard: string;
  description: string;
}

const createWageRow = (): WageRow => ({
  id: Date.now().toString() + Math.random().toString(36).slice(2),
  purpose: "",
  workMode: "",
  startDate: null,
  endDate: null,
  paymentType: "",
  dailyAmount: "",
  contractAmount: "",
  accountHolder: "",
  ibanOrCard: "",
  description: "",
});

interface DailyWorkerRow {
  id: string;
  purpose: string;
  workerName: string;
  daysCount: string;
  hoursCount: string;
  dailyRate: string;
  hourlyRate: string;
  startDate: JalaliDate | null;
  endDate: JalaliDate | null;
  description: string;
}

const createDailyWorkerRow = (): DailyWorkerRow => ({
  id: Date.now().toString() + Math.random().toString(36).slice(2),
  purpose: "",
  workerName: "",
  daysCount: "",
  hoursCount: "",
  dailyRate: "",
  hourlyRate: "",
  startDate: null,
  endDate: null,
  description: "",
});

interface InvoiceData {
  productType: string;
  invoiceType: string;
  serviceSubType: string;
  date: JalaliDate | null;
  invoiceNumber: string;
  tax: string;
  sellerType: string;
  company: string;
  settlement: string;
  discount: string;
  shipping: string;
  deliveryDate: JalaliDate | null;
  isBuyerCompany: boolean;
  milkCompany: string;
}

const initial: InvoiceData = {
  productType: "",
  invoiceType: "",
  serviceSubType: "",
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
};

function formatRial(n: number): string {
  return toPersianDigits(n.toLocaleString("en-US")) + " ریال";
}

export default function NewInvoice() {
  const navigate = useNavigate();
  const [data, setData] = useState<InvoiceData>(initial);
  const [rows, setRows] = useState<ProductRow[]>([createRow()]);
  const [milkRows, setMilkRows] = useState<MilkProductRow[]>([createMilkRow()]);
  const [feedRows, setFeedRows] = useState<FeedProductRow[]>([createFeedRow()]);
  const [medicineRows, setMedicineRows] = useState<MedicineProductRow[]>([createMedicineRow()]);
  const [livestockRows, setLivestockRows] = useState<LivestockProductRow[]>([createLivestockRow()]);
  const [examinationRows, setExaminationRows] = useState<ExaminationRow[]>([createExaminationRow()]);
  const [wageRows, setWageRows] = useState<WageRow[]>([createWageRow()]);
  const [dailyWorkerRows, setDailyWorkerRows] = useState<DailyWorkerRow[]>([createDailyWorkerRow()]);
  const [submitted, setSubmitted] = useState(false);
  const [spermOptions, setSpermOptions] = useState<{ label: string; value: string }[]>([]);
  const [feedCompanyOptions, setFeedCompanyOptions] = useState<{ label: string; value: string }[]>([]);
  const [medicineCompanyOptions, setMedicineCompanyOptions] = useState<{ label: string; value: string }[]>([]);
  const [livestockCompanyOptions, setLivestockCompanyOptions] = useState<{ label: string; value: string }[]>([]);
  const [otherCompanyOptions, setOtherCompanyOptions] = useState<{ label: string; value: string }[]>([]);
  const [otherItemOptions, setOtherItemOptions] = useState<{ label: string; value: string }[]>([]);
  const [examinationItemOptions, setExaminationItemOptions] = useState<{ label: string; value: string }[]>([]);
  const [feedOptions, setFeedOptions] = useState<{ label: string; value: string }[]>([]);
  const [medicineOptions, setMedicineOptions] = useState<{ label: string; value: string; typeId: number; typeName: string }[]>([]);
  const [cowOptions, setCowOptions] = useState<{ label: string; value: string; earNumber: string }[]>([]);

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
    const fetchFeedCompanies = async () => {
      const { data: companies } = await supabase.from("feedshoppingcenter").select("*").order("id");
      if (companies) {
        setFeedCompanyOptions(
          companies.map((c) => ({
            label: c.name || "",
            value: c.id.toString(),
          }))
        );
      }
    };
    const fetchMedicineCompanies = async () => {
      const { data: companies } = await supabase.from("medicineshoppingcenter").select("*").order("id");
      if (companies) {
        setMedicineCompanyOptions(
          companies.map((c) => ({
            label: c.name || "",
            value: c.id.toString(),
          }))
        );
      }
    };
    const fetchFeeds = async () => {
      const { data: feeds } = await supabase.from("feeds").select("*").order("id");
      if (feeds) {
        setFeedOptions(
          feeds.map((f) => ({
            label: f.name || "",
            value: f.id.toString(),
          }))
        );
      }
    };
    const fetchMedicines = async () => {
      const { data: meds } = await supabase.from("medicines").select("*").order("id");
      const { data: types } = await supabase.from("medicinetypes").select("*").order("id");
      if (meds && types) {
        const typeMap = new Map(types.map((t) => [t.id, t.name || ""]));
        setMedicineOptions(
          meds.map((m) => ({
            label: m.name || "",
            value: m.id.toString(),
            typeId: Number(m.medicinetypeid) || 0,
            typeName: typeMap.get(Number(m.medicinetypeid)) || "",
          }))
        );
      }
    };
    const fetchLivestockCompanies = async () => {
      const { data: companies } = await supabase.from("buy_cattle_shoppingcenter").select("*").order("id");
      if (companies) {
        setLivestockCompanyOptions(
          companies.map((c) => ({
            label: c.name || "",
            value: c.id.toString(),
          }))
        );
      }
    };
    const fetchCows = async () => {
      const { data: cows } = await supabase.from("cows").select("*").order("bodynumber");
      if (cows) {
        setCowOptions(
          cows
            .filter((c) => c.bodynumber != null)
            .map((c) => ({
              label: c.bodynumber?.toString() || "",
              value: c.id.toString(),
              earNumber: c.earnumber?.toString() || "",
            }))
        );
      }
    };
    const fetchOtherCompanies = async () => {
      const { data: companies } = await supabase.from("other_shoppingcenter").select("*").order("id");
      if (companies) {
        setOtherCompanyOptions(
          companies.map((c) => ({
            label: c.name || "",
            value: c.id.toString(),
          }))
        );
      }
    };
    const fetchOtherItems = async () => {
      const { data: parents } = await supabase.from("factor_item_type").select("*").order("id");
      const { data: children } = await supabase.from("factor_item_type_id").select("*").order("id");
      if (parents && children) {
        const parentMap = new Map(parents.map((p) => [p.id, p.name || ""]));
        // Parents tagged as services_examinations should be excluded from "other" and shown under services
        const examinationParentIds = new Set(
          (parents as Array<{ id: number; category?: string | null }>)
            .filter((p) => (p.category || "other") === "services_examinations")
            .map((p) => p.id)
        );
        const childOption = (c: { id: number; name: string | null; factortypeid: number | null }) => {
          const parentName = parentMap.get(Number(c.factortypeid)) || "";
          return {
            label: parentName ? `${parentName} - ${c.name}` : c.name || "",
            value: c.id.toString(),
          };
        };
        setOtherItemOptions(
          children
            .filter((c) => c.name && !examinationParentIds.has(Number(c.factortypeid)))
            .map(childOption)
        );
        setExaminationItemOptions(
          children
            .filter((c) => c.name && examinationParentIds.has(Number(c.factortypeid)))
            .map(childOption)
        );
      }
    };
    fetchSperms();
    fetchFeedCompanies();
    fetchMedicineCompanies();
    fetchLivestockCompanies();
    fetchOtherCompanies();
    fetchOtherItems();
    fetchFeeds();
    fetchMedicines();
    fetchCows();
  }, []);

  const set = <K extends keyof InvoiceData>(key: K, val: InvoiceData[K]) =>
    setData((prev) => ({ ...prev, [key]: val }));

  // Sperm row helpers
  const updateRow = (rowId: string, field: keyof ProductRow, value: string) => {
    setRows((prev) => prev.map((r) => (r.id === rowId ? { ...r, [field]: value } : r)));
  };
  const addRow = () => setRows((prev) => [...prev, createRow()]);
  const removeRow = (rowId: string) => {
    if (rows.length <= 1) return;
    setRows((prev) => prev.filter((r) => r.id !== rowId));
  };

  // Milk row helpers
  const updateMilkRow = (rowId: string, field: keyof MilkProductRow, value: string) => {
    setMilkRows((prev) => prev.map((r) => (r.id === rowId ? { ...r, [field]: value } : r)));
  };
  const addMilkRow = () => setMilkRows((prev) => [...prev, createMilkRow()]);
  const removeMilkRow = (rowId: string) => {
    if (milkRows.length <= 1) return;
    setMilkRows((prev) => prev.filter((r) => r.id !== rowId));
  };

  // Feed row helpers
  const updateFeedRow = (rowId: string, field: keyof FeedProductRow, value: string) => {
    setFeedRows((prev) => prev.map((r) => (r.id === rowId ? { ...r, [field]: value } : r)));
  };
  const addFeedRow = () => setFeedRows((prev) => [...prev, createFeedRow()]);
  const removeFeedRow = (rowId: string) => {
    if (feedRows.length <= 1) return;
    setFeedRows((prev) => prev.filter((r) => r.id !== rowId));
  };

  // Medicine row helpers
  const updateMedicineRow = (rowId: string, field: keyof MedicineProductRow, value: string) => {
    setMedicineRows((prev) => prev.map((r) => (r.id === rowId ? { ...r, [field]: value } : r)));
  };
  const selectMedicine = (rowId: string, medicineValue: string) => {
    const med = medicineOptions.find((m) => m.value === medicineValue);
    setMedicineRows((prev) =>
      prev.map((r) =>
        r.id === rowId
          ? { ...r, medicineName: medicineValue, medicineType: med?.typeName || "" }
          : r
      )
    );
  };
  const addMedicineRow = () => setMedicineRows((prev) => [...prev, createMedicineRow()]);
  const removeMedicineRow = (rowId: string) => {
    if (medicineRows.length <= 1) return;
    setMedicineRows((prev) => prev.filter((r) => r.id !== rowId));
  };

  // Livestock row helpers
  const updateLivestockRow = (rowId: string, field: keyof LivestockProductRow, value: string) => {
    setLivestockRows((prev) => prev.map((r) => (r.id === rowId ? { ...r, [field]: value } : r)));
  };
  const selectCow = (rowId: string, cowValue: string) => {
    const cow = cowOptions.find((c) => c.value === cowValue);
    setLivestockRows((prev) =>
      prev.map((r) =>
        r.id === rowId
          ? { ...r, animalNumber: cowValue, earNumber: cow?.earNumber || "" }
          : r
      )
    );
  };
  const addLivestockRow = () => setLivestockRows((prev) => [...prev, createLivestockRow()]);
  const removeLivestockRow = (rowId: string) => {
    if (livestockRows.length <= 1) return;
    setLivestockRows((prev) => prev.filter((r) => r.id !== rowId));
  };

  // Examination row helpers
  const updateExaminationRow = (rowId: string, field: keyof ExaminationRow, value: string) => {
    setExaminationRows((prev) => prev.map((r) => (r.id === rowId ? { ...r, [field]: value } : r)));
  };
  const addExaminationRow = () => setExaminationRows((prev) => [...prev, createExaminationRow()]);
  const removeExaminationRow = (rowId: string) => {
    if (examinationRows.length <= 1) return;
    setExaminationRows((prev) => prev.filter((r) => r.id !== rowId));
  };

  // Wage row helpers
  const updateWageRow = (rowId: string, field: keyof WageRow, value: string | JalaliDate | null) => {
    setWageRows((prev) => prev.map((r) => (r.id === rowId ? { ...r, [field]: value } as WageRow : r)));
  };
  const addWageRow = () => setWageRows((prev) => [...prev, createWageRow()]);
  const removeWageRow = (rowId: string) => {
    if (wageRows.length <= 1) return;
    setWageRows((prev) => prev.filter((r) => r.id !== rowId));
  };

  // Daily worker row helpers
  const updateDailyWorkerRow = (rowId: string, field: keyof DailyWorkerRow, value: string | JalaliDate | null) => {
    setDailyWorkerRows((prev) => prev.map((r) => (r.id === rowId ? { ...r, [field]: value } as DailyWorkerRow : r)));
  };
  const addDailyWorkerRow = () => setDailyWorkerRows((prev) => [...prev, createDailyWorkerRow()]);
  const removeDailyWorkerRow = (rowId: string) => {
    if (dailyWorkerRows.length <= 1) return;
    setDailyWorkerRows((prev) => prev.filter((r) => r.id !== rowId));
  };

  const isMilk = data.productType === "milk";
  const isMilkReceipt = isMilk && data.invoiceType === "milk_receipt";
  const isMilkRetail = isMilk && data.invoiceType === "retail_sell";
  const isSperm = data.productType === "sperm";
  const isFeed = data.productType === "feed";
  const isMedicine = data.productType === "medicine";
  const isLivestock = data.productType === "livestock";
  const isServices = data.productType === "services";
  const isExaminations = isServices && data.serviceSubType === "examinations";
  const isWage = isServices && data.serviceSubType === "wage";
  const isDailyWorker = isServices && data.serviceSubType === "daily_worker";

  // Milk calculations (multi-row)
  const milkRowCalcs = milkRows.map((r) => {
    const kg = parseFloat(r.quantityKg) || 0;
    const sample = parseFloat(r.milkSample) || 0.97;
    const liter = sample > 0 ? Math.round((kg / sample) * 100) / 100 : 0;
    const ppk = parseInt(r.pricePerKg) || 0;
    const rowTotal = Math.round(kg * ppk);
    return { kg, sample, liter, ppk, rowTotal };
  });
  const milkTotalProduct = milkRowCalcs.reduce((a, b) => a + b.rowTotal, 0);
  const milkDiscount = parseInt(data.discount) || 0;
  const milkShipping = parseInt(data.shipping) || 0;
  const milkTaxAmount = data.tax === "yes" ? Math.round(milkTotalProduct * 0.1) : 0;
  const milkPayable = isMilkRetail
    ? milkTotalProduct - milkDiscount + milkShipping + milkTaxAmount
    : milkTotalProduct + milkTaxAmount;

  // Feed calculations (multi-row)
  const feedRowCalcs = feedRows.map((r) => {
    const wt = parseFloat(r.weightKg) || 0;
    const moisture = parseFloat(r.moistureLoss) || 0;
    const ppk = parseInt(r.pricePerKg) || 0;
    const effectiveWeight = wt * (1 - moisture / 100);
    const rowTotal = Math.round(effectiveWeight * ppk);
    return { wt, moisture, effectiveWeight, ppk, rowTotal };
  });
  const feedTotalProduct = feedRowCalcs.reduce((a, b) => a + b.rowTotal, 0);

  // Medicine calculations (multi-row)
  const medicineRowTotals = medicineRows.map((r) => (parseInt(r.quantity) || 0) * (parseInt(r.unitPrice) || 0));
  const medicineTotalProduct = medicineRowTotals.reduce((a, b) => a + b, 0);

  // Livestock calculations (multi-row)
  const livestockRowCalcs = livestockRows.map((r) => {
    const wt = parseFloat(r.weightKg) || 0;
    const ppk = parseInt(r.pricePerKg) || 0;
    const rowTotal = Math.round(wt * ppk);
    return { wt, ppk, rowTotal };
  });
  const livestockTotalProduct = livestockRowCalcs.reduce((a, b) => a + b.rowTotal, 0);

  // Non-milk/non-feed calculations (multi-row)
  const rowTotals = rows.map((r) => (parseInt(r.quantity) || 0) * (parseInt(r.unitPrice) || 0));
  const genericTotalProduct = rowTotals.reduce((a, b) => a + b, 0);

  // Examination calculations
  const examinationRowTotals = examinationRows.map((r) => (parseInt(r.quantity) || 0) * (parseInt(r.unitPrice) || 0));
  const examinationTotalProduct = examinationRowTotals.reduce((a, b) => a + b, 0);

  // Wage calculations: total = daily*days OR contract amount (whichever is entered)
  const wageRowCalcs = wageRows.map((r) => {
    const daily = parseInt(r.dailyAmount) || 0;
    const contract = parseInt(r.contractAmount) || 0;
    const rowTotal = r.workMode === "contract" ? contract : daily;
    return { rowTotal };
  });
  const wageTotalProduct = wageRowCalcs.reduce((a, b) => a + b.rowTotal, 0);

  // Daily worker calculations
  const dailyWorkerRowCalcs = dailyWorkerRows.map((r) => {
    const days = parseFloat(r.daysCount) || 0;
    const hours = parseFloat(r.hoursCount) || 0;
    const dRate = parseInt(r.dailyRate) || 0;
    const hRate = parseInt(r.hourlyRate) || 0;
    const rowTotal = Math.round(days * dRate + hours * hRate);
    return { rowTotal };
  });
  const dailyWorkerTotalProduct = dailyWorkerRowCalcs.reduce((a, b) => a + b.rowTotal, 0);

  // Unified total for non-milk
  const totalProduct = isFeed
    ? feedTotalProduct
    : isMedicine
    ? medicineTotalProduct
    : isLivestock
    ? livestockTotalProduct
    : isExaminations
    ? examinationTotalProduct
    : isWage
    ? wageTotalProduct
    : isDailyWorker
    ? dailyWorkerTotalProduct
    : genericTotalProduct;
  const discount = parseInt(data.discount) || 0;
  const shipping = parseInt(data.shipping) || 0;
  const taxAmount = data.tax === "yes" ? Math.round(totalProduct * 0.1) : 0;
  const payable = totalProduct - discount + shipping + taxAmount;

  const invoiceTypes = data.productType ? (invoiceTypesMap[data.productType] || []) : [];

  // Visibility logic
  const showInvoiceType = !!data.productType;
  // Services requires sub-type chosen before continuing the flow
  const showServiceSubType = isServices && !!data.invoiceType;
  const servicesGate = !isServices || !!data.serviceSubType;
  const showDate = !!data.invoiceType && servicesGate;
  const showInvoiceNumber = !!data.date;
  const showTax = !!data.invoiceNumber;

  // Milk flow
  const showDeliveryDate = isMilk && !!data.tax;
  const showBuyer = isMilk && !!data.deliveryDate;
  const showMilkCompany = isMilk && data.isBuyerCompany;
  const showMilkDetails = isMilk && (data.isBuyerCompany ? !!data.milkCompany : showBuyer);
  const hasMilkValidRows = milkRows.some((r) => (parseFloat(r.quantityKg) || 0) > 0 && (parseInt(r.pricePerKg) || 0) > 0);
  const showMilkPreview = showMilkDetails && !!data.settlement && hasMilkValidRows;

  // Non-milk flow
  const showSellerType = !isMilk && !!data.tax;
  const showCompany = showSellerType && data.sellerType === "company";
  const showProductDetails = !isMilk && (data.sellerType === "person" || (data.sellerType === "company" && !!data.company));
  const hasFeedValidRows = feedRows.some((r) => (parseFloat(r.weightKg) || 0) > 0 && (parseInt(r.pricePerKg) || 0) > 0);
  const hasMedicineValidRows = medicineRows.some((r) => (parseInt(r.quantity) || 0) > 0 && (parseInt(r.unitPrice) || 0) > 0);
  const hasLivestockValidRows = livestockRows.some((r) => (parseFloat(r.weightKg) || 0) > 0 && (parseInt(r.pricePerKg) || 0) > 0);
  const hasExaminationValidRows = examinationRows.some((r) => (parseInt(r.quantity) || 0) > 0 && (parseInt(r.unitPrice) || 0) > 0);
  const hasWageValidRows = wageRows.some((r) => (parseInt(r.dailyAmount) || 0) > 0 || (parseInt(r.contractAmount) || 0) > 0);
  const hasDailyWorkerValidRows = dailyWorkerRows.some((r) => (parseFloat(r.daysCount) || 0) > 0 || (parseFloat(r.hoursCount) || 0) > 0);
  const hasValidRows = isFeed
    ? hasFeedValidRows
    : isMedicine
    ? hasMedicineValidRows
    : isLivestock
    ? hasLivestockValidRows
    : isExaminations
    ? hasExaminationValidRows
    : isWage
    ? hasWageValidRows
    : isDailyWorker
    ? hasDailyWorkerValidRows
    : rows.some((r) => (parseInt(r.quantity) || 0) > 0 && (parseInt(r.unitPrice) || 0) > 0);
  const showPreview = showProductDetails && !!data.settlement && hasValidRows;

  const handleSubmit = async () => {
    const finalTotal = isMilk ? milkTotalProduct : totalProduct;
    const finalTax = isMilk ? milkTaxAmount : taxAmount;
    const finalPayable = isMilk ? milkPayable : payable;
    const finalDiscount = isMilk ? milkDiscount : discount;
    const finalShipping = isMilk ? milkShipping : shipping;

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
        company: isMilk ? data.milkCompany : (() => {
          const allCompanies = data.productType === "feed" ? feedCompanyOptions : data.productType === "medicine" ? medicineCompanyOptions : data.productType === "livestock" ? livestockCompanyOptions : (data.productType === "other" || data.productType === "services" || data.productType === "rental") ? otherCompanyOptions : companyList;
          const found = allCompanies.find((c) => c.value === data.company);
          return found ? found.label : data.company || null;
        })(),
        discount: finalDiscount,
        shipping: finalShipping,
        tax_amount: finalTax,
        total_amount: finalTotal,
        payable_amount: finalPayable,
        settlement_type: data.settlement || null,
        settlement_date: null,
        settlement_number: null,
        description: isMilk
          ? milkRows.map((r) => r.description).filter(Boolean).join(" | ") || null
          : isFeed
          ? feedRows.map((r) => r.description).filter(Boolean).join(" | ") || null
          : isMedicine
          ? medicineRows.map((r) => r.description).filter(Boolean).join(" | ") || null
          : isLivestock
          ? livestockRows.map((r) => r.description).filter(Boolean).join(" | ") || null
          : isExaminations
          ? examinationRows
              .map((r) => {
                const itemLabel = examinationItemOptions.find((o) => o.value === r.itemName)?.label;
                const parts = [itemLabel, r.description].filter(Boolean);
                return parts.join(" — ");
              })
              .filter(Boolean)
              .join(" | ") || null
          : isWage
          ? wageRows.map((r) => [r.purpose, r.description].filter(Boolean).join(" — ")).filter(Boolean).join(" | ") || null
          : isDailyWorker
          ? dailyWorkerRows.map((r) => [r.purpose, r.workerName, r.description].filter(Boolean).join(" — ")).filter(Boolean).join(" | ") || null
          : data.productType === "other"
          ? rows
              .map((r) => {
                const itemLabel = otherItemOptions.find((o) => o.value === r.itemName)?.label;
                const parts = [itemLabel, r.description].filter(Boolean);
                return parts.join(" — ");
              })
              .filter(Boolean)
              .join(" | ") || null
          : rows.map((r) => r.description).filter(Boolean).join(" | ") || null,
      })
      .select()
      .single();

    if (factorError || !factor) {
      console.error("Factor insert error:", factorError);
      alert("خطا در ثبت فاکتور: " + (factorError?.message || "Unknown"));
      return;
    }

    // 2) Insert sperm line items
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
        if (itemsError) console.error("Spermbuy insert error:", itemsError);
      }
    }

    // 3) Insert milk line items
    if (isMilk) {
      const milkInsertRows = milkRows
        .filter((r) => (parseFloat(r.quantityKg) || 0) > 0)
        .map((r, idx) => {
          const calc = milkRowCalcs[idx];
          return {
            factor_id: factor.id,
            quantity_kg: calc.kg,
            quantity_liter: calc.liter,
            milk_sample: calc.sample,
            fat: parseFloat(r.fat) || 0,
            protein: parseFloat(r.protein) || 0,
            total: parseFloat(r.total) || 0,
            somatic: parseFloat(r.somatic) || 0,
            price_per_kg: calc.ppk,
            row_total: calc.rowTotal,
            description: r.description || null,
          };
        });

      if (milkInsertRows.length > 0) {
        const { error: milkError } = await supabase.from("milk").insert(milkInsertRows);
        if (milkError) console.error("Milk insert error:", milkError);
      }
    }

    // 4) Insert feed line items
    if (isFeed) {
      const feedInsertRows = feedRows
        .filter((r) => (parseFloat(r.weightKg) || 0) > 0)
        .map((r, idx) => {
          const calc = feedRowCalcs[idx];
          const selectedFeed = feedOptions.find((f) => f.value === r.feedName);
          return {
            factor_id: factor.id,
            feed_name: selectedFeed ? selectedFeed.label : r.feedName || null,
            weight_kg: calc.wt,
            moisture_loss: calc.moisture,
            price_per_kg: calc.ppk,
            row_total: calc.rowTotal,
            description: r.description || null,
          };
        });

      if (feedInsertRows.length > 0) {
        const { error: feedError } = await supabase.from("feed_items").insert(feedInsertRows);
        if (feedError) console.error("Feed items insert error:", feedError);
      }
    }

    // 5) Insert medicine line items
    if (isMedicine) {
      const medInsertRows = medicineRows
        .filter((r) => (parseInt(r.quantity) || 0) > 0)
        .map((r, idx) => {
          const selectedMed = medicineOptions.find((m) => m.value === r.medicineName);
          return {
            factor_id: factor.id,
            medicine_name: selectedMed ? selectedMed.label : r.medicineName || null,
            medicine_type: r.medicineType || null,
            quantity: parseInt(r.quantity) || 0,
            unit_price: parseInt(r.unitPrice) || 0,
            row_total: medicineRowTotals[idx],
            description: r.description || null,
          };
        });

      if (medInsertRows.length > 0) {
        const { error: medError } = await supabase.from("medicine_items").insert(medInsertRows);
        if (medError) console.error("Medicine items insert error:", medError);
      }
    }

    // 6) Insert livestock line items
    if (isLivestock) {
      const livestockInsertRows = livestockRows
        .filter((r) => (parseFloat(r.weightKg) || 0) > 0)
        .map((r, idx) => {
          const calc = livestockRowCalcs[idx];
          const cow = cowOptions.find((c) => c.value === r.animalNumber);
          const bodyNum = cow ? cow.label : r.animalNumber;
          const earSuffix = cow?.earNumber ? ` (شماره گوش: ${cow.earNumber})` : "";
          const saleTypeLabel = livestockSaleTypeOptions.find((o) => o.value === r.saleType)?.label;
          const saleTypePrefix = saleTypeLabel ? `[نوع: ${saleTypeLabel}] ` : "";
          return {
            factor_id: factor.id,
            animal_number: bodyNum || null,
            weight_kg: calc.wt,
            price_per_kg: calc.ppk,
            row_total: calc.rowTotal,
            description: (saleTypePrefix + (r.description || "") + earSuffix).trim() || null,
          };
        });

      if (livestockInsertRows.length > 0) {
        const { error: livestockError } = await supabase.from("livestock_items").insert(livestockInsertRows);
        if (livestockError) console.error("Livestock items insert error:", livestockError);
      }
    }

    // 7) Insert examination items (services > examinations) — reuse medicine_items table for now? No, store in feed-style. We'll save into a generic table by reusing factor description; line items live below.
    if (isExaminations) {
      const examRowsToInsert = examinationRows
        .filter((r) => r.itemName || (parseInt(r.quantity) || 0) > 0)
        .map((r) => {
          const itemLabel = examinationItemOptions.find((o) => o.value === r.itemName)?.label || r.itemName || null;
          return {
            factor_id: factor.id,
            medicine_name: itemLabel,
            medicine_type: "معاینات",
            quantity: parseInt(r.quantity) || 0,
            unit_price: parseInt(r.unitPrice) || 0,
            row_total: (parseInt(r.quantity) || 0) * (parseInt(r.unitPrice) || 0),
            description: r.description || null,
          };
        });
      if (examRowsToInsert.length > 0) {
        const { error: examErr } = await supabase.from("medicine_items").insert(examRowsToInsert);
        if (examErr) console.error("Examination items insert error:", examErr);
      }
    }

    // 8) Insert wage items
    if (isWage) {
      const wageInsertRows = wageRows
        .filter((r) => r.purpose || (parseInt(r.dailyAmount) || 0) > 0 || (parseInt(r.contractAmount) || 0) > 0)
        .map((r, idx) => ({
          factor_id: factor.id,
          purpose: r.purpose || null,
          work_mode: r.workMode || null,
          start_date: formatDate(r.startDate),
          end_date: formatDate(r.endDate),
          payment_type: r.paymentType || null,
          daily_amount: parseInt(r.dailyAmount) || 0,
          contract_amount: parseInt(r.contractAmount) || 0,
          account_holder: r.accountHolder || null,
          iban_or_card: r.ibanOrCard || null,
          row_total: wageRowCalcs[idx].rowTotal,
          description: r.description || null,
        }));
      if (wageInsertRows.length > 0) {
        const { error: wageErr } = await (supabase as any).from("wage_items").insert(wageInsertRows);
        if (wageErr) console.error("Wage items insert error:", wageErr);
      }
    }

    // 9) Insert daily worker items
    if (isDailyWorker) {
      const dwInsertRows = dailyWorkerRows
        .filter((r) => r.workerName || (parseFloat(r.daysCount) || 0) > 0 || (parseFloat(r.hoursCount) || 0) > 0)
        .map((r, idx) => ({
          factor_id: factor.id,
          purpose: r.purpose || null,
          worker_name: r.workerName || null,
          days_count: parseFloat(r.daysCount) || 0,
          hours_count: parseFloat(r.hoursCount) || 0,
          daily_rate: parseInt(r.dailyRate) || 0,
          hourly_rate: parseInt(r.hourlyRate) || 0,
          start_date: formatDate(r.startDate),
          end_date: formatDate(r.endDate),
          row_total: dailyWorkerRowCalcs[idx].rowTotal,
          description: r.description || null,
        }));
      if (dwInsertRows.length > 0) {
        const { error: dwErr } = await (supabase as any).from("daily_worker_items").insert(dwInsertRows);
        if (dwErr) console.error("Daily worker items insert error:", dwErr);
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
          setMilkRows([createMilkRow()]);
          setFeedRows([createFeedRow()]);
          setMedicineRows([createMedicineRow()]);
          setLivestockRows([createLivestockRow()]);
          setExaminationRows([createExaminationRow()]);
          setWageRows([createWageRow()]);
          setDailyWorkerRows([createDailyWorkerRow()]);
        }}
        placeholder="انتخاب نوع محصول..."
      />

      {/* Invoice Type */}
      {showInvoiceType && (
        <div className="animate-fade-in">
          <SearchableSelect label="نوع فاکتور" options={invoiceTypes} value={data.invoiceType} onChange={(v) => { set("invoiceType", v); set("serviceSubType", ""); }} placeholder="انتخاب نوع فاکتور..." />
        </div>
      )}

      {/* Service Sub-type (only for خدمات) */}
      {showServiceSubType && (
        <div className="animate-fade-in">
          <SearchableSelect
            label="نوع خدمات"
            options={serviceSubTypeOptions}
            value={data.serviceSubType}
            onChange={(v) => set("serviceSubType", v)}
            placeholder="انتخاب نوع خدمات..."
          />
        </div>
      )}

      {/* Date */}
      {showDate && (
        <div className="animate-fade-in">
          <JalaliDatePicker label="تاریخ فاکتور" value={data.date} onChange={(v) => set("date", v)} />
        </div>
      )}

      {/* Invoice Number */}
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
          <SearchableSelect label="مالیات" options={taxOptions} value={data.tax} onChange={(v) => set("tax", v)} placeholder="آیا مالیات دارد؟" />
        </div>
      )}

      {/* ===== MILK FLOW ===== */}
      {showDeliveryDate && (
        <div className="animate-fade-in">
          <JalaliDatePicker label="تاریخ تحویل" value={data.deliveryDate} onChange={(v) => set("deliveryDate", v)} />
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
            <label htmlFor="buyerCompany" className="text-sm text-foreground cursor-pointer">شرکت</label>
          </div>
        </div>
      )}

      {showMilkCompany && (
        <div className="animate-fade-in">
          <SearchableSelect label="لیست شرکت‌ها" options={milkCompanyList} value={data.milkCompany} onChange={(v) => set("milkCompany", v)} placeholder="انتخاب شرکت..." />
        </div>
      )}

      {/* Milk اقلام - same card design as sperm */}
      {showMilkDetails && (
        <div className="animate-fade-in space-y-4">
          <Separator />

          <div className="flex items-center justify-between">
            <h2 className="text-body font-bold text-foreground">اقلام فاکتور</h2>
            <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded-lg">
              {toPersianDigits(milkRows.length.toString())} ردیف
            </span>
          </div>

          <div className="space-y-3">
            {milkRows.map((row, index) => (
              <div key={row.id} className="rounded-2xl border-2 border-accent/30 bg-accent/5 p-4 space-y-3 relative">
                {/* Row header */}
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-accent bg-accent/10 px-2.5 py-1 rounded-lg">
                    ردیف {toPersianDigits((index + 1).toString())}
                  </span>
                  {milkRows.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeMilkRow(row.id)}
                      className="p-2 rounded-lg text-destructive/70 hover:text-destructive hover:bg-destructive/10 transition-colors"
                      aria-label="حذف ردیف"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>

                {/* Quantity KG & Price per KG side by side */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-foreground">مقدار به کیلو</label>
                    <Input
                      type="number"
                      value={row.quantityKg}
                      onChange={(e) => updateMilkRow(row.id, "quantityKg", e.target.value)}
                      placeholder="کیلوگرم..."
                      className="rounded-xl touch-target text-sm"
                      min="0"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-foreground">قیمت هر کیلو (ریال)</label>
                    <Input
                      type="number"
                      value={row.pricePerKg}
                      onChange={(e) => updateMilkRow(row.id, "pricePerKg", e.target.value)}
                      placeholder="قیمت..."
                      className="rounded-xl touch-target text-sm"
                      min="0"
                    />
                  </div>
                </div>

                {/* Milk Receipt only fields */}
                {isMilkReceipt && (
                  <>
                    <div className="space-y-1.5">
                      <label className="block text-xs font-medium text-foreground">مقدار به لیتر</label>
                      <div className="flex gap-2 items-center">
                        <Input
                          value={milkRowCalcs[index].kg > 0 ? toPersianDigits(milkRowCalcs[index].liter.toString()) : ""}
                          readOnly
                          placeholder="خودکار محاسبه می‌شود"
                          className="rounded-xl touch-target bg-muted/50 flex-1 text-sm"
                        />
                        <div className="flex items-center gap-1 text-xs text-muted-foreground whitespace-nowrap">
                          <span>نمونه:</span>
                          <Input
                            type="number"
                            value={row.milkSample}
                            onChange={(e) => updateMilkRow(row.id, "milkSample", e.target.value)}
                            className="rounded-lg w-16 h-8 text-center text-xs"
                            step="0.01"
                            min="0"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <label className="block text-xs font-medium text-foreground">چربی</label>
                        <Input type="number" value={row.fat} onChange={(e) => updateMilkRow(row.id, "fat", e.target.value)} placeholder="درصد..." className="rounded-xl touch-target text-sm" step="0.01" min="0" />
                      </div>
                      <div className="space-y-1.5">
                        <label className="block text-xs font-medium text-foreground">پروتئین</label>
                        <Input type="number" value={row.protein} onChange={(e) => updateMilkRow(row.id, "protein", e.target.value)} placeholder="درصد..." className="rounded-xl touch-target text-sm" step="0.01" min="0" />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <label className="block text-xs font-medium text-foreground">توتال</label>
                        <Input type="number" value={row.total} onChange={(e) => updateMilkRow(row.id, "total", e.target.value)} placeholder="توتال..." className="rounded-xl touch-target text-sm" step="0.01" min="0" />
                      </div>
                      <div className="space-y-1.5">
                        <label className="block text-xs font-medium text-foreground">سماتیک</label>
                        <Input type="number" value={row.somatic} onChange={(e) => updateMilkRow(row.id, "somatic", e.target.value)} placeholder="سماتیک..." className="rounded-xl touch-target text-sm" min="0" />
                      </div>
                    </div>
                  </>
                )}

                {/* Row total */}
                {milkRowCalcs[index].rowTotal > 0 && (
                  <div className="flex justify-between items-center bg-accent/10 rounded-xl px-3 py-2">
                    <span className="text-xs text-muted-foreground">جمع ردیف</span>
                    <span className="text-sm font-bold text-accent">{formatRial(milkRowCalcs[index].rowTotal)}</span>
                  </div>
                )}

                {/* Description */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-foreground">توضیحات</label>
                  <Input
                    value={row.description}
                    onChange={(e) => updateMilkRow(row.id, "description", e.target.value)}
                    placeholder="توضیحات ردیف..."
                    className="rounded-xl touch-target text-sm"
                  />
                </div>
              </div>
            ))}
          </div>

          {/* Add milk row button */}
          <Button
            type="button"
            variant="outline"
            onClick={addMilkRow}
            className="w-full touch-target rounded-xl gap-2 border-dashed border-2 border-accent/40 text-accent hover:bg-accent/10 hover:text-accent"
          >
            <Plus className="w-5 h-5" />
            ردیف جدید
          </Button>

          {/* Grand total */}
          {milkTotalProduct > 0 && (
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">قیمت کل</span>
                <span className="text-body-lg font-bold text-primary">{formatRial(milkTotalProduct)}</span>
              </div>
            </div>
          )}

          {/* Settlement */}
          <SearchableSelect label="نوع تسویه" options={settlementTypes} value={data.settlement} onChange={(v) => set("settlement", v)} placeholder="نوع تسویه..." />
        </div>
      )}

      {/* Milk Preview */}
      {showMilkPreview && (
        <div className="animate-fade-in space-y-4 mt-6">
          <Separator />
          <div className="rounded-2xl border-2 border-dashed border-primary/30 bg-card p-5 space-y-4">
            <h2 className="text-body-lg font-bold text-foreground text-center border-b border-border pb-3">پیش‌نمایش فاکتور</h2>
            <div className="space-y-3 text-sm">
              <RowDisplay label="مبلغ کل فاکتور" value={formatRial(milkTotalProduct)} />
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
              {data.tax === "yes" && <RowDisplay label="مبلغ مالیات (۱۰٪)" value={formatRial(milkTaxAmount)} highlight />}
              <Separator />
              <RowDisplay label="مبلغ قابل پرداخت" value={formatRial(milkPayable)} bold />
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
          <SearchableSelect
            label="لیست شرکت‌ها"
            options={
              data.productType === "feed"
                ? feedCompanyOptions
                : data.productType === "medicine"
                ? medicineCompanyOptions
                : data.productType === "livestock"
                ? livestockCompanyOptions
                : (data.productType === "other" || data.productType === "services" || data.productType === "rental")
                ? otherCompanyOptions
                : companyList
            }
            value={data.company}
            onChange={(v) => set("company", v)}
            placeholder="انتخاب شرکت..."
          />
        </div>
      )}

      {showProductDetails && (
        <div className="animate-fade-in space-y-4">
          <Separator />

          <div className="flex items-center justify-between">
            <h2 className="text-body font-bold text-foreground">اقلام فاکتور</h2>
            <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded-lg">
              {toPersianDigits((isFeed ? feedRows.length : isMedicine ? medicineRows.length : rows.length).toString())} ردیف
            </span>
          </div>

          {/* ===== FEED ITEMS ===== */}
          {isFeed ? (
            <>
              <div className="space-y-3">
                {feedRows.map((row, index) => (
                  <div key={row.id} className="rounded-2xl border-2 border-accent/30 bg-accent/5 p-4 space-y-3 relative">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-accent bg-accent/10 px-2.5 py-1 rounded-lg">
                        ردیف {toPersianDigits((index + 1).toString())}
                      </span>
                      {feedRows.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeFeedRow(row.id)}
                          className="p-2 rounded-lg text-destructive/70 hover:text-destructive hover:bg-destructive/10 transition-colors"
                          aria-label="حذف ردیف"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>

                    <SearchableSelect
                      label="نوع خوراک"
                      options={feedOptions}
                      value={row.feedName}
                      onChange={(v) => updateFeedRow(row.id, "feedName", v)}
                      placeholder="انتخاب نوع خوراک..."
                    />

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <label className="block text-xs font-medium text-foreground">وزن به کیلوگرم</label>
                        <Input type="number" value={row.weightKg} onChange={(e) => updateFeedRow(row.id, "weightKg", e.target.value)} placeholder="کیلوگرم..." className="rounded-xl touch-target text-sm" min="0" />
                      </div>
                      <div className="space-y-1.5">
                        <label className="block text-xs font-medium text-foreground">درصد افت رطوبت</label>
                        <Input type="number" value={row.moistureLoss} onChange={(e) => updateFeedRow(row.id, "moistureLoss", e.target.value)} placeholder="درصد..." className="rounded-xl touch-target text-sm" min="0" max="100" step="0.1" />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label className="block text-xs font-medium text-foreground">قیمت هر کیلوگرم (ریال)</label>
                      <Input type="number" value={row.pricePerKg} onChange={(e) => updateFeedRow(row.id, "pricePerKg", e.target.value)} placeholder="قیمت..." className="rounded-xl touch-target text-sm" min="0" />
                    </div>

                    {feedRowCalcs[index].rowTotal > 0 && (
                      <div className="flex justify-between items-center bg-accent/10 rounded-xl px-3 py-2">
                        <span className="text-xs text-muted-foreground">جمع ردیف</span>
                        <span className="text-sm font-bold text-accent">{formatRial(feedRowCalcs[index].rowTotal)}</span>
                      </div>
                    )}

                    <div className="space-y-1.5">
                      <label className="block text-xs font-medium text-foreground">توضیحات</label>
                      <Input value={row.description} onChange={(e) => updateFeedRow(row.id, "description", e.target.value)} placeholder="توضیحات ردیف..." className="rounded-xl touch-target text-sm" />
                    </div>
                  </div>
                ))}
              </div>

              <Button
                type="button"
                variant="outline"
                onClick={addFeedRow}
                className="w-full touch-target rounded-xl gap-2 border-dashed border-2 border-accent/40 text-accent hover:bg-accent/10 hover:text-accent"
              >
                <Plus className="w-5 h-5" />
                ردیف جدید
              </Button>
            </>
          ) : isMedicine ? (
            <>
              {/* ===== MEDICINE ITEMS ===== */}
              <div className="space-y-3">
                {medicineRows.map((row, index) => (
                  <div key={row.id} className="rounded-2xl border-2 border-accent/30 bg-accent/5 p-4 space-y-3 relative">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-accent bg-accent/10 px-2.5 py-1 rounded-lg">
                        ردیف {toPersianDigits((index + 1).toString())}
                      </span>
                      {medicineRows.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeMedicineRow(row.id)}
                          className="p-2 rounded-lg text-destructive/70 hover:text-destructive hover:bg-destructive/10 transition-colors"
                          aria-label="حذف ردیف"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>

                    <SearchableSelect
                      label="نام دارو"
                      options={medicineOptions.map((m) => ({ label: m.label, value: m.value }))}
                      value={row.medicineName}
                      onChange={(v) => selectMedicine(row.id, v)}
                      placeholder="انتخاب دارو..."
                    />

                    {row.medicineType && (
                      <div className="flex justify-between items-center bg-primary/10 rounded-xl px-3 py-2">
                        <span className="text-xs text-muted-foreground">نوع دارو</span>
                        <span className="text-sm font-bold text-primary">{row.medicineType}</span>
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <label className="block text-xs font-medium text-foreground">تعداد</label>
                        <Input type="number" value={row.quantity} onChange={(e) => updateMedicineRow(row.id, "quantity", e.target.value)} placeholder="تعداد..." className="rounded-xl touch-target text-sm" min="0" />
                      </div>
                      <div className="space-y-1.5">
                        <label className="block text-xs font-medium text-foreground">قیمت واحد (ریال)</label>
                        <Input type="number" value={row.unitPrice} onChange={(e) => updateMedicineRow(row.id, "unitPrice", e.target.value)} placeholder="قیمت واحد..." className="rounded-xl touch-target text-sm" min="0" />
                      </div>
                    </div>

                    {medicineRowTotals[index] > 0 && (
                      <div className="flex justify-between items-center bg-accent/10 rounded-xl px-3 py-2">
                        <span className="text-xs text-muted-foreground">جمع ردیف</span>
                        <span className="text-sm font-bold text-accent">{formatRial(medicineRowTotals[index])}</span>
                      </div>
                    )}

                    <div className="space-y-1.5">
                      <label className="block text-xs font-medium text-foreground">توضیحات</label>
                      <Input value={row.description} onChange={(e) => updateMedicineRow(row.id, "description", e.target.value)} placeholder="توضیحات ردیف..." className="rounded-xl touch-target text-sm" />
                    </div>
                  </div>
                ))}
              </div>

              <Button
                type="button"
                variant="outline"
                onClick={addMedicineRow}
                className="w-full touch-target rounded-xl gap-2 border-dashed border-2 border-accent/40 text-accent hover:bg-accent/10 hover:text-accent"
              >
                <Plus className="w-5 h-5" />
                ردیف جدید
              </Button>
            </>
          ) : isLivestock ? (
            <>
              {/* ===== LIVESTOCK ITEMS ===== */}
              <div className="space-y-3">
                {livestockRows.map((row, index) => (
                  <div key={row.id} className="rounded-2xl border-2 border-accent/30 bg-accent/5 p-4 space-y-3 relative">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-accent bg-accent/10 px-2.5 py-1 rounded-lg">
                        ردیف {toPersianDigits((index + 1).toString())}
                      </span>
                      {livestockRows.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeLivestockRow(row.id)}
                          className="p-2 rounded-lg text-destructive/70 hover:text-destructive hover:bg-destructive/10 transition-colors"
                          aria-label="حذف ردیف"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>

                    <SearchableSelect
                      label="شماره دام"
                      options={cowOptions.map((c) => ({ label: c.label, value: c.value }))}
                      value={row.animalNumber}
                      onChange={(v) => selectCow(row.id, v)}
                      placeholder="انتخاب شماره دام..."
                    />

                    {row.earNumber && (
                      <div className="flex justify-between items-center bg-primary/10 rounded-xl px-3 py-2">
                        <span className="text-xs text-muted-foreground">شماره گوش</span>
                        <span className="text-sm font-bold text-primary">{toPersianDigits(row.earNumber)}</span>
                      </div>
                    )}

                    {data.invoiceType === "sell" && (
                      <SearchableSelect
                        label="نوع"
                        options={livestockSaleTypeOptions}
                        value={row.saleType}
                        onChange={(v) => updateLivestockRow(row.id, "saleType", v)}
                        placeholder="انتخاب نوع..."
                      />
                    )}

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <label className="block text-xs font-medium text-foreground">وزن به کیلوگرم</label>
                        <Input type="number" value={row.weightKg} onChange={(e) => updateLivestockRow(row.id, "weightKg", e.target.value)} placeholder="کیلوگرم..." className="rounded-xl touch-target text-sm" min="0" step="0.01" />
                      </div>
                      <div className="space-y-1.5">
                        <label className="block text-xs font-medium text-foreground">قیمت هر کیلوگرم (ریال)</label>
                        <Input type="number" value={row.pricePerKg} onChange={(e) => updateLivestockRow(row.id, "pricePerKg", e.target.value)} placeholder="قیمت..." className="rounded-xl touch-target text-sm" min="0" />
                      </div>
                    </div>

                    {livestockRowCalcs[index].rowTotal > 0 && (
                      <div className="flex justify-between items-center bg-accent/10 rounded-xl px-3 py-2">
                        <span className="text-xs text-muted-foreground">جمع ردیف</span>
                        <span className="text-sm font-bold text-accent">{formatRial(livestockRowCalcs[index].rowTotal)}</span>
                      </div>
                    )}

                    <div className="space-y-1.5">
                      <label className="block text-xs font-medium text-foreground">توضیحات</label>
                      <Input value={row.description} onChange={(e) => updateLivestockRow(row.id, "description", e.target.value)} placeholder="توضیحات ردیف..." className="rounded-xl touch-target text-sm" />
                    </div>
                  </div>
                ))}
              </div>

              <Button
                type="button"
                variant="outline"
                onClick={addLivestockRow}
                className="w-full touch-target rounded-xl gap-2 border-dashed border-2 border-accent/40 text-accent hover:bg-accent/10 hover:text-accent"
              >
                <Plus className="w-5 h-5" />
                ردیف جدید
              </Button>
            </>
          ) : isExaminations ? (
            <>
              {/* ===== EXAMINATION ITEMS (services > معاینات) ===== */}
              <div className="space-y-3">
                {examinationRows.map((row, index) => (
                  <div key={row.id} className="rounded-2xl border-2 border-accent/30 bg-accent/5 p-4 space-y-3 relative">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-accent bg-accent/10 px-2.5 py-1 rounded-lg">
                        ردیف {toPersianDigits((index + 1).toString())}
                      </span>
                      {examinationRows.length > 1 && (
                        <button type="button" onClick={() => removeExaminationRow(row.id)} className="p-2 rounded-lg text-destructive/70 hover:text-destructive hover:bg-destructive/10 transition-colors" aria-label="حذف ردیف">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>

                    <SearchableSelect
                      label="نام آیتم"
                      options={examinationItemOptions}
                      value={row.itemName}
                      onChange={(v) => updateExaminationRow(row.id, "itemName", v)}
                      placeholder="انتخاب آیتم معاینات..."
                    />

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <label className="block text-xs font-medium text-foreground">تعداد</label>
                        <Input type="number" value={row.quantity} onChange={(e) => updateExaminationRow(row.id, "quantity", e.target.value)} placeholder="تعداد..." className="rounded-xl touch-target text-sm" min="0" />
                      </div>
                      <div className="space-y-1.5">
                        <label className="block text-xs font-medium text-foreground">قیمت واحد (ریال)</label>
                        <Input type="number" value={row.unitPrice} onChange={(e) => updateExaminationRow(row.id, "unitPrice", e.target.value)} placeholder="قیمت..." className="rounded-xl touch-target text-sm" min="0" />
                      </div>
                    </div>

                    {examinationRowTotals[index] > 0 && (
                      <div className="flex justify-between items-center bg-accent/10 rounded-xl px-3 py-2">
                        <span className="text-xs text-muted-foreground">جمع ردیف</span>
                        <span className="text-sm font-bold text-accent">{formatRial(examinationRowTotals[index])}</span>
                      </div>
                    )}

                    <div className="space-y-1.5">
                      <label className="block text-xs font-medium text-foreground">توضیحات</label>
                      <Input value={row.description} onChange={(e) => updateExaminationRow(row.id, "description", e.target.value)} placeholder="توضیحات ردیف..." className="rounded-xl touch-target text-sm" />
                    </div>
                  </div>
                ))}
              </div>

              <Button type="button" variant="outline" onClick={addExaminationRow} className="w-full touch-target rounded-xl gap-2 border-dashed border-2 border-accent/40 text-accent hover:bg-accent/10 hover:text-accent">
                <Plus className="w-5 h-5" />
                ردیف جدید
              </Button>
            </>
          ) : isWage ? (
            <>
              {/* ===== WAGE ITEMS (services > اجرت) ===== */}
              <div className="space-y-3">
                {wageRows.map((row, index) => (
                  <div key={row.id} className="rounded-2xl border-2 border-accent/30 bg-accent/5 p-4 space-y-3 relative">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-accent bg-accent/10 px-2.5 py-1 rounded-lg">
                        ردیف {toPersianDigits((index + 1).toString())}
                      </span>
                      {wageRows.length > 1 && (
                        <button type="button" onClick={() => removeWageRow(row.id)} className="p-2 rounded-lg text-destructive/70 hover:text-destructive hover:bg-destructive/10 transition-colors" aria-label="حذف ردیف">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>

                    <div className="space-y-1.5">
                      <label className="block text-xs font-medium text-foreground">بابت</label>
                      <Input value={row.purpose} onChange={(e) => updateWageRow(row.id, "purpose", e.target.value)} placeholder="بابت چیست..." className="rounded-xl touch-target text-sm" />
                    </div>

                    <SearchableSelect
                      label="نوع کار"
                      options={workModeOptions}
                      value={row.workMode}
                      onChange={(v) => updateWageRow(row.id, "workMode", v)}
                      placeholder="روزانه یا پیمان کاری..."
                    />

                    <div className="grid grid-cols-2 gap-3">
                      <JalaliDatePicker label="از تاریخ" value={row.startDate} onChange={(v) => updateWageRow(row.id, "startDate", v)} />
                      <JalaliDatePicker label="تا تاریخ" value={row.endDate} onChange={(v) => updateWageRow(row.id, "endDate", v)} />
                    </div>

                    <div className="space-y-1.5">
                      <label className="block text-xs font-medium text-foreground">پرداخت</label>
                      <Input value={row.paymentType} onChange={(e) => updateWageRow(row.id, "paymentType", e.target.value)} placeholder="نوع پرداخت..." className="rounded-xl touch-target text-sm" />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <label className="block text-xs font-medium text-foreground">روزی چقدر (ریال)</label>
                        <Input type="number" value={row.dailyAmount} onChange={(e) => updateWageRow(row.id, "dailyAmount", e.target.value)} placeholder="مبلغ روزانه..." className="rounded-xl touch-target text-sm" min="0" />
                      </div>
                      <div className="space-y-1.5">
                        <label className="block text-xs font-medium text-foreground">پیمان کاری چقدر (ریال)</label>
                        <Input type="number" value={row.contractAmount} onChange={(e) => updateWageRow(row.id, "contractAmount", e.target.value)} placeholder="مبلغ پیمان..." className="rounded-xl touch-target text-sm" min="0" />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label className="block text-xs font-medium text-foreground">نام صاحب حساب</label>
                      <Input value={row.accountHolder} onChange={(e) => updateWageRow(row.id, "accountHolder", e.target.value)} placeholder="نام و نام خانوادگی..." className="rounded-xl touch-target text-sm" />
                    </div>

                    <div className="space-y-1.5">
                      <label className="block text-xs font-medium text-foreground">شماره شبا یا کارت</label>
                      <Input value={row.ibanOrCard} onChange={(e) => updateWageRow(row.id, "ibanOrCard", e.target.value)} placeholder="شبا/کارت..." className="rounded-xl touch-target text-sm" />
                    </div>

                    {wageRowCalcs[index].rowTotal > 0 && (
                      <div className="flex justify-between items-center bg-accent/10 rounded-xl px-3 py-2">
                        <span className="text-xs text-muted-foreground">جمع ردیف</span>
                        <span className="text-sm font-bold text-accent">{formatRial(wageRowCalcs[index].rowTotal)}</span>
                      </div>
                    )}

                    <div className="space-y-1.5">
                      <label className="block text-xs font-medium text-foreground">توضیحات</label>
                      <Input value={row.description} onChange={(e) => updateWageRow(row.id, "description", e.target.value)} placeholder="توضیحات ردیف..." className="rounded-xl touch-target text-sm" />
                    </div>
                  </div>
                ))}
              </div>

              <Button type="button" variant="outline" onClick={addWageRow} className="w-full touch-target rounded-xl gap-2 border-dashed border-2 border-accent/40 text-accent hover:bg-accent/10 hover:text-accent">
                <Plus className="w-5 h-5" />
                ردیف جدید
              </Button>
            </>
          ) : isDailyWorker ? (
            <>
              {/* ===== DAILY WORKER ITEMS (services > کارگر روز مزد) ===== */}
              <div className="space-y-3">
                {dailyWorkerRows.map((row, index) => (
                  <div key={row.id} className="rounded-2xl border-2 border-accent/30 bg-accent/5 p-4 space-y-3 relative">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-accent bg-accent/10 px-2.5 py-1 rounded-lg">
                        ردیف {toPersianDigits((index + 1).toString())}
                      </span>
                      {dailyWorkerRows.length > 1 && (
                        <button type="button" onClick={() => removeDailyWorkerRow(row.id)} className="p-2 rounded-lg text-destructive/70 hover:text-destructive hover:bg-destructive/10 transition-colors" aria-label="حذف ردیف">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>

                    <div className="space-y-1.5">
                      <label className="block text-xs font-medium text-foreground">بابت</label>
                      <Input value={row.purpose} onChange={(e) => updateDailyWorkerRow(row.id, "purpose", e.target.value)} placeholder="بابت چیست..." className="rounded-xl touch-target text-sm" />
                    </div>

                    <div className="space-y-1.5">
                      <label className="block text-xs font-medium text-foreground">نام کارگر</label>
                      <Input value={row.workerName} onChange={(e) => updateDailyWorkerRow(row.id, "workerName", e.target.value)} placeholder="نام کارگر..." className="rounded-xl touch-target text-sm" />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <label className="block text-xs font-medium text-foreground">تعداد روز</label>
                        <Input type="number" value={row.daysCount} onChange={(e) => updateDailyWorkerRow(row.id, "daysCount", e.target.value)} placeholder="روز..." className="rounded-xl touch-target text-sm" min="0" step="0.5" />
                      </div>
                      <div className="space-y-1.5">
                        <label className="block text-xs font-medium text-foreground">تعداد ساعت</label>
                        <Input type="number" value={row.hoursCount} onChange={(e) => updateDailyWorkerRow(row.id, "hoursCount", e.target.value)} placeholder="ساعت..." className="rounded-xl touch-target text-sm" min="0" step="0.5" />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <label className="block text-xs font-medium text-foreground">قیمت روز (ریال)</label>
                        <Input type="number" value={row.dailyRate} onChange={(e) => updateDailyWorkerRow(row.id, "dailyRate", e.target.value)} placeholder="نرخ روز..." className="rounded-xl touch-target text-sm" min="0" />
                      </div>
                      <div className="space-y-1.5">
                        <label className="block text-xs font-medium text-foreground">قیمت ساعت (ریال)</label>
                        <Input type="number" value={row.hourlyRate} onChange={(e) => updateDailyWorkerRow(row.id, "hourlyRate", e.target.value)} placeholder="نرخ ساعت..." className="rounded-xl touch-target text-sm" min="0" />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <JalaliDatePicker label="تاریخ شروع" value={row.startDate} onChange={(v) => updateDailyWorkerRow(row.id, "startDate", v)} />
                      <JalaliDatePicker label="تاریخ پایان" value={row.endDate} onChange={(v) => updateDailyWorkerRow(row.id, "endDate", v)} />
                    </div>

                    {dailyWorkerRowCalcs[index].rowTotal > 0 && (
                      <div className="flex justify-between items-center bg-accent/10 rounded-xl px-3 py-2">
                        <span className="text-xs text-muted-foreground">جمع ردیف</span>
                        <span className="text-sm font-bold text-accent">{formatRial(dailyWorkerRowCalcs[index].rowTotal)}</span>
                      </div>
                    )}

                    <div className="space-y-1.5">
                      <label className="block text-xs font-medium text-foreground">توضیحات</label>
                      <Input value={row.description} onChange={(e) => updateDailyWorkerRow(row.id, "description", e.target.value)} placeholder="توضیحات ردیف..." className="rounded-xl touch-target text-sm" />
                    </div>
                  </div>
                ))}
              </div>

              <Button type="button" variant="outline" onClick={addDailyWorkerRow} className="w-full touch-target rounded-xl gap-2 border-dashed border-2 border-accent/40 text-accent hover:bg-accent/10 hover:text-accent">
                <Plus className="w-5 h-5" />
                ردیف جدید
              </Button>
            </>
          ) : (
            <>
              {/* ===== GENERIC (SPERM, etc.) ITEMS ===== */}
              <div className="space-y-3">
                {rows.map((row, index) => (
                  <div key={row.id} className="rounded-2xl border-2 border-accent/30 bg-accent/5 p-4 space-y-3 relative">
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

                    {isSperm && (
                      <SearchableSelect
                        label="کد و نام اسپرم"
                        options={spermOptions}
                        value={row.spermCode}
                        onChange={(v) => updateRow(row.id, "spermCode", v)}
                        placeholder="انتخاب اسپرم..."
                      />
                    )}

                    {data.productType === "other" && (
                      <SearchableSelect
                        label="نام آیتم"
                        options={otherItemOptions}
                        value={row.itemName}
                        onChange={(v) => updateRow(row.id, "itemName", v)}
                        placeholder="انتخاب آیتم..."
                      />
                    )}

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <label className="block text-xs font-medium text-foreground">تعداد</label>
                        <Input type="number" value={row.quantity} onChange={(e) => updateRow(row.id, "quantity", e.target.value)} placeholder="تعداد..." className="rounded-xl touch-target text-sm" min="0" />
                      </div>
                      <div className="space-y-1.5">
                        <label className="block text-xs font-medium text-foreground">قیمت واحد (ریال)</label>
                        <Input type="number" value={row.unitPrice} onChange={(e) => updateRow(row.id, "unitPrice", e.target.value)} placeholder="قیمت واحد..." className="rounded-xl touch-target text-sm" min="0" />
                      </div>
                    </div>

                    {rowTotals[index] > 0 && (
                      <div className="flex justify-between items-center bg-accent/10 rounded-xl px-3 py-2">
                        <span className="text-xs text-muted-foreground">جمع ردیف</span>
                        <span className="text-sm font-bold text-accent">{formatRial(rowTotals[index])}</span>
                      </div>
                    )}

                    <div className="space-y-1.5">
                      <label className="block text-xs font-medium text-foreground">توضیحات</label>
                      <Input value={row.description} onChange={(e) => updateRow(row.id, "description", e.target.value)} placeholder="توضیحات ردیف..." className="rounded-xl touch-target text-sm" />
                    </div>
                  </div>
                ))}
              </div>

              <Button
                type="button"
                variant="outline"
                onClick={addRow}
                className="w-full touch-target rounded-xl gap-2 border-dashed border-2 border-accent/40 text-accent hover:bg-accent/10 hover:text-accent"
              >
                <Plus className="w-5 h-5" />
                ردیف جدید
              </Button>
            </>
          )}

          {totalProduct > 0 && (
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">قیمت کل</span>
                <span className="text-body-lg font-bold text-primary">{formatRial(totalProduct)}</span>
              </div>
            </div>
          )}

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
              <RowDisplay label="مبلغ کل فاکتور" value={formatRial(totalProduct)} />
              <div className="space-y-2">
                <label className="block text-sm font-medium text-foreground">تخفیف (ریال)</label>
                <Input type="number" value={data.discount} onChange={(e) => set("discount", e.target.value)} placeholder="۰" className="rounded-xl touch-target" min="0" />
              </div>
              <div className="space-y-2">
                <label className="block text-sm font-medium text-foreground">کرایه حمل و نقل (ریال)</label>
                <Input type="number" value={data.shipping} onChange={(e) => set("shipping", e.target.value)} placeholder="۰" className="rounded-xl touch-target" min="0" />
              </div>
              {data.tax === "yes" && <RowDisplay label="مبلغ مالیات (۱۰٪)" value={formatRial(taxAmount)} highlight />}
              <Separator />
              <RowDisplay label="مبلغ قابل پرداخت" value={formatRial(payable)} bold />
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

function RowDisplay({ label, value, bold, highlight }: { label: string; value: string; bold?: boolean; highlight?: boolean }) {
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
