import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MoneyCell, JalaliDateCell, FinanceStatusBadge } from "@/components/finance/atoms";
import { BankSelector } from "@/components/finance/selectors";
import { parseMoney, partyName } from "@/lib/finance";
import { Plus, Upload, Download, X, Trash2, FileText } from "lucide-react";
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
    if (error) return toast.error(error.message);
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
          <option value="assigned">تخصیص شده</option>
          <option value="partially_assigned">تخصیص ناقص</option>
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
                      <div className="flex gap-1">
                        <Button size="icon" variant="ghost" title="جزئیات خام" onClick={() => setOpenRaw(t)}><FileText className="w-3.5 h-3.5" /></Button>
                        <Button size="icon" variant="ghost" title="حذف نرم" onClick={() => softDelete(t)}><Trash2 className="w-3.5 h-3.5" /></Button>
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
                <div className="mt-2 flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setOpenRaw(t)}><FileText className="w-3 h-3 ml-1" /> جزئیات</Button>
                  <Button size="sm" variant="ghost" onClick={() => softDelete(t)}><Trash2 className="w-3 h-3 ml-1" /> حذف</Button>
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
      return toast.error(error.message);
    }
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
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [fileName, setFileName] = useState("");
  const [saving, setSaving] = useState(false);

  async function onFile(f: File | null) {
    if (!f) return;
    setFileName(f.name);
    const text = await f.text();
    // Naive CSV parser (xlsx libs not added). Expect: date,type,amount,reference,description
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) return toast.error("فایل خالی است");
    const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
    const out: Record<string, string>[] = [];
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(",");
      const r: Record<string, string> = {};
      headers.forEach((h, idx) => (r[h] = (parts[idx] || "").trim()));
      out.push(r);
    }
    setRows(out);
    toast.success(`${out.length} ردیف خوانده شد`);
  }

  async function importAll() {
    if (!bankId) return toast.error("بانک را انتخاب کنید");
    if (rows.length === 0) return toast.error("ردیفی برای ورود نیست");
    setSaving(true);
    let inserted = 0, skipped = 0;
    for (const r of rows) {
      const dateStr = r.date || r["تاریخ"] || "";
      const amt = parseMoney(r.amount || r["مبلغ"] || "0");
      const type = (r.type || r["نوع"] || "").toLowerCase();
      const isDeposit = type.includes("deposit") || type.includes("واریز") || type === "1";
      const txType = isDeposit ? "deposit" : "withdraw";
      const payload = {
        bank_id: bankId,
        transaction_datetime: dateStr ? new Date(dateStr).toISOString() : new Date().toISOString(),
        transaction_type: txType,
        deposit_amount: isDeposit ? amt : 0,
        withdraw_amount: isDeposit ? 0 : amt,
        amount: amt,
        description: r.description || r["شرح"] || description,
        reference_number: r.reference || r["مرجع"] || null,
        source_type: "excel" as const,
        assignment_status: "unassigned",
        original_file_name: fileName,
        imported_file_name: title || fileName,
        raw_data: r,
      };
      const { error } = await supabase.from("finance_bank_transactions").insert(payload);
      if (error) { skipped++; } else { inserted++; }
    }
    setSaving(false);
    toast.success(`${inserted} ردیف ثبت، ${skipped} ردیف رد شد (تکراری)`);
    onDone();
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-card rounded-t-2xl sm:rounded-2xl border shadow-lg w-full max-w-2xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b flex items-center justify-between sticky top-0 bg-card">
          <h3 className="font-bold">آپلود فایل تراکنش‌ها</h3>
          <Button size="sm" variant="ghost" onClick={onClose}><X className="w-4 h-4" /></Button>
        </div>
        <div className="p-4 space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">بانک</Label>
            <BankSelector value={bankId} onChange={setBankId} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">عنوان</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="مثلاً: گردش بانک ملت اردیبهشت" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">توضیحات</Label>
            <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">فایل تراکنش‌ها (CSV)</Label>
            <Input type="file" accept=".csv,.txt" onChange={(e) => onFile(e.target.files?.[0] || null)} />
            <p className="text-[11px] text-muted-foreground">ستون‌ها: date, type (deposit|withdraw), amount, reference, description</p>
          </div>
          {rows.length > 0 && (
            <div className="rounded-lg border overflow-x-auto max-h-64">
              <table className="w-full text-xs">
                <thead className="bg-muted/40 sticky top-0"><tr>{Object.keys(rows[0]).map((h) => <th key={h} className="p-2 text-right">{h}</th>)}</tr></thead>
                <tbody>{rows.slice(0, 50).map((r, i) => (<tr key={i} className="border-t">{Object.keys(rows[0]).map((h) => <td key={h} className="p-2">{r[h]}</td>)}</tr>))}</tbody>
              </table>
              {rows.length > 50 && <p className="p-2 text-xs text-center text-muted-foreground">و {rows.length - 50} ردیف دیگر…</p>}
            </div>
          )}
        </div>
        <div className="p-4 border-t flex justify-end gap-2 sticky bottom-0 bg-card">
          <Button variant="outline" onClick={onClose}>انصراف</Button>
          <Button onClick={importAll} disabled={saving || rows.length === 0}>ثبت همه</Button>
        </div>
      </div>
    </div>
  );
}
