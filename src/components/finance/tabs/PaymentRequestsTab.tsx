import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MoneyCell, FinanceStatusBadge, JalaliDateCell } from "@/components/finance/atoms";
import { PartySelector } from "@/components/finance/selectors";
import { createPaymentAllocation, retryPaymentAllocationSync, cancelPaymentAllocation, approvePaymentRequest, parseMoney, partyName, formatMoney, formatJalaliDateTime } from "@/lib/finance";
import { Plus, X, CheckCircle2, Trash2, AlertTriangle, Link2, RefreshCw, XCircle } from "lucide-react";
import { toast } from "sonner";
import { PAYMENT_REQUEST_TYPES, getPaymentRequestTypeLabel, getPaymentRequestTypeKey } from "@/lib/paymentRequestTypes";
import {
  PAYMENT_AMOUNT_TYPES,
  getPaymentAmountTypeLabel,
  getPaymentAmountTypeKey,
  validateCreditorBalance,
} from "@/lib/paymentAmountTypes";

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

interface PartyLite {
  ownership_type: string | null;
  first_name: string | null;
  last_name: string | null;
  company_name: string | null;
  balance?: number | null;
}

interface PRItem {
  id?: string;
  party_id: string | null;
  amount: number;
  amount_type_code: number; // 1=creditor, 2=prepayment, 3=on_account
  amount_type: string; // text key
  description: string;
  status?: string;
  party?: PartyLite;
}

