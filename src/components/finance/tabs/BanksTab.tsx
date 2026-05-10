import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MoneyCell, JalaliDateCell } from "@/components/finance/atoms";
import { Plus, Pencil, Power, Eye, RefreshCw, X, Link2, Search, CheckCircle2, AlertTriangle, Unlink } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { LEGACY_BANK_CODES, legacyBankLabel } from "@/lib/legacyBanks";

type MappingStatus = "not_mapped" | "mapped" | "needs_review";

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
  sepidar_dl_id: number | null;
  sepidar_dl_code: string | null;
  sepidar_account_id: number | null;
  sepidar_bank_account_id: number | null;
  sepidar_full_title: string | null;
  sepidar_mapping_status: MappingStatus | null;
  sepidar_mapping_note: string | null;
  sepidar_last_checked_at: string | null;
  legacy_bank_name_code: number | null;
}

interface SepidarCacheRow {
  id: string;
  sepidar_bank_account_id: number;
  sepidar_dl_id: number | null;
  sepidar_dl_code: string | null;
  sepidar_account_id: number | null;
  title: string | null;
  account_number: string | null;
  bank_name: string | null;
  is_active: boolean;
}

const EMPTY: Partial<Bank> = {
  title: "", bank_name: "", account_holder_name: "", account_number: "",
  iban_number: "", card_number: "", is_official: false, is_api_enabled: false,
  is_cheque: false, is_active: true, notes: "",
  sepidar_dl_id: null, sepidar_dl_code: "", sepidar_account_id: null,
  sepidar_bank_account_id: null, sepidar_full_title: "",
  sepidar_mapping_status: "not_mapped", sepidar_mapping_note: "",
};

const MAPPING_LABEL: Record<MappingStatus, string> = {
  not_mapped: "متصل نشده",
  mapped: "متصل شده",
  needs_review: "نیازمند بررسی",
};
const MAPPING_TONE: Record<MappingStatus, string> = {
  not_mapped: "bg-muted text-muted-foreground",
  mapped: "bg-emerald-100 text-emerald-800",
  needs_review: "bg-amber-100 text-amber-800",
};

export function isBankSepidarReady(b: Pick<Bank, "sepidar_mapping_status" | "sepidar_dl_id" | "sepidar_account_id">): boolean {
  return b.sepidar_mapping_status === "mapped" && !!b.sepidar_dl_id && !!b.sepidar_account_id;
}

