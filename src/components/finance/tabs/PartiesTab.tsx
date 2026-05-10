import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MoneyCell, FinanceStatusBadge, SepidarStatusBadge } from "@/components/finance/atoms";
import { partyName } from "@/lib/finance";
import { Plus, Pencil, X, Send } from "lucide-react";
import { toast } from "sonner";

interface Party {
  id: string;
  ownership_type: string | null;
  nationality: string | null;
  first_name: string | null;
  last_name: string | null;
  company_name: string | null;
  national_code: string | null;
  national_id: string | null;
  identification_code: string | null;
  mobile: string | null;
  telephone: string | null;
  address: string | null;
  postal_code: string | null;
  branch_code: string | null;
  description: string | null;
  balance: number | null;
  status: string | null;
  sepidar_sync_status: string | null;
}

const EMPTY: Partial<Party> = {
  ownership_type: "individual", nationality: "iranian", first_name: "", last_name: "",
  company_name: "", national_code: "", national_id: "", identification_code: "",
  mobile: "", telephone: "", address: "", postal_code: "", branch_code: "",
  description: "", status: "active",
};

export default function PartiesTab() {
  const [parties, setParties] = useState<Party[]>([]);
  const [q, setQ] = useState("");
  const [filterOwnership, setFilterOwnership] = useState("");
  const [filterNationality, setFilterNationality] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Partial<Party> | null>(null);
  const [detail, setDetail] = useState<Party | null>(null);

  useEffect(() => { void load(); }, []);
  async function load() {
    const { data } = await supabase
      .from("finance_parties")
      .select("*")
      .eq("is_deleted", false)
      .order("created_at", { ascending: false })
      .limit(500);
    setParties((data as Party[]) || []);
  }

  const filtered = parties.filter((p) => {
    if (filterOwnership && p.ownership_type !== filterOwnership) return false;
    if (filterNationality && p.nationality !== filterNationality) return false;
    if (filterStatus && p.status !== filterStatus) return false;
    if (q) {
      const s = `${partyName(p)} ${p.national_code || ""} ${p.national_id || ""} ${p.identification_code || ""}`.toLowerCase();
      if (!s.includes(q.toLowerCase())) return false;
    }
    return true;
  });

  async function save() {
    if (!editing) return;
    const payload = { ...editing };
    delete (payload as { id?: string }).id;
    if (editing.id) {
      const { error } = await supabase.from("finance_parties").update(payload).eq("id", editing.id);
      if (error) return toast.error(error.message);
      toast.success("ذینفع ویرایش شد");
    } else {
      const { error } = await supabase.from("finance_parties").insert(payload);
      if (error) return toast.error(error.message);
      toast.success("ذینفع ثبت شد");
    }
    setOpen(false); setEditing(null); void load();
  }

  async function syncSepidar(p: Party) {
    await supabase.from("finance_parties").update({ sepidar_sync_status: "syncing" }).eq("id", p.id);
    toast.info("درخواست ثبت سپیدار ارسال شد (placeholder)");
    void load();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-bold">ذینفعان</h2>
        <Button onClick={() => { setEditing({ ...EMPTY }); setOpen(true); }}>
          <Plus className="w-4 h-4 ml-1" /> ذینفع جدید
        </Button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Input placeholder="جستجو..." value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={filterOwnership} onChange={(e) => setFilterOwnership(e.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
          <option value="">مالکیت</option>
          <option value="individual">حقیقی</option>
          <option value="legal">حقوقی</option>
        </select>
        <select value={filterNationality} onChange={(e) => setFilterNationality(e.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
          <option value="">تابعیت</option>
          <option value="iranian">ایرانی</option>
          <option value="foreign">خارجی</option>
        </select>
        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
          <option value="">وضعیت</option>
          <option value="active">فعال</option>
          <option value="inactive">غیرفعال</option>
        </select>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {filtered.map((p) => (
          <button key={p.id} onClick={() => setDetail(p)} className="text-right rounded-xl border bg-card p-4 hover:border-primary/30 hover:shadow-md transition-all">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="font-bold truncate">{partyName(p)}</h3>
                <p className="text-xs text-muted-foreground">{p.ownership_type === "legal" ? "حقوقی" : "حقیقی"} • {p.nationality === "foreign" ? "خارجی" : "ایرانی"}</p>
              </div>
              <SepidarStatusBadge status={p.sepidar_sync_status} />
            </div>
            <div className="mt-2 text-xs text-muted-foreground space-y-0.5">
              {p.national_code && <p>کد ملی: <span className="font-mono">{p.national_code}</span></p>}
              {p.mobile && <p>موبایل: <span className="font-mono" dir="ltr">{p.mobile}</span></p>}
            </div>
            <div className="mt-3 pt-3 border-t flex items-center justify-between">
              <span className="text-xs text-muted-foreground">مانده</span>
              <MoneyCell value={p.balance} positive={(p.balance || 0) > 0} negative={(p.balance || 0) < 0} />
            </div>
          </button>
        ))}
        {filtered.length === 0 && (
          <div className="col-span-full rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
            ذینفعی یافت نشد
          </div>
        )}
      </div>

      {open && editing && (
        <PartyDialog editing={editing} onChange={setEditing} onClose={() => { setOpen(false); setEditing(null); }} onSave={save} />
      )}
      {detail && (
        <PartyDetailDrawer party={detail} onClose={() => setDetail(null)} onEdit={() => { setEditing(detail); setOpen(true); setDetail(null); }} onSync={() => syncSepidar(detail)} />
      )}
    </div>
  );
}

function PartyDialog({ editing, onChange, onClose, onSave }: { editing: Partial<Party>; onChange: (p: Partial<Party>) => void; onClose: () => void; onSave: () => void }) {
  const isLegal = editing.ownership_type === "legal";
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-card rounded-t-2xl sm:rounded-2xl border shadow-lg w-full max-w-2xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b flex items-center justify-between sticky top-0 bg-card">
          <h3 className="font-bold">{editing.id ? "ویرایش ذینفع" : "ذینفع جدید"}</h3>
          <Button size="sm" variant="ghost" onClick={onClose}><X className="w-4 h-4" /></Button>
        </div>
        <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">نوع مالکیت</Label>
            <select value={editing.ownership_type || "individual"} onChange={(e) => onChange({ ...editing, ownership_type: e.target.value })} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
              <option value="individual">حقیقی</option>
              <option value="legal">حقوقی</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">تابعیت</Label>
            <select value={editing.nationality || "iranian"} onChange={(e) => onChange({ ...editing, nationality: e.target.value })} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
              <option value="iranian">ایرانی</option>
              <option value="foreign">خارجی</option>
            </select>
          </div>
          {!isLegal && (
            <>
              <Field label="نام"><Input value={editing.first_name || ""} onChange={(e) => onChange({ ...editing, first_name: e.target.value })} /></Field>
              <Field label="نام خانوادگی"><Input value={editing.last_name || ""} onChange={(e) => onChange({ ...editing, last_name: e.target.value })} /></Field>
              <Field label="کد ملی"><Input dir="ltr" value={editing.national_code || ""} onChange={(e) => onChange({ ...editing, national_code: e.target.value })} /></Field>
            </>
          )}
          {isLegal && (
            <>
              <Field label="نام شرکت" full><Input value={editing.company_name || ""} onChange={(e) => onChange({ ...editing, company_name: e.target.value })} /></Field>
              <Field label="شناسه ملی"><Input dir="ltr" value={editing.national_id || ""} onChange={(e) => onChange({ ...editing, national_id: e.target.value })} /></Field>
              <Field label="کد اقتصادی"><Input dir="ltr" value={editing.identification_code || ""} onChange={(e) => onChange({ ...editing, identification_code: e.target.value })} /></Field>
            </>
          )}
          <Field label="موبایل"><Input dir="ltr" value={editing.mobile || ""} onChange={(e) => onChange({ ...editing, mobile: e.target.value })} /></Field>
          <Field label="تلفن"><Input dir="ltr" value={editing.telephone || ""} onChange={(e) => onChange({ ...editing, telephone: e.target.value })} /></Field>
          <Field label="کد پستی"><Input dir="ltr" value={editing.postal_code || ""} onChange={(e) => onChange({ ...editing, postal_code: e.target.value })} /></Field>
          <Field label="کد شعبه"><Input value={editing.branch_code || ""} onChange={(e) => onChange({ ...editing, branch_code: e.target.value })} /></Field>
          <Field label="آدرس" full><Textarea rows={2} value={editing.address || ""} onChange={(e) => onChange({ ...editing, address: e.target.value })} /></Field>
          <Field label="توضیحات" full><Textarea rows={2} value={editing.description || ""} onChange={(e) => onChange({ ...editing, description: e.target.value })} /></Field>
        </div>
        <div className="p-4 border-t flex justify-end gap-2 sticky bottom-0 bg-card">
          <Button variant="outline" onClick={onClose}>انصراف</Button>
          <Button onClick={onSave}>ذخیره</Button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (<div className={full ? "sm:col-span-2 space-y-1.5" : "space-y-1.5"}><Label className="text-xs">{label}</Label>{children}</div>);
}

function PartyDetailDrawer({ party, onClose, onEdit, onSync }: { party: Party; onClose: () => void; onEdit: () => void; onSync: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex justify-end" onClick={onClose}>
      <div className="bg-card border-l shadow-lg w-full max-w-md h-full overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b flex items-center justify-between sticky top-0 bg-card">
          <div>
            <h3 className="font-bold">{partyName(party)}</h3>
            <p className="text-xs text-muted-foreground">{party.ownership_type === "legal" ? "حقوقی" : "حقیقی"}</p>
          </div>
          <div className="flex gap-1">
            <Button size="icon" variant="ghost" onClick={onEdit}><Pencil className="w-4 h-4" /></Button>
            <Button size="icon" variant="ghost" onClick={onClose}><X className="w-4 h-4" /></Button>
          </div>
        </div>
        <div className="p-4 space-y-4">
          <div className="rounded-xl border p-3">
            <p className="text-xs text-muted-foreground">مانده</p>
            <MoneyCell value={party.balance} className="text-xl" positive={(party.balance || 0) > 0} negative={(party.balance || 0) < 0} />
          </div>
          <div className="space-y-1.5 text-sm">
            {party.national_code && <Row label="کد ملی" value={party.national_code} />}
            {party.national_id && <Row label="شناسه ملی" value={party.national_id} />}
            {party.mobile && <Row label="موبایل" value={party.mobile} />}
            {party.telephone && <Row label="تلفن" value={party.telephone} />}
            {party.postal_code && <Row label="کد پستی" value={party.postal_code} />}
            {party.address && <Row label="آدرس" value={party.address} />}
          </div>
          <div className="rounded-xl border p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">وضعیت سپیدار</span>
              <SepidarStatusBadge status={party.sepidar_sync_status} />
            </div>
            <Button size="sm" className="w-full" onClick={onSync}>
              <Send className="w-4 h-4 ml-1" /> ثبت در سپیدار
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="font-medium" dir="auto">{value}</span>
    </div>
  );
}
