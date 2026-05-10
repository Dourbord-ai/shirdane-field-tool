import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MoneyCell, FinanceStatusBadge, JalaliDateCell } from "@/components/finance/atoms";
import { PartySelector } from "@/components/finance/selectors";
import { createVoucher, sepidarSyncPlaceholder, parseMoney, partyName } from "@/lib/finance";
import { Plus, X, CheckCircle2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PAYMENT_REQUEST_TYPES, getPaymentRequestTypeLabel, getPaymentRequestTypeKey } from "@/lib/paymentRequestTypes";

interface PR {
  id: string;
  title: string | null;
  description: string | null;
  request_type: string | null;
  legacy_request_type_code: number | null;
  status: string | null;
  total_amount: number | null;
  confirmed_amount: number | null;
  created_at: string;
}

interface PRItem {
  id?: string;
  party_id: string | null;
  amount: number;
  amount_type: "debtor" | "creditor";
  description: string;
  status?: string;
  party?: { ownership_type: string | null; first_name: string | null; last_name: string | null; company_name: string | null };
}

export default function PaymentRequestsTab() {
  const [requests, setRequests] = useState<PR[]>([]);
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<PR | null>(null);
  const [typeFilter, setTypeFilter] = useState<string>(""); // "" = همه موارد

  useEffect(() => { void load(); }, [typeFilter]);
  async function load() {
    let q = supabase
      .from("finance_payment_requests")
      .select("*")
      .eq("is_deleted", false)
      .order("created_at", { ascending: false });
    if (typeFilter) q = q.eq("legacy_request_type_code", Number(typeFilter));
    const { data } = await q;
    setRequests((data as PR[]) || []);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-bold">درخواست‌های پرداخت</h2>
        <div className="flex items-center gap-2">
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="">همه موارد</option>
            {PAYMENT_REQUEST_TYPES.map((t) => (
              <option key={t.code} value={t.code}>{t.code} - {t.label}</option>
            ))}
          </select>
          <Button onClick={() => setOpen(true)}><Plus className="w-4 h-4 ml-1" /> درخواست جدید</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {requests.map((r) => (
          <button key={r.id} onClick={() => setDetail(r)} className="text-right rounded-xl border bg-card p-4 hover:border-primary/30 hover:shadow-md transition-all">
            <div className="flex items-start justify-between gap-2">
              <h3 className="font-bold truncate flex-1">{r.title || "—"}</h3>
              <FinanceStatusBadge status={r.status} />
            </div>
            {r.description && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{r.description}</p>}
            <div className="mt-3 pt-3 border-t flex items-center justify-between">
              <JalaliDateCell value={r.created_at} />
              <MoneyCell value={r.total_amount} />
            </div>
          </button>
        ))}
        {requests.length === 0 && (
          <div className="col-span-full rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
            درخواستی ثبت نشده
          </div>
        )}
      </div>

      {open && <PRDialog onClose={() => setOpen(false)} onDone={() => { setOpen(false); void load(); }} />}
      {detail && <PRDetail pr={detail} onClose={() => { setDetail(null); void load(); }} />}
    </div>
  );
}

function PRDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [type, setType] = useState("payment");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [items, setItems] = useState<PRItem[]>([{ party_id: null, amount: 0, amount_type: "debtor", description: "" }]);
  const [saving, setSaving] = useState(false);

  const total = items.reduce((s, i) => s + (i.amount || 0), 0);

  async function save() {
    if (!title) return toast.error("عنوان لیست را وارد کنید");
    if (items.some((i) => !i.party_id || !i.amount)) return toast.error("ذینفع و مبلغ هر آیتم الزامی است");
    setSaving(true);
    try {
      const { data: pr, error } = await supabase.from("finance_payment_requests").insert({
        title, description, request_type: type, status: "draft", total_amount: total,
      }).select("id").single();
      if (error || !pr) throw error || new Error("insert failed");
      await supabase.from("finance_payment_request_items").insert(
        items.map((i) => ({
          payment_request_id: pr.id,
          party_id: i.party_id,
          amount: i.amount,
          amount_type: i.amount_type,
          description: i.description,
          status: "pending",
        })),
      );
      toast.success("درخواست ثبت شد");
      onDone();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "خطا در ثبت");
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-card rounded-t-2xl sm:rounded-2xl border shadow-lg w-full max-w-2xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b flex items-center justify-between sticky top-0 bg-card">
          <h3 className="font-bold">درخواست پرداخت جدید</h3>
          <Button size="sm" variant="ghost" onClick={onClose}><X className="w-4 h-4" /></Button>
        </div>
        <div className="p-4 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label className="text-xs">نوع درخواست</Label>
              <select value={type} onChange={(e) => setType(e.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                <option value="payment">پرداخت</option>
                <option value="settlement">تسویه</option>
                <option value="other">سایر</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">عنوان لیست</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">توضیحات</Label>
            <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>

          <div className="rounded-lg border">
            <div className="p-2 border-b bg-muted/40 flex justify-between items-center">
              <span className="font-bold text-sm">آیتم‌ها</span>
              <Button size="sm" variant="ghost" onClick={() => setItems([...items, { party_id: null, amount: 0, amount_type: "debtor", description: "" }])}>
                <Plus className="w-3 h-3 ml-1" /> افزودن
              </Button>
            </div>
            <div className="p-2 space-y-2">
              {items.map((it, idx) => (
                <div key={idx} className="rounded-lg border p-2 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">ردیف {idx + 1}</span>
                    {items.length > 1 && (
                      <Button size="icon" variant="ghost" onClick={() => setItems(items.filter((_, i) => i !== idx))}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </div>
                  <PartySelector value={it.party_id} onChange={(id) => { const next = [...items]; next[idx].party_id = id; setItems(next); }} />
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      value={it.amount_type}
                      onChange={(e) => { const next = [...items]; next[idx].amount_type = e.target.value as "debtor" | "creditor"; setItems(next); }}
                      className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                    >
                      <option value="debtor">بدهکار</option>
                      <option value="creditor">بستانکار</option>
                    </select>
                    <Input dir="ltr" inputMode="numeric" placeholder="مبلغ" value={it.amount || ""}
                      onChange={(e) => { const next = [...items]; next[idx].amount = parseMoney(e.target.value); setItems(next); }} />
                  </div>
                  <Input placeholder="توضیحات" value={it.description}
                    onChange={(e) => { const next = [...items]; next[idx].description = e.target.value; setItems(next); }} />
                </div>
              ))}
            </div>
            <div className="p-2 border-t flex justify-between items-center bg-muted/30">
              <span className="text-xs text-muted-foreground">جمع کل</span>
              <MoneyCell value={total} />
            </div>
          </div>
        </div>
        <div className="p-4 border-t flex justify-end gap-2 sticky bottom-0 bg-card">
          <Button variant="outline" onClick={onClose}>انصراف</Button>
          <Button onClick={save} disabled={saving}>ذخیره پیش‌نویس</Button>
        </div>
      </div>
    </div>
  );
}

function PRDetail({ pr, onClose }: { pr: PR; onClose: () => void }) {
  const [items, setItems] = useState<(PRItem & { party?: { ownership_type: string | null; first_name: string | null; last_name: string | null; company_name: string | null } })[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase
      .from("finance_payment_request_items")
      .select("*, party:finance_parties(ownership_type,first_name,last_name,company_name)")
      .eq("payment_request_id", pr.id)
      .then(({ data }) => setItems((data as never[]) || []));
  }, [pr.id]);

  async function approve() {
    setBusy(true);
    await supabase.from("finance_payment_requests").update({ status: "approved", approved_at: new Date().toISOString(), confirmed_amount: pr.total_amount }).eq("id", pr.id);
    toast.success("تایید شد");
    setBusy(false);
    onClose();
  }
  async function reject() {
    setBusy(true);
    await supabase.from("finance_payment_requests").update({ status: "rejected" }).eq("id", pr.id);
    toast.success("لغو تایید شد");
    setBusy(false);
    onClose();
  }
  async function postVoucher() {
    setBusy(true);
    try {
      // Create one consolidated voucher for the request
      const debtorTotal = items.filter((i) => i.amount_type === "debtor").reduce((s, i) => s + Number(i.amount || 0), 0);
      const creditorTotal = items.filter((i) => i.amount_type === "creditor").reduce((s, i) => s + Number(i.amount || 0), 0);
      if (Math.abs(debtorTotal - creditorTotal) > 0.01) {
        toast.error("جمع بدهکار/بستانکار آیتم‌ها متوازن نیست — نیاز به تخصیص پرداخت دارد");
        setBusy(false);
        return;
      }
      const v = await createVoucher({
        voucher_type: "payment_request",
        source_operation_type: "payment_request",
        source_operation_id: pr.id,
        title: pr.title || "درخواست پرداخت",
        description: pr.description,
        items: items.map((i) => ({
          party_id: i.party_id,
          account_type: "party",
          debit: i.amount_type === "debtor" ? i.amount : 0,
          credit: i.amount_type === "creditor" ? i.amount : 0,
          description: i.description,
        })),
      });
      await supabase.from("finance_payment_requests").update({ status: "posted" }).eq("id", pr.id);
      await sepidarSyncPlaceholder(v.id, "post_voucher");
      toast.success("سند داخلی صادر شد");
      onClose();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "خطا");
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex justify-end" onClick={onClose}>
      <div className="bg-card border-l shadow-lg w-full max-w-lg h-full overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b flex items-center justify-between sticky top-0 bg-card">
          <div>
            <h3 className="font-bold">{pr.title || "درخواست پرداخت"}</h3>
            <div className="flex items-center gap-2 mt-1">
              <FinanceStatusBadge status={pr.status} />
              <JalaliDateCell value={pr.created_at} />
            </div>
          </div>
          <Button size="icon" variant="ghost" onClick={onClose}><X className="w-4 h-4" /></Button>
        </div>
        <div className="p-4 space-y-4">
          {pr.description && <p className="text-sm text-muted-foreground">{pr.description}</p>}
          <div className="rounded-xl border">
            {items.map((i) => (
              <div key={i.id} className="p-3 border-b last:border-0 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-bold text-sm truncate">{i.party ? partyName(i.party) : "—"}</p>
                  {i.description && <p className="text-xs text-muted-foreground truncate">{i.description}</p>}
                </div>
                <div className="text-right shrink-0">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${i.amount_type === "debtor" ? "bg-red-100 text-red-800" : "bg-emerald-100 text-emerald-800"}`}>
                    {i.amount_type === "debtor" ? "بدهکار" : "بستانکار"}
                  </span>
                  <MoneyCell value={i.amount} className="text-sm block" />
                </div>
              </div>
            ))}
          </div>
          <div className="rounded-xl border p-3 flex justify-between">
            <span className="text-xs text-muted-foreground">جمع کل</span>
            <MoneyCell value={pr.total_amount} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            {pr.status !== "approved" && pr.status !== "posted" && (
              <Button onClick={approve} disabled={busy}><CheckCircle2 className="w-4 h-4 ml-1" /> تایید مدیریت</Button>
            )}
            {pr.status === "approved" && (
              <Button onClick={reject} variant="outline" disabled={busy}>لغو تایید</Button>
            )}
            {pr.status === "approved" && (
              <Button onClick={postVoucher} disabled={busy}>صدور سند داخلی</Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
