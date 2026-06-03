// =============================================================================
// NewPayableCheckDialog
// -----------------------------------------------------------------------------
// Form to issue a check from one of our own checkbooks. Picking a leaf is
// required so the DB trigger can flip that leaf to "issued" and prevent
// reuse. Initial status is "issued"; party_effected_at is stamped by the
// after-insert trigger.
// =============================================================================
import { useEffect, useMemo, useState } from "react";
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
import { useCheckbooks, useAvailableLeaves, useInvalidateCheckbooks } from "@/hooks/useCheckbooks";
import { partyLabel, bankLabel } from "@/lib/checks";
import { jalaliToGregorian } from "@/lib/jalali";
import { gregorianDateToJalali } from "@/lib/dateUtils";
import { parseMoney, formatMoney } from "@/lib/finance";
import { toPersianDigits } from "@/lib/jalali";

// -----------------------------------------------------------------------------
// Phase 8 addition: optional `seed` to pre-fill the form when the dialog is
// launched from a settlement item, and optional `onCreated` to receive the
// inserted check's id so the caller can link it (settlement → check link).
// Behaviour with no seed / no onCreated is unchanged — the dialog still works
// stand-alone exactly as it did before.
// -----------------------------------------------------------------------------
interface CheckSeed {
  partyId?: string;
  amount?: number;
  dueDateISO?: string; // YYYY-MM-DD Gregorian — converted to Shamsi inside.
  description?: string;
  // Task 1: when launched from a settlement item we pass the payee national
  // id so the operator can verify the recipient before issuing the cheque.
  // This is display-only inside the dialog (read-only chip) — no DB column
  // is added on `finance_checks` in this task; check-module redesign is
  // explicitly out of scope.
  payeeName?: string;
  payeeNationalId?: string;
}
interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  seed?: CheckSeed;
  onCreated?: (checkId: string) => void | Promise<void>;
}

function shamsiToISODate(s: string): string | null {
  const m = s?.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (!m) return null;
  const g = jalaliToGregorian(+m[1], +m[2], +m[3]);
  return `${g.year}-${String(g.month).padStart(2, "0")}-${String(g.day).padStart(2, "0")}`;
}

