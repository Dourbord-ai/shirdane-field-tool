import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { TransactionSelector, PartySelector } from "@/components/finance/selectors";
import { MoneyCell, JalaliDateCell, FinanceStatusBadge } from "@/components/finance/atoms";
import {
  createReceiveIdentification,
  approveReceiveIdentification,
  rejectReceiveIdentification,
  cancelReceiveIdentification,
  receiveIdStatusLabel,
  partyName,
} from "@/lib/finance";
import { toast } from "sonner";
import { CheckCircle2, X, Plus, RefreshCcw, XCircle, Eye } from "lucide-react";

interface RI {
  id: string;
  title: string | null;
  description: string | null;
  status: string | null;
  amount: number | null;
  transaction_datetime: string | null;
  bank_id: string | null;
  party_id: string | null;
  bank_transaction_id: string | null;
  voucher_id: string | null;
  rejection_reason: string | null;
  sepidar_error_message: string | null;
  sepidar_sync_attempts: number | null;
}

interface PartyRef {
  id: string; first_name: string | null; last_name: string | null;
  company_name: string | null; ownership_type: string | null;
}
interface BankRef { id: string; title: string | null; bank_name: string | null }

const FILTERS: Array<{ key: string; label: string }> = [
  { key: "", label: "همه" },
  { key: "pending_approval", label: "در انتظار تایید" },
  { key: "approved", label: "تایید شده" },
  { key: "sync_failed", label: "خطای سپیدار" },
  { key: "rejected", label: "رد شده" },
  { key: "cancelled", label: "لغو شده" },
];

