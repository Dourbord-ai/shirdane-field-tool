import { useEffect, useRef, useState } from "react";
import { toastFinanceError } from "@/lib/financeErrors";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MoneyCell, SepidarStatusBadge } from "@/components/finance/atoms";
import {
  partyName,
  partyApprovalLabel,
  PARTY_APPROVAL_STATUS_LABEL,
  syncPartyToSepidar,
  isPartyReadyForPosting,
  isPartySyncedInSepidar,
} from "@/lib/finance";
import { Plus, Pencil, X, Send, CheckCircle2, XCircle, RefreshCw, AlertTriangle, GitCompareArrows, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import BeneficiaryStatementCompareDialog from "@/components/finance/BeneficiaryStatementCompareDialog";

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
  // approval workflow
  approval_status: string | null;
  approved_by: string | null;
  approved_at: string | null;
  rejected_by: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
  // sepidar
  sepidar_sync_status: string | null;
  sepidar_party_id: number | null;
  sepidar_dl_id: number | null;
  sepidar_dl_code: number | null;
  sepidar_account_id: number | null;
  // Per-party PartyAccountSLRef used when creating Sepidar payment vouchers.
  // When null, the edge function falls back to settings → 193 (legacy default).
  party_account_sl_ref: number | null;
  sepidar_full_name: string | null;
  sepidar_synced_at: string | null;
  sepidar_sync_attempts: number | null;
  sepidar_error_message: string | null;
}

const EMPTY: Partial<Party> = {
  ownership_type: "individual", nationality: "iranian", first_name: "", last_name: "",
  company_name: "", national_code: "", national_id: "", identification_code: "",
  mobile: "", telephone: "", address: "", postal_code: "", branch_code: "",
  description: "", status: "active", approval_status: "pending_approval",
};

function ApprovalBadge({ status }: { status: string | null | undefined }) {
  const label = partyApprovalLabel(status);
  const color =
    status === "synced_to_sepidar"
      ? "bg-emerald-100 text-emerald-800"
      : status === "approved"
      ? "bg-sky-100 text-sky-800"
      : status === "rejected"
      ? "bg-rose-100 text-rose-800"
      : status === "sync_failed"
      ? "bg-amber-100 text-amber-800"
      : status === "inactive"
      ? "bg-muted text-muted-foreground"
      : "bg-slate-100 text-slate-800";
  return <span className={`text-[10px] px-2 py-0.5 rounded-full ${color}`}>{label}</span>;
}

