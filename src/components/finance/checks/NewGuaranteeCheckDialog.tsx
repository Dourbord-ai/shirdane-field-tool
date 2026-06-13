// =============================================================================
// NewGuaranteeCheckDialog
// -----------------------------------------------------------------------------
// Registers a guarantee check (چک ضمانتی). These checks are tracking-only —
// they DO NOT create accounting vouchers and DO NOT touch party or bank
// balances. The DB enforces this via category='guarantee'.
//
// The user can pick the direction (received from a party as security, or
// issued by us as our guarantee to a party) plus the guarantee metadata.
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

// Shared helper — converts a Shamsi date string (yyyy/m/d) to an ISO
// Gregorian date used by Postgres. Returns null on bad input.
function shamsiToISODate(s: string): string | null {
  const m = s?.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (!m) return null;
  const g = jalaliToGregorian(+m[1], +m[2], +m[3]);
  return `${g.year}-${String(g.month).padStart(2, "0")}-${String(g.day).padStart(2, "0")}`;
}

export default function NewGuaranteeCheckDialog({ open, onOpenChange }: Props) {
  // Load parties and banks once for the dropdowns. Same pattern as the
  // received/payable dialogs to stay consistent.
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

  // Form state — kept as local primitives so the dialog stays self-contained.
  const [direction, setDirection] = useState<"received" | "payable">("received");
  const [partyId, setPartyId] = useState("");
  const [amount, setAmount] = useState("");
  const [checkNumber, setCheckNumber] = useState("");
  const [sayadNumber, setSayadNumber] = useState("");
  const [bankId, setBankId] = useState("");
  const [bankAccount, setBankAccount] = useState("");
  const [issueDate, setIssueDate] = useState("");
  const [expiry, setExpiry] = useState("");
  const [subject, setSubject] = useState("");
  const [contract, setContract] = useState("");
  const [project, setProject] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const invalidate = useInvalidateChecks();

  // Reset every time the dialog opens so a re-open shows a clean form.
  useEffect(() => {
    if (open) {
      setDirection("received");
      setPartyId(""); setAmount(""); setCheckNumber(""); setSayadNumber("");
      setBankId(""); setBankAccount(""); setIssueDate(""); setExpiry("");
      setSubject(""); setContract(""); setProject(""); setDescription("");
      setSaving(false);
    }
  }, [open]);

  async function submit() {
    const amt = parseMoney(amount);
    // Basic validation — mirrors the received/payable dialogs.
    if (!partyId) return toast.error("ذینفع را انتخاب کنید");
    if (amt <= 0) return toast.error("مبلغ چک باید بزرگ‌تر از صفر باشد");
    if (!checkNumber.trim()) return toast.error("شماره چک الزامی است");
    const issue = shamsiToISODate(issueDate);
    if (!issue) return toast.error("تاریخ چک الزامی است");

    setSaving(true);
    // due_date is NOT NULL on the table — guarantee checks reuse the
    // expiry date (if provided) or the issue date so we always have a value.
    const exp = shamsiToISODate(expiry);
    const { error } = await supabase.from("finance_checks" as never).insert({
      // category='guarantee' tells the trigger to skip voucher posting.
      category: "guarantee",
      direction,
      party_id: partyId,
      amount: amt,
      check_number: checkNumber.trim(),
      sayad_number: sayadNumber.trim() || null,
      bank_id: bankId || null,
      bank_account_id: bankAccount.trim() || null,
      issue_date: issue,
      due_date: exp ?? issue,
      // Status starts as 'active' — the new guarantee lifecycle state.
      status: "active",
      // Guarantee metadata.
      expiry_date: exp,
      guarantee_subject: subject.trim() || null,
      related_contract: contract.trim() || null,
      related_project: project.trim() || null,
      description: description.trim() || null,
    } as never);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("چک ضمانتی ثبت شد");
    invalidate();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>ثبت چک ضمانتی</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          {/* Direction picker — guarantee checks can flow either way. */}
          <div>
            <Label>نوع</Label>
            <Select value={direction} onValueChange={(v) => setDirection(v as "received" | "payable")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="received">دریافت از طرف حساب</SelectItem>
                <SelectItem value="payable">صادر شده توسط ما</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>ذینفع / طرف حساب</Label>
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
            <Label>تاریخ انقضا (اختیاری)</Label>
            <ShamsiDatePicker value={expiry} onChange={setExpiry} placeholder="انتخاب تاریخ" />
          </div>
          <div className="col-span-2">
            <Label>موضوع ضمانت</Label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="مثلاً ضمانت حسن انجام کار" />
          </div>
          <div>
            <Label>قرارداد مرتبط</Label>
            <Input value={contract} onChange={(e) => setContract(e.target.value)} />
          </div>
          <div>
            <Label>پروژه مرتبط</Label>
            <Input value={project} onChange={(e) => setProject(e.target.value)} />
          </div>
          <div className="col-span-2">
            <Label>توضیحات</Label>
            <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>انصراف</Button>
          <Button onClick={submit} disabled={saving}>{saving ? "در حال ثبت…" : "ثبت چک ضمانتی"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
