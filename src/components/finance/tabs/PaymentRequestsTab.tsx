import { useEffect, useState } from "react";
import { toastFinanceError } from "@/lib/financeErrors";
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
import { getSepidarBeneficiaryBalance, shouldEnforceSepidarBalance } from "@/lib/sepidar";

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
        title, description, request_type: typeKey, legacy_request_type_code: code, status: "pending_approval", total_amount: total, total_paid_amount: 0, remaining_amount: total,
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
      toastFinanceError(toast, e);
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

interface PRItemFull {
  id: string;
  party_id: string | null;
  amount: number;
  paid_amount: number | null;
  remaining_amount: number | null;
  amount_type_code: number;
  amount_type: string;
  description: string | null;
  status: string | null;
  party?: PartyLite & { id?: string };
}

interface AllocationRow {
  id: string;
  payment_request_item_id: string;
  bank_transaction_id: string;
  bank_id: string | null;
  amount: number;
  status: string;
  sepidar_sync_status: string;
  sepidar_error_message: string | null;
  allocation_datetime: string;
  bank?: { title: string | null; bank_name: string | null } | null;
  bank_transaction?: { transaction_jalali_date: string | null; document_number: string | null; description: string | null } | null;
}

function PRDetail({ pr, onClose }: { pr: PR; onClose: () => void }) {
  const [items, setItems] = useState<PRItemFull[]>([]);
  const [allocations, setAllocations] = useState<AllocationRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [allocItem, setAllocItem] = useState<PRItemFull | null>(null);
  const [headerRefresh, setHeaderRefresh] = useState<PR>(pr);

  async function reload() {
    const [itemsRes, allocRes, headerRes] = await Promise.all([
      supabase
        .from("finance_payment_request_items")
        .select("*, party:finance_parties(ownership_type,first_name,last_name,company_name,balance)")
        .eq("payment_request_id", pr.id),
      supabase
        .from("finance_payment_allocations")
        .select("*, bank:finance_banks(title,bank_name), bank_transaction:finance_bank_transactions(transaction_jalali_date,document_number,description)")
        .eq("payment_request_id", pr.id)
        .eq("is_deleted", false)
        .order("allocation_datetime", { ascending: false }),
      supabase.from("finance_payment_requests").select("*").eq("id", pr.id).maybeSingle(),
    ]);
    setItems((itemsRes.data as never[]) || []);
    setAllocations((allocRes.data as never[]) || []);
    if (headerRes.data) setHeaderRefresh(headerRes.data as PR);
  }
  useEffect(() => { void reload(); }, [pr.id]);

  function validateForApproval(): string | null {
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
    const err = validateForApproval();
    if (err) return toast.error(err);
    setBusy(true);
    try {
      await approvePaymentRequest(pr.id);
      toast.success("درخواست تایید شد");
      await reload();
    } catch (e: unknown) {
      toastFinanceError(toast, e);
    } finally { setBusy(false); }
  }
  async function reject() {
    setBusy(true);
    await supabase.from("finance_payment_requests").update({ status: "rejected" }).eq("id", pr.id);
    toast.success("رد شد");
    setBusy(false);
    onClose();
  }

  const headerTotal = Number(headerRefresh.total_amount || 0);
  const headerPaid = Number((headerRefresh as PR & { total_paid_amount?: number }).total_paid_amount || 0);
  const headerRemaining = Math.max(0, headerTotal - headerPaid);
  const headerStatus = headerRefresh.status;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex justify-end" onClick={onClose}>
      <div className="bg-card border-l shadow-lg w-full max-w-2xl h-full overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b flex items-center justify-between sticky top-0 bg-card z-10">
          <div>
            <h3 className="font-bold">{pr.title || "درخواست پرداخت"}</h3>
            <p className="text-[11px] text-muted-foreground mt-0.5">{getPaymentRequestTypeLabel(pr.legacy_request_type_code)}</p>
            <div className="flex items-center gap-2 mt-1">
              <FinanceStatusBadge status={headerStatus} />
              <JalaliDateCell value={pr.created_at} />
            </div>
          </div>
          <Button size="icon" variant="ghost" onClick={onClose}><X className="w-4 h-4" /></Button>
        </div>
        <div className="p-4 space-y-4">
          {pr.description && <p className="text-sm text-muted-foreground">{pr.description}</p>}

          {/* Header summary */}
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-lg border p-2">
              <div className="text-[11px] text-muted-foreground">مبلغ کل</div>
              <MoneyCell value={headerTotal} className="text-sm" />
            </div>
            <div className="rounded-lg border p-2">
              <div className="text-[11px] text-muted-foreground">پرداخت‌شده</div>
              <MoneyCell value={headerPaid} className="text-sm" positive />
            </div>
            <div className="rounded-lg border p-2">
              <div className="text-[11px] text-muted-foreground">مانده</div>
              <MoneyCell value={headerRemaining} className="text-sm" negative={headerRemaining > 0} />
            </div>
          </div>

          {/* Items table */}
          <div className="rounded-xl border divide-y">
            {items.map((i, idx) => {
              const amt = Number(i.amount || 0);
              const paid = Number(i.paid_amount || 0);
              const remaining = Math.max(0, amt - paid);
              const canAllocate = ["approved", "partially_paid", "sync_failed"].includes(String(i.status)) && remaining > 0;
              return (
                <div key={i.id || idx} className="p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-bold text-sm truncate">{i.party ? partyName(i.party) : "—"}</p>
                      {i.description && <p className="text-xs text-muted-foreground truncate">{i.description}</p>}
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <FinanceStatusBadge status={i.status} />
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-800">
                        {getPaymentAmountTypeLabel(i.amount_type_code)}
                      </span>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-[11px]">
                    <div className="rounded bg-muted/40 px-2 py-1 flex justify-between">
                      <span className="text-muted-foreground">درخواستی</span>
                      <MoneyCell value={amt} className="text-[11px]" />
                    </div>
                    <div className="rounded bg-muted/40 px-2 py-1 flex justify-between">
                      <span className="text-muted-foreground">پرداخت شده</span>
                      <MoneyCell value={paid} className="text-[11px]" />
                    </div>
                    <div className="rounded bg-muted/40 px-2 py-1 flex justify-between">
                      <span className="text-muted-foreground">مانده</span>
                      <MoneyCell value={remaining} className="text-[11px]" />
                    </div>
                  </div>
                  {canAllocate && (
                    <Button size="sm" variant="outline" className="w-full" onClick={() => setAllocItem(i)}>
                      <Link2 className="w-3.5 h-3.5 ml-1" /> اتصال تراکنش پرداخت
                    </Button>
                  )}
                </div>
              );
            })}
          </div>

          {/* Allocations list */}
          {allocations.length > 0 && (
            <div className="rounded-xl border">
              <div className="p-2 border-b bg-muted/40 text-sm font-bold">تخصیص‌های پرداخت</div>
              <div className="divide-y">
                {allocations.map((a) => (
                  <div key={a.id} className="p-3 space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs">
                        <span className="font-bold">{a.bank?.title || a.bank?.bank_name || "بانک"}</span>
                        <span className="text-muted-foreground"> — سند: {a.bank_transaction?.document_number || "—"}</span>
                      </div>
                      <FinanceStatusBadge status={a.status} />
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                      <span>{a.bank_transaction?.transaction_jalali_date || formatJalaliDateTime(a.allocation_datetime)}</span>
                      <MoneyCell value={a.amount} className="text-[11px]" />
                    </div>
                    {a.sepidar_error_message && (
                      <div className="text-[11px] text-red-700 bg-red-50 rounded px-2 py-1">{a.sepidar_error_message}</div>
                    )}
                    {a.status !== "synced" && a.status !== "cancelled" && (
                      <div className="flex gap-2">
                        {a.status === "sync_failed" && (
                          <Button size="sm" variant="outline" disabled={busy} onClick={async () => {
                            setBusy(true);
                            try {
                              const r = await retryPaymentAllocationSync(a.id);
                              if (r.ok) toast.success("ثبت سند انجام شد");
                              else toastFinanceError(toast, r.error || new Error("خطا"));
                              await reload();
                            } catch (e: unknown) { toastFinanceError(toast, e); }
                            finally { setBusy(false); }
                          }}>
                            <RefreshCw className="w-3.5 h-3.5 ml-1" /> تلاش مجدد
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" disabled={busy} onClick={async () => {
                          if (!confirm("لغو تخصیص؟")) return;
                          setBusy(true);
                          try { await cancelPaymentAllocation(a.id); toast.success("لغو شد"); await reload(); }
                          catch (e: unknown) { toastFinanceError(toast, e); }
                          finally { setBusy(false); }
                        }}>
                          <XCircle className="w-3.5 h-3.5 ml-1" /> لغو تخصیص
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Approval actions */}
          <div className="grid grid-cols-2 gap-2">
            {(headerStatus === "draft" || headerStatus === "pending_approval") && (
              <>
                <Button onClick={approve} disabled={busy}><CheckCircle2 className="w-4 h-4 ml-1" /> تایید مدیریت</Button>
                <Button onClick={reject} variant="outline" disabled={busy}>رد درخواست</Button>
              </>
            )}
          </div>
        </div>
      </div>

      {allocItem && (
        <AllocationDialog
          item={allocItem}
          requestId={pr.id}
          onClose={() => setAllocItem(null)}
          onDone={async () => { setAllocItem(null); await reload(); }}
        />
      )}
    </div>
  );
}

interface BankLite { id: string; title: string | null; bank_name: string | null }
interface TxRow {
  id: string; bank_id: string; transaction_jalali_date: string | null;
  withdraw_amount: number; description: string | null; document_number: string | null;
}

function AllocationDialog({ item, requestId, onClose, onDone }: { item: PRItemFull; requestId: string; onClose: () => void; onDone: () => void }) {
  const [banks, setBanks] = useState<BankLite[]>([]);
  const [bankFilter, setBankFilter] = useState<string>("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [amountFilter, setAmountFilter] = useState("");
  const [descFilter, setDescFilter] = useState("");
  const [docFilter, setDocFilter] = useState("");
  const [txs, setTxs] = useState<TxRow[]>([]);
  const [selected, setSelected] = useState<TxRow | null>(null);
  const [allocAmount, setAllocAmount] = useState<number>(0);
  const [busy, setBusy] = useState(false);

  const remaining = Math.max(0, Number(item.amount || 0) - Number(item.paid_amount || 0));

  useEffect(() => {
    void supabase.from("finance_banks").select("id,title,bank_name").eq("is_deleted", false).then(({ data }) => setBanks((data as BankLite[]) || []));
  }, []);

  useEffect(() => {
    let q = supabase
      .from("finance_bank_transactions")
      .select("id,bank_id,transaction_jalali_date,withdraw_amount,description,document_number")
      .eq("is_deleted", false)
      .eq("transaction_type", "withdraw")
      .eq("assignment_status", "unassigned")
      .order("transaction_datetime", { ascending: false })
      .limit(100);
    if (bankFilter) q = q.eq("bank_id", bankFilter);
    if (fromDate) q = q.gte("transaction_jalali_date", fromDate);
    if (toDate) q = q.lte("transaction_jalali_date", toDate);
    if (amountFilter) {
      const a = parseMoney(amountFilter);
      if (a) q = q.eq("withdraw_amount", a);
    }
    if (descFilter) q = q.ilike("description", `%${descFilter}%`);
    if (docFilter) q = q.ilike("document_number", `%${docFilter}%`);
    void q.then(({ data }) => setTxs((data as TxRow[]) || []));
  }, [bankFilter, fromDate, toDate, amountFilter, descFilter, docFilter]);

  function selectTx(tx: TxRow) {
    setSelected(tx);
    const w = Number(tx.withdraw_amount || 0);
    setAllocAmount(Math.min(w, remaining));
  }

  async function submit() {
    if (!selected) return;
    if (!allocAmount || allocAmount <= 0) return toast.error("مبلغ تخصیص نامعتبر است");
    if (allocAmount > remaining + 1e-6) return toast.error("بیش از مانده ردیف");
    if (allocAmount > Number(selected.withdraw_amount || 0) + 1e-6) return toast.error("بیش از مبلغ تراکنش");
    setBusy(true);
    try {
      const r = await createPaymentAllocation({
        payment_request_id: requestId,
        payment_request_item_id: item.id,
        bank_transaction_id: selected.id,
        amount: allocAmount,
      });
      if (r.ok) toast.success("تخصیص و سند داخلی ثبت شد");
      else toastFinanceError(toast, r.error || new Error("تخصیص ثبت شد ولی ثبت سپیدار ناموفق بود"));
      onDone();
    } catch (e: unknown) {
      toastFinanceError(toast, e);
    } finally { setBusy(false); }
  }

  const bankName = (id: string) => {
    const b = banks.find((x) => x.id === id);
    return b ? (b.title || b.bank_name || "—") : "—";
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-card rounded-t-2xl sm:rounded-2xl border shadow-lg w-full max-w-2xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b flex items-center justify-between sticky top-0 bg-card">
          <h3 className="font-bold">انتخاب تراکنش برداشت</h3>
          <Button size="icon" variant="ghost" onClick={onClose}><X className="w-4 h-4" /></Button>
        </div>
        <div className="p-4 space-y-3">
          <div className="rounded-lg bg-muted/40 p-2 text-xs grid grid-cols-3 gap-2">
            <div><span className="text-muted-foreground">ذینفع: </span><span className="font-bold">{item.party ? partyName(item.party) : "—"}</span></div>
            <div><span className="text-muted-foreground">مبلغ ردیف: </span>{formatMoney(item.amount)}</div>
            <div><span className="text-muted-foreground">مانده ردیف: </span>{formatMoney(remaining)}</div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <select value={bankFilter} onChange={(e) => setBankFilter(e.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-sm">
              <option value="">همه بانک‌ها</option>
              {banks.map((b) => <option key={b.id} value={b.id}>{b.title || b.bank_name}</option>)}
            </select>
            <Input placeholder="تاریخ از (شمسی)" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            <Input placeholder="تاریخ تا (شمسی)" value={toDate} onChange={(e) => setToDate(e.target.value)} />
            <Input dir="ltr" placeholder="مبلغ" value={amountFilter} onChange={(e) => setAmountFilter(e.target.value)} />
            <Input placeholder="شرح" value={descFilter} onChange={(e) => setDescFilter(e.target.value)} />
            <Input placeholder="شماره سند" value={docFilter} onChange={(e) => setDocFilter(e.target.value)} />
          </div>

          <div className="rounded-lg border max-h-72 overflow-y-auto">
            {txs.length === 0 && <div className="p-6 text-center text-sm text-muted-foreground">تراکنش برداشت تخصیص‌نشده‌ای یافت نشد</div>}
            {txs.map((tx) => (
              <button key={tx.id} onClick={() => selectTx(tx)}
                className={`w-full text-right p-3 border-b last:border-b-0 hover:bg-muted/60 transition ${selected?.id === tx.id ? "bg-primary/5" : ""}`}>
                <div className="flex justify-between items-center gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-bold">{bankName(tx.bank_id)}</div>
                    <div className="text-[11px] text-muted-foreground truncate">{tx.description || "—"}</div>
                    <div className="text-[10px] text-muted-foreground">سند: {tx.document_number || "—"} · {tx.transaction_jalali_date || ""}</div>
                  </div>
                  <MoneyCell value={tx.withdraw_amount} className="text-sm" negative />
                </div>
              </button>
            ))}
          </div>

          {selected && (
            <div className="rounded-lg border p-3 space-y-2 bg-muted/20">
              <div className="text-sm font-bold">تایید تخصیص</div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div><span className="text-muted-foreground">بانک: </span>{bankName(selected.bank_id)}</div>
                <div><span className="text-muted-foreground">تاریخ: </span>{selected.transaction_jalali_date || "—"}</div>
                <div><span className="text-muted-foreground">مبلغ تراکنش: </span>{formatMoney(selected.withdraw_amount)}</div>
                <div><span className="text-muted-foreground">مانده ردیف: </span>{formatMoney(remaining)}</div>
              </div>
              <div className="space-y-1">
                <Label className="text-[11px]">مبلغ تخصیص</Label>
                <Input dir="ltr" inputMode="numeric" value={allocAmount || ""} onChange={(e) => setAllocAmount(parseMoney(e.target.value))} />
              </div>
              <Button onClick={submit} disabled={busy} className="w-full">
                <CheckCircle2 className="w-4 h-4 ml-1" /> ثبت تخصیص و ایجاد سند
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
