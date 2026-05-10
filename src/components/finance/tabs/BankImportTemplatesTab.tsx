import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Plus, Pencil, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import type { BankImportTemplate } from "@/lib/bankImport";

type T = BankImportTemplate;

const EMPTY: Omit<T, "id"> = {
  title: "",
  bank_name_code: null,
  file_type: "xlsx",
  has_header: true,
  row_validation_column_index: 0,
  creditor_amount_column_index: 0,
  debtor_amount_column_index: 0,
  date_column_index: 0,
  time_column_index: 0,
  doc_number_column_index: 0,
  description_column_indexes: [],
  needs_rtl_cleanup: false,
  time_24_fix: false,
  is_active: true,
};

export default function BankImportTemplatesTab() {
  const [list, setList] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [edit, setEdit] = useState<T | (Omit<T, "id"> & { id?: string }) | null>(null);

  useEffect(() => { void load(); }, []);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("finance_bank_import_templates")
      .select("*")
      .order("bank_name_code", { ascending: true });
    if (error) toast.error(error.message);
    setList((data as unknown as T[]) || []);
    setLoading(false);
  }

  async function save() {
    if (!edit) return;
    const payload = { ...edit } as Partial<T>;
    delete (payload as { id?: string }).id;
    if (!payload.title) return toast.error("عنوان الزامی است");
    if (edit.id) {
      const { error } = await supabase
        .from("finance_bank_import_templates")
        .update(payload as never)
        .eq("id", edit.id);
      if (error) return toast.error(error.message);
    } else {
      const { error } = await supabase.from("finance_bank_import_templates").insert(payload as never);
      if (error) return toast.error(error.message);
    }
    toast.success("ذخیره شد");
    setEdit(null);
    void load();
  }

  async function remove(t: T) {
    if (!confirm(`حذف ${t.title}؟`)) return;
    const { error } = await supabase.from("finance_bank_import_templates").delete().eq("id", t.id);
    if (error) return toast.error(error.message);
    toast.success("حذف شد");
    void load();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold">قالب‌های ورود فایل بانکی</h2>
          <p className="text-xs text-muted-foreground">قواعد پارس فایل بانک‌ها بر اساس کد بانک قدیمی</p>
        </div>
        <Button onClick={() => setEdit({ ...EMPTY })}><Plus className="w-4 h-4 ml-1" /> قالب جدید</Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">در حال بارگذاری…</p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {list.map((t) => (
            <div key={t.id} className="rounded-xl border bg-card p-3 space-y-1">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-bold">{t.title}</p>
                  <p className="text-xs text-muted-foreground">کد {t.bank_name_code} · {t.file_type.toUpperCase()}</p>
                </div>
                <div className="flex gap-1">
                  <Button size="icon" variant="ghost" onClick={() => setEdit(t)}><Pencil className="w-4 h-4" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => remove(t)}><Trash2 className="w-4 h-4" /></Button>
                </div>
              </div>
              <div className="text-[11px] text-muted-foreground grid grid-cols-2 gap-x-2">
                <span>تاریخ: ستون {t.date_column_index}</span>
                <span>ساعت: ستون {t.time_column_index}</span>
                <span>واریز: ستون {t.creditor_amount_column_index}</span>
                <span>برداشت: ستون {t.debtor_amount_column_index}</span>
                <span>سند: ستون {t.doc_number_column_index}</span>
                <span>شرح: {(t.description_column_indexes || []).join(", ")}</span>
              </div>
              {(t.needs_rtl_cleanup || t.time_24_fix) && (
                <div className="flex gap-1 flex-wrap pt-1">
                  {t.needs_rtl_cleanup && <span className="text-[10px] px-2 py-0.5 rounded bg-amber-500/15 text-amber-700">RTL cleanup</span>}
                  {t.time_24_fix && <span className="text-[10px] px-2 py-0.5 rounded bg-amber-500/15 text-amber-700">24:00 fix</span>}
                </div>
              )}
            </div>
          ))}
          {list.length === 0 && <p className="text-sm text-muted-foreground">قالبی ثبت نشده است.</p>}
        </div>
      )}

      {edit && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setEdit(null)}>
          <div className="bg-card rounded-t-2xl sm:rounded-2xl border shadow-lg w-full max-w-xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b flex items-center justify-between sticky top-0 bg-card">
              <h3 className="font-bold">{edit.id ? "ویرایش قالب" : "قالب جدید"}</h3>
              <Button size="sm" variant="ghost" onClick={() => setEdit(null)}><X className="w-4 h-4" /></Button>
            </div>
            <div className="p-4 grid grid-cols-2 gap-3">
              <Field label="عنوان" full>
                <Input value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} />
              </Field>
              <Field label="کد بانک">
                <Input type="number" value={edit.bank_name_code ?? ""} onChange={(e) => setEdit({ ...edit, bank_name_code: e.target.value === "" ? null : Number(e.target.value) })} />
              </Field>
              <Field label="نوع فایل">
                <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={edit.file_type} onChange={(e) => setEdit({ ...edit, file_type: e.target.value as T["file_type"] })}>
                  <option value="xlsx">xlsx</option>
                  <option value="xls">xls</option>
                  <option value="csv">csv</option>
                </select>
              </Field>
              <NumField label="ستون اعتبارسنجی ردیف" v={edit.row_validation_column_index} on={(n) => setEdit({ ...edit, row_validation_column_index: n })} />
              <NumField label="ستون تاریخ" v={edit.date_column_index} on={(n) => setEdit({ ...edit, date_column_index: n })} />
              <NumField label="ستون ساعت" v={edit.time_column_index} on={(n) => setEdit({ ...edit, time_column_index: n })} />
              <NumField label="ستون واریز" v={edit.creditor_amount_column_index} on={(n) => setEdit({ ...edit, creditor_amount_column_index: n })} />
              <NumField label="ستون برداشت" v={edit.debtor_amount_column_index} on={(n) => setEdit({ ...edit, debtor_amount_column_index: n })} />
              <NumField label="ستون شماره سند" v={edit.doc_number_column_index} on={(n) => setEdit({ ...edit, doc_number_column_index: n })} />
              <Field label="ستون‌های شرح (با کاما)" full>
                <Input
                  value={(edit.description_column_indexes || []).join(",")}
                  onChange={(e) => setEdit({ ...edit, description_column_indexes: e.target.value.split(",").map((s) => Number(s.trim())).filter((n) => !isNaN(n)) })}
                  placeholder="3,4"
                />
              </Field>
              <ToggleRow label="هدر دارد" v={edit.has_header} on={(b) => setEdit({ ...edit, has_header: b })} />
              <ToggleRow label="پاکسازی RTL" v={edit.needs_rtl_cleanup} on={(b) => setEdit({ ...edit, needs_rtl_cleanup: b })} />
              <ToggleRow label="اصلاح ساعت ۲۴:۰۰" v={edit.time_24_fix} on={(b) => setEdit({ ...edit, time_24_fix: b })} />
              <ToggleRow label="فعال" v={edit.is_active} on={(b) => setEdit({ ...edit, is_active: b })} />
            </div>
            <div className="p-4 border-t flex justify-end gap-2 sticky bottom-0 bg-card">
              <Button variant="outline" onClick={() => setEdit(null)}>انصراف</Button>
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
    <div className={`space-y-1.5 ${full ? "col-span-2" : ""}`}>
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

function NumField({ label, v, on }: { label: string; v: number | null; on: (n: number | null) => void }) {
  return (
    <Field label={label}>
      <Input type="number" value={v ?? ""} onChange={(e) => on(e.target.value === "" ? null : Number(e.target.value))} />
    </Field>
  );
}

function ToggleRow({ label, v, on }: { label: string; v: boolean; on: (b: boolean) => void }) {
  return (
    <div className="flex items-center justify-between rounded-lg border p-2">
      <Label className="text-xs">{label}</Label>
      <Switch checked={v} onCheckedChange={on} />
    </div>
  );
}
