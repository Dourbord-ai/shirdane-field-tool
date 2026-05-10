import { useEffect, useMemo, useState } from "react";
import { toastFinanceError } from "@/lib/financeErrors";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MoneyCell, JalaliDateCell, FinanceStatusBadge } from "@/components/finance/atoms";
import { BankSelector } from "@/components/finance/selectors";
import { parseMoney, recalculateBankUnassignedBalances } from "@/lib/finance";
import { legacyBankLabel } from "@/lib/legacyBanks";
import { NewReceiveIdDialog } from "@/components/finance/tabs/ReceiveIdentificationTab";
import { Plus, Upload, Download, X, Trash2, FileText, AlertTriangle, ArrowDownToLine, ArrowUpFromLine, ArrowLeftRight, Link2 } from "lucide-react";
import { toast } from "sonner";

interface Tx {
  id: string;
  bank_id: string | null;
  transaction_datetime: string | null;
  transaction_type: string | null;
  deposit_amount: number | null;
  withdraw_amount: number | null;
  amount: number | null;
  balance_after: number | null;
  description: string | null;
  document_number: string | null;
  reference_number: string | null;
  tracking_number: string | null;
  card_number: string | null;
  source_type: string | null;
  assignment_status: string | null;
  assigned_operation_type: string | null;
  assigned_operation_id: string | null;
  raw_data: unknown;
}

interface BankRef { id: string; title: string | null; bank_name: string | null }