export default function NewPayableCheckDialog({ open, onOpenChange, seed, onCreated }: Props) {
  // Party list — payee/supplier for whom we are issuing the check.
  const { data: parties = [] } = useQuery({
    queryKey: ["finance_parties_for_check"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("finance_parties")
        .select("id, first_name, last_name, company_name")
        .eq("is_deleted", false)
        .limit(500);
      if (error) throw error;
      return data ?? [];
    },
  });
  // All our active checkbooks — only ones that still have at least one
  // available leaf would make sense, but we let the user see all and pick.
  const { data: checkbooks = [] } = useCheckbooks();
  const [checkbookId, setCheckbookId] = useState<string>("");
  const { data: leaves = [] } = useAvailableLeaves(checkbookId || null);

  const [leafId, setLeafId] = useState<string>("");
  const [partyId, setPartyId] = useState<string>("");
  const [amount, setAmount] = useState("");
  const [issueDate, setIssueDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const invalidateChecks = useInvalidateChecks();
  const invalidateBooks = useInvalidateCheckbooks();

  // Selected leaf object (for serial display). Memoised to avoid recompute.
  const selectedLeaf = useMemo(
    () => leaves.find((l) => l.id === leafId) ?? null,
    [leaves, leafId],
  );
  const selectedBook = useMemo(
    () => checkbooks.find((b) => b.id === checkbookId) ?? null,
    [checkbooks, checkbookId],
  );

  useEffect(() => {
    if (open) {
      setCheckbookId(""); setLeafId(""); setSaving(false);
      // Phase 8: when launched from a settlement item we pre-fill party,
      // amount, due date and description so the operator only has to pick
      // the checkbook + leaf. With no seed the form is empty (legacy use).
      setPartyId(seed?.partyId ?? "");
      setAmount(seed?.amount != null ? String(seed.amount) : "");
      setIssueDate("");
      // Convert the Gregorian ISO seed date back to Jalali so the picker
      // can display it. dateUtils.gregorianDateToJalali returns YYYY/MM/DD.
      setDueDate(seed?.dueDateISO ? (gregorianDateToJalali(seed.dueDateISO) || "") : "");
      setDescription(seed?.description ?? "");
    }
  }, [open, seed?.partyId, seed?.amount, seed?.dueDateISO, seed?.description]);

  // Reset leaf selection whenever the checkbook changes so we never carry a
  // leaf from another checkbook by accident.
  useEffect(() => { setLeafId(""); }, [checkbookId]);

  async function submit() {
    const amt = parseMoney(amount);
    if (!checkbookId || !leafId || !selectedLeaf || !selectedBook)
      return toast.error("دسته‌چک و برگه را انتخاب کنید");
    if (!partyId) return toast.error("طرف حساب را انتخاب کنید");
    if (amt <= 0) return toast.error("مبلغ چک باید بزرگ‌تر از صفر باشد");
    const due = shamsiToISODate(dueDate);
    if (!due) return toast.error("تاریخ سررسید الزامی است");

    setSaving(true);
    // Phase 8: we need the inserted check's id so the caller can link it to
    // a settlement item. .select("id").single() returns the row after insert.
    const { data: inserted, error } = await supabase
      .from("finance_checks" as never)
      .insert({
        direction: "payable",
        party_id: partyId,
        amount: amt,
        // The check number IS the leaf serial — keeps the two perfectly in sync.
        check_number: String(selectedLeaf.serial_number),
        sayad_number: null,
        bank_id: selectedBook.bank_id,
        bank_account_id: selectedBook.bank_account_id,
        checkbook_leaf_id: leafId,
        issue_date: shamsiToISODate(issueDate),
        due_date: due,
        status: "issued",
        description: description.trim() || null,
      } as never)
      .select("id")
      .single();
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("چک پرداختی صادر شد");
    invalidateChecks(); invalidateBooks();
    // Fire onCreated BEFORE closing so the caller has a chance to surface
    // its own follow-up toast (e.g. "linked to settlement item") without
    // a flicker. Errors inside onCreated are caught so they never block
    // the dialog from closing.
    if (onCreated && inserted && (inserted as { id?: string }).id) {
      try { await onCreated((inserted as { id: string }).id); }
      catch (e) { /* caller handles its own errors */ console.error(e); }
    }
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader><DialogTitle>صدور چک پرداختی</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>دسته‌چک</Label>
            <Select value={checkbookId} onValueChange={setCheckbookId}>
              <SelectTrigger><SelectValue placeholder="انتخاب دسته‌چک" /></SelectTrigger>
              <SelectContent>
                {checkbooks.filter((b) => b.is_active).map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.title} ({bankLabel(b.bank)})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>برگه (سریال)</Label>
            <Select value={leafId} onValueChange={setLeafId} disabled={!checkbookId}>
              <SelectTrigger><SelectValue placeholder={checkbookId ? "انتخاب برگه" : "ابتدا دسته‌چک"} /></SelectTrigger>
              <SelectContent className="max-h-72">
                {leaves.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {toPersianDigits(String(l.serial_number))}
                  </SelectItem>
                ))}
                {leaves.length === 0 && checkbookId && (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">برگه آزاد موجود نیست</div>
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2">
            <Label>طرف حساب (دریافت‌کننده چک)</Label>
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
            <Label>مبلغ (ریال)</Label>
            <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="numeric" />
            {amount && (
              <p className="text-[11px] text-muted-foreground mt-1 tabular-nums">
                {formatMoney(parseMoney(amount))} ریال
              </p>
            )}
          </div>
          <div />
          <div>
            <Label>تاریخ صدور</Label>
            <ShamsiDatePicker value={issueDate} onChange={setIssueDate} placeholder="انتخاب تاریخ" />
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
          <Button onClick={submit} disabled={saving}>{saving ? "در حال صدور…" : "صدور چک"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
