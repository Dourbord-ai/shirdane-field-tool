import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { TransactionSelector, PartySelector } from "@/components/finance/selectors";
import { createVoucher, sepidarSyncPlaceholder, parseMoney, formatMoney, type VoucherItemInput } from "@/lib/finance";
import { toast } from "sonner";
import { CheckCircle2 } from "lucide-react";

interface SelectedTx {
  id: string; bank_id: string | null; deposit_amount: number | null;
  withdraw_amount: number | null; transaction_datetime: string | null;
}

export default function BankTransferTab() {
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

      await supabase.from("finance_bank_transactions").update({
        assignment_status: "assigned", assigned_operation_type: "bank_transfer", assigned_operation_id: tr.id,
      }).in("id", [fromId, toId]);

      await supabase.from("finance_bank_transfers").update({ voucher_id: v.id }).eq("id", tr.id);
      await sepidarSyncPlaceholder(v.id, "post_voucher");

      toast.success("انتقال ثبت و سند داخلی صادر شد");
      setFromId(null); setFromTx(null); setToId(null); setToTx(null);
      setHasFee(false); setFeeAmount(""); setFeeParty(null); setDescription("");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "خطا در ثبت");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <h2 className="text-lg font-bold">انتقال بین بانکی</h2>

      <div className="rounded-xl border bg-card p-4 space-y-4">
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

        <Button className="w-full" onClick={submit} disabled={saving || !valid}>
          <CheckCircle2 className="w-4 h-4 ml-1" /> ثبت و صدور سند
        </Button>
      </div>
    </div>
  );
}