export default function BankTransactionsTab({ initialBankId }: { initialBankId?: string }) {
  const [txs, setTxs] = useState<Tx[]>([]);
  const [banks, setBanks] = useState<Record<string, BankRef>>({});
  const [filterBank, setFilterBank] = useState<string | null>(initialBankId || null);
  const [filterType, setFilterType] = useState<string>("");
  const [filterAssign, setFilterAssign] = useState<string>("");
  const [filterDescr, setFilterDescr] = useState("");
  const [openManual, setOpenManual] = useState(false);
  const [openExcel, setOpenExcel] = useState(false);
  const [openRaw, setOpenRaw] = useState<Tx | null>(null);
  const [openReceiveId, setOpenReceiveId] = useState<Tx | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.from("finance_banks").select("id,title,bank_name").then(({ data }) => {
      const m: Record<string, BankRef> = {};
      (data as BankRef[] || []).forEach((b) => (m[b.id] = b));
      setBanks(m);
    });
  }, []);

  useEffect(() => { void load(); }, [filterBank, filterType, filterAssign]);

  async function load() {
    setLoading(true);
    let q = supabase
      .from("finance_bank_transactions")
      .select("*")
      .eq("is_deleted", false)
      .order("transaction_datetime", { ascending: false })
      .limit(500);
    if (filterBank) q = q.eq("bank_id", filterBank);
    if (filterType) q = q.eq("transaction_type", filterType);
    if (filterAssign) q = q.eq("assignment_status", filterAssign);
    const { data } = await q;
    setTxs((data as Tx[]) || []);
    setLoading(false);
  }

  const filtered = useMemo(() => {
    if (!filterDescr) return txs;
    return txs.filter((t) => (t.description || "").toLowerCase().includes(filterDescr.toLowerCase()));
  }, [txs, filterDescr]);

  async function softDelete(t: Tx) {
    if (!confirm("حذف این تراکنش؟")) return;
    const { error } = await supabase
      .from("finance_bank_transactions")
      .update({ is_deleted: true, deleted_at: new Date().toISOString() })
      .eq("id", t.id);
    if (error) return toastFinanceError(toast, error);
    if (t.bank_id) await recalculateBankUnassignedBalances(t.bank_id);
    toast.success("حذف شد");
    void load();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-bold">تراکنش‌های بانکی</h2>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" onClick={() => setOpenExcel(true)}><Upload className="w-4 h-4 ml-1" /> آپلود اکسل</Button>
          <Button variant="outline" onClick={() => toast.info("دریافت از API هنوز پیاده‌سازی نشده — placeholder")}>
            <Download className="w-4 h-4 ml-1" /> دریافت از API
          </Button>
          <Button onClick={() => setOpenManual(true)}><Plus className="w-4 h-4 ml-1" /> ثبت دستی</Button>
        </div>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <BankSelector value={filterBank} onChange={setFilterBank} placeholder="همه بانک‌ها" />
        <select value={filterType} onChange={(e) => setFilterType(e.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
          <option value="">نوع تراکنش</option>
          <option value="deposit">واریز</option>
          <option value="withdraw">برداشت</option>
        </select>
        <select value={filterAssign} onChange={(e) => setFilterAssign(e.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
          <option value="">وضعیت تخصیص</option>
          <option value="unassigned">تخصیص نشده</option>
          <option value="assigning">در حال تخصیص</option>
          <option value="assigned">تخصیص شده</option>
          <option value="rejected">رد شده</option>
          <option value="cancelled">لغو شده</option>
        </select>
        <Input placeholder="شرح..." value={filterDescr} onChange={(e) => setFilterDescr(e.target.value)} />
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">در حال بارگذاری…</p>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto rounded-xl border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr className="text-right">
                  <th className="p-2 font-bold">بانک</th>
                  <th className="p-2 font-bold">تاریخ</th>
                  <th className="p-2 font-bold">نوع</th>
                  <th className="p-2 font-bold">واریز</th>
                  <th className="p-2 font-bold">برداشت</th>
                  <th className="p-2 font-bold">مانده</th>
                  <th className="p-2 font-bold">شرح</th>
                  <th className="p-2 font-bold">مرجع</th>
                  <th className="p-2 font-bold">منبع</th>
                  <th className="p-2 font-bold">وضعیت</th>
                  <th className="p-2"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((t) => (
                  <tr key={t.id} className="border-t hover:bg-secondary/30">
                    <td className="p-2">{banks[t.bank_id || ""]?.title || banks[t.bank_id || ""]?.bank_name || "—"}</td>
                    <td className="p-2"><JalaliDateCell value={t.transaction_datetime} withTime /></td>
                    <td className="p-2">{t.transaction_type === "deposit" ? "واریز" : "برداشت"}</td>
                    <td className="p-2"><MoneyCell value={t.deposit_amount} positive /></td>
                    <td className="p-2"><MoneyCell value={t.withdraw_amount} negative /></td>
                    <td className="p-2"><MoneyCell value={t.balance_after} /></td>
                    <td className="p-2 max-w-[200px] truncate">{t.description || "—"}</td>
                    <td className="p-2 font-mono text-xs">{t.reference_number || t.tracking_number || "—"}</td>
                    <td className="p-2 text-xs">{t.source_type || "—"}</td>
                    <td className="p-2"><FinanceStatusBadge status={t.assignment_status} /></td>
                    <td className="p-2">
                      <div className="flex gap-1 flex-wrap items-center">
                        {t.assignment_status === "unassigned" && t.transaction_type === "deposit" && (
                          <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setOpenReceiveId(t)}>
                            <ArrowDownToLine className="w-3 h-3 ml-1" /> شناسایی دریافت
                          </Button>
                        )}
                        {t.assignment_status === "unassigned" && t.transaction_type === "withdraw" && (
                          <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => toast.info("ثبت پرداخت از تب درخواست‌های پرداخت")}>
                            <ArrowUpFromLine className="w-3 h-3 ml-1" /> ثبت پرداخت
                          </Button>
                        )}
                        {t.assignment_status === "unassigned" && (
                          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => toast.info("اتصال به انتقال بین بانکی از تب مربوطه")}>
                            <ArrowLeftRight className="w-3 h-3 ml-1" /> انتقال بانکی
                          </Button>
                        )}
                        {t.assignment_status === "assigning" && (
                          <span className="text-[11px] text-amber-700 inline-flex items-center gap-1">
                            <Link2 className="w-3 h-3" /> در انتظار تایید مدیر
                          </span>
                        )}
                        {t.assignment_status === "assigned" && t.assigned_operation_type === "receive_identification" && (
                          <span className="text-[11px] text-emerald-700">شناسایی شده</span>
                        )}
                        <Button size="icon" variant="ghost" title="جزئیات خام" onClick={() => setOpenRaw(t)}><FileText className="w-3.5 h-3.5" /></Button>
                        {t.assignment_status === "unassigned" && (
                          <Button size="icon" variant="ghost" title="حذف نرم" onClick={() => softDelete(t)}><Trash2 className="w-3.5 h-3.5" /></Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={11} className="p-8 text-center text-muted-foreground">تراکنشی یافت نشد</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-2">
            {filtered.map((t) => (
              <div key={t.id} className="rounded-xl border bg-card p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-sm">{banks[t.bank_id || ""]?.title || "—"}</span>
                  <FinanceStatusBadge status={t.assignment_status} />
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <JalaliDateCell value={t.transaction_datetime} withTime />
                  {t.transaction_type === "deposit"
                    ? <MoneyCell value={t.deposit_amount} positive />
                    : <MoneyCell value={t.withdraw_amount} negative />}
                </div>
                {t.description && <p className="text-xs text-muted-foreground mt-2 line-clamp-2">{t.description}</p>}
                <div className="mt-2 flex gap-1 flex-wrap">
                  {t.assignment_status === "unassigned" && t.transaction_type === "deposit" && (
                    <Button size="sm" variant="outline" onClick={() => setOpenReceiveId(t)}>
                      <ArrowDownToLine className="w-3 h-3 ml-1" /> شناسایی دریافت
                    </Button>
                  )}
                  {t.assignment_status === "assigning" && (
                    <span className="text-[11px] text-amber-700">در انتظار تایید مدیر</span>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => setOpenRaw(t)}><FileText className="w-3 h-3 ml-1" /> جزئیات</Button>
                  {t.assignment_status === "unassigned" && (
                    <Button size="sm" variant="ghost" onClick={() => softDelete(t)}><Trash2 className="w-3 h-3 ml-1" /> حذف</Button>
                  )}
                </div>
              </div>
            ))}
            {filtered.length === 0 && (
              <p className="text-center text-muted-foreground py-8">تراکنشی یافت نشد</p>
            )}
          </div>
        </>
      )}

      {openManual && <ManualTxDialog onClose={() => setOpenManual(false)} onDone={() => { setOpenManual(false); void load(); }} />}
      {openExcel && <ExcelImportDialog onClose={() => setOpenExcel(false)} onDone={() => { setOpenExcel(false); void load(); }} />}
      {openReceiveId && (
        <NewReceiveIdDialog
          presetTxId={openReceiveId.id}
          onClose={() => setOpenReceiveId(null)}
          onDone={() => { setOpenReceiveId(null); void load(); }}
        />
      )}
      {openRaw && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setOpenRaw(null)}>
          <div className="bg-card rounded-xl border shadow-lg w-full max-w-lg max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b flex items-center justify-between">
              <h3 className="font-bold">جزئیات خام</h3>
              <Button size="sm" variant="ghost" onClick={() => setOpenRaw(null)}><X className="w-4 h-4" /></Button>
            </div>
            <pre dir="ltr" className="p-4 text-xs overflow-x-auto whitespace-pre-wrap">{JSON.stringify(openRaw.raw_data ?? openRaw, null, 2)}</pre>
          </div>
        </div>
      )}
    </div>
  );
}

function ManualTxDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [bankId, setBankId] = useState<string | null>(null);
  const [type, setType] = useState<"deposit" | "withdraw">("deposit");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [reference, setReference] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 16));
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!bankId) return toast.error("بانک را انتخاب کنید");
    const amt = parseMoney(amount);
    if (amt <= 0) return toast.error("مبلغ نامعتبر");
    setSaving(true);
    const payload = {
      bank_id: bankId,
      transaction_datetime: new Date(date).toISOString(),
      transaction_type: type,
      deposit_amount: type === "deposit" ? amt : 0,
      withdraw_amount: type === "withdraw" ? amt : 0,
      amount: amt,
      description,
      reference_number: reference || null,
      source_type: "manual" as const,
      assignment_status: "unassigned",
    };
    const { error } = await supabase.from("finance_bank_transactions").insert(payload);
    setSaving(false);
    if (error) {
      if (error.code === "23505") return toast.error("تراکنش تکراری");
      return toastFinanceError(toast, error);
    }
    await recalculateBankUnassignedBalances(bankId);
    toast.success("ثبت شد");
    onDone();
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-card rounded-t-2xl sm:rounded-2xl border shadow-lg w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b flex items-center justify-between">
          <h3 className="font-bold">ثبت دستی تراکنش</h3>
          <Button size="sm" variant="ghost" onClick={onClose}><X className="w-4 h-4" /></Button>
        </div>
        <div className="p-4 space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">بانک</Label>
            <BankSelector value={bankId} onChange={setBankId} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label className="text-xs">نوع</Label>
              <select value={type} onChange={(e) => setType(e.target.value as "deposit" | "withdraw")} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                <option value="deposit">واریز</option>
                <option value="withdraw">برداشت</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">تاریخ و ساعت</Label>
              <Input type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">مبلغ (ریال)</Label>
            <Input dir="ltr" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">شماره مرجع / پیگیری</Label>
            <Input dir="ltr" value={reference} onChange={(e) => setReference(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">شرح</Label>
            <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
        </div>
        <div className="p-4 border-t flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>انصراف</Button>
          <Button onClick={save} disabled={saving}>ذخیره</Button>
        </div>
      </div>
    </div>
  );
}

function ExcelImportDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [bankId, setBankId] = useState<string | null>(null);
  const [bankInfo, setBankInfo] = useState<{ title: string | null; bank_name: string | null; import_template_id: string | null; legacy_bank_name_code: number | null } | null>(null);
  const [templates, setTemplates] = useState<import("@/lib/bankImport").BankImportTemplate[]>([]);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<import("@/lib/bankImport").ParsedRow[]>([]);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [summary, setSummary] = useState<{ total: number; valid: number; duplicate: number; invalid: number; inserted: number } | null>(null);

  useEffect(() => {
    void supabase
      .from("finance_bank_import_templates")
      .select("*")
      .order("bank_name_code", { ascending: true })
      .then(({ data }) => setTemplates((data as unknown as import("@/lib/bankImport").BankImportTemplate[]) || []));
  }, []);

  useEffect(() => {
    setTemplateId(null);
    setParsed([]);
    setSummary(null);
    if (!bankId) { setBankInfo(null); return; }
    void supabase
      .from("finance_banks")
      .select("title,bank_name,import_template_id,legacy_bank_name_code")
      .eq("id", bankId)
      .maybeSingle()
      .then(({ data }) => {
        const info = data as { title: string | null; bank_name: string | null; import_template_id: string | null; legacy_bank_name_code: number | null } | null;
        setBankInfo(info);
      });
  }, [bankId]);

  // Auto-select template based on bank: explicit mapping first, then legacy code
  useEffect(() => {
    if (!bankInfo || templates.length === 0) return;
    if (bankInfo.import_template_id) {
      setTemplateId(bankInfo.import_template_id);
      return;
    }
    if (bankInfo.legacy_bank_name_code != null) {
      const m = templates.find((t) => t.bank_name_code === bankInfo.legacy_bank_name_code);
      if (m) setTemplateId(m.id);
    }
  }, [bankInfo, templates]);

  const selectedTemplate = useMemo(() => templates.find((t) => t.id === templateId) || null, [templates, templateId]);
  const templateActive = !!selectedTemplate?.is_active;
  const noActiveTemplate = !!bankId && !!bankInfo && !templateActive;

  async function preview() {
    setSummary(null);
    if (!bankId) return toast.error("اطلاعات ضروری تکمیل نشده است");
    if (!title.trim() || !description.trim()) return toast.error("اطلاعات ضروری تکمیل نشده است");
    if (!file) return toast.error("اطلاعات ضروری تکمیل نشده است");
    if (!selectedTemplate) return toast.error("قالب خواندن فایل را انتخاب کنید");
    if (!selectedTemplate.is_active) return toast.error("برای این بانک هنوز قالب خواندن فایل تعریف نشده است");

    const ext = file.name.split(".").pop()?.toLowerCase() || "";
    if (!["xls", "xlsx", "csv"].includes(ext)) return toast.error("فرمت فایل مجاز نیست");

    setPreviewing(true);
    try {
      const { readFileRows, parseRowsWithTemplate } = await import("@/lib/bankImport");
      const rows = await readFileRows(file, selectedTemplate);
      const list = parseRowsWithTemplate(rows, selectedTemplate);
      if (list.length === 0) {
        toast.error("اطلاعات قابل ثبت در فایل پیدا نشد");
        setParsed([]);
        return;
      }
      // duplicate check against db
      const validList = list.filter((r) => r.status === "valid");
      if (validList.length > 0) {
        const datetimes = validList.map((r) => r.transaction_datetime!).filter(Boolean);
        const { data: existing } = await supabase
          .from("finance_bank_transactions")
          .select("transaction_datetime,amount,document_number,transaction_type")
          .eq("bank_id", bankId)
          .in("transaction_datetime", datetimes);
        const set = new Set(
          ((existing as { transaction_datetime: string | null; amount: number | null; document_number: string | null; transaction_type: string | null }[]) || []).map(
            (e) => `${e.transaction_datetime}|${e.amount}|${e.document_number || ""}|${e.transaction_type}`,
          ),
        );
        for (const r of validList) {
          const key = `${r.transaction_datetime}|${r.amount}|${r.document_number || ""}|${r.transaction_type}`;
          if (set.has(key)) { r.status = "duplicate"; r.status_reason = "تکراری"; }
        }
      }
      setParsed(list);
      toast.success(`${list.length} ردیف خوانده شد`);
    } catch (e) {
      toastFinanceError(toast, e);
    } finally {
      setPreviewing(false);
    }
  }

  async function importAll() {
    if (!bankId || !file) return;
    const validRows = parsed.filter((r) => r.status === "valid");
    if (validRows.length === 0) return toast.error("ردیف معتبری برای ثبت نیست");
    setSaving(true);
    let inserted = 0;
    for (const r of validRows) {
      const payload = {
        bank_id: bankId,
        transaction_datetime: r.transaction_datetime,
        transaction_type: r.transaction_type,
        deposit_amount: r.deposit,
        withdraw_amount: r.withdraw,
        amount: r.amount,
        description: r.description || description,
        document_number: r.document_number || null,
        source_type: selectedTemplate?.file_type === "csv" ? "csv" : "excel",
        assignment_status: "unassigned",
        original_file_name: file.name,
        imported_file_name: title,
        raw_data: r.raw as unknown as Record<string, unknown>,
      };
      const { error } = await supabase.from("finance_bank_transactions").insert([payload]);
      if (!error) inserted++;
    }
    if (bankId) await recalculateBankUnassignedBalances(bankId);
    setSaving(false);
    const total = parsed.length;
    const valid = parsed.filter((r) => r.status === "valid").length;
    const dup = parsed.filter((r) => r.status === "duplicate").length;
    const inv = parsed.filter((r) => r.status === "invalid").length;
    setSummary({ total, valid, duplicate: dup, invalid: inv, inserted });
    toast.success(`${inserted} ردیف ثبت شد`);
    onDone();
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-card rounded-t-2xl sm:rounded-2xl border shadow-lg w-full max-w-3xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b flex items-center justify-between sticky top-0 bg-card z-10">
          <h3 className="font-bold">آپلود فایل تراکنش‌ها</h3>
          <Button size="sm" variant="ghost" onClick={onClose}><X className="w-4 h-4" /></Button>
        </div>
        <div className="p-4 space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">بانک *</Label>
              <BankSelector value={bankId} onChange={setBankId} />
              {bankInfo && (
                <p className="text-[11px] text-muted-foreground">
                  {bankInfo.title || bankInfo.bank_name || "—"}
                  {bankInfo.legacy_bank_name_code != null && <> · کد قدیمی: {legacyBankLabel(bankInfo.legacy_bank_name_code)}</>}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">قالب خواندن فایل *</Label>
              <select
                value={templateId || ""}
                onChange={(e) => setTemplateId(e.target.value || null)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">— انتخاب کنید —</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title} ({legacyBankLabel(t.bank_name_code)}){!t.is_active ? " — غیرفعال" : ""}
                  </option>
                ))}
              </select>
              {selectedTemplate && (
                <p className="text-[11px] text-muted-foreground">
                  {selectedTemplate.title} · {selectedTemplate.file_type.toUpperCase()}
                  {!selectedTemplate.is_active && <span className="text-amber-700"> · غیرفعال</span>}
                </p>
              )}
            </div>
          </div>

          {noActiveTemplate && (
            <div className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md p-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                {selectedTemplate?.description || "برای این بانک هنوز قالب خواندن فایل تعریف نشده است"}
              </span>
            </div>
          )}
          <div className="space-y-1.5">
            <Label className="text-xs">عنوان *</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="مثلاً: گردش بانک ملت اردیبهشت" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">توضیحات *</Label>
            <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">فایل تراکنش‌ها * (xls / xlsx / csv)</Label>
            <Input type="file" accept=".xls,.xlsx,.csv" onChange={(e) => { setFile(e.target.files?.[0] || null); setParsed([]); setSummary(null); }} />
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={preview} disabled={previewing || !file || !templateActive}>
              {previewing ? "در حال پردازش…" : "پیش‌نمایش"}
            </Button>
          </div>

          {parsed.length > 0 && (
            <>
              <div className="rounded-lg border overflow-x-auto max-h-80">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40 sticky top-0">
                    <tr className="text-right">
                      <th className="p-2">ردیف</th>
                      <th className="p-2">تاریخ</th>
                      <th className="p-2">ساعت</th>
                      <th className="p-2">واریز</th>
                      <th className="p-2">برداشت</th>
                      <th className="p-2">شماره سند</th>
                      <th className="p-2">توضیحات</th>
                      <th className="p-2">وضعیت</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.map((r) => (
                      <tr key={r.index} className={
                        r.status === "valid" ? "border-t" :
                        r.status === "duplicate" ? "border-t bg-amber-500/10" :
                        "border-t bg-destructive/10"
                      }>
                        <td className="p-2">{r.index}</td>
                        <td className="p-2 font-mono">{r.date}</td>
                        <td className="p-2 font-mono">{r.time}</td>
                        <td className="p-2 font-mono text-emerald-700">{r.deposit ? r.deposit.toLocaleString() : "—"}</td>
                        <td className="p-2 font-mono text-rose-700">{r.withdraw ? r.withdraw.toLocaleString() : "—"}</td>
                        <td className="p-2 font-mono">{r.document_number || "—"}</td>
                        <td className="p-2 max-w-[260px] truncate">{r.description || "—"}</td>
                        <td className="p-2">
                          {r.status === "valid" && <span className="text-emerald-700">معتبر</span>}
                          {r.status === "duplicate" && <span className="text-amber-700">تکراری</span>}
                          {r.status === "invalid" && <span className="text-rose-700">{r.status_reason || "نامعتبر"}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap gap-3 text-xs">
                <span>کل: {parsed.length}</span>
                <span className="text-emerald-700">معتبر: {parsed.filter((r) => r.status === "valid").length}</span>
                <span className="text-amber-700">تکراری: {parsed.filter((r) => r.status === "duplicate").length}</span>
                <span className="text-rose-700">خطادار: {parsed.filter((r) => r.status === "invalid").length}</span>
                {summary && <span className="font-bold">ثبت‌شده: {summary.inserted}</span>}
              </div>
            </>
          )}
        </div>
        <div className="p-4 border-t flex justify-end gap-2 sticky bottom-0 bg-card">
          <Button variant="outline" onClick={onClose}>انصراف</Button>
          <Button onClick={importAll} disabled={saving || !templateActive || parsed.filter((r) => r.status === "valid").length === 0}>
            ثبت نهایی
          </Button>
        </div>
      </div>
    </div>
  );
}

