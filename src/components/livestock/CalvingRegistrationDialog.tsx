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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import JalaliDatePicker from "@/components/JalaliDatePicker";
import { JalaliDate, formatJalali, todayJalali } from "@/lib/jalali";
import { toast } from "sonner";
import { Loader2, Upload, X } from "lucide-react";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  livestockId: number;
  onSuccess?: () => void;
};

type PhysicalStatus = "healthy" | "defective" | "dead";
type Gender = "male" | "female";
type CalfRecordType = "new" | "existing";

type CalfState = {
  physical_status: PhysicalStatus;
  gender: Gender;
  calf_record_type: CalfRecordType;
  body_number: string;
  ear_number: string;
  birth_weight: string;
  notes: string;
  imageFile: File | null;
  imageUrl: string;
};

const PHYSICAL_LABELS: Record<PhysicalStatus, string> = {
  healthy: "سالم",
  defective: "معیوب",
  dead: "فوتی",
};
const GENDER_LABELS: Record<Gender, string> = {
  male: "نر",
  female: "ماده",
};
const CONDITION_OPTIONS = [
  { value: "normal", label: "معمولی" },
  { value: "easy", label: "آسان" },
  { value: "hard_1", label: "سخت ۱" },
  { value: "hard_2", label: "سخت ۲" },
  { value: "severe_dystocia", label: "سخت‌زایی شدید" },
] as const;

function emptyCalf(): CalfState {
  return {
    physical_status: "healthy",
    gender: "female",
    calf_record_type: "new",
    body_number: "",
    ear_number: "",
    birth_weight: "",
    notes: "",
    imageFile: null,
    imageUrl: "",
  };
}