export default function PaymentRequestsTab() {
  const [requests, setRequests] = useState<PR[]>([]);
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<PR | null>(null);
  const [typeFilter, setTypeFilter] = useState<string>("");

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
            <p className="text-[11px] text-muted-foreground mt-1">{getPaymentRequestTypeLabel(r.legacy_request_type_code)}</p>
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
  const [typeCode, setTypeCode] = useState<number | "">("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [items, setItems] = useState<PRItem[]>([
    { party_id: null, amount: 0, amount_type_code: 1, amount_type: "creditor", description: "" },
  ]);
  const [partyBalances, setPartyBalances] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);

  const total = items.reduce((s, i) => s + (i.amount || 0), 0);

  // Fetch balances for selected parties
  useEffect(() => {
    const ids = Array.from(new Set(items.map((i) => i.party_id).filter((x): x is string => !!x)));
    const missing = ids.filter((id) => !(id in partyBalances));
    if (!missing.length) return;
    void supabase.from("finance_parties").select("id,balance").in("id", missing).then(({ data }) => {
      if (!data) return;
      setPartyBalances((prev) => {
        const next = { ...prev };
        for (const r of data as { id: string; balance: number | null }[]) next[r.id] = Number(r.balance || 0);
        return next;
      });
    });
  }, [items, partyBalances]);

  function updateItem(idx: number, patch: Partial<PRItem>) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  async function save() {
    if (!typeCode) return toast.error("نوع درخواست را انتخاب کنید");
    if (!title) return toast.error("عنوان لیست را وارد کنید");
    if (items.some((i) => !i.party_id || !i.amount)) return toast.error("ذینفع و مبلغ هر آیتم الزامی است");
    if (items.some((i) => !i.amount_type_code)) return toast.error("نوع مبلغ هر آیتم الزامی است");

    // Validate creditor balance for amount_type_code = 1
    for (let idx = 0; idx < items.length; idx++) {
      const it = items[idx];
      if (it.amount_type_code === 1 && it.party_id) {
        const v = validateCreditorBalance(partyBalances[it.party_id], it.amount);
        if (!v.ok) return toast.error(`ردیف ${idx + 1}: ${v.message}`);
      }
    }

    setSaving(true);
    try {
      const code = Number(typeCode);
      const typeKey = getPaymentRequestTypeKey(code);
      const { data: pr, error } = await supabase.from("finance_payment_requests").insert({
        title, description, request_type: typeKey, legacy_request_type_code: code, status: "draft", total_amount: total,
      }).select("id").single();
      if (error || !pr) throw error || new Error("insert failed");
      await supabase.from("finance_payment_request_items").insert(
        items.map((i) => ({
          payment_request_id: pr.id,
          party_id: i.party_id,
          amount: i.amount,
          amount_type_code: i.amount_type_code,
          amount_type: i.amount_type,
          description: i.description,
          status: "pending_approval",
          legacy_request_type_code: code,
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
              <Label className="text-xs">نوع درخواست <span className="text-destructive">*</span></Label>
              <select
                value={typeCode === "" ? "" : String(typeCode)}
                onChange={(e) => setTypeCode(e.target.value ? Number(e.target.value) : "")}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">انتخاب کنید…</option>
                {PAYMENT_REQUEST_TYPES.map((t) => (
                  <option key={t.code} value={t.code}>{t.code} - {t.label}</option>
                ))}
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
              <Button size="sm" variant="ghost" onClick={() => setItems([...items, { party_id: null, amount: 0, amount_type_code: 1, amount_type: "creditor", description: "" }])}>
                <Plus className="w-3 h-3 ml-1" /> افزودن
              </Button>
            </div>
            <div className="p-2 space-y-2">
              {items.map((it, idx) => {
                const bal = it.party_id ? partyBalances[it.party_id] : undefined;
                const available = bal !== undefined && bal <= 0 ? Math.abs(bal) : 0;
                const isCreditor = it.amount_type_code === 1;
                const shortage = isCreditor && it.amount > 0 && it.party_id && bal !== undefined && available + 1e-6 < it.amount;
                return (
                  <div key={idx} className="rounded-lg border p-2 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">ردیف {idx + 1}</span>
                      {items.length > 1 && (
                        <Button size="icon" variant="ghost" onClick={() => setItems(items.filter((_, i) => i !== idx))}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                    <PartySelector value={it.party_id} onChange={(id) => updateItem(idx, { party_id: id })} />
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-[11px] text-muted-foreground">نوع مبلغ</Label>
                        <select
                          value={String(it.amount_type_code)}
                          onChange={(e) => {
                            const code = Number(e.target.value);
                            updateItem(idx, { amount_type_code: code, amount_type: getPaymentAmountTypeKey(code) || "creditor" });
                          }}
                          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                        >
                          {PAYMENT_AMOUNT_TYPES.map((t) => (
                            <option key={t.code} value={t.code}>{t.code} - {t.label}</option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[11px] text-muted-foreground">مبلغ</Label>
                        <Input dir="ltr" inputMode="numeric" placeholder="مبلغ" value={it.amount || ""}
                          onChange={(e) => updateItem(idx, { amount: parseMoney(e.target.value) })} />
                      </div>
                    </div>
                    {it.party_id && bal !== undefined && (
                      <div className="grid grid-cols-2 gap-2 text-[11px]">
                        <div className="rounded bg-muted/40 px-2 py-1 flex justify-between">
                          <span className="text-muted-foreground">مانده فعلی ذینفع</span>
                          <MoneyCell value={bal} className="text-[11px]" />
                        </div>
                        <div className="rounded bg-muted/40 px-2 py-1 flex justify-between">
                          <span className="text-muted-foreground">مبلغ مجاز قابل پرداخت</span>
                          <MoneyCell value={isCreditor ? available : it.amount || 0} className="text-[11px]" />
                        </div>
                      </div>
                    )}
                    {shortage && (
                      <div className="flex items-center gap-1.5 text-[11px] text-red-700 bg-red-50 rounded px-2 py-1">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        مانده بستانکاری ذینفع برای این مبلغ کافی نیست
                      </div>
                    )}
                    <Input placeholder="توضیحات" value={it.description}
                      onChange={(e) => updateItem(idx, { description: e.target.value })} />
                  </div>
                );
              })}
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
  const [items, setItems] = useState<PRItem[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase
      .from("finance_payment_request_items")
      .select("*, party:finance_parties(ownership_type,first_name,last_name,company_name,balance)")
      .eq("payment_request_id", pr.id)
      .then(({ data }) => setItems((data as never[]) || []));
  }, [pr.id]);

  function validateAllForApproval(): string | null {
    for (let idx = 0; idx < items.length; idx++) {
      const it = items[idx];
      if (it.amount_type_code === 1) {
        const v = validateCreditorBalance(it.party?.balance, Number(it.amount));
        if (!v.ok) return `ردیف ${idx + 1}: ${v.message}`;
      }
    }
    return null;
  }

  async function approve() {
    const err = validateAllForApproval();
    if (err) return toast.error(err);
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
      // Re-validate creditor balances at post-time
      const err = validateAllForApproval();
      if (err) { toast.error(err); setBusy(false); return; }

      // Block posting if any beneficiary is not yet synced to Sepidar
      try {
        await assertPartiesReadyForPosting(items.map((i) => i.party_id).filter((x): x is string => !!x));
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : "ذینفع نامعتبر");
        setBusy(false);
        return;
      }

      // Build voucher items: each PR item is debited to the appropriate party account
      // (creditor / prepayment / on_account). The credit side is a single pending-bank
      // line — final allocation to a real bank happens at the payment step.
      const totalDebit = items.reduce((s, i) => s + Number(i.amount || 0), 0);
      const debitItems = items.map((i) => {
        const accountKind =
          i.amount_type_code === 1 ? "party_creditor"
          : i.amount_type_code === 2 ? "party_prepayment"
          : i.amount_type_code === 3 ? "party_on_account"
          : "party";
        return {
          party_id: i.party_id,
          account_type: accountKind,
          debit: Number(i.amount || 0),
          credit: 0,
          description: [i.description, `(${getPaymentAmountTypeLabel(i.amount_type_code).split(" - ")[1] || ""})`].filter(Boolean).join(" "),
        };
      });
      const v = await createVoucher({
        voucher_type: "payment_request",
        source_operation_type: "payment_request",
        source_operation_id: pr.id,
        title: pr.title || "درخواست پرداخت",
        description: pr.description,
        items: [
          ...debitItems,
          { account_type: "bank_pending", debit: 0, credit: totalDebit, description: "اعتبار بانک — در انتظار تخصیص" },
        ],
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
            <p className="text-[11px] text-muted-foreground mt-0.5">{getPaymentRequestTypeLabel(pr.legacy_request_type_code)}</p>
            <div className="flex items-center gap-2 mt-1">
              <FinanceStatusBadge status={pr.status} />
              <JalaliDateCell value={pr.created_at} />
            </div>
          </div>
          <Button size="icon" variant="ghost" onClick={onClose}><X className="w-4 h-4" /></Button>
        </div>
        <div className="p-4 space-y-4">
          {pr.description && <p className="text-sm text-muted-foreground">{pr.description}</p>}
          <div className="rounded-xl border divide-y">
            {items.map((i, idx) => {
              const bal = Number(i.party?.balance || 0);
              const available = bal <= 0 ? Math.abs(bal) : 0;
              const isCreditor = i.amount_type_code === 1;
              const shortage = isCreditor && Number(i.amount) > available + 1e-6;
              return (
                <div key={i.id || idx} className="p-3 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-bold text-sm truncate">{i.party ? partyName(i.party) : "—"}</p>
                      {i.description && <p className="text-xs text-muted-foreground truncate">{i.description}</p>}
                    </div>
                    <div className="text-right shrink-0">
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-800">
                        {getPaymentAmountTypeLabel(i.amount_type_code)}
                      </span>
                      <MoneyCell value={i.amount} className="text-sm block" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    <div className="rounded bg-muted/40 px-2 py-1 flex justify-between">
                      <span className="text-muted-foreground">مانده فعلی ذینفع</span>
                      <MoneyCell value={bal} className="text-[11px]" />
                    </div>
                    <div className="rounded bg-muted/40 px-2 py-1 flex justify-between">
                      <span className="text-muted-foreground">مبلغ مجاز قابل پرداخت</span>
                      <MoneyCell value={isCreditor ? available : Number(i.amount || 0)} className="text-[11px]" />
                    </div>
                  </div>
                  {shortage && (
                    <div className="flex items-center gap-1.5 text-[11px] text-red-700 bg-red-50 rounded px-2 py-1">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      مانده بستانکاری ذینفع برای این مبلغ کافی نیست
                    </div>
                  )}
                </div>
              );
            })}
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
