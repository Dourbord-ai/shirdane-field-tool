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

type AppUser = { id: string; full_name: string | null; username: string };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  livestockId: number;
  onSuccess?: () => void;
};

export default function RinseRegistrationDialog({
  open,
  onOpenChange,
  livestockId,
  onSuccess,
}: Props) {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loadingLookups, setLoadingLookups] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [validationMessages, setValidationMessages] = useState<string[]>([]);

  const [operatorId, setOperatorId] = useState<string>("");
  const [reason, setReason] = useState("");
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
    setOperatorId("");
    setReason("");
    setDescription("");
    setDate(todayJalali());
    setTime("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!operatorId) return toast.error("شخص شستشو دهنده را انتخاب کنید");
    if (!reason.trim()) return toast.error("علت شستشو را وارد کنید");
    if (!date) return toast.error("تاریخ شستشو را انتخاب کنید");
    if (!time) return toast.error("ساعت شستشو را وارد کنید");

    setSubmitting(true);

    setValidationMessages([]);
    const selectedUser = users.find((u) => String(u.id) === operatorId);
    const dateStr = formatJalali(date);
    const eventDate = `${dateStr} ${time}`;
    const operatorName = selectedUser?.full_name ?? selectedUser?.username ?? null;

    const metadata = {
      rinse_reason: reason.trim(),
      time,
      operator_name: operatorName,
    };

    const { checkFertilityOperation } = await import("@/lib/fertilityValidation");
    const validation = await checkFertilityOperation({
      livestock_id: livestockId,
      fertility_operation_id: 8,
      event_date: eventDate,
      event_time: time || null,
    });
    if (!validation.ok) {
      setSubmitting(false);
      setValidationMessages(validation.messages);
      return;
    }
    (metadata as any).matched_rule_id = validation.matched_rule_id ?? null;

    const { error } = await supabase.from("livestock_fertility_events" as any).insert({
      livestock_id: livestockId,
      event_type: "rinse",
      fertility_operation_id: 8,
      event_date: eventDate,
      operator_user_id: null,
      operator_name: operatorName,
      notes: description || null,
      legacy_table_name: "manual",
      legacy_record_id: null,
      metadata,
    });

    setSubmitting(false);

    if (error) {
      toast.error("خطا در ثبت شستشو: " + error.message);
      return;
    }

    toast.success("شستشو با موفقیت ثبت شد");
    reset();
    onOpenChange(false);
    onSuccess?.();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-right">ثبت شستشو</DialogTitle>
          <DialogDescription className="text-right">
            اطلاعات رویداد شستشو این دام را وارد کنید
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
                شخص شستشو دهنده <span className="text-destructive">*</span>
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

            {/* Reason */}
            <div className="space-y-1.5">
              <Label>
                علت شستشو <span className="text-destructive">*</span>
              </Label>
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="مثلاً ترشحات غیرطبیعی"
              />
            </div>

            {/* Date + Time */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="mb-1.5 block">
                  تاریخ شستشو <span className="text-destructive">*</span>
                </Label>
                <JalaliDatePicker value={date} onChange={setDate} />
              </div>
              <div className="space-y-1.5">
                <Label>
                  ساعت شستشو <span className="text-destructive">*</span>
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
                ثبت شستشو
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