export default function BanksTab({ onViewTransactions }: { onViewTransactions?: (bankId: string) => void }) {
  const [banks, setBanks] = useState<Bank[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Partial<Bank> | null>(null);
  const [detail, setDetail] = useState<Bank | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => { void load(); }, []);
  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from("finance_banks")
      .select("*")
      .eq("is_deleted", false)
      .order("created_at", { ascending: false });
    setBanks(((data as unknown) as Bank[]) || []);
    setLoading(false);
  }

  async function save() {
    if (!editing) return;
    const payload = { ...editing };
    delete (payload as { id?: string }).id;
    if (editing.id) {
      const { error } = await supabase.from("finance_banks").update(payload as never).eq("id", editing.id);
      if (error) return toast.error(error.message);
      toast.success("بانک ویرایش شد");
    } else {
      const { error } = await supabase.from("finance_banks").insert(payload as never);
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

  function applySepidarSelection(row: SepidarCacheRow) {
    if (!editing) return;
    setEditing({
      ...editing,
      sepidar_dl_id: row.sepidar_dl_id,
      sepidar_dl_code: row.sepidar_dl_code,
      sepidar_account_id: row.sepidar_account_id,
      sepidar_bank_account_id: row.sepidar_bank_account_id,
      sepidar_full_title: row.title || editing.sepidar_full_title || null,
      sepidar_mapping_status: "mapped",
    });
    setPickerOpen(false);
    toast.success("اتصال به سپیدار انجام شد");
  }

  function clearSepidar() {
    if (!editing) return;
    setEditing({
      ...editing,
      sepidar_dl_id: null,
      sepidar_dl_code: "",
      sepidar_account_id: null,
      sepidar_bank_account_id: null,
      sepidar_full_title: "",
      sepidar_mapping_status: "not_mapped",
    });
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
          {banks.map((b) => {
            const ms = (b.sepidar_mapping_status || "not_mapped") as MappingStatus;
            return (
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

                <div className="mt-2 flex flex-wrap items-center gap-1">
                  <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-bold", MAPPING_TONE[ms])}>
                    سپیدار: {MAPPING_LABEL[ms]}
                  </span>
                  {b.sepidar_dl_code && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-foreground/80 font-mono" dir="ltr">
                      DL {b.sepidar_dl_code}
                    </span>
                  )}
                  {b.sepidar_full_title && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-foreground/80 truncate max-w-[160px]" title={b.sepidar_full_title}>
                      {b.sepidar_full_title}
                    </span>
                  )}
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
                  <Button size="sm" variant="outline" onClick={() => setDetail(b)}>
                    <Eye className="w-3 h-3 ml-1" /> جزئیات
                  </Button>
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
            );
          })}
        </div>
      )}

      {/* ---- Edit / Create dialog ---- */}
      {open && editing && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setOpen(false)}>
          <div className="bg-card rounded-t-2xl sm:rounded-2xl border shadow-lg w-full max-w-2xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b flex items-center justify-between sticky top-0 bg-card z-10">
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

            {/* Sepidar mapping section */}
            <div className="px-4 pb-4">
              <div className="rounded-xl border bg-muted/30 p-3 space-y-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Link2 className="w-4 h-4 text-primary" />
                    <h4 className="font-bold text-sm">اتصال به سپیدار</h4>
                    <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-bold",
                      MAPPING_TONE[(editing.sepidar_mapping_status as MappingStatus) || "not_mapped"])}>
                      {MAPPING_LABEL[(editing.sepidar_mapping_status as MappingStatus) || "not_mapped"]}
                    </span>
                  </div>
                  <div className="flex gap-1">
                    <Button size="sm" type="button" onClick={() => setPickerOpen(true)}>
                      <Search className="w-3 h-3 ml-1" /> انتخاب از سپیدار
                    </Button>
                    {(editing.sepidar_bank_account_id || editing.sepidar_dl_id) && (
                      <Button size="sm" variant="outline" type="button" onClick={clearSepidar}>
                        <Unlink className="w-3 h-3 ml-1" /> حذف اتصال
                      </Button>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="کد DL سپیدار">
                    <Input dir="ltr" type="number" value={editing.sepidar_dl_id ?? ""} onChange={(e) => setEditing({ ...editing, sepidar_dl_id: e.target.value === "" ? null : Number(e.target.value) })} />
                  </Field>
                  <Field label="کد تفصیلی سپیدار">
                    <Input dir="ltr" value={editing.sepidar_dl_code || ""} onChange={(e) => setEditing({ ...editing, sepidar_dl_code: e.target.value })} />
                  </Field>
                  <Field label="کد حساب معین سپیدار">
                    <Input dir="ltr" type="number" value={editing.sepidar_account_id ?? ""} onChange={(e) => setEditing({ ...editing, sepidar_account_id: e.target.value === "" ? null : Number(e.target.value) })} />
                  </Field>
                  <Field label="شناسه حساب بانکی سپیدار">
                    <Input dir="ltr" type="number" value={editing.sepidar_bank_account_id ?? ""} onChange={(e) => setEditing({ ...editing, sepidar_bank_account_id: e.target.value === "" ? null : Number(e.target.value) })} />
                  </Field>
                  <Field label="عنوان حساب در سپیدار" full>
                    <Input value={editing.sepidar_full_title || ""} onChange={(e) => setEditing({ ...editing, sepidar_full_title: e.target.value })} />
                  </Field>
                  <Field label="وضعیت اتصال">
                    <select
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={(editing.sepidar_mapping_status as MappingStatus) || "not_mapped"}
                      onChange={(e) => setEditing({ ...editing, sepidar_mapping_status: e.target.value as MappingStatus })}
                    >
                      <option value="not_mapped">متصل نشده</option>
                      <option value="mapped">متصل شده</option>
                      <option value="needs_review">نیازمند بررسی</option>
                    </select>
                  </Field>
                  <Field label="توضیحات اتصال">
                    <Input value={editing.sepidar_mapping_note || ""} onChange={(e) => setEditing({ ...editing, sepidar_mapping_note: e.target.value })} />
                  </Field>
                </div>

                {editing.sepidar_mapping_status === "mapped" && (!editing.sepidar_dl_id || !editing.sepidar_account_id) && (
                  <div className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md p-2">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>برای وضعیت «متصل شده»، کد DL و کد حساب معین الزامی است؛ در غیر این صورت ثبت سند در سپیدار مجاز نخواهد بود.</span>
                  </div>
                )}
              </div>
            </div>

            <div className="p-4 border-t flex justify-end gap-2 sticky bottom-0 bg-card">
              <Button variant="outline" onClick={() => setOpen(false)}>انصراف</Button>
              <Button onClick={save}>ذخیره</Button>
            </div>
          </div>
        </div>
      )}

      {/* ---- Sepidar account picker modal ---- */}
      {pickerOpen && (
        <SepidarAccountPicker
          onClose={() => setPickerOpen(false)}
          onPick={applySepidarSelection}
        />
      )}

      {/* ---- Bank detail drawer ---- */}
      {detail && (
        <BankDetailDrawer bank={detail} onClose={() => setDetail(null)} onEdit={(b) => { setDetail(null); setEditing(b); setOpen(true); }} />
      )}
    </div>
  );
}

