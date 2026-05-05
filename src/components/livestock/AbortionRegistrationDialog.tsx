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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import JalaliDatePicker from "@/components/JalaliDatePicker";
import { JalaliDate, formatJalali, todayJalali } from "@/lib/jalali";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  livestockId: number;
  onSuccess?: () => void;
};

export default function AbortionRegistrationDialog({
  open,
  onOpenChange,
  livestockId,
  onSuccess,
}: Props) {
  const [loadingLookups, setLoadingLookups] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [validationMessages, setValidationMessages] = useState<string[]>([]);

  const [defaultPeriod, setDefaultPeriod] = useState<number>(1);
  const [useDefaultPeriod, setUseDefaultPeriod] = useState(true);
  const [period, setPeriod] = useState<number>(1);
  const [isMilking, setIsMilking] = useState(false);
  const [description, setDescription] = useState("");
  const [date, setDate] = useState<JalaliDate | null>(todayJalali());
  const [time, setTime] = useState<string>("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoadingLookups(true);
      // derive default period from latest calving/abortion
      const { data } = await supabase
        .from("livestock_fertility_events" as any)
        .select("event_type, metadata, event_date")
        .eq("livestock_id", livestockId)
        .in("event_type", ["calving", "abortion"])
        .order("event_date", { ascending: false })
        .limit(1);
      if (cancelled) return;
      let computed = 1;
      const last = (data as any[])?.[0];
      if (last) {
        const p = Number(last?.metadata?.period);
        if (!isNaN(p) && p > 0) {
          computed = last.event_type === "calving" ? p + 1 : p;
        }
      }
      setDefaultPeriod(computed);
      setPeriod(computed);
      setUseDefaultPeriod(true);
      setLoadingLookups(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, livestockId]);

  function reset() {
    setDescription("");
    setDate(todayJalali());
    setTime("");
    setIsMilking(false);
    setUseDefaultPeriod(true);
    setPeriod(defaultPeriod);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const finalPeriod = useDefaultPeriod ? defaultPeriod : Number(period);
    if (!finalPeriod || finalPeriod < 1) return toast.error("دوره زایش معتبر نیست");
    if (!date) return toast.error("تاریخ سقط را انتخاب کنید");
    if (!time) return toast.error("ساعت سقط را وارد کنید");

    setSubmitting(true);

    setValidationMessages([]);
    const eventDate = `${formatJalali(date)} ${time}`;
    const metadata = {
      period: finalPeriod,
      is_default_period: useDefaultPeriod,
      is_milking_after_abortion: isMilking,
      is_dry_after_abortion: !isMilking,
      time,
    };

    const { checkFertilityOperation } = await import("@/lib/fertilityValidation");
    const validation = await checkFertilityOperation({
      livestock_id: livestockId,
      fertility_operation_id: 5,
      event_date: eventDate,
      event_time: time || null,
      fertility_status_id: 9,
    });
    if (!validation.ok) {
      setSubmitting(false);
      setValidationMessages(validation.messages);
      return;
    }
    (metadata as any).matched_rule_id = validation.matched_rule_id ?? null;

    const { error } = await supabase.from("livestock_fertility_events" as any).insert({
      livestock_id: livestockId,
      event_type: "abortion",
      fertility_operation_id: 5,
      event_date: eventDate,
      notes: description || null,
      status_code: 9,
      legacy_table_name: "manual",
      legacy_record_id: null,
      metadata,
    });

    if (error) {
      setSubmitting(false);
      toast.error("خطا در ثبت سقط: " + error.message);
      return;
    }

    // Update cow current state
    const { error: cowErr } = await supabase
      .from("cows")
      .update({
        last_fertility_status: 9,
        is_dry: !isMilking,
      })
      .eq("id", livestockId);

    setSubmitting(false);

    if (cowErr) {
      toast.error("سقط ثبت شد ولی به‌روزرسانی دام انجام نشد: " + cowErr.message);
    } else {
      toast.success("سقط با موفقیت ثبت شد");
    }

    reset();
    onOpenChange(false);
    onSuccess?.();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-right">ثبت سقط</DialogTitle>
          <DialogDescription className="text-right">
            اطلاعات سقط جنین این دام را وارد کنید
          </DialogDescription>
        </DialogHeader>

        {loadingLookups ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Default period checkbox */}
            <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 p-2.5">
              <Checkbox
                id="ab-default-period"
                checked={useDefaultPeriod}
                onCheckedChange={(v) => {
                  const checked = v === true;
                  setUseDefaultPeriod(checked);
                  if (checked) setPeriod(defaultPeriod);
                }}
              />
              <Label htmlFor="ab-default-period" className="cursor-pointer text-sm">
                دوره پیش‌فرض ({defaultPeriod.toLocaleString("fa-IR")})
              </Label>
            </div>

            {/* Period */}
            <div className="space-y-1.5">
              <Label>
                دوره زایش <span className="text-destructive">*</span>
              </Label>
              <Input
                type="number"
                min={1}
                value={period}
                onChange={(e) => setPeriod(Number(e.target.value))}
                disabled={useDefaultPeriod}
                dir="ltr"
                className="text-left"
              />
            </div>

            {/* Milking status */}
            <div className="flex items-start gap-2 rounded-md border border-border p-2.5">
              <Checkbox
                id="ab-milking"
                checked={isMilking}
                onCheckedChange={(v) => setIsMilking(v === true)}
                className="mt-0.5"
              />
              <div className="space-y-0.5">
                <Label htmlFor="ab-milking" className="cursor-pointer text-sm">
                  این گاو دوشا است
                </Label>
                <p className="text-[11px] text-muted-foreground">
                  در صورت تیک خوردن، دام بعد از سقط دوشا در نظر گرفته می‌شود؛ در غیر این صورت خشک
                  محسوب می‌شود.
                </p>
              </div>
            </div>

            {/* Date + Time */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="mb-1.5 block">
                  تاریخ سقط <span className="text-destructive">*</span>
                </Label>
                <JalaliDatePicker value={date} onChange={setDate} />
              </div>
              <div className="space-y-1.5">
                <Label>
                  ساعت سقط <span className="text-destructive">*</span>
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
              <Label>توضیحات تکمیلی</Label>
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
                ثبت سقط
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