export default function PartiesTab() {
  const [parties, setParties] = useState<Party[]>([]);
  const [q, setQ] = useState("");
  const [filterOwnership, setFilterOwnership] = useState("");
  const [filterApproval, setFilterApproval] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Partial<Party> | null>(null);
  const [detail, setDetail] = useState<Party | null>(null);
  const [compareId, setCompareId] = useState<string | null>(null);

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
    if (filterApproval && p.approval_status !== filterApproval) return false;
    if (q) {
      const s = `${partyName(p)} ${p.national_code || ""} ${p.national_id || ""} ${p.identification_code || ""}`.toLowerCase();
      if (!s.includes(q.toLowerCase())) return false;
    }
    return true;
  });

  const savingRef = useRef(false);
  async function save() {
    if (savingRef.current) return;
    if (!editing) return;
    savingRef.current = true;
    try {
      const payload = { ...editing };
      delete (payload as { id?: string }).id;
      if (editing.id) {
        const { error } = await supabase.from("finance_parties").update(payload).eq("id", editing.id);
        if (error) return toastFinanceError(toast, error);
        toast.success("ذینفع ویرایش شد");
      } else {
        // New beneficiaries always start in pending_approval
        payload.approval_status = "pending_approval";
        payload.sepidar_sync_status = "not_synced";
        const { error } = await supabase.from("finance_parties").insert(payload);
        if (error) return toastFinanceError(toast, error);
        toast.success("ذینفع ثبت شد — در انتظار تایید مدیریت");
      }
      setOpen(false); setEditing(null); void load();
    } finally {
      savingRef.current = false;
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-bold">ذینفعان</h2>
        <Button onClick={() => { setEditing({ ...EMPTY }); setOpen(true); }}>
          <Plus className="w-4 h-4 ml-1" /> ذینفع جدید
        </Button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        <Input placeholder="جستجو..." value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={filterOwnership} onChange={(e) => setFilterOwnership(e.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
          <option value="">مالکیت</option>
          <option value="individual">حقیقی</option>
          <option value="legal">حقوقی</option>
        </select>
        <select value={filterApproval} onChange={(e) => setFilterApproval(e.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
          <option value="">وضعیت تایید / سپیدار</option>
          <option value="pending_approval">در انتظار تایید</option>
          <option value="approved">تایید شده</option>
          <option value="synced_to_sepidar">ثبت‌شده در سپیدار</option>
          <option value="sync_failed">خطای سپیدار</option>
          <option value="rejected">رد شده</option>
        </select>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {filtered.map((p) => (
          <div key={p.id} className="text-right rounded-xl border bg-card p-4 hover:border-primary/30 hover:shadow-md transition-all flex flex-col">
            <button onClick={() => setDetail(p)} className="text-right flex-1">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="font-bold truncate">{partyName(p)}</h3>
                  <p className="text-xs text-muted-foreground">{p.ownership_type === "legal" ? "حقوقی" : "حقیقی"} • {p.nationality === "foreign" ? "خارجی" : "ایرانی"}</p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <ApprovalBadge status={p.approval_status} />
                  <SepidarStatusBadge status={p.sepidar_sync_status} />
                </div>
              </div>
              <div className="mt-2 text-xs text-muted-foreground space-y-0.5">
                {p.national_code && <p>کد ملی: <span className="font-mono">{p.national_code}</span></p>}
                {p.sepidar_dl_code != null && <p>کد تفصیل: <span className="font-mono">{p.sepidar_dl_code}</span></p>}
                {p.sepidar_party_id != null && <p>شناسه طرف حساب سپیدار: <span className="font-mono">{p.sepidar_party_id}</span></p>}
              </div>
              <div className="mt-3 pt-3 border-t flex items-center justify-between">
                <span className="text-xs text-muted-foreground">مانده</span>
                <MoneyCell value={p.balance} positive={(p.balance || 0) > 0} negative={(p.balance || 0) < 0} />
              </div>
            </button>
            <Button
              size="sm"
              variant="outline"
              className="mt-3 w-full"
              onClick={(e) => { e.stopPropagation(); setCompareId(p.id); }}
            >
              <GitCompareArrows className="w-4 h-4 ml-1" /> مقایسه صورتحساب با سپیدار
            </Button>
          </div>
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
        <PartyDetailDrawer
          party={detail}
          onClose={() => setDetail(null)}
          onEdit={() => { setEditing(detail); setOpen(true); setDetail(null); }}
          onCompare={() => setCompareId(detail.id)}
          onChanged={async () => {
            const { data } = await supabase.from("finance_parties").select("*").eq("id", detail.id).maybeSingle();
            if (data) setDetail(data as Party);
            void load();
          }}
        />
      )}
      {compareId && (
        <BeneficiaryStatementCompareDialog beneficiaryId={compareId} onClose={() => setCompareId(null)} />
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
        {!editing.id && (
          <div className="mx-4 mt-3 rounded-lg border bg-amber-50 text-amber-900 text-xs p-2">
            پس از ثبت، این ذینفع در وضعیت «در انتظار تایید مدیریت» قرار می‌گیرد و تا تایید و ثبت در سپیدار، در صدور سند نهایی قابل استفاده نیست.
          </div>
        )}
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
          {/* Sepidar AccountSLRef used as PartyAccountSLRef on payment voucher rows.
              Optional — left blank means "use global setting or 193 fallback".
              We parse to integer or null so the DB column stays clean. */}
          <Field label="کد حساب طرف در سپیدار (PartyAccountSLRef)" full>
            <Input
              dir="ltr"
              inputMode="numeric"
              placeholder="در صورت خالی بودن از مقدار پیش‌فرض استفاده می‌شود"
              value={editing.party_account_sl_ref != null ? String(editing.party_account_sl_ref) : ""}
              onChange={(e) => {
                const raw = e.target.value.trim();
                const num = raw === "" ? null : Number(raw);
                onChange({
                  ...editing,
                  party_account_sl_ref: Number.isFinite(num as number) ? (num as number) : null,
                });
              }}
            />
          </Field>
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

function PartyDetailDrawer({
  party, onClose, onEdit, onCompare, onChanged,
}: {
  party: Party;
  onClose: () => void;
  onEdit: () => void;
  onCompare: () => void;
  onChanged: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [showRejectBox, setShowRejectBox] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [showError, setShowError] = useState(false);

  const ready = isPartyReadyForPosting(party);
  // Treat any party that already has Sepidar identifiers (or an explicit
  // `synced` sync status) as "registered in Sepidar". For such parties we
  // MUST NOT show the "ثبت در سپیدار" button — they already exist there and
  // re-posting would create duplicates. Instead we render a readonly badge.
  const alreadySynced = isPartySyncedInSepidar(party);
  const canApprove = (party.approval_status === "pending_approval" || party.approval_status === "rejected") && !alreadySynced;
  const canReject = (party.approval_status === "pending_approval" || party.approval_status === "approved") && !alreadySynced;
  const canSync = party.approval_status === "approved" && !alreadySynced;
  const canRetry = party.approval_status === "sync_failed" && !alreadySynced;

  async function approve() {
    setBusy(true);
    const { error } = await supabase
      .from("finance_parties")
      .update({
        approval_status: "approved",
        approved_at: new Date().toISOString(),
        rejected_at: null, rejected_by: null, rejection_reason: null,
      })
      .eq("id", party.id);
    setBusy(false);
    if (error) return toastFinanceError(toast, error);
    toast.success("اطلاعات تایید شد — اکنون می‌توانید در سپیدار ثبت کنید");
    await onChanged();
  }

  async function reject() {
    if (!rejectReason.trim()) return toast.error("دلیل رد را وارد کنید");
    setBusy(true);
    const { error } = await supabase
      .from("finance_parties")
      .update({
        approval_status: "rejected",
        rejected_at: new Date().toISOString(),
        rejection_reason: rejectReason.trim(),
        approved_at: null, approved_by: null,
      })
      .eq("id", party.id);
    setBusy(false);
    if (error) return toastFinanceError(toast, error);
    toast.success("اطلاعات رد شد");
    setShowRejectBox(false); setRejectReason("");
    await onChanged();
  }

  async function sync() {
    setBusy(true);
    try {
      const res = await syncPartyToSepidar(party.id);
      if (res.sepidar_sync_status === "synced") toast.success("در سپیدار ثبت شد");
      else toastFinanceError(toast, res.error_message || new Error("خطا در ثبت سپیدار"));
    } catch (e: unknown) {
      toastFinanceError(toast, e);
    } finally {
      setBusy(false);
      await onChanged();
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex justify-end" onClick={onClose}>
      <div className="bg-card border-l shadow-lg w-full max-w-md h-full overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b flex items-center justify-between sticky top-0 bg-card">
          <div className="min-w-0">
            <h3 className="font-bold truncate">{partyName(party)}</h3>
            <p className="text-xs text-muted-foreground">{party.ownership_type === "legal" ? "حقوقی" : "حقیقی"}</p>
          </div>
          <div className="flex gap-1">
            <Button size="icon" variant="ghost" onClick={onEdit}><Pencil className="w-4 h-4" /></Button>
            <Button size="icon" variant="ghost" onClick={onClose}><X className="w-4 h-4" /></Button>
          </div>
        </div>

        <div className="p-4 space-y-4">
          {/* Posting readiness banner */}
          {!ready && (
            <div className="rounded-lg border bg-amber-50 text-amber-900 text-xs p-2 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>این ذینفع تا کامل شدن ثبت در سپیدار، در صدور سند نهایی قابل انتخاب نیست.</span>
            </div>
          )}

          <div className="rounded-xl border p-3">
            <p className="text-xs text-muted-foreground">مانده</p>
            <MoneyCell value={party.balance} className="text-xl" positive={(party.balance || 0) > 0} negative={(party.balance || 0) < 0} />
          </div>

          <Button variant="outline" className="w-full" onClick={onCompare}>
            <GitCompareArrows className="w-4 h-4 ml-1" /> مقایسه صورتحساب با سپیدار
          </Button>

          <div className="space-y-1.5 text-sm">
            {party.national_code && <Row label="کد ملی" value={party.national_code} />}
            {party.national_id && <Row label="شناسه ملی" value={party.national_id} />}
            {party.mobile && <Row label="موبایل" value={party.mobile} />}
            {party.telephone && <Row label="تلفن" value={party.telephone} />}
            {party.postal_code && <Row label="کد پستی" value={party.postal_code} />}
            {party.address && <Row label="آدرس" value={party.address} />}
          </div>

          {/* Approval & Sepidar registration */}
          <div className="rounded-xl border p-3 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-bold text-sm">وضعیت تایید و ثبت در سپیدار</h4>
              <ApprovalBadge status={party.approval_status} />
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <Row label="وضعیت تایید" value={partyApprovalLabel(party.approval_status)} />
              <Row label="وضعیت سپیدار" value={party.sepidar_sync_status || "—"} />
              <Row label="کد DL" value={party.sepidar_dl_id != null ? String(party.sepidar_dl_id) : "—"} />
              <Row label="کد تفصیل" value={party.sepidar_dl_code != null ? String(party.sepidar_dl_code) : "—"} />
              <Row label="شناسه طرف حساب" value={party.sepidar_party_id != null ? String(party.sepidar_party_id) : "—"} />
              <Row label="شناسه حساب" value={party.sepidar_account_id != null ? String(party.sepidar_account_id) : "—"} />
              {/* PartyAccountSLRef used by bridge.CreatePaymentRequestVoucher / CreateBankVoucher.
                  Blank ⇒ edge function will fall back to settings, then to legacy 193. */}
              <Row label="کد حساب طرف (PartyAccountSLRef)" value={party.party_account_sl_ref != null ? String(party.party_account_sl_ref) : "—"} />
              <Row label="عنوان در سپیدار" value={party.sepidar_full_name || "—"} />
              <Row label="تعداد تلاش" value={String(party.sepidar_sync_attempts ?? 0)} />
            </div>

            {party.rejection_reason && (
              <div className="rounded-md bg-rose-50 text-rose-900 text-xs p-2">
                دلیل رد: {party.rejection_reason}
              </div>
            )}

            {party.sepidar_error_message && (
              <div className="space-y-1">
                <Button size="sm" variant="outline" className="w-full" onClick={() => setShowError((s) => !s)}>
                  <AlertTriangle className="w-4 h-4 ml-1" /> مشاهده خطای سپیدار
                </Button>
                {showError && (
                  <div className="rounded-md bg-rose-50 text-rose-900 text-xs p-2 break-words">
                    {party.sepidar_error_message}
                  </div>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              {alreadySynced && (
                <div className="col-span-2 inline-flex items-center justify-center gap-1.5 rounded-md bg-emerald-50 text-emerald-800 border border-emerald-200 px-3 py-2 text-xs font-bold">
                  <ShieldCheck className="w-4 h-4" /> ثبت‌شده در سپیدار
                </div>
              )}
              {canApprove && (
                <Button size="sm" disabled={busy} onClick={approve}>
                  <CheckCircle2 className="w-4 h-4 ml-1" /> تایید اطلاعات
                </Button>
              )}
              {canReject && (
                <Button size="sm" variant="outline" disabled={busy} onClick={() => setShowRejectBox((s) => !s)}>
                  <XCircle className="w-4 h-4 ml-1" /> رد اطلاعات
                </Button>
              )}
              {canSync && (
                <Button size="sm" className="col-span-2" disabled={busy} onClick={sync}>
                  <Send className="w-4 h-4 ml-1" /> ثبت در سپیدار
                </Button>
              )}
              {canRetry && (
                <Button size="sm" className="col-span-2" disabled={busy} onClick={sync}>
                  <RefreshCw className="w-4 h-4 ml-1" /> تلاش مجدد ثبت در سپیدار
                </Button>
              )}
            </div>

            {showRejectBox && (
              <div className="space-y-2 rounded-md border p-2">
                <Label className="text-xs">دلیل رد اطلاعات</Label>
                <Textarea rows={2} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="ghost" onClick={() => { setShowRejectBox(false); setRejectReason(""); }}>انصراف</Button>
                  <Button size="sm" variant="destructive" disabled={busy} onClick={reject}>ثبت رد</Button>
                </div>
              </div>
            )}
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

// Re-export status labels for consumers
export { PARTY_APPROVAL_STATUS_LABEL };
