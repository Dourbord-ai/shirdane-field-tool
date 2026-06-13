// =============================================================================
// NewCancelledCheckDialog
// -----------------------------------------------------------------------------
// Direct registration form for a cancelled check (چک ابطالی). Users register
// these without first creating a normal check — exactly per spec.
//
// Cancelled checks DO NOT create vouchers and DO NOT affect any balance.
// The DB enforces immutability via the status guard.
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
import { partyLabel, CANCEL_REASONS } from "@/lib/checks";
import { jalaliToGregorian } from "@/lib/jalali";
import { parseMoney, formatMoney } from "@/lib/finance";

interface Props { open: boolean; onOpenChange: (v: boolean) => void }

// Shamsi → ISO conversion helper (same as the other check dialogs).
function shamsiToISODate(s: string): string | null {
  const m = s?.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (!m) return null;
  const g = jalaliToGregorian(+m[1], +m[2], +m[3]);
  return `${g.year}-${String(g.month).padStart(2, "0")}-${String(g.day).padStart(2, "0")}`;
}

export default function NewCancelledCheckDialog({ open, onOpenChange }: Props) {
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
  const { data: banks = [] } = useQuery({
    queryKey: ["finance_banks_for_check"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("finance_banks")
        .select("id, title, bank_name")
        .order("title", { nullsFirst: false })
        .limit(200);
      if (error) throw error;
      return data ?? [];
    },
  });

  // Local form state. We default direction to 'received' because the most
  // common cancellation use-case is a customer check we never deposited.
  const [direction, setDirection] = useState<"received" | "payable">("received");
  const [partyId, setPartyId] = useState("");
  const [amount, setAmount] = useState("");
  const [checkNumber, setCheckNumber] = useState("");
  const [sayadNumber, setSayadNumber] = useState("");
  const [bankId, setBankId] = useState("");
  const [bankAccount, setBankAccount] = useState("");
  const [issueDate, setIssueDate] = useState("");
  const [cancelDate, setCancelDate] = useState("");
  const [reason, setReason] = useState<string>("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const invalidate = useInvalidateChecks();

  useEffect(() => {
    if (open) {
      setDirection("received");
      setPartyId(""); setAmount(""); setCheckNumber(""); setSayadNumber("");
      setBankId(""); setBankAccount(""); setIssueDate(""); setCancelDate("");
      setReason(""); setDescription(""); setSaving(false);
    }
  }, [open]);

  async function submit() {
    const amt = parseMoney(amount);
    if (!partyId) return toast.error("ذینفع را انتخاب کنید");
    if (amt <= 0) return toast.error("مبلغ چک باید بزرگ‌تر از صفر باشد");
    if (!checkNumber.trim()) return toast.error("شماره چک الزامی است");
    if (!reason) return toast.error("علت ابطال را انتخاب کنید");
    const issue = shamsiToISODate(issueDate);
    if (!issue) return toast.error("تاریخ چک الزامی است");
    const cancel = shamsiToISODate(cancelDate) ?? issue;

    setSaving(true);
    const { error } = await supabase.from("finance_checks" as never).insert({
      // category='cancelled' + status='cancelled' — the trigger will skip
      // voucher posting and the guard will lock the row immutable.
      category: "cancelled",
      direction,
      party_id: partyId,
      amount: amt,
      check_number: checkNumber.trim(),
      sayad_number: sayadNumber.trim() || null,
      bank_id: bankId || null,
      bank_account_id: bankAccount.trim() || null,
      issue_date: issue,
      // due_date is NOT NULL on the table; reuse the issue date for
      // cancelled checks since they will never reach a real due date.
      due_date: issue,
      status: "cancelled",
      cancelled_date: cancel,
      cancel_reason: reason,
      description: description.trim() || null,
    } as never);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("چک ابطالی ثبت شد");
    invalidate();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>ثبت چک ابطالی</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>نوع</Label>
            <Select value={direction} onValueChange={(v) => setDirection(v as "received" | "payable")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="received">دریافتی</SelectItem>
                <SelectItem value="payable">پرداختی</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>ذینفع</Label>
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
            <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="numeric" placeholder="مثلاً 10,000,000" />
            {amount && (
              <p className="text-[11px] text-muted-foreground mt-1 tabular-nums">
                {formatMoney(parseMoney(amount))} ریال
              </p>
            )}
          </div>
          <div>
            <Label>بانک</Label>
            <Select value={bankId} onValueChange={setBankId}>
              <SelectTrigger><SelectValue placeholder="انتخاب بانک" /></SelectTrigger>
              <SelectContent className="max-h-72">
                {banks.map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.title || b.bank_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>حساب بانکی</Label>
            <Input value={bankAccount} onChange={(e) => setBankAccount(e.target.value)} />
          </div>
          <div>
            <Label>تاریخ چک</Label>
            <ShamsiDatePicker value={issueDate} onChange={setIssueDate} placeholder="انتخاب تاریخ" />
          </div>
          <div>
            <Label>تاریخ ابطال</Label>
            <ShamsiDatePicker value={cancelDate} onChange={setCancelDate} placeholder="انتخاب تاریخ" />
          </div>
          <div className="col-span-2">
            <Label>علت ابطال</Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger><SelectValue placeholder="انتخاب علت" /></SelectTrigger>
              <SelectContent>
                {CANCEL_REASONS.map((r) => (
                  <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2">
            <Label>توضیحات</Label>
            <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>انصراف</Button>
          <Button onClick={submit} disabled={saving}>{saving ? "در حال ثبت…" : "ثبت چک ابطالی"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
