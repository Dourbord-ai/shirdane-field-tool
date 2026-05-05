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
import { Checkbox } from "@/components/ui/checkbox";
import JalaliDatePicker from "@/components/JalaliDatePicker";
import { JalaliDate, formatJalali, todayJalali } from "@/lib/jalali";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { checkFertilityOperation } from "@/lib/fertilityValidation";
import FertilityValidationAlert from "@/components/livestock/FertilityValidationAlert";

type AppUser = { id: string; full_name: string | null; username: string };
type SpermRow = { id: number; code: string | null; name: string | null };
type MaleCow = {
  id: number;
  tag_number: string | null;
  earnumber: number | null;
  bodynumber: number | null;
  presence_status: number | null;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  livestockId: number;
  onSuccess?: () => void;
};

type SpermType = "single" | "double";
type InseminationType = "natural" | "sperm";

const SPERM_OPTIONS: { value: SpermType; label: string }[] = [
  { value: "single", label: "تک اسپرمی" },
  { value: "double", label: "دو اسپرمی" },
];

const INSEMINATION_TYPE_OPTIONS: { value: InseminationType; label: string }[] = [
  { value: "natural", label: "طبیعی" },
  { value: "sperm", label: "با اسپرم" },
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
    <div className="grid grid-cols-2 gap-2">
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

function maleCowLabel(c: MaleCow) {
  return c.tag_number || (c.earnumber ? String(c.earnumber) : null) || (c.bodynumber ? String(c.bodynumber) : null) || `#${c.id}`;
}

function spermLabel(s: SpermRow) {
  if (s.code && s.name) return `${s.code} - ${s.name}`;
  return s.code || s.name || `#${s.id}`;
}

export default function InseminationRegistrationDialog({
  open,
  onOpenChange,
  livestockId,
  onSuccess,
}: Props) {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [sperms, setSperms] = useState<SpermRow[]>([]);
  const [maleCows, setMaleCows] = useState<MaleCow[]>([]);
  const [loadingLookups, setLoadingLookups] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [validationMessages, setValidationMessages] = useState<string[]>([]);

  // type
  const [inseminationType, setInseminationType] = useState<InseminationType | "">("");

  // shared
  const [operatorId, setOperatorId] = useState<string>("");
  const [date, setDate] = useState<JalaliDate | null>(todayJalali());
  const [time, setTime] = useState<string>("");
  const [description, setDescription] = useState("");
  const [helperMeds, setHelperMeds] = useState("");

  // natural
  const [maleCowId, setMaleCowId] = useState<string>("");

  // sperm
  const [spermId, setSpermId] = useState<string>("");
  const [firstType, setFirstType] = useState<SpermType | "">("");
  const [hasSecond, setHasSecond] = useState(false);
  const [secondDate, setSecondDate] = useState<JalaliDate | null>(null);
  const [secondTime, setSecondTime] = useState<string>("");
  const [secondType, setSecondType] = useState<SpermType | "">("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    async function load() {
      setLoadingLookups(true);
      const [usersRes, spermsRes, cowsRes] = await Promise.all([
        supabase.from("app_users").select("id, full_name, username").eq("is_active", true).order("full_name"),
        supabase.from("sperms").select("id, code, name").order("name"),
        supabase
          .from("cows")
          .select("id, tag_number, earnumber, bodynumber, presence_status, sex, sextype")
          .or("sex.eq.2,sextype.eq.نر")
          .limit(1000),
      ]);
      if (cancelled) return;
      setUsers(((usersRes.data as any[]) ?? []) as AppUser[]);
      setSperms(((spermsRes.data as any[]) ?? []) as SpermRow[]);
      const cows = ((cowsRes.data as any[]) ?? []) as MaleCow[];
      cows.sort((a, b) => {
        const ap = a.presence_status === 0 ? 0 : 1;
        const bp = b.presence_status === 0 ? 0 : 1;
        return ap - bp;
      });
      setMaleCows(cows);
      setLoadingLookups(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Clear conditional fields when type changes
  useEffect(() => {
    if (inseminationType === "natural") {
      setSpermId("");
      setFirstType("");
      setHasSecond(false);
      setSecondDate(null);
      setSecondTime("");
      setSecondType("");
    } else if (inseminationType === "sperm") {
      setMaleCowId("");
    }
  }, [inseminationType]);

  useEffect(() => {
    if (!hasSecond) {
      setSecondDate(null);
      setSecondTime("");
      setSecondType("");
    }
  }, [hasSecond]);

  function reset() {
    setInseminationType("");
    setOperatorId("");
    setDate(todayJalali());
    setTime("");
    setDescription("");
    setHelperMeds("");
    setMaleCowId("");
    setSpermId("");
    setFirstType("");
    setHasSecond(false);
    setSecondDate(null);
    setSecondTime("");
    setSecondType("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!inseminationType) return toast.error("نوع تلقیح را انتخاب کنید");

    if (inseminationType === "natural") {
      if (!maleCowId) return toast.error("شماره دام نر را انتخاب کنید");
    } else {
      if (!spermId) return toast.error("اسپرم را انتخاب کنید");
      if (!firstType) return toast.error("نوع اسپرم مصرفی را انتخاب کنید");
      if (hasSecond) {
        if (!secondDate) return toast.error("تاریخ تلقیح دوم را انتخاب کنید");
        if (!secondTime) return toast.error("ساعت تلقیح دوم را وارد کنید");
        if (!secondType) return toast.error("نوع اسپرم تلقیح دوم را انتخاب کنید");
      }
    }

    if (!operatorId) return toast.error("تلقیح‌کننده را انتخاب کنید");
    if (!date) return toast.error("تاریخ تلقیح را انتخاب کنید");
    if (!time) return toast.error("ساعت تلقیح را وارد کنید");

    setSubmitting(true);

    setValidationMessages([]);
    const selectedUser = users.find((u) => String(u.id) === operatorId);
    const dateStr = formatJalali(date);
    const eventDate = `${dateStr} ${time}`;

    const metadata: Record<string, any> = {
      insemination_type: inseminationType,
      insemination_type_label: inseminationType === "natural" ? "طبیعی" : "با اسپرم",
      time,
      operator_name: selectedUser?.full_name ?? selectedUser?.username ?? null,
      helper_medicines: helperMeds || null,
    };

    if (inseminationType === "natural") {
      const cow = maleCows.find((c) => String(c.id) === maleCowId);
      metadata.male_cow_id = cow?.id ?? null;
      metadata.male_cow_label = cow ? maleCowLabel(cow) : null;
    } else {
      const s = sperms.find((x) => String(x.id) === spermId);
      metadata.sperm_id = s?.id ?? null;
      metadata.sperm_label = s ? spermLabel(s) : null;
      metadata.sperm_usage_type = firstType;
      metadata.sperm_usage_type_label = firstType === "single" ? "تک اسپرمی" : "دو اسپرمی";
      metadata.needs_reinjection = hasSecond;
      if (hasSecond) {
        metadata.second_insemination = {
          date: formatJalali(secondDate!),
          time: secondTime,
          sperm_usage_type: secondType,
          sperm_usage_type_label: secondType === "single" ? "تک اسپرمی" : "دو اسپرمی",
        };
      }
    }

    const validation = await checkFertilityOperation({
      livestock_id: livestockId,
      fertility_operation_id: 2,
      event_date: eventDate,
      event_time: time || null,
    });
    if (!validation.ok) {
      setSubmitting(false);
      setValidationMessages(validation.messages);
      return;
    }
    metadata.matched_rule_id = validation.matched_rule_id ?? null;

    const { error } = await supabase.from("livestock_fertility_events" as any).insert({
      livestock_id: livestockId,
      event_type: "insemination",
      fertility_operation_id: 2,
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
      toast.error("خطا در ثبت تلقیح: " + error.message);
      return;
    }

    toast.success("تلقیح با موفقیت ثبت شد");
    reset();
    onOpenChange(false);
    onSuccess?.();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-right">ثبت تلقیح</DialogTitle>
          <DialogDescription className="text-right">
            اطلاعات رویداد تلقیح این دام را وارد کنید
          </DialogDescription>
        </DialogHeader>

        {loadingLookups ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* 1. Insemination type */}
            <div className="space-y-1.5">
              <Label>
                نوع تلقیح <span className="text-destructive">*</span>
              </Label>
              <RadioRow
                name="insemination_type"
                value={inseminationType}
                onChange={(v) => setInseminationType(v as InseminationType)}
                options={INSEMINATION_TYPE_OPTIONS}
              />
            </div>

            {/* 2. Conditional selector */}
            {inseminationType === "natural" && (
              <div className="space-y-1.5">
                <Label>
                  شماره دام نر تلقیح کننده <span className="text-destructive">*</span>
                </Label>
                <Select value={maleCowId} onValueChange={setMaleCowId} dir="rtl">
                  <SelectTrigger>
                    <SelectValue placeholder="انتخاب کنید" />
                  </SelectTrigger>
                  <SelectContent>
                    {maleCows.length === 0 && (
                      <div className="px-2 py-3 text-sm text-muted-foreground text-center">
                        دام نری یافت نشد
                      </div>
                    )}
                    {maleCows.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {maleCowLabel(c)}
                        {c.presence_status === 0 ? "" : "  (غایب)"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {inseminationType === "sperm" && (
              <div className="space-y-1.5">
                <Label>
                  کد و نام اسپرم <span className="text-destructive">*</span>
                </Label>
                <Select value={spermId} onValueChange={setSpermId} dir="rtl">
                  <SelectTrigger>
                    <SelectValue placeholder="انتخاب کنید" />
                  </SelectTrigger>
                  <SelectContent>
                    {sperms.map((s) => (
                      <SelectItem key={s.id} value={String(s.id)}>
                        {spermLabel(s)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* 3. Operator */}
            <div className="space-y-1.5">
              <Label>
                تلقیح‌کننده <span className="text-destructive">*</span>
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

            {/* 4 & 5. Sperm-only fields */}
            {inseminationType === "sperm" && (
              <>
                <div className="space-y-1.5">
                  <Label>
                    نوع اسپرم مصرفی <span className="text-destructive">*</span>
                  </Label>
                  <RadioRow
                    name="first_type"
                    value={firstType}
                    onChange={(v) => setFirstType(v as SpermType)}
                    options={SPERM_OPTIONS}
                  />
                </div>

                <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <Checkbox
                      checked={hasSecond}
                      onCheckedChange={(v) => setHasSecond(v === true)}
                      id="has-second"
                    />
                    <span className="text-sm font-medium">نیاز به تزریق مجدد</span>
                  </label>

                  {hasSecond && (
                    <div className="space-y-3 pt-1">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label className="mb-1.5 block">
                            تاریخ تلقیح دوم <span className="text-destructive">*</span>
                          </Label>
                          <JalaliDatePicker value={secondDate} onChange={setSecondDate} />
                        </div>
                        <div className="space-y-1.5">
                          <Label>
                            ساعت تلقیح دوم <span className="text-destructive">*</span>
                          </Label>
                          <Input
                            type="time"
                            value={secondTime}
                            onChange={(e) => setSecondTime(e.target.value)}
                            dir="ltr"
                            className="text-left"
                          />
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <Label>
                          نوع اسپرم تلقیح دوم <span className="text-destructive">*</span>
                        </Label>
                        <RadioRow
                          name="second_type"
                          value={secondType}
                          onChange={(v) => setSecondType(v as SpermType)}
                          options={SPERM_OPTIONS}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}

            {/* 7. Helper medicines */}
            <div className="space-y-1.5">
              <Label>داروهای کمکی</Label>
              <Input
                value={helperMeds}
                onChange={(e) => setHelperMeds(e.target.value)}
                placeholder="اختیاری"
              />
            </div>

            {/* 8. Description */}
            <div className="space-y-1.5">
              <Label>توضیحات</Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="اختیاری"
                rows={3}
              />
            </div>

            {/* 9 & 10. Date + Time */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="mb-1.5 block">
                  تاریخ تلقیح <span className="text-destructive">*</span>
                </Label>
                <JalaliDatePicker value={date} onChange={setDate} />
              </div>
              <div className="space-y-1.5">
                <Label>
                  ساعت تلقیح <span className="text-destructive">*</span>
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

            <FertilityValidationAlert messages={validationMessages} />
            <div className="flex gap-2 pt-2">
              <Button type="submit" disabled={submitting} className="flex-1">
                {submitting && <Loader2 className="w-4 h-4 animate-spin ml-2" />}
                ثبت تلقیح
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
