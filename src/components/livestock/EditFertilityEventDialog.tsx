import { useEffect, useState } from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

type AppUser = { id: string; full_name: string | null; username: string };

export default function EditFertilityEventDialog({
  event,
  open,
  onOpenChange,
  onSuccess,
}: Props) {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [eventDate, setEventDate] = useState("");
  const [operatorId, setOperatorId] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [result, setResult] = useState("");
  const [statusCode, setStatusCode] = useState<string>("");
  const [metadataText, setMetadataText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const isLegacyReadOnly =
    !!event && !!event.legacy_table_name && event.legacy_table_name !== "manual";

  useEffect(() => {
    if (!open || !event) return;
    setEventDate(event.event_date ?? "");
    setNotes(event.notes ?? "");
    setResult(event.result ?? "");
    setStatusCode(event.status_code != null ? String(event.status_code) : "");
    setOperatorId(event.operator_user_id != null ? String(event.operator_user_id) : "");
    try {
      setMetadataText(JSON.stringify(event.metadata ?? {}, null, 2));
    } catch {
      setMetadataText("{}");
    }
    supabase
      .from("app_users")
      .select("id, full_name, username")
      .eq("is_active", true)
      .order("full_name")
      .then(({ data }) => setUsers(((data as any[]) ?? []) as AppUser[]));
  }, [open, event]);

  async function handleSave() {
    if (!event) return;
    if (isLegacyReadOnly) {
      toast.error("این رویداد از منبع قدیمی وارد شده و قابل ویرایش نیست");
      return;
    }
    let parsedMetadata: any = {};
    try {
      parsedMetadata = metadataText.trim() ? JSON.parse(metadataText) : {};
    } catch {
      toast.error("ساختار metadata معتبر نیست (JSON)");
      return;
    }
    const selectedUser = users.find((u) => u.id === operatorId);
    setSubmitting(true);

    const updates: any = {
      event_date: eventDate || null,
      notes: notes || null,
      result: result || null,
      status_code: statusCode ? Number(statusCode) : null,
      metadata: parsedMetadata,
      operator_name: selectedUser?.full_name ?? selectedUser?.username ?? event.operator_name,
    };

    const { error } = await supabase
      .from("livestock_fertility_events" as any)
      .update(updates)
      .eq("id", event.id);

    if (!error) {
      const { user } = getSession();
      await supabase.from("fertility_event_audit_logs" as any).insert({
        fertility_event_id: event.id,
        action: "updated",
        old_data: event as any,
        new_data: updates,
        user_id: user?.id ?? null,
      } as any);
    }

    setSubmitting(false);
    if (error) {
      toast.error("خطا در ذخیره: " + error.message);
      return;
    }
    toast.success("رویداد به‌روزرسانی شد");
    onOpenChange(false);
    onSuccess?.();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-right">
            ویرایش — {event ? fertilityEventLabel(event.event_type) : ""}
          </DialogTitle>
          <DialogDescription className="text-right">
            تغییر نوع رویداد و دام مقصد امکان‌پذیر نیست.
          </DialogDescription>
        </DialogHeader>

        {isLegacyReadOnly && (
          <div className="rounded-md bg-amber-50 border border-amber-200 text-amber-800 text-xs p-2">
            این رویداد از منبع «{event?.legacy_table_name}» وارد شده و فقط مدیر می‌تواند ویرایش کند.
          </div>
        )}

        <div className="space-y-3">
          <div>
            <Label>تاریخ رویداد</Label>
            <Input
              value={eventDate}
              onChange={(e) => setEventDate(e.target.value)}
              placeholder="مثال: 1404/02/15 یا 1404/02/15 14:30"
              disabled={isLegacyReadOnly}
            />
          </div>

          <div>
            <Label>اپراتور</Label>
            <Select
              value={operatorId}
              onValueChange={setOperatorId}
              dir="rtl"
              disabled={isLegacyReadOnly}
            >
              <SelectTrigger>
                <SelectValue placeholder="انتخاب کنید" />
              </SelectTrigger>
              <SelectContent>
                {users.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.full_name || u.username}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>نتیجه (result)</Label>
              <Input
                value={result}
                onChange={(e) => setResult(e.target.value)}
                disabled={isLegacyReadOnly}
              />
            </div>
            <div>
              <Label>کد وضعیت</Label>
              <Input
                type="number"
                value={statusCode}
                onChange={(e) => setStatusCode(e.target.value)}
                disabled={isLegacyReadOnly}
              />
            </div>
          </div>

          <div>
            <Label>یادداشت</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              disabled={isLegacyReadOnly}
            />
          </div>

          <div>
            <Label>اطلاعات تکمیلی (metadata - JSON)</Label>
            <Textarea
              value={metadataText}
              onChange={(e) => setMetadataText(e.target.value)}
              rows={5}
              dir="ltr"
              className="font-mono text-xs text-left"
              disabled={isLegacyReadOnly}
            />
          </div>

          <div className="flex gap-2 pt-2">
            <Button
              type="button"
              className="flex-1"
              onClick={handleSave}
              disabled={submitting || isLegacyReadOnly}
            >
              {submitting && <Loader2 className="w-4 h-4 animate-spin ml-2" />}
              ذخیره تغییرات
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
