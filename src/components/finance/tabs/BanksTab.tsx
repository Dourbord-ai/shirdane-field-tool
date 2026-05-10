import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MoneyCell } from "@/components/finance/atoms";
import { Plus, Pencil, Power, Eye, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";

interface Bank {
  id: string;
  title: string | null;
  bank_name: string | null;
  account_holder_name: string | null;
  account_number: string | null;
  iban_number: string | null;
  card_number: string | null;
  online_balance: number | null;
  last_balance: number | null;
  is_official: boolean | null;
  is_api_enabled: boolean | null;
  is_cheque: boolean | null;
  is_active: boolean | null;
  notes: string | null;
}

const EMPTY: Partial<Bank> = {
  title: "", bank_name: "", account_holder_name: "", account_number: "",
  iban_number: "", card_number: "", is_official: false, is_api_enabled: false,
  is_cheque: false, is_active: true, notes: "",
};

export default function BanksTab({ onViewTransactions }: { onViewTransactions?: (bankId: string) => void }) {
  const [banks, setBanks] = useState<Bank[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Partial<Bank> | null>(null);

  useEffect(() => { void load(); }, []);
  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from("finance_banks")
      .select("*")
      .eq("is_deleted", false)
      .order("created_at", { ascending: false });
    setBanks((data as Bank[]) || []);
    setLoading(false);
  }

  async function save() {
    if (!editing) return;
    const payload = { ...editing };
    delete (payload as { id?: string }).id;
    if (editing.id) {
      const { error } = await supabase.from("finance_banks").update(payload).eq("id", editing.id);
      if (error) return toast.error(error.message);
      toast.success("بانک ویرایش شد");
    } else {
      const { error } = await supabase.from("finance_banks").insert(payload);
      if (error) return toast.error(error.message);
      toast.success("بانک ثبت شد");
    }
    setOpen(false);
    setEditing(null);
    void load();
  }

  async function toggleActive(b: Bank) {
    const { error } = await supabase.from("finance_banks").update({ is_active: !b.is_active }).eq("id", b.id);
    if (error) return toast.error(error.message);
    toast.success(b.is_active ? "غیرفعال شد" : "فعال شد");
    void load();
  }

  async function refreshApi(b: Bank) {
    if (!b.is_api_enabled) return toast.error("API این بانک فعال نیست");
    toast.info("بروزرسانی API هنوز پیاده‌سازی نشده — placeholder");
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-lg font-bold">بانک‌ها</h2>
        <Button onClick={() => { setEditing({ ...EMPTY }); setOpen(true); }}>
          <Plus className="w-4 h-4 ml-1" />
          بانک جدید
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">در حال بارگذاری…</p>
      ) : banks.length === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          هنوز بانکی ثبت نشده است
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {banks.map((b) => (
            <div key={b.id} className={`rounded-xl border bg-card p-4 ${b.is_active ? "" : "opacity-60"}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="font-bold truncate">{b.title || b.bank_name || "—"}</h3>
                  <p className="text-xs text-muted-foreground truncate">{b.bank_name} • {b.account_holder_name || "—"}</p>
                </div>
                <div className="flex flex-col gap-1 items-end shrink-0">
                  {b.is_official && <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold">رسمی</span>}
                  {b.is_api_enabled && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 font-bold">API</span>}
                  {b.is_cheque && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-bold">چک</span>}
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div>
                  <p className="text-muted-foreground">شماره حساب</p>
                  <p className="font-mono tabular-nums" dir="ltr">{b.account_number || "—"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">شماره کارت</p>
                  <p className="font-mono tabular-nums" dir="ltr">{b.card_number || "—"}</p>
                </div>
                <div className="col-span-2">
                  <p className="text-muted-foreground">شبا</p>
                  <p className="font-mono tabular-nums text-xs" dir="ltr">{b.iban_number || "—"}</p>
                </div>
              </div>
              <div className="mt-3 pt-3 border-t flex items-center justify-between">
                <div>
                  <p className="text-[10px] text-muted-foreground">موجودی آنلاین</p>
                  <MoneyCell value={b.online_balance} className="text-sm" />
                </div>
                <div className="text-right">
                  <p className="text-[10px] text-muted-foreground">موجودی سیستم</p>
                  <MoneyCell value={b.last_balance} className="text-sm" />
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1">
                <Button size="sm" variant="outline" onClick={() => { setEditing(b); setOpen(true); }}>
                  <Pencil className="w-3 h-3 ml-1" /> ویرایش
                </Button>
                <Button size="sm" variant="outline" onClick={() => onViewTransactions?.(b.id)}>
                  <Eye className="w-3 h-3 ml-1" /> تراکنش‌ها
                </Button>
                <Button size="sm" variant="outline" onClick={() => refreshApi(b)}>
                  <RefreshCw className="w-3 h-3 ml-1" /> API
                </Button>
                <Button size="sm" variant="outline" onClick={() => toggleActive(b)}>
                  <Power className="w-3 h-3 ml-1" /> {b.is_active ? "غیرفعال" : "فعال"}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {open && editing && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setOpen(false)}>
          <div className="bg-card rounded-t-2xl sm:rounded-2xl border shadow-lg w-full max-w-2xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b flex items-center justify-between sticky top-0 bg-card">
              <h3 className="font-bold">{editing.id ? "ویرایش بانک" : "بانک جدید"}</h3>
              <Button size="sm" variant="ghost" onClick={() => setOpen(false)}><X className="w-4 h-4" /></Button>
            </div>
            <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="عنوان"><Input value={editing.title || ""} onChange={(e) => setEditing({ ...editing, title: e.target.value })} /></Field>
              <Field label="بانک"><Input value={editing.bank_name || ""} onChange={(e) => setEditing({ ...editing, bank_name: e.target.value })} /></Field>
              <Field label="صاحب حساب"><Input value={editing.account_holder_name || ""} onChange={(e) => setEditing({ ...editing, account_holder_name: e.target.value })} /></Field>
              <Field label="شماره حساب"><Input dir="ltr" value={editing.account_number || ""} onChange={(e) => setEditing({ ...editing, account_number: e.target.value })} /></Field>
              <Field label="شبا"><Input dir="ltr" value={editing.iban_number || ""} onChange={(e) => setEditing({ ...editing, iban_number: e.target.value })} /></Field>
              <Field label="شماره کارت"><Input dir="ltr" value={editing.card_number || ""} onChange={(e) => setEditing({ ...editing, card_number: e.target.value })} /></Field>
              <div className="sm:col-span-2 grid grid-cols-3 gap-2">
                <Toggle label="رسمی" checked={!!editing.is_official} onChange={(v) => setEditing({ ...editing, is_official: v })} />
                <Toggle label="API فعال" checked={!!editing.is_api_enabled} onChange={(v) => setEditing({ ...editing, is_api_enabled: v })} />
                <Toggle label="حساب چک" checked={!!editing.is_cheque} onChange={(v) => setEditing({ ...editing, is_cheque: v })} />
              </div>
              <Field label="یادداشت" full><Textarea rows={2} value={editing.notes || ""} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} /></Field>
            </div>
            <div className="p-4 border-t flex justify-end gap-2 sticky bottom-0 bg-card">
              <Button variant="outline" onClick={() => setOpen(false)}>انصراف</Button>
              <Button onClick={save}>ذخیره</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div className={full ? "sm:col-span-2 space-y-1.5" : "space-y-1.5"}>
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`h-10 rounded-md border text-xs font-bold transition-colors ${checked ? "bg-primary text-primary-foreground border-primary" : "bg-background border-input"}`}
    >
      {label}
    </button>
  );
}
