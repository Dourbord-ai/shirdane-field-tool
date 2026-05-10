import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { TransactionSelector } from "@/components/finance/selectors";
import { PartySelector } from "@/components/finance/selectors";
import { createVoucher, sepidarSyncPlaceholder } from "@/lib/finance";
import { toast } from "sonner";
import { CheckCircle2 } from "lucide-react";

interface SelectedTx {
  id: string; bank_id: string | null; deposit_amount: number | null;
  withdraw_amount: number | null; transaction_datetime: string | null;
}

export default function ReceiveIdentificationTab() {
  const [txId, setTxId] = useState<string | null>(null);
  const [tx, setTx] = useState<SelectedTx | null>(null);
  const [partyId, setPartyId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  const amount = tx?.deposit_amount || tx?.withdraw_amount || 0;

  async function submit() {
    if (!tx || !txId) return toast.error("رسید را انتخاب کنید");
    if (!partyId) return toast.error("ذینفع را انتخاب کنید");
    if (!tx.bank_id) return toast.error("بانک رسید نامعتبر است");
    setSaving(true);
    try {
      const { data: ri, error } = await supabase
        .from("finance_receive_identifications")
        .insert({
          title: title || "شناسایی دریافت",
          description,
          party_id: partyId,
          bank_id: tx.bank_id,
          bank_transaction_id: txId,
          amount,
          transaction_datetime: tx.transaction_datetime,
          status: "approved",
          approved_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (error || !ri) throw error || new Error("insert failed");

      // Voucher: Debit bank, Credit party
      const v = await createVoucher({
        voucher_type: "receive_identification",
        source_operation_type: "receive_identification",
        source_operation_id: ri.id,
        title: title || "شناسایی دریافت",
        description,
        items: [
          { bank_id: tx.bank_id, account_type: "bank", debit: amount, credit: 0, description: "بانک" },
          { party_id: partyId, account_type: "party", debit: 0, credit: amount, description: "ذینفع" },
        ],
      });

      // Mark transaction assigned
      await supabase
        .from("finance_bank_transactions")
        .update({
          assignment_status: "assigned",
          assigned_operation_type: "receive_identification",
          assigned_operation_id: ri.id,
        })
        .eq("id", txId);

      // Link voucher_id back
      await supabase
        .from("finance_receive_identifications")
        .update({ voucher_id: v.id })
        .eq("id", ri.id);

      // Update party balance (creditor +)
      const { data: party } = await supabase.from("finance_parties").select("balance").eq("id", partyId).maybeSingle();
      const newBal = Number(party?.balance || 0) + Number(amount);
      await supabase.from("finance_parties").update({ balance: newBal }).eq("id", partyId);

      // Sepidar placeholder
      await sepidarSyncPlaceholder(v.id, "post_voucher");

      toast.success("شناسایی دریافت ثبت و سند داخلی صادر شد");
      setTxId(null); setTx(null); setPartyId(null); setTitle(""); setDescription("");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "خطا در ثبت");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <h2 className="text-lg font-bold">شناسایی دریافت</h2>
      <p className="text-sm text-muted-foreground">یک واریز بانکی را به ذینفع اختصاص دهید. پس از تایید، سند داخلی متوازن صادر می‌شود.</p>

      <div className="rounded-xl border bg-card p-4 space-y-4">
        <div className="space-y-1.5">
          <Label className="text-xs">۱) انتخاب رسید (واریز تخصیص نشده)</Label>
          <TransactionSelector
            value={txId}
            onChange={(id, t) => { setTxId(id); setTx(t || null); }}
            filter={{ transaction_type: "deposit", assignment_status: "unassigned" }}
            placeholder="انتخاب واریز"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">۲) انتخاب ذینفع</Label>
          <PartySelector value={partyId} onChange={setPartyId} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">۳) عنوان</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="شناسایی دریافت..." />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">توضیحات</Label>
          <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>

        <Button className="w-full" onClick={submit} disabled={saving || !txId || !partyId}>
          <CheckCircle2 className="w-4 h-4 ml-1" /> ثبت و صدور سند
        </Button>
      </div>
    </div>
  );
}