function BankDetailDrawer({ bank, onClose, onEdit }: { bank: Bank; onClose: () => void; onEdit: (b: Bank) => void }) {
  const ms = (bank.sepidar_mapping_status || "not_mapped") as MappingStatus;
  const ready = isBankSepidarReady(bank);
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex justify-start" onClick={onClose}>
      <div className="bg-card border-l shadow-xl w-full max-w-md h-full overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b flex items-center justify-between sticky top-0 bg-card z-10">
          <h3 className="font-bold">جزئیات بانک</h3>
          <Button size="sm" variant="ghost" onClick={onClose}><X className="w-4 h-4" /></Button>
        </div>
        <div className="p-4 space-y-4">
          <div>
            <h4 className="font-bold text-base">{bank.title || bank.bank_name}</h4>
            <p className="text-xs text-muted-foreground">{bank.bank_name} • {bank.account_holder_name || "—"}</p>
          </div>

          <div className="rounded-xl border bg-card p-3 space-y-2">
            <div className="flex items-center gap-2">
              <Link2 className="w-4 h-4 text-primary" />
              <h5 className="font-bold text-sm">اتصال حساب بانکی به سپیدار</h5>
              <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-bold mr-auto", MAPPING_TONE[ms])}>
                {MAPPING_LABEL[ms]}
              </span>
            </div>
            <Row k="عنوان بانک در برنامه" v={bank.title || bank.bank_name || "—"} />
            <Row k="عنوان حساب در سپیدار" v={bank.sepidar_full_title || "—"} />
            <Row k="کد DL سپیدار" v={bank.sepidar_dl_id ?? "—"} mono />
            <Row k="کد تفصیلی" v={bank.sepidar_dl_code || "—"} mono />
            <Row k="کد حساب معین" v={bank.sepidar_account_id ?? "—"} mono />
            <Row k="شناسه حساب بانکی سپیدار" v={bank.sepidar_bank_account_id ?? "—"} mono />
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">آخرین بررسی/همگام‌سازی</span>
              <JalaliDateCell value={bank.sepidar_last_checked_at} withTime />
            </div>
            {bank.sepidar_mapping_note && (
              <div className="text-xs text-muted-foreground border-t pt-2">{bank.sepidar_mapping_note}</div>
            )}
            {ready ? (
              <div className="flex items-center gap-2 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md p-2">
                <CheckCircle2 className="w-4 h-4" />
                <span>این بانک برای ثبت سند در سپیدار آماده است.</span>
              </div>
            ) : (
              <div className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md p-2">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>تا زمانی که اتصال «متصل شده» نباشد و کد DL و کد حساب معین تکمیل نشود، ثبت سند نهایی در سپیدار مجاز نیست.</span>
              </div>
            )}
          </div>

          <div className="rounded-xl border bg-card p-3 grid grid-cols-2 gap-3 text-xs">
            <div>
              <p className="text-muted-foreground">شماره حساب</p>
              <p className="font-mono tabular-nums" dir="ltr">{bank.account_number || "—"}</p>
            </div>
            <div>
              <p className="text-muted-foreground">شماره کارت</p>
              <p className="font-mono tabular-nums" dir="ltr">{bank.card_number || "—"}</p>
            </div>
            <div className="col-span-2">
              <p className="text-muted-foreground">شبا</p>
              <p className="font-mono tabular-nums" dir="ltr">{bank.iban_number || "—"}</p>
            </div>
            <div>
              <p className="text-muted-foreground">موجودی آنلاین</p>
              <MoneyCell value={bank.online_balance} />
            </div>
            <div>
              <p className="text-muted-foreground">موجودی سیستم</p>
              <MoneyCell value={bank.last_balance} />
            </div>
          </div>
        </div>
        <div className="p-4 border-t sticky bottom-0 bg-card flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>بستن</Button>
          <Button onClick={() => onEdit(bank)}><Pencil className="w-3 h-3 ml-1" /> ویرایش</Button>
        </div>
      </div>
    </div>
  );
}

function Row({ k, v, mono }: { k: string; v: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted-foreground">{k}</span>
      <span className={mono ? "font-mono tabular-nums" : "font-bold"} dir={mono ? "ltr" : undefined}>{v}</span>
    </div>
  );
}

