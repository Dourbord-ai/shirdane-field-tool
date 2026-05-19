import { useEffect, useState } from "react";
import { toastFinanceError } from "@/lib/financeErrors";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { TransactionSelector, PartySelector } from "@/components/finance/selectors";
import { MoneyCell, JalaliDateCell, FinanceStatusBadge } from "@/components/finance/atoms";
import { createVoucher, sepidarSyncPlaceholder, parseMoney, formatMoney, type VoucherItemInput } from "@/lib/finance";
import { toast } from "sonner";
import { CheckCircle2, Plus, X, ArrowRight, FileCheck2 } from "lucide-react";

interface SelectedTx {
  id: string; bank_id: string | null; deposit_amount: number | null;
  withdraw_amount: number | null; transaction_datetime: string | null;
}

// Row shape for the bank-transfer LIST view. We keep this narrow on purpose —
// the create form has its own state.
interface BankTransferRow {
  id: string;
  legacy_id: number | null;
  from_bank_id: string | null;
  to_bank_id: string | null;
  from_amount: number | null;
  to_amount: number | null;
  transfer_datetime: string | null;
  status: string | null;
  voucher_id: string | null;
  description: string | null;
}

interface BankRef { id: string; title: string | null; bank_name: string | null }

export default function BankTransferTab() {
  // --- List state ----------------------------------------------------------
  // Default view = list. The user explicitly asked the create form to be
  // opened only via a primary button so legacy imported rows (≈325 records)
  // are visible immediately.
  const [rows, setRows] = useState<BankTransferRow[]>([]);
  const [banks, setBanks] = useState<Record<string, BankRef>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [openForm, setOpenForm] = useState(false);

  useEffect(() => { void load(); }, []);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      // Pull a generous page; the table currently holds at most a few hundred
      // legacy rows so a single query is fine. If volume grows we should
      // introduce pagination.
      const [{ data, error }, banksRes] = await Promise.all([
        supabase
          .from("finance_bank_transfers")
          .select("id,legacy_id,from_bank_id,to_bank_id,from_amount,to_amount,transfer_datetime,status,voucher_id,description")
          .eq("is_deleted", false)
          .order("transfer_datetime", { ascending: false, nullsFirst: false })
          .limit(1000),
        supabase.from("finance_banks").select("id,title,bank_name"),
      ]);
      if (error) throw error;
      setRows((data as BankTransferRow[]) || []);
      const map: Record<string, BankRef> = {};
      ((banksRes.data as BankRef[]) || []).forEach((b) => (map[b.id] = b));
      setBanks(map);
    } catch (e: unknown) {
      setLoadError(e instanceof Error ? e.message : "خطا در بارگذاری");
    } finally {
      setLoading(false);
    }
  }

  const bankLabel = (id: string | null) => {
    if (!id) return "—";
    const b = banks[id];
    return b?.title || b?.bank_name || id.slice(0, 8);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-bold">انتقال بین بانکی</h2>
        <Button onClick={() => setOpenForm(true)}>
          <Plus className="w-4 h-4 ml-1" /> ثبت انتقال بین بانکی
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground py-8 text-center">در حال بارگذاری…</p>
      ) : loadError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 text-red-800 text-sm p-3">
          خطا در بارگذاری انتقال‌ها: {loadError}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          هنوز انتقالی ثبت نشده — برای شروع روی «ثبت انتقال بین بانکی» بزنید.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full text-sm text-right">
            <thead className="bg-muted/40 text-xs">
              <tr>
                <th className="p-2 font-bold">کد</th>
                <th className="p-2 font-bold">بانک مبدا</th>
                <th className="p-2 font-bold">بانک مقصد</th>
                <th className="p-2 font-bold">مبلغ مبدا</th>
                <th className="p-2 font-bold">مبلغ مقصد</th>
                <th className="p-2 font-bold">تاریخ انتقال</th>
                <th className="p-2 font-bold">وضعیت</th>
                <th className="p-2 font-bold">سند</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t hover:bg-muted/30">
                  <td className="p-2 font-mono text-xs">{r.legacy_id ?? r.id.slice(0, 8)}</td>
                  <td className="p-2">{bankLabel(r.from_bank_id)}</td>
                  <td className="p-2">
                    <span className="inline-flex items-center gap-1">
                      <ArrowRight className="w-3 h-3 text-muted-foreground" />
                      {bankLabel(r.to_bank_id)}
                    </span>
                  </td>
                  <td className="p-2"><MoneyCell value={r.from_amount} /></td>
                  <td className="p-2"><MoneyCell value={r.to_amount} positive /></td>
                  <td className="p-2"><JalaliDateCell value={r.transfer_datetime} /></td>
                  <td className="p-2"><FinanceStatusBadge status={r.status} /></td>
                  <td className="p-2">
                    {r.voucher_id ? (
                      <span className="inline-flex items-center gap-1 text-emerald-700 text-xs font-bold">
                        <FileCheck2 className="w-3.5 h-3.5" /> صادر شده
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {openForm && (
        <BankTransferFormDialog
          onClose={() => setOpenForm(false)}
          onDone={() => { setOpenForm(false); void load(); }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create form — extracted into a modal so the tab can default to the list
// view. The logic is unchanged from the previous inline form.
// ---------------------------------------------------------------------------
function BankTransferFormDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [fromId, setFromId] = useState<string | null>(null);
  const [fromTx, setFromTx] = useState<SelectedTx | null>(null);
  const [toId, setToId] = useState<string | null>(null);
  const [toTx, setToTx] = useState<SelectedTx | null>(null);
  const [hasFee, setHasFee] = useState(false);
  const [feeAmount, setFeeAmount] = useState("");
  const [feeParty, setFeeParty] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  const fromAmount = fromTx?.withdraw_amount || 0;
  const toAmount = toTx?.deposit_amount || 0;
  const computedFee = hasFee ? parseMoney(feeAmount) : 0;
  const diff = Number(fromAmount) - Number(toAmount);
  const valid = !!fromTx && !!toTx && Math.abs(diff - computedFee) < 0.01;

  async function submit() {
    if (saving) return;
    if (!fromTx || !toTx || !fromId || !toId) return toast.error("هر دو رسید را انتخاب کنید");
    if (!fromTx.bank_id || !toTx.bank_id) return toast.error("بانک نامعتبر");
    if (fromTx.bank_id === toTx.bank_id) return toast.error("بانک مبدا و مقصد یکسان است");
    if (!valid) return toast.error("اختلاف مبلغ با کارمزد نمی‌خواند");
    setSaving(true);
    try {
      const { data: tr, error } = await supabase
        .from("finance_bank_transfers")
        .insert({
          from_bank_id: fromTx.bank_id,
          to_bank_id: toTx.bank_id,
          from_transaction_id: fromId,
          to_transaction_id: toId,
          from_amount: fromAmount,
          to_amount: toAmount,
          transfer_datetime: fromTx.transaction_datetime,
          has_fee: hasFee,
          fee_amount: computedFee,
          fee_party_id: hasFee ? feeParty : null,
          description,
          status: "approved",
          approved_at: new Date().toISOString(),
        })
        .select("id").single();
      if (error || !tr) throw error || new Error("insert failed");

      await supabase.from("finance_bank_transactions").update({
        assignment_status: "assigning",
        assigned_operation_type: "bank_transfer",
        assigned_operation_id: tr.id,
      }).in("id", [fromId, toId]);

      const items: VoucherItemInput[] = [
        { bank_id: toTx.bank_id, account_type: "bank", debit: toAmount, credit: 0, description: "بانک مقصد" },
        { bank_id: fromTx.bank_id, account_type: "bank", debit: 0, credit: fromAmount, description: "بانک مبدا" },
      ];
      if (hasFee && computedFee > 0) {
        items.push({
          party_id: feeParty,
          account_type: feeParty ? "party" : "expense",
          debit: computedFee,
          credit: 0,
          description: "کارمزد انتقال",
        });
      }
      const v = await createVoucher({
        voucher_type: "bank_transfer",
        source_operation_type: "bank_transfer",
        source_operation_id: tr.id,
        title: "انتقال بین بانکی",
        description,
        items,
      });

      await supabase.from("finance_bank_transfers").update({ voucher_id: v.id }).eq("id", tr.id);
      await sepidarSyncPlaceholder(v.id, "post_voucher");

      await supabase.from("finance_bank_transactions").update({
        assignment_status: "assigned",
      }).in("id", [fromId, toId]);

      toast.success("انتقال ثبت و سند داخلی صادر شد");
      onDone();
    } catch (e: unknown) {
      toastFinanceError(toast, e);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-card rounded-t-2xl sm:rounded-2xl border shadow-lg w-full max-w-2xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b flex items-center justify-between sticky top-0 bg-card z-10">
          <h3 className="font-bold">ثبت انتقال بین بانکی</h3>
          <Button size="sm" variant="ghost" onClick={onClose}><X className="w-4 h-4" /></Button>
        </div>

        <div className="p-4 space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs">۱) رسید بانک مبدا (برداشت)</Label>
            <TransactionSelector value={fromId} onChange={(id, t) => { setFromId(id); setFromTx(t || null); }} filter={{ transaction_type: "withdraw", assignment_status: "unassigned" }} placeholder="انتخاب برداشت" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">۲) رسید بانک مقصد (واریز)</Label>
            <TransactionSelector value={toId} onChange={(id, t) => { setToId(id); setToTx(t || null); }} filter={{ transaction_type: "deposit", assignment_status: "unassigned" }} placeholder="انتخاب واریز" />
          </div>

          {fromTx && toTx && (
            <div className="rounded-lg bg-muted/30 p-3 text-sm space-y-1">
              <div className="flex justify-between"><span>برداشت مبدا</span><span className="font-bold tabular-nums">{formatMoney(fromAmount)}</span></div>
              <div className="flex justify-between"><span>واریز مقصد</span><span className="font-bold tabular-nums">{formatMoney(toAmount)}</span></div>
              <div className="flex justify-between"><span>اختلاف</span><span className="font-bold tabular-nums">{formatMoney(diff)}</span></div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setHasFee(false)} className={`h-10 rounded-md border text-sm font-bold ${!hasFee ? "bg-primary text-primary-foreground border-primary" : "bg-background"}`}>بدون کارمزد</button>
            <button type="button" onClick={() => setHasFee(true)} className={`h-10 rounded-md border text-sm font-bold ${hasFee ? "bg-primary text-primary-foreground border-primary" : "bg-background"}`}>دارای کارمزد</button>
          </div>

          {hasFee && (
            <>
              <div className="space-y-1.5">
                <Label className="text-xs">مبلغ کارمزد</Label>
                <Input dir="ltr" inputMode="numeric" value={feeAmount} onChange={(e) => setFeeAmount(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">محل کارمزد (ذینفع)</Label>
                <PartySelector value={feeParty} onChange={setFeeParty} placeholder="در صورت خالی بودن، حساب هزینه" />
              </div>
            </>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs">توضیحات</Label>
            <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
        </div>

        <div className="p-4 border-t flex justify-end gap-2 sticky bottom-0 bg-card">
          <Button variant="outline" onClick={onClose}>انصراف</Button>
          <Button onClick={submit} disabled={saving || !valid}>
            <CheckCircle2 className="w-4 h-4 ml-1" /> ثبت و صدور سند
          </Button>
        </div>
      </div>
    </div>
  );
}
