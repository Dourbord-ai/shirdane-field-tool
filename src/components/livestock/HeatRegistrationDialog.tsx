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
import JalaliDatePicker from "@/components/JalaliDatePicker";
import { JalaliDate, formatJalali, todayJalali } from "@/lib/jalali";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { checkFertilityOperation } from "@/lib/fertilityValidation";
import FertilityValidationAlert from "@/components/livestock/FertilityValidationAlert";

type HeatType = { id: number; title: string };
type AppUser = { id: string; full_name: string | null; username: string };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  livestockId: number;
  onSuccess?: () => void;
};

type Quality = "weak" | "normal" | "good";

const QUALITY_OPTIONS: { value: Quality; label: string }[] = [
  { value: "weak", label: "ضعیف" },
  { value: "normal", label: "معمولی" },
  { value: "good", label: "خوب" },
];

function RadioRow({
  name,
  value,
  onChange,
  options,
}: {
  name: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {options.map((o) => {
        const selected = value === o.value;
        return (
          <label
            key={o.value}
            className={`cursor-pointer rounded-lg border px-3 py-2.5 text-center text-sm transition-colors ${
              selected
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background border-border hover:bg-muted"
            }`}
          >
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={selected}
              onChange={() => onChange(o.value)}
              className="sr-only"
            />
            {o.label}
          </label>
        );
      })}
    </div>
  );
}

export default function HeatRegistrationDialog({
  open,
  onOpenChange,
  livestockId,
  onSuccess,
}: Props) {
  const [heatTypes, setHeatTypes] = useState<HeatType[]>([]);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loadingLookups, setLoadingLookups] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [validationMessages, setValidationMessages] = useState<string[]>([]);

  // form state
  const [heatTypeId, setHeatTypeId] = useState<string>("");
  const [quality, setQuality] = useState<Quality | "">("");
  const [discharge, setDischarge] = useState<Quality | "">("");
  const [uterineInfection, setUterineInfection] = useState<"yes" | "no" | "">("");
  const [operatorId, setOperatorId] = useState<string>("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState<JalaliDate | null>(todayJalali());
  const [time, setTime] = useState<string>("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    async function load() {
      setLoadingLookups(true);
      const [{ data: types }, { data: usersData }] = await Promise.all([
        supabase
          .from("fertility_erotic_types" as any)
          .select("id, title")
          .eq("is_active", true)
          .order("sort_order", { ascending: true })
          .order("id", { ascending: true }),
        supabase
          .from("app_users")
          .select("id, full_name, username")
          .eq("is_active", true)
          .order("full_name"),
      ]);
      if (!cancelled) {
        setHeatTypes(((types as any[]) ?? []) as HeatType[]);
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
    setHeatTypeId("");
    setQuality("");
    setDischarge("");
    setUterineInfection("");
    setOperatorId("");
    setDescription("");
    setDate(todayJalali());
    setTime("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!heatTypeId) return toast.error("نوع فحلی را انتخاب کنید");
    if (!quality) return toast.error("کیفیت فحلی را انتخاب کنید");
    if (!discharge) return toast.error("میزان ترشحات را انتخاب کنید");
    if (!uterineInfection) return toast.error("وضعیت عفونت رحمی را مشخص کنید");
    if (!operatorId) return toast.error("گزارش‌دهنده را انتخاب کنید");
    if (!date) return toast.error("تاریخ فحلی را انتخاب کنید");
    if (!time) return toast.error("ساعت فحلی را وارد کنید");

    setSubmitting(true);

    setValidationMessages([]);
    const selectedType = heatTypes.find((t) => String(t.id) === heatTypeId);
    const selectedUser = users.find((u) => String(u.id) === operatorId);
    const dateStr = formatJalali(date);
    const eventDate = `${dateStr} ${time}`;

    const validation = await checkFertilityOperation({
      livestock_id: livestockId,
      fertility_operation_id: 1,
      event_date: eventDate,
      event_time: time || null,
    });
    if (!validation.ok) {
      setSubmitting(false);
      setValidationMessages(validation.messages);
      return;
    }

    const metadata = {
      erotic_type_id: Number(heatTypeId),
      erotic_type_label: selectedType?.title ?? null,
      quality,
      discharge,
      uterine_infection: uterineInfection === "yes",
      time,
      operator_name: selectedUser?.full_name ?? selectedUser?.username ?? null,
      matched_rule_id: validation.matched_rule_id ?? null,
    };

    const { error } = await supabase.from("livestock_fertility_events" as any).insert({
      livestock_id: livestockId,
      event_type: "heat",
      fertility_operation_id: 1,
      erotic_type_id: Number(heatTypeId),
      event_date: eventDate,
      operator_user_id: null,
      operator_name: selectedUser?.full_name ?? selectedUser?.username ?? null,
      notes: description || null,
      legacy_table_name: "manual",
      legacy_record_id: null,
      metadata,
    });

    setSubmitting(false);

    if (error) {
      toast.error("خطا در ثبت فحلی: " + error.message);
      return;
    }

    toast.success("فحلی با موفقیت ثبت شد");
    reset();
    onOpenChange(false);
    onSuccess?.();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        dir="rtl"
        className="max-w-lg max-h-[90vh] overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle className="text-right">ثبت فحلی</DialogTitle>
          <DialogDescription className="text-right">
            اطلاعات رویداد فحلی این دام را وارد کنید
          </DialogDescription>
        </DialogHeader>

        {loadingLookups ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Heat type */}
            <div className="space-y-1.5">
              <Label>
                نوع فحلی <span className="text-destructive">*</span>
              </Label>
              <Select value={heatTypeId} onValueChange={setHeatTypeId} dir="rtl">
                <SelectTrigger>
                  <SelectValue placeholder="انتخاب کنید" />
                </SelectTrigger>
                <SelectContent>
                  {heatTypes.map((t) => (
                    <SelectItem key={t.id} value={String(t.id)}>
                      {t.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Quality */}
            <div className="space-y-1.5">
              <Label>
                کیفیت فحلی <span className="text-destructive">*</span>
              </Label>
              <RadioRow
                name="quality"
                value={quality}
                onChange={(v) => setQuality(v as Quality)}
                options={QUALITY_OPTIONS}
              />
            </div>

            {/* Discharge */}
            <div className="space-y-1.5">
              <Label>
                میزان ترشحات <span className="text-destructive">*</span>
              </Label>
              <RadioRow
                name="discharge"
                value={discharge}
                onChange={(v) => setDischarge(v as Quality)}
                options={QUALITY_OPTIONS}
              />
            </div>

            {/* Uterine infection */}
            <div className="space-y-1.5">
              <Label>
                عفونت رحمی <span className="text-destructive">*</span>
              </Label>
              <RadioRow
                name="uterine_infection"
                value={uterineInfection}
                onChange={(v) => setUterineInfection(v as "yes" | "no")}
                options={[
                  { value: "yes", label: "دارد" },
                  { value: "no", label: "ندارد" },
                ]}
              />
            </div>

            {/* Operator */}
            <div className="space-y-1.5">
              <Label>
                گزارش‌دهنده فحلی <span className="text-destructive">*</span>
              </Label>
              <Select value={operatorId} onValueChange={setOperatorId} dir="rtl">
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

            {/* Date + Time */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="mb-1.5 block">
                  تاریخ فحلی <span className="text-destructive">*</span>
                </Label>
                <JalaliDatePicker value={date} onChange={setDate} />
              </div>
              <div className="space-y-1.5">
                <Label>
                  ساعت فحلی <span className="text-destructive">*</span>
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
                ثبت فحلی
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