function SepidarAccountPicker({ onClose, onPick }: { onClose: () => void; onPick: (r: SepidarCacheRow) => void }) {
  const [rows, setRows] = useState<SepidarCacheRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [seeding, setSeeding] = useState(false);

  useEffect(() => { void load(); }, []);
  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from("finance_sepidar_bank_accounts_cache" as never)
      .select("*")
      .order("title", { ascending: true });
    setRows(((data as unknown) as SepidarCacheRow[]) || []);
    setLoading(false);
  }

  async function seedDemo() {
    setSeeding(true);
    const demo = [
      { sepidar_bank_account_id: 1001, sepidar_dl_id: 5001, sepidar_dl_code: "10-001", sepidar_account_id: 2110, title: "حساب جاری ملت — مرکزی", account_number: "0123456789", bank_name: "بانک ملت", is_active: true },
      { sepidar_bank_account_id: 1002, sepidar_dl_id: 5002, sepidar_dl_code: "10-002", sepidar_account_id: 2110, title: "حساب جاری صادرات", account_number: "9876543210", bank_name: "بانک صادرات", is_active: true },
      { sepidar_bank_account_id: 1003, sepidar_dl_id: 5003, sepidar_dl_code: "10-003", sepidar_account_id: 2120, title: "حساب پس‌انداز ملی", account_number: "5555000011", bank_name: "بانک ملی", is_active: true },
      { sepidar_bank_account_id: 1004, sepidar_dl_id: 5004, sepidar_dl_code: "10-004", sepidar_account_id: 2110, title: "حساب چک سپه", account_number: "4444333322", bank_name: "بانک سپه", is_active: false },
    ];
    const { error } = await supabase.from("finance_sepidar_bank_accounts_cache" as never).insert(demo as never);
    setSeeding(false);
    if (error) return toast.error(error.message);
    toast.success("داده‌های نمونه افزوده شد");
    void load();
  }

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) =>
      [r.title, r.account_number, r.bank_name, r.sepidar_dl_code, String(r.sepidar_dl_id ?? ""), String(r.sepidar_bank_account_id)]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(s))
    );
  }, [rows, q]);

  return (
    <div className="fixed inset-0 z-[60] bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-card rounded-t-2xl sm:rounded-2xl border shadow-xl w-full max-w-3xl max-h-[92vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b flex items-center justify-between">
          <h3 className="font-bold">انتخاب حساب بانکی سپیدار</h3>
          <Button size="sm" variant="ghost" onClick={onClose}><X className="w-4 h-4" /></Button>
        </div>
        <div className="p-3 border-b flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input className="pr-9" placeholder="جستجو در عنوان، شماره حساب، بانک، DL…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {rows.length === 0 && !loading && (
            <Button size="sm" variant="outline" onClick={seedDemo} disabled={seeding}>
              افزودن نمونه
            </Button>
          )}
        </div>
        <div className="overflow-auto flex-1">
          {loading ? (
            <p className="p-6 text-sm text-muted-foreground text-center">در حال بارگذاری…</p>
          ) : filtered.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground text-center">
              {rows.length === 0 ? "حساب بانکی در سپیدار یافت نشد. می‌توانید داده نمونه اضافه کنید." : "نتیجه‌ای یافت نشد"}
            </p>
          ) : (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted/60">
                <tr className="text-right">
                  <Th>شناسه</Th>
                  <Th>کد DL</Th>
                  <Th>کد تفصیلی</Th>
                  <Th>عنوان</Th>
                  <Th>شماره حساب</Th>
                  <Th>بانک</Th>
                  <Th>وضعیت</Th>
                  <Th>{" "}</Th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} className="border-t hover:bg-muted/30">
                    <Td mono>{r.sepidar_bank_account_id}</Td>
                    <Td mono>{r.sepidar_dl_id ?? "—"}</Td>
                    <Td mono>{r.sepidar_dl_code || "—"}</Td>
                    <Td>{r.title || "—"}</Td>
                    <Td mono>{r.account_number || "—"}</Td>
                    <Td>{r.bank_name || "—"}</Td>
                    <Td>
                      <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-bold",
                        r.is_active ? "bg-emerald-100 text-emerald-800" : "bg-muted text-muted-foreground")}>
                        {r.is_active ? "فعال" : "غیرفعال"}
                      </span>
                    </Td>
                    <Td>
                      <Button size="sm" onClick={() => onPick(r)}>انتخاب</Button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-2 font-bold text-muted-foreground text-right">{children}</th>;
}
function Td({ children, mono }: { children: React.ReactNode; mono?: boolean }) {
  return <td className={cn("px-3 py-2", mono && "font-mono tabular-nums")} dir={mono ? "ltr" : undefined}>{children}</td>;
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
