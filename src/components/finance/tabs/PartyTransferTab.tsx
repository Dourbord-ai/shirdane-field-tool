import { useState } from "react";
import { toastFinanceError } from "@/lib/financeErrors";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PartySelector } from "@/components/finance/selectors";
import { createVoucher, sepidarSyncPlaceholder, parseMoney } from "@/lib/finance";
import { toast } from "sonner";
import { CheckCircle2 } from "lucide-react";

export default function PartyTransferTab() {
  const [fromParty, setFromParty] = useState<string | null>(null);
  const [toParty, setToParty] = useState<string | null>(null);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!fromParty) return toast.error("ذینفع بستانکار را انتخاب کنید");
    if (!toParty) return toast.error("ذینفع بدهکار را انتخاب کنید");
    if (fromParty === toParty) return toast.error("ذینفع‌ها نمی‌توانند یکسان باشند");
    const amt = parseMoney(amount);
    if (amt <= 0) return toast.error("مبلغ نامعتبر");
    setSaving(true);
    try {
      const { data: pt, error } = await supabase
        .from("finance_party_transfers")
        .insert({
          from_party_id: fromParty,
          to_party_id: toParty,
          amount: amt,
          transfer_datetime: new Date(date).toISOString(),
          title,
          description,
          status: "approved",
          approved_at: new Date().toISOString(),
        })
        .select("id").single();
      if (error || !pt) throw error || new Error("insert failed");

      const v = await createVoucher({
        voucher_type: "party_transfer",
        source_operation_type: "party_transfer",
        source_operation_id: pt.id,
        title: title || "انتقال بین ذینفع",
        description,
        items: [
          { party_id: toParty, account_type: "party", debit: amt, credit: 0, description: "ذینفع بدهکار" },
          { party_id: fromParty, account_type: "party", debit: 0, credit: amt, description: "ذینفع بستانکار" },
        ],
      });

      await supabase.from("finance_party_transfers").update({ voucher_id: v.id }).eq("id", pt.id);

      // Update balances
      const [{ data: from }, { data: to }] = await Promise.all([
        supabase.from("finance_parties").select("balance").eq("id", fromParty).maybeSingle(),
        supabase.from("finance_parties").select("balance").eq("id", toParty).maybeSingle(),
      ]);
      await Promise.all([
        supabase.from("finance_parties").update({ balance: Number(from?.balance || 0) - amt }).eq("id", fromParty),
        supabase.from("finance_parties").update({ balance: Number(to?.balance || 0) + amt }).eq("id", toParty),
      ]);

      await sepidarSyncPlaceholder(v.id, "post_voucher");

      toast.success("انتقال ثبت و سند داخلی صادر شد");
      setFromParty(null); setToParty(null); setAmount(""); setTitle(""); setDescription("");
    } catch (e: unknown) {
      toastFinanceError(toast, e);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <h2 className="text-lg font-bold">انتقال بین ذینفع</h2>

      <div className="rounded-xl border bg-card p-4 space-y-4">
        <div className="space-y-1.5">
          <Label className="text-xs">از ذینفع (بستانکار)</Label>
          <PartySelector value={fromParty} onChange={setFromParty} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">به ذینفع (بدهکار)</Label>
          <PartySelector value={toParty} onChange={setToParty} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label className="text-xs">تاریخ جابه‌جایی</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">مبلغ</Label>
            <Input dir="ltr" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">بابت</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">توضیحات</Label>
          <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <Button className="w-full" onClick={submit} disabled={saving}>
          <CheckCircle2 className="w-4 h-4 ml-1" /> ثبت و صدور سند
        </Button>
      </div>
    </div>
  );
}