export default function CalvingRegistrationDialog({
  open,
  onOpenChange,
  livestockId,
  onSuccess,
}: Props) {
  const [loadingLookups, setLoadingLookups] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [validationMessages, setValidationMessages] = useState<string[]>([]);

  const [calfCount, setCalfCount] = useState<number>(1);
  const [calves, setCalves] = useState<CalfState[]>([emptyCalf()]);

  const [date, setDate] = useState<JalaliDate | null>(todayJalali());
  const [time, setTime] = useState<string>("");
  const [caregiver, setCaregiver] = useState("");
  const [isHelped, setIsHelped] = useState<"yes" | "no">("no");
  const [condition, setCondition] = useState<string>("normal");
  const [defaultPeriod, setDefaultPeriod] = useState<number>(1);
  const [useDefaultPeriod, setUseDefaultPeriod] = useState(true);
  const [period, setPeriod] = useState<number>(1);
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoadingLookups(true);
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

  // Sync calves array length with calfCount
  useEffect(() => {
    setCalves((prev) => {
      if (prev.length === calfCount) return prev;
      if (prev.length < calfCount) {
        return [...prev, ...Array.from({ length: calfCount - prev.length }, emptyCalf)];
      }
      return prev.slice(0, calfCount);
    });
  }, [calfCount]);

  function updateCalf(idx: number, patch: Partial<CalfState>) {
    setCalves((prev) => prev.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  }

  function reset() {
    setDescription("");
    setDate(todayJalali());
    setTime("");
    setCaregiver("");
    setIsHelped("no");
    setCondition("normal");
    setUseDefaultPeriod(true);
    setPeriod(defaultPeriod);
    setCalfCount(1);
    setCalves([emptyCalf()]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!date) return toast.error("تاریخ زایش را انتخاب کنید");
    if (!time) return toast.error("ساعت زایش را وارد کنید");
    const finalPeriod = useDefaultPeriod ? defaultPeriod : Number(period);
    if (!finalPeriod || finalPeriod < 1) return toast.error("دوره زایش معتبر نیست");

    for (let i = 0; i < calves.length; i++) {
      const c = calves[i];
      if (c.calf_record_type === "new") {
        if (!c.body_number.trim())
          return toast.error(`گوساله ${i + 1}: شماره بدن الزامی است`);
        if (!c.ear_number.trim())
          return toast.error(`گوساله ${i + 1}: شماره گوش الزامی است`);
      }
    }

    setSubmitting(true);

    setValidationMessages([]);
    // Upload calf images if provided
    const calvesMeta: any[] = [];
    for (let i = 0; i < calves.length; i++) {
      const c = calves[i];
      let imageUrl = c.imageUrl || "";
      if (c.imageFile) {
        const ext = c.imageFile.name.split(".").pop() || "jpg";
        const path = `calves/${livestockId}/${Date.now()}-${i}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("cow-factor-images")
          .upload(path, c.imageFile, { upsert: true });
        if (!upErr) {
          const { data: pub } = supabase.storage.from("cow-factor-images").getPublicUrl(path);
          imageUrl = pub.publicUrl;
        }
      }
      calvesMeta.push({
        index: i + 1,
        physical_status: c.physical_status,
        physical_status_label: PHYSICAL_LABELS[c.physical_status],
        gender: c.gender,
        gender_label: GENDER_LABELS[c.gender],
        calf_record_type: c.calf_record_type,
        body_number: c.body_number || null,
        ear_number: c.ear_number || null,
        birth_weight: c.birth_weight ? Number(c.birth_weight) : null,
        notes: c.notes || null,
        image_url: imageUrl || null,
      });
    }

    const conditionLabel =
      CONDITION_OPTIONS.find((o) => o.value === condition)?.label ?? "";

    const eventDate = `${formatJalali(date)} ${time}`;
    const metadata = {
      calf_count: calfCount,
      caregiver_name: caregiver || null,
      is_helped: isHelped === "yes",
      calving_condition: condition,
      calving_condition_label: conditionLabel,
      period: finalPeriod,
      is_default_period: useDefaultPeriod,
      time,
      calves: calvesMeta,
    };

    const { checkFertilityOperation } = await import("@/lib/fertilityValidation");
    const validation = await checkFertilityOperation({
      livestock_id: livestockId,
      fertility_operation_id: 6,
      event_date: eventDate,
      event_time: time || null,
      fertility_status_id: 12,
    });
    if (!validation.ok) {
      setSubmitting(false);
      setValidationMessages(validation.messages);
      return;
    }
    (metadata as any).matched_rule_id = validation.matched_rule_id ?? null;

    const { error } = await supabase.from("livestock_fertility_events" as any).insert({
      livestock_id: livestockId,
      event_type: "calving",
      fertility_operation_id: 6,
      event_date: eventDate,
      notes: description || null,
      status_code: 12,
      legacy_table_name: "manual",
      legacy_record_id: null,
      metadata,
    });

    if (error) {
      setSubmitting(false);
      toast.error("خطا در ثبت زایش: " + error.message);
      return;
    }

    const { error: cowErr } = await supabase
      .from("cows")
      .update({ last_fertility_status: 12, is_dry: false })
      .eq("id", livestockId);

    setSubmitting(false);

    if (cowErr) {
      toast.error("زایش ثبت شد ولی به‌روزرسانی دام انجام نشد: " + cowErr.message);
    } else {
      toast.success("زایش با موفقیت ثبت شد");
    }

    reset();
    onOpenChange(false);
    onSuccess?.();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-right">ثبت زایش</DialogTitle>
          <DialogDescription className="text-right">
            اطلاعات زایش و گوساله‌ها را وارد کنید
          </DialogDescription>
        </DialogHeader>

        {loadingLookups ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Calf count */}
            <div className="space-y-1.5">
              <Label>
                تعداد قل <span className="text-destructive">*</span>
              </Label>
              <Select
                value={String(calfCount)}
                onValueChange={(v) => setCalfCount(Number(v))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">۱ (تک)</SelectItem>
                  <SelectItem value="2">۲ (دوقلو)</SelectItem>
                  <SelectItem value="3">۳ (سه‌قلو)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Date + Time */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="mb-1.5 block">
                  تاریخ زایش <span className="text-destructive">*</span>
                </Label>
                <JalaliDatePicker value={date} onChange={setDate} />
              </div>
              <div className="space-y-1.5">
                <Label>
                  ساعت زایش <span className="text-destructive">*</span>
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

            {/* Caregiver */}
            <div className="space-y-1.5">
              <Label>نام مراقب هنگام زایش</Label>
              <Input
                value={caregiver}
                onChange={(e) => setCaregiver(e.target.value)}
                placeholder="اختیاری"
              />
            </div>

            {/* Helped */}
            <div className="space-y-1.5">
              <Label>
                زایش با کمک؟ <span className="text-destructive">*</span>
              </Label>
              <RadioGroup
                value={isHelped}
                onValueChange={(v) => setIsHelped(v as "yes" | "no")}
                className="flex gap-4"
              >
                <label className="flex items-center gap-2 cursor-pointer">
                  <RadioGroupItem value="yes" id="helped-yes" />
                  <span className="text-sm">بلی</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <RadioGroupItem value="no" id="helped-no" />
                  <span className="text-sm">خیر</span>
                </label>
              </RadioGroup>
            </div>

            {/* Condition */}
            <div className="space-y-1.5">
              <Label>
                وضعیت زایش <span className="text-destructive">*</span>
              </Label>
              <RadioGroup
                value={condition}
                onValueChange={setCondition}
                className="grid grid-cols-2 sm:grid-cols-3 gap-2"
              >
                {CONDITION_OPTIONS.map((opt) => (
                  <label
                    key={opt.value}
                    className="flex items-center gap-2 cursor-pointer rounded-md border border-border p-2"
                  >
                    <RadioGroupItem value={opt.value} id={`cond-${opt.value}`} />
                    <span className="text-sm">{opt.label}</span>
                  </label>
                ))}
              </RadioGroup>
            </div>

            {/* Default period */}
            <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 p-2.5">
              <Checkbox
                id="cv-default-period"
                checked={useDefaultPeriod}
                onCheckedChange={(v) => {
                  const checked = v === true;
                  setUseDefaultPeriod(checked);
                  if (checked) setPeriod(defaultPeriod);
                }}
              />
              <Label htmlFor="cv-default-period" className="cursor-pointer text-sm">
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

            {/* Description */}
            <div className="space-y-1.5">
              <Label>توضیحات تکمیلی</Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="اختیاری"
                rows={2}
              />
            </div>

            {/* Calves */}
            <div className="space-y-3">
              {calves.map((c, idx) => (
                <div
                  key={idx}
                  className="rounded-lg border border-border bg-muted/20 p-3 space-y-3"
                >
                  <div className="font-bold text-sm text-foreground">
                    گوساله {(idx + 1).toLocaleString("fa-IR")}
                  </div>

                  {/* Physical status */}
                  <div className="space-y-1.5">
                    <Label className="text-xs">
                      وضعیت جسمی <span className="text-destructive">*</span>
                    </Label>
                    <RadioGroup
                      value={c.physical_status}
                      onValueChange={(v) =>
                        updateCalf(idx, { physical_status: v as PhysicalStatus })
                      }
                      className="grid grid-cols-3 gap-2"
                    >
                      {(Object.keys(PHYSICAL_LABELS) as PhysicalStatus[]).map((k) => (
                        <label
                          key={k}
                          className="flex items-center gap-1.5 cursor-pointer rounded-md border border-border p-1.5"
                        >
                          <RadioGroupItem value={k} id={`phys-${idx}-${k}`} />
                          <span className="text-xs">{PHYSICAL_LABELS[k]}</span>
                        </label>
                      ))}
                    </RadioGroup>
                  </div>

                  {/* Gender */}
                  <div className="space-y-1.5">
                    <Label className="text-xs">
                      جنسیت <span className="text-destructive">*</span>
                    </Label>
                    <RadioGroup
                      value={c.gender}
                      onValueChange={(v) => updateCalf(idx, { gender: v as Gender })}
                      className="grid grid-cols-2 gap-2"
                    >
                      {(Object.keys(GENDER_LABELS) as Gender[]).map((k) => (
                        <label
                          key={k}
                          className="flex items-center gap-1.5 cursor-pointer rounded-md border border-border p-1.5"
                        >
                          <RadioGroupItem value={k} id={`gen-${idx}-${k}`} />
                          <span className="text-xs">{GENDER_LABELS[k]}</span>
                        </label>
                      ))}
                    </RadioGroup>
                  </div>

                  {/* Record type */}
                  <div className="space-y-1.5">
                    <Label className="text-xs">
                      اطلاعات گوساله <span className="text-destructive">*</span>
                    </Label>
                    <RadioGroup
                      value={c.calf_record_type}
                      onValueChange={(v) =>
                        updateCalf(idx, { calf_record_type: v as CalfRecordType })
                      }
                      className="grid grid-cols-2 gap-2"
                    >
                      <label className="flex items-center gap-1.5 cursor-pointer rounded-md border border-border p-1.5">
                        <RadioGroupItem value="new" id={`rt-${idx}-new`} />
                        <span className="text-xs">ثبت جدید</span>
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer rounded-md border border-border p-1.5">
                        <RadioGroupItem value="existing" id={`rt-${idx}-existing`} />
                        <span className="text-xs">قبلاً ثبت شده</span>
                      </label>
                    </RadioGroup>
                  </div>

                  {/* Body / Ear numbers */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">
                        شماره بدن
                        {c.calf_record_type === "new" && (
                          <span className="text-destructive"> *</span>
                        )}
                      </Label>
                      <Input
                        value={c.body_number}
                        onChange={(e) => updateCalf(idx, { body_number: e.target.value })}
                        dir="ltr"
                        className="text-left"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">
                        شماره گوش
                        {c.calf_record_type === "new" && (
                          <span className="text-destructive"> *</span>
                        )}
                      </Label>
                      <Input
                        value={c.ear_number}
                        onChange={(e) => updateCalf(idx, { ear_number: e.target.value })}
                        dir="ltr"
                        className="text-left"
                      />
                    </div>
                  </div>

                  {/* Birth weight */}
                  <div className="space-y-1.5">
                    <Label className="text-xs">وزن تولد (کیلوگرم)</Label>
                    <Input
                      type="number"
                      step="0.1"
                      min={0}
                      value={c.birth_weight}
                      onChange={(e) => updateCalf(idx, { birth_weight: e.target.value })}
                      dir="ltr"
                      className="text-left"
                    />
                  </div>

                  {/* Notes */}
                  <div className="space-y-1.5">
                    <Label className="text-xs">توضیحات تکمیلی گوساله</Label>
                    <Textarea
                      value={c.notes}
                      onChange={(e) => updateCalf(idx, { notes: e.target.value })}
                      rows={2}
                      placeholder="اختیاری"
                    />
                  </div>

                  {/* Image */}
                  <div className="space-y-1.5">
                    <Label className="text-xs">تصویر گوساله</Label>
                    {c.imageFile ? (
                      <div className="flex items-center justify-between rounded-md border border-border p-2 text-xs">
                        <span className="truncate">{c.imageFile.name}</span>
                        <button
                          type="button"
                          onClick={() => updateCalf(idx, { imageFile: null })}
                          className="text-destructive"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <label className="flex items-center justify-center gap-2 cursor-pointer rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground hover:bg-muted/40">
                        <Upload className="w-4 h-4" />
                        <span>انتخاب تصویر</span>
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) =>
                            updateCalf(idx, { imageFile: e.target.files?.[0] ?? null })
                          }
                        />
                      </label>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <FertilityValidationAlert messages={validationMessages} />
            <div className="flex gap-2 pt-2 sticky bottom-0 bg-background">
              <Button type="submit" disabled={submitting} className="flex-1">
                {submitting && <Loader2 className="w-4 h-4 animate-spin ml-2" />}
                ثبت زایش
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
