import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { getSession } from "@/lib/auth";
import { FertilityEvent, fertilityEventLabel } from "@/lib/fertility";

type Props = {
  event: FertilityEvent | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
};

export default function CancelFertilityEventDialog({
  event,
  open,
  onOpenChange,
  onSuccess,
}: Props) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleConfirm() {
    if (!event) return;
    if (!reason.trim()) {
      toast.error("دلیل لغو را وارد کنید");
      return;
    }
    setSubmitting(true);
    const { user } = getSession();
    const userId = user?.id ?? null;

    const { error } = await supabase
      .from("livestock_fertility_events" as any)
      .update({
        is_cancelled: true,
        cancelled_at: new Date().toISOString(),
        cancelled_by_user_id: userId,
        cancel_reason: reason.trim(),
      } as any)
      .eq("id", event.id);

    if (!error) {
      await supabase.from("fertility_event_audit_logs" as any).insert({
        fertility_event_id: event.id,
        action: "cancelled",
        old_data: event as any,
        new_data: { cancel_reason: reason.trim() } as any,
        user_id: userId,
      } as any);
    }

    setSubmitting(false);
    if (error) {
      toast.error("خطا در لغو عملیات: " + error.message);
      return;
    }
    toast.success("عملیات لغو شد");
    setReason("");
    onOpenChange(false);
    onSuccess?.();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-right">لغو عملیات</DialogTitle>
          <DialogDescription className="text-right">
            {event ? fertilityEventLabel(event.event_type) : ""} — این عملیات به‌صورت لغو شده ثبت می‌شود و حذف نمی‌گردد.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>دلیل لغو *</Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="دلیل لغو این عملیات را بنویسید"
            />
          </div>
          <div className="flex gap-2 pt-2">
            <Button
              type="button"
              variant="destructive"
              className="flex-1"
              onClick={handleConfirm}
              disabled={submitting}
            >
              {submitting && <Loader2 className="w-4 h-4 animate-spin ml-2" />}
              تایید لغو
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
        </div>
      </DialogContent>
    </Dialog>
  );
}