export default function ReceiveIdentificationTab() {
  const [items, setItems] = useState<RI[]>([]);
  const [parties, setParties] = useState<Record<string, PartyRef>>({});
  const [banks, setBanks] = useState<Record<string, BankRef>>({});
  const [filter, setFilter] = useState<string>("pending_approval");
  const [loading, setLoading] = useState(true);
  const [openNew, setOpenNew] = useState(false);
  const [openReject, setOpenReject] = useState<RI | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    void supabase.from("finance_parties").select("id,first_name,last_name,company_name,ownership_type")
      .then(({ data }) => {
        const m: Record<string, PartyRef> = {};
        ((data as PartyRef[]) || []).forEach((p) => (m[p.id] = p));
        setParties(m);
      });
    void supabase.from("finance_banks").select("id,title,bank_name")
      .then(({ data }) => {
        const m: Record<string, BankRef> = {};
        ((data as BankRef[]) || []).forEach((b) => (m[b.id] = b));
        setBanks(m);
      });
  }, []);

  useEffect(() => { void load(); }, [filter]);

  async function load() {
    setLoading(true);
    let q = supabase
      .from("finance_receive_identifications")
      .select("*")
      .eq("is_deleted", false)
      .order("created_at", { ascending: false })
      .limit(200);
    if (filter) q = q.eq("status", filter);
    const { data } = await q;
    setItems((data as RI[]) || []);
    setLoading(false);
  }

  async function approve(ri: RI) {
    setBusyId(ri.id);
    try {
      const res = await approveReceiveIdentification(ri.id);
      if (res.ok) toast.success("تایید شد و سند صادر گردید");
      else toast.error(res.error || "خطا در ثبت سپیدار");
      void load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "خطا");
    } finally {
      setBusyId(null);
    }
  }

  async function cancel(ri: RI) {
    if (!confirm("لغو این درخواست؟")) return;
    setBusyId(ri.id);
    try {
      await cancelReceiveIdentification(ri.id);
      toast.success("لغو شد");
      void load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "خطا");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-bold">شناسایی دریافت‌ها</h2>
        <Button onClick={() => setOpenNew(true)}>
          <Plus className="w-4 h-4 ml-1" /> شناسایی جدید
        </Button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.key || "all"}
            onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
              filter === f.key
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-card hover:bg-muted/50"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">در حال بارگذاری…</p>
      ) : items.length === 0 ? (
        <p className="text-center text-muted-foreground py-8">درخواستی یافت نشد</p>
      ) : (
        <div className="space-y-2">
          {items.map((r) => {
            const party = r.party_id ? parties[r.party_id] : null;
            const bank = r.bank_id ? banks[r.bank_id] : null;
            const canApprove = r.status === "pending_approval" || r.status === "sync_failed";
            const canReject = r.status === "pending_approval" || r.status === "sync_failed";
            const canCancel = r.status === "pending_approval";
            return (
              <div key={r.id} className="rounded-xl border bg-card p-3 space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="font-bold text-sm">{r.title || "شناسایی دریافت"}</div>
                  <FinanceStatusBadge status={r.status} />
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs text-muted-foreground">
                  <div>
                    <div className="text-[10px]">ذینفع</div>
                    <div className="text-foreground">{party ? partyName(party) : "—"}</div>
                  </div>
                  <div>
                    <div className="text-[10px]">بانک</div>
                    <div className="text-foreground">{bank?.title || bank?.bank_name || "—"}</div>
                  </div>
                  <div>
                    <div className="text-[10px]">مبلغ</div>
                    <MoneyCell value={r.amount} positive />
                  </div>
                  <div>
                    <div className="text-[10px]">تاریخ تراکنش</div>
                    <JalaliDateCell value={r.transaction_datetime} withTime />
                  </div>
                </div>
                {r.description && <p className="text-xs text-muted-foreground">{r.description}</p>}
                {r.status === "sync_failed" && r.sepidar_error_message && (
                  <div className="text-xs bg-red-50 text-red-800 border border-red-200 rounded-md p-2">
                    خطای سپیدار: {r.sepidar_error_message}
                  </div>
                )}
                {r.status === "rejected" && r.rejection_reason && (
                  <div className="text-xs bg-amber-50 text-amber-800 border border-amber-200 rounded-md p-2">
                    دلیل رد: {r.rejection_reason}
                  </div>
                )}
                <div className="flex flex-wrap gap-1.5">
                  {canApprove && (
                    <Button size="sm" onClick={() => approve(r)} disabled={busyId === r.id}>
                      <CheckCircle2 className="w-3.5 h-3.5 ml-1" />
                      {r.status === "sync_failed" ? "تلاش مجدد ثبت سپیدار" : "تایید و ثبت سند"}
                    </Button>
                  )}
                  {canReject && (
                    <Button size="sm" variant="outline" onClick={() => setOpenReject(r)}>
                      <XCircle className="w-3.5 h-3.5 ml-1" /> رد درخواست
                    </Button>
                  )}
                  {canCancel && (
                    <Button size="sm" variant="ghost" onClick={() => cancel(r)} disabled={busyId === r.id}>
                      لغو
                    </Button>
                  )}
                  {r.status === "approved" && r.voucher_id && (
                    <span className="text-[11px] text-emerald-700">سند: {r.voucher_id.slice(0, 8)}…</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {openNew && <NewReceiveIdDialog onClose={() => setOpenNew(false)} onDone={() => { setOpenNew(false); void load(); }} />}
      {openReject && (
        <RejectDialog
          ri={openReject}
          onClose={() => setOpenReject(null)}
          onDone={() => { setOpenReject(null); void load(); }}
        />
      )}
    </div>
  );
}

function NewReceiveIdDialog({ onClose, onDone, presetTxId }: { onClose: () => void; onDone: () => void; presetTxId?: string }) {
  interface SelectedTx {
    id: string; bank_id: string | null; deposit_amount: number | null;
    withdraw_amount: number | null; transaction_datetime: string | null;
  }
  const [txId, setTxId] = useState<string | null>(presetTxId || null);
  const [tx, setTx] = useState<SelectedTx | null>(null);
  const [partyId, setPartyId] = useState<string | null>(null);
  const [title, setTitle] = useState("شناسایی دریافت");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (presetTxId) {
      void supabase.from("finance_bank_transactions")
        .select("id,bank_id,deposit_amount,withdraw_amount,transaction_datetime")
        .eq("id", presetTxId).maybeSingle()
        .then(({ data }) => setTx((data as SelectedTx) || null));
    }
  }, [presetTxId]);

  const amount = tx?.deposit_amount || 0;

  async function submit() {
    if (!tx || !txId) return toast.error("رسید را انتخاب کنید");
    if (!tx.bank_id) return toast.error("بانک رسید نامعتبر است");
    if (!partyId) return toast.error("ذینفع را انتخاب کنید");
    if (!amount || amount <= 0) return toast.error("مبلغ واریز معتبر نیست");
    setSaving(true);
    try {
      await createReceiveIdentification({
        bank_transaction_id: txId,
        bank_id: tx.bank_id,
        party_id: partyId,
        amount,
        transaction_datetime: tx.transaction_datetime,
        title,
        description,
      });
      toast.success("درخواست در انتظار تایید مدیر ثبت شد");
      onDone();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "خطا در ثبت");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-card rounded-t-2xl sm:rounded-2xl border shadow-lg w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b flex items-center justify-between">
          <h3 className="font-bold">شناسایی دریافت جدید</h3>
          <Button size="sm" variant="ghost" onClick={onClose}><X className="w-4 h-4" /></Button>
        </div>
        <div className="p-4 space-y-3">
          {!presetTxId && (
            <div className="space-y-1.5">
              <Label className="text-xs">رسید (واریز تخصیص نشده)</Label>
              <TransactionSelector
                value={txId}
                onChange={(id, t) => { setTxId(id); setTx((t as SelectedTx) || null); }}
                filter={{ transaction_type: "deposit", assignment_status: "unassigned" }}
                placeholder="انتخاب واریز"
              />
            </div>
          )}
          {tx && (
            <div className="text-xs bg-muted/40 rounded-md p-2 space-y-1">
              <div>مبلغ واریز: <MoneyCell value={amount} positive /></div>
              <div>تاریخ: <JalaliDateCell value={tx.transaction_datetime} withTime /></div>
            </div>
          )}
          <div className="space-y-1.5">
            <Label className="text-xs">ذینفع</Label>
            <PartySelector value={partyId} onChange={setPartyId} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">عنوان</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">توضیحات</Label>
            <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
        </div>
        <div className="p-4 border-t flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>انصراف</Button>
          <Button onClick={submit} disabled={saving || !txId || !partyId}>ارسال برای تایید</Button>
        </div>
      </div>
    </div>
  );
}

function RejectDialog({ ri, onClose, onDone }: { ri: RI; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  async function submit() {
    if (!reason.trim()) return toast.error("دلیل رد را بنویسید");
    setSaving(true);
    try {
      await rejectReceiveIdentification(ri.id, reason.trim());
      toast.success("درخواست رد شد");
      onDone();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "خطا");
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-card rounded-t-2xl sm:rounded-2xl border shadow-lg w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b flex items-center justify-between">
          <h3 className="font-bold">رد درخواست شناسایی</h3>
          <Button size="sm" variant="ghost" onClick={onClose}><X className="w-4 h-4" /></Button>
        </div>
        <div className="p-4 space-y-2">
          <Label className="text-xs">دلیل رد *</Label>
          <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <div className="p-4 border-t flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>انصراف</Button>
          <Button onClick={submit} disabled={saving}>ثبت رد</Button>
        </div>
      </div>
    </div>
  );
}

// Exported helper so other tabs (BankTransactionsTab) can launch the create dialog
export { NewReceiveIdDialog };
