// =============================================================================
// NewCheckbookDialog
// -----------------------------------------------------------------------------
// Form to register a new checkbook owned by the company. Picks the bank,
// records the serial range, and persists the row — the DB trigger then
// auto-creates one finance_checkbook_leaves row per serial inside the range.
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
import { useInvalidateCheckbooks } from "@/hooks/useCheckbooks";
import { bankLabel } from "@/lib/checks";
import { jalaliToGregorian } from "@/lib/jalali";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

// Convert "YYYY/MM/DD" Shamsi → "YYYY-MM-DD" Gregorian for date columns.
// Returns null when empty/invalid so callers can skip the field.
function shamsiToISODate(s: string): string | null {
  const m = s?.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (!m) return null;
  const g = jalaliToGregorian(+m[1], +m[2], +m[3]);
  return `${g.year}-${String(g.month).padStart(2, "0")}-${String(g.day).padStart(2, "0")}`;
}

export default function NewCheckbookDialog({ open, onOpenChange }: Props) {
  // Pull only "cheque-enabled" banks for the picker — these are the banks
  // for which we'd realistically own a checkbook. We still fall back to
  // is_active=true so newer banks not yet flagged can also be selected.
  const { data: banks = [] } = useQuery({
    queryKey: ["finance_banks_for_checkbook"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("finance_banks")
        .select("id, title, bank_name, account_number, is_cheque, is_active")
        .eq("is_active", true)
        .order("title");
      if (error) throw error;
      return data ?? [];
    },
  });

  const [bankId, setBankId] = useState<string>("");
  const [title, setTitle] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [issuedAt, setIssuedAt] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const invalidate = useInvalidateCheckbooks();

  // Reset every time the dialog reopens so stale values from a previous
  // attempt don't bleed into a fresh form.
  useEffect(() => {
    if (open) {
      setBankId(""); setTitle(""); setStart(""); setEnd("");
      setIssuedAt(""); setDescription(""); setSaving(false);
    }
  }, [open]);

  async function submit() {
    // Defensive validation — the DB CHECK constraint enforces the range too,
    // but a friendly toast is much nicer than a 500 from PostgREST.
    if (!bankId) return toast.error("بانک را انتخاب کنید");
    if (!title.trim()) return toast.error("عنوان دسته‌چک الزامی است");
    const s = Number(start); const e = Number(end);
    if (!Number.isFinite(s) || !Number.isFinite(e) || e < s) {
      return toast.error("سریال شروع/پایان معتبر نیست");
    }
    if (e - s > 200) {
      return toast.error("بازه سریال غیرمنطقی است (حداکثر ۲۰۰ برگ)");
    }
    setSaving(true);
    const { error } = await supabase.from("finance_checkbooks" as never).insert({
      bank_id: bankId,
      title: title.trim(),
      start_serial: s,
      end_serial: e,
      issued_at: shamsiToISODate(issuedAt),
      description: description.trim() || null,
    } as never);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("دسته‌چک ثبت شد و برگه‌ها به‌صورت خودکار تولید شدند");
    invalidate();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>افزودن دسته‌چک</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {/* Bank picker — required FK. */}
          <div>
            <Label>بانک</Label>
            <Select value={bankId} onValueChange={setBankId}>
              <SelectTrigger><SelectValue placeholder="انتخاب بانک" /></SelectTrigger>
              <SelectContent>
                {banks.map((b) => (
                  <SelectItem key={b.id} value={b.id}>{bankLabel(b)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>عنوان دسته‌چک</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="مثلاً دسته‌چک ملت ۱۰۲۳" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>سریال شروع</Label>
              <Input inputMode="numeric" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div>
              <Label>سریال پایان</Label>
              <Input inputMode="numeric" value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
          </div>
          <div>
            <Label>تاریخ دریافت</Label>
            <ShamsiDatePicker value={issuedAt} onChange={setIssuedAt} placeholder="انتخاب تاریخ" />
          </div>
          <div>
            <Label>توضیحات</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>انصراف</Button>
          <Button onClick={submit} disabled={saving}>{saving ? "در حال ثبت…" : "ثبت دسته‌چک"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
