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
import { checkFertilityOperation } from "@/lib/fertilityValidation";
import FertilityValidationAlert from "@/components/livestock/FertilityValidationAlert";

const TEST_TYPE_OP_ID: Record<string, number> = {
  initial: 3,
  final: 4,
  extra: 11,
  dry: 12,
};

type AppUser = { id: string; full_name: string | null; username: string };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  livestockId: number;
  onSuccess?: () => void;
};

type TestType = "initial" | "final" | "extra" | "dry";
type ResultValue = "positive" | "negative" | "suspicious";

const TEST_TYPE_LABELS: Record<TestType, string> = {
  initial: "تست اولیه",
  final: "تست نهایی",
  extra: "تست تکمیلی",
  dry: "تست خشکی",
};

const RESULT_LABELS: Record<ResultValue, string> = {
  positive: "مثبت",
  negative: "منفی",
  suspicious: "مشکوک",
};

const STATUS_CODE_MAP: Record<TestType, Partial<Record<ResultValue, number>>> = {
  initial: { positive: 4, suspicious: 5, negative: 6 },
  final: { positive: 8, negative: 7 },
  extra: { positive: 18, negative: 17 },
  dry: { positive: 20, negative: 19 },
};

export default function PregnancyTestRegistrationDialog({
  open,
  onOpenChange,
  livestockId,
  onSuccess,
}: Props) {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loadingLookups, setLoadingLookups] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [validationMessages, setValidationMessages] = useState<string[]>([]);

  const [testType, setTestType] = useState<TestType | "">("");
  const [vetId, setVetId] = useState<string>("");
  const [result, setResult] = useState<ResultValue | "">("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState<JalaliDate | null>(todayJalali());
  const [time, setTime] = useState<string>("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoadingLookups(true);
      const { data } = await supabase
        .from("app_users")
        .select("id, full_name, username")
        .eq("is_active", true)
        .order("full_name");
      if (!cancelled) {
        setUsers(((data as any[]) ?? []) as AppUser[]);
        setLoadingLookups(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  function reset() {
    setTestType("");
    setVetId("");
    setResult("");
    setDescription("");
    setDate(todayJalali());
    setTime("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!testType) return toast.error("نوع تست آبستنی را انتخاب کنید");
    if (!vetId) return toast.error("دامپزشک را انتخاب کنید");
    if (!result) return toast.error("نتیجه تست را انتخاب کنید");
    if (!date) return toast.error("تاریخ تست را انتخاب کنید");
    if (!time) return toast.error("ساعت تست را وارد کنید");

    const statusCode = STATUS_CODE_MAP[testType][result];
    if (statusCode === undefined) {
      return toast.error("ترکیب نوع تست و نتیجه نامعتبر است");
    }

    setSubmitting(true);

    setValidationMessages([]);
    const selectedUser = users.find((u) => String(u.id) === vetId);
    const operatorName = selectedUser?.full_name ?? selectedUser?.username ?? null;
    const eventDate = `${formatJalali(date)} ${time}`;

    const metadata = {
      test_type: testType,
      test_type_label: TEST_TYPE_LABELS[testType],
      result,
      result_label: RESULT_LABELS[result],
      time,
      operator_name: operatorName,
    };

    const opId = TEST_TYPE_OP_ID[testType];
    const validation = await checkFertilityOperation({
      livestock_id: livestockId,
      fertility_operation_id: opId,
      event_date: eventDate,
      event_time: time || null,
      result_code: String(statusCode),
      fertility_status_id: statusCode,
    });
    if (!validation.ok) {
      setSubmitting(false);
      setValidationMessages(validation.messages);
      return;
    }
    (metadata as any).matched_rule_id = validation.matched_rule_id ?? null;

    const { error } = await supabase.from("livestock_fertility_events" as any).insert({
      livestock_id: livestockId,
      event_type: "pregnancy_test",
      fertility_operation_id: opId,
      event_date: eventDate,
      operator_user_id: null,
      operator_name: operatorName,
      notes: description || null,
      status_code: statusCode,
      result: RESULT_LABELS[result],
      legacy_table_name: "manual",
      legacy_record_id: null,
      metadata,
    });

    setSubmitting(false);

    if (error) {
      toast.error("خطا در ثبت تست آبستنی: " + error.message);
      return;
    }

    toast.success("تست آبستنی با موفقیت ثبت شد");
    reset();
    onOpenChange(false);
    onSuccess?.();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-right">ثبت تست آبستنی</DialogTitle>
          <DialogDescription className="text-right">
            اطلاعات تست آبستنی این دام را وارد کنید
          </DialogDescription>
        </DialogHeader>

        {loadingLookups ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Test type */}
            <div className="space-y-1.5">
              <Label>
                نوع تست آبستنی <span className="text-destructive">*</span>
              </Label>
              <Select value={testType} onValueChange={(v) => setTestType(v as TestType)} dir="rtl">
                <SelectTrigger>
                  <SelectValue placeholder="انتخاب کنید" />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(TEST_TYPE_LABELS) as TestType[]).map((k) => (
                    <SelectItem key={k} value={k}>
                      {TEST_TYPE_LABELS[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Vet */}
            <div className="space-y-1.5">
              <Label>
                دامپزشک تست گیرنده <span className="text-destructive">*</span>
              </Label>
              <Select value={vetId} onValueChange={setVetId} dir="rtl">
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
                نتیجه تست <span className="text-destructive">*</span>
              </Label>
              <RadioGroup
                value={result}
                onValueChange={(v) => setResult(v as ResultValue)}
                className="flex flex-wrap gap-4"
              >
                {(Object.keys(RESULT_LABELS) as ResultValue[]).map((r) => (
                  <div key={r} className="flex items-center gap-2">
                    <RadioGroupItem value={r} id={`pt-${r}`} />
                    <Label htmlFor={`pt-${r}`} className="cursor-pointer">
                      {RESULT_LABELS[r]}
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            </div>

            {/* Date + Time */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="mb-1.5 block">
                  تاریخ تست <span className="text-destructive">*</span>
                </Label>
                <JalaliDatePicker value={date} onChange={setDate} />
              </div>
              <div className="space-y-1.5">
                <Label>
                  ساعت تست <span className="text-destructive">*</span>
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
                ثبت تست آبستنی
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
