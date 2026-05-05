import FertilityValidationAlert from "@/components/livestock/FertilityValidationAlert";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import JalaliDatePicker from "@/components/JalaliDatePicker";
import { JalaliDate, formatJalali, todayJalali } from "@/lib/jalali";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

type AppUser = { id: string; full_name: string | null; username: string };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  livestockId: number;
  onSuccess?: () => void;
};

type ResultValue = "positive" | "under_treatment";

const RESULT_LABELS: Record<ResultValue, string> = {
  positive: "مثبت",
  under_treatment: "تحت درمان",
};

const RESULT_STATUS_CODE: Record<ResultValue, number> = {
  positive: 15,
  under_treatment: 16,
};

export default function CleanTestRegistrationDialog({
  open,
  onOpenChange,
  livestockId,
  onSuccess,
}: Props) {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loadingLookups, setLoadingLookups] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [validationMessages, setValidationMessages] = useState<string[]>([]);

  const [visitorId, setVisitorId] = useState<string>("");
  const [result, setResult] = useState<ResultValue | "">("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState<JalaliDate | null>(todayJalali());
  const [time, setTime] = useState<string>("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    async function load() {
      setLoadingLookups(true);
      const { data: usersData } = await supabase
        .from("app_users")
        .select("id, full_name, username")
        .eq("is_active", true)
        .order("full_name");
      if (!cancelled) {
        setUsers(((usersData as any[]) ?? []) as AppUser[]);
        setLoadingLookups(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [open]);

  function reset() {
    setVisitorId("");
    setResult("");
    setDescription("");
    setDate(todayJalali());
    setTime("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!visitorId) return toast.error("بازدید کننده را انتخاب کنید");
    if (!result) return toast.error("نتیجه کلین تست را انتخاب کنید");
    if (!date) return toast.error("تاریخ کلین تست را انتخاب کنید");
    if (!time) return toast.error("ساعت کلین تست را وارد کنید");

    setSubmitting(true);

    setValidationMessages([]);
    const selectedUser = users.find((u) => String(u.id) === visitorId);
    const dateStr = formatJalali(date);
    const eventDate = `${dateStr} ${time}`;
    const operatorName = selectedUser?.full_name ?? selectedUser?.username ?? null;

    const metadata = {
      clean_test_result: result,
      clean_test_result_label: RESULT_LABELS[result],
      time,
      operator_name: operatorName,
    };

    const { checkFertilityOperation } = await import("@/lib/fertilityValidation");
    const validation = await checkFertilityOperation({
      livestock_id: livestockId,
      fertility_operation_id: 10,
      event_date: eventDate,
      event_time: time || null,
      result_code: String(RESULT_STATUS_CODE[result]),
      fertility_status_id: RESULT_STATUS_CODE[result],
    });
    if (!validation.ok) {
      setSubmitting(false);
      setValidationMessages(validation.messages);
      return;
    }
    (metadata as any).matched_rule_id = validation.matched_rule_id ?? null;

    const { error } = await supabase.from("livestock_fertility_events" as any).insert({
      livestock_id: livestockId,
      event_type: "clean_test",
      fertility_operation_id: 10,
      event_date: eventDate,
      operator_user_id: null,
      operator_name: operatorName,
      notes: description || null,
      status_code: RESULT_STATUS_CODE[result],
      result: RESULT_LABELS[result],
      legacy_table_name: "manual",
      legacy_record_id: null,
      metadata,
    });

    setSubmitting(false);

    if (error) {
      toast.error("خطا در ثبت کلین تست: " + error.message);
      return;
    }

    toast.success("کلین تست با موفقیت ثبت شد");
    reset();
    onOpenChange(false);
    onSuccess?.();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-right">ثبت کلین تست</DialogTitle>
          <DialogDescription className="text-right">
            اطلاعات کلین تست این دام را وارد کنید
          </DialogDescription>
        </DialogHeader>

        {loadingLookups ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Visitor */}
            <div className="space-y-1.5">
              <Label>
                بازدید کننده <span className="text-destructive">*</span>
              </Label>
              <Select value={visitorId} onValueChange={setVisitorId} dir="rtl">
                <SelectTrigger>
                  <SelectValue placeholder="انتخاب کنید" />
                </SelectTrigger>
                <SelectContent>
                  {users.map((u) => (
                    <SelectItem key={u.id} value={String(u.id)}>
                      {u.full_name || u.username}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Result */}
            <div className="space-y-1.5">
              <Label>
                نتیجه <span className="text-destructive">*</span>
              </Label>
              <RadioGroup
                value={result}
                onValueChange={(v) => setResult(v as ResultValue)}
                className="flex gap-4"
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="positive" id="ct-positive" />
                  <Label htmlFor="ct-positive" className="cursor-pointer">
                    مثبت
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="under_treatment" id="ct-under-treatment" />
                  <Label htmlFor="ct-under-treatment" className="cursor-pointer">
                    تحت درمان
                  </Label>
                </div>
              </RadioGroup>
            </div>

            {/* Date + Time */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="mb-1.5 block">
                  تاریخ کلین تست <span className="text-destructive">*</span>
                </Label>
                <JalaliDatePicker value={date} onChange={setDate} />
              </div>
              <div className="space-y-1.5">
                <Label>
                  ساعت کلین تست <span className="text-destructive">*</span>
                </Label>
                <Input
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  dir="ltr"
                  className="text-left"
                />
              </div>
            </div>

            {/* Description */}
            <div className="space-y-1.5">
              <Label>توضیحات</Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="اختیاری"
                rows={3}
              />
            </div>

            <FertilityValidationAlert messages={validationMessages} />
            <div className="flex gap-2 pt-2">
              <Button type="submit" disabled={submitting} className="flex-1">
                {submitting && <Loader2 className="w-4 h-4 animate-spin ml-2" />}
                ثبت کلین تست
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={submitting}
              >
                انصراف
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
