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

type AppUser = { id: string; full_name: string | null; username: string };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  livestockId: number;
  onSuccess?: () => void;
};

type SpermType = "single" | "double";

const SPERM_OPTIONS: { value: SpermType; label: string }[] = [
  { value: "single", label: "تک اسپرمی" },
  { value: "double", label: "دو اسپرمی" },
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

export default function InseminationRegistrationDialog({
  open,
  onOpenChange,
  livestockId,
  onSuccess,
}: Props) {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loadingLookups, setLoadingLookups] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // primary insemination
  const [operatorId, setOperatorId] = useState<string>("");
  const [bullCode, setBullCode] = useState("");
  const [firstType, setFirstType] = useState<SpermType | "">("");
  const [date, setDate] = useState<JalaliDate | null>(todayJalali());
  const [time, setTime] = useState<string>("");
  const [description, setDescription] = useState("");

  // second insemination (dynamic)
  const [hasSecond, setHasSecond] = useState(false);
  const [secondDate, setSecondDate] = useState<JalaliDate | null>(null);
  const [secondTime, setSecondTime] = useState<string>("");
  const [secondType, setSecondType] = useState<SpermType | "">("");

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

  // Clear second insemination fields when checkbox is unchecked
  useEffect(() => {
    if (!hasSecond) {
      setSecondDate(null);
      setSecondTime("");
      setSecondType("");
    }
  }, [hasSecond]);

  function reset() {
    setOperatorId("");
    setBullCode("");
    setFirstType("");
    setDate(todayJalali());
    setTime("");
    setDescription("");
    setHasSecond(false);
    setSecondDate(null);
    setSecondTime("");
    setSecondType("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!operatorId) return toast.error("تلقیح‌کننده را انتخاب کنید");
    if (!firstType) return toast.error("نوع تلقیح را انتخاب کنید");
    if (!date) return toast.error("تاریخ تلقیح را انتخاب کنید");
    if (!time) return toast.error("ساعت تلقیح را وارد کنید");

    if (hasSecond) {
      if (!secondDate) return toast.error("تاریخ تلقیح دوم را انتخاب کنید");
      if (!secondTime) return toast.error("ساعت تلقیح دوم را وارد کنید");
      if (!secondType) return toast.error("نوع تلقیح دوم را انتخاب کنید");
    }

    setSubmitting(true);

    const selectedUser = users.find((u) => String(u.id) === operatorId);
    const dateStr = formatJalali(date);
    const eventDate = `${dateStr} ${time}`;

    const metadata: Record<string, any> = {
      first_type: firstType,
      bull_code: bullCode || null,
      time,
      operator_name: selectedUser?.full_name ?? selectedUser?.username ?? null,
      has_second_insemination: hasSecond,
    };

    if (hasSecond) {
      metadata.second_insemination = {
        date: formatJalali(secondDate!),
        time: secondTime,
        type: secondType,
      };
    }

    const { error } = await supabase.from("livestock_fertility_events" as any).insert({
      livestock_id: livestockId,
      event_type: "insemination",
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
            {/* Operator */}
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

            {/* Bull code */}
            <div className="space-y-1.5">
              <Label>کد اسپرم / گاو نر</Label>
              <Input
                value={bullCode}
                onChange={(e) => setBullCode(e.target.value)}
                placeholder="اختیاری"
              />
            </div>

            {/* First type */}
            <div className="space-y-1.5">
              <Label>
                نوع تلقیح <span className="text-destructive">*</span>
              </Label>
              <RadioRow
                name="first_type"
                value={firstType}
                onChange={(v) => setFirstType(v as SpermType)}
                options={SPERM_OPTIONS}
              />
            </div>

            {/* Date + Time */}
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

            {/* Need re-insemination */}
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
                      نوع تلقیح دوم <span className="text-destructive">*</span>
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
