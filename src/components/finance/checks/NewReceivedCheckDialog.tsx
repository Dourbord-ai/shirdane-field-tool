// =============================================================================
// NewReceivedCheckDialog
// -----------------------------------------------------------------------------
// Form to register a check we received from a party. The initial status is
// always "received" so the DB trigger logs the right initial event and stamps
// party_effected_at (party balance impact happens at receive-time per spec).
// =============================================================================
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import ShamsiDatePicker from "@/components/ShamsiDatePicker";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useInvalidateChecks } from "@/hooks/useChecks";
import { partyLabel } from "@/lib/checks";
import { jalaliToGregorian } from "@/lib/jalali";
import { parseMoney, formatMoney } from "@/lib/finance";

interface Props { open: boolean; onOpenChange: (v: boolean) => void }

// Shared helper — same logic as in NewCheckbookDialog. Duplicated here to
// avoid creating a one-line util file; the project keeps such tiny helpers
// inlined per dialog.
function shamsiToISODate(s: string): string | null {
  const m = s?.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (!m) return null;
  const g = jalaliToGregorian(+m[1], +m[2], +m[3]);
  return `${g.year}-${String(g.month).padStart(2, "0")}-${String(g.day).padStart(2, "0")}`;
}

export default function NewReceivedCheckDialog({ open, onOpenChange }: Props) {
  // Load the party list once — capped so the dropdown stays usable. Real
  // production code would swap this for the existing SearchableSelect, but
  // for v1 we render a native <Select> to stay simple.
  const { data: parties = [] } = useQuery({
    queryKey: ["finance_parties_for_check"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("finance_parties")
        .select("id, first_name, last_name, company_name")
        .eq("is_deleted", false)
        .order("company_name", { nullsFirst: false })
        .limit(500);
      if (error) throw error;
      return data ?? [];
    },
  });

  const [partyId, setPartyId] = useState<string>("");
  const [amount, setAmount] = useState("");
  const [checkNumber, setCheckNumber] = useState("");
  const [sayadNumber, setSayadNumber] = useState("");
  const [payerBank, setPayerBank] = useState("");
  const [payerAccount, setPayerAccount] = useState("");
  const [receiveDate, setReceiveDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const invalidate = useInvalidateChecks();

  useEffect(() => {
    if (open) {
      setPartyId(""); setAmount(""); setCheckNumber(""); setSayadNumber("");
      setPayerBank(""); setPayerAccount(""); setReceiveDate(""); setDueDate("");
      setDescription(""); setSaving(false);
    }
  }, [open]);

  async function submit() {
    const amt = parseMoney(amount);
    if (!partyId) return toast.error("طرف حساب را انتخاب کنید");
    if (amt <= 0) return toast.error("مبلغ چک باید بزرگ‌تر از صفر باشد");
    if (!checkNumber.trim()) return toast.error("شماره چک الزامی است");
    const due = shamsiToISODate(dueDate);
    if (!due) return toast.error("تاریخ سررسید الزامی است");

    setSaving(true);
    const { error } = await supabase.from("finance_checks" as never).insert({
      direction: "received",
      party_id: partyId,
      amount: amt,
      check_number: checkNumber.trim(),
      sayad_number: sayadNumber.trim() || null,
      // Payer bank is captured as free text — we don't always have a
      // finance_banks row for the other party's bank.
      bank_id: null,
      bank_account_id: payerAccount.trim() || null,
      issue_date: null,
      receive_date: shamsiToISODate(receiveDate),
      due_date: due,
      status: "received",
      description: [payerBank && `بانک پرداخت‌کننده: ${payerBank}`, description.trim()]
        .filter(Boolean).join(" — ") || null,
    } as never);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("چک دریافتی ثبت شد");
    invalidate();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader><DialogTitle>ثبت چک دریافتی</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Label>طرف حساب (پرداخت‌کننده)</Label>
            <Select value={partyId} onValueChange={setPartyId}>
              <SelectTrigger><SelectValue placeholder="انتخاب ذینفع" /></SelectTrigger>
              <SelectContent className="max-h-72">
                {parties.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{partyLabel(p)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>شماره چک</Label>
            <Input value={checkNumber} onChange={(e) => setCheckNumber(e.target.value)} />
          </div>
          <div>
            <Label>شماره صیاد</Label>
            <Input value={sayadNumber} onChange={(e) => setSayadNumber(e.target.value)} />
          </div>
          <div>
            <Label>مبلغ (ریال)</Label>
            <Input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="مثلاً 10,000,000"
              inputMode="numeric"
            />
            {amount && (
              <p className="text-[11px] text-muted-foreground mt-1 tabular-nums">
                {formatMoney(parseMoney(amount))} ریال
              </p>
            )}
          </div>
          <div>
            <Label>بانک پرداخت‌کننده</Label>
            <Input value={payerBank} onChange={(e) => setPayerBank(e.target.value)} placeholder="نام بانک" />
          </div>
          <div>
            <Label>شماره حساب</Label>
            <Input value={payerAccount} onChange={(e) => setPayerAccount(e.target.value)} />
          </div>
          <div />
          <div>
            <Label>تاریخ دریافت</Label>
            <ShamsiDatePicker value={receiveDate} onChange={setReceiveDate} placeholder="انتخاب تاریخ" />
          </div>
          <div>
            <Label>تاریخ سررسید</Label>
            <ShamsiDatePicker value={dueDate} onChange={setDueDate} placeholder="انتخاب تاریخ" />
          </div>
          <div className="col-span-2">
            <Label>توضیحات</Label>
            <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>انصراف</Button>
          <Button onClick={submit} disabled={saving}>{saving ? "در حال ثبت…" : "ثبت چک دریافتی"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
