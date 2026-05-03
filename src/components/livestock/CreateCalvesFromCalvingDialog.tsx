import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, CheckCircle2, Baby, AlertTriangle } from "lucide-react";
import { FertilityEvent } from "@/lib/fertility";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event: FertilityEvent | null;
  motherCowId: number;
  onSuccess?: () => void;
};

type CalfMeta = {
  index?: number;
  physical_status?: string;
  physical_status_label?: string;
  gender?: "male" | "female" | string;
  gender_label?: string;
  calf_record_type?: "new" | "existing" | string;
  body_number?: string | null;
  ear_number?: string | null;
  birth_weight?: number | null;
  notes?: string | null;
  image_url?: string | null;
  created_cow_id?: number | null;
  created_at?: string | null;
  creation_status?: string | null;
};

export default function CreateCalvesFromCalvingDialog({
  open,
  onOpenChange,
  event,
  motherCowId,
  onSuccess,
}: Props) {
  const initialCalves: CalfMeta[] = useMemo(() => {
    const m = (event?.metadata ?? {}) as any;
    return Array.isArray(m?.calves) ? (m.calves as CalfMeta[]) : [];
  }, [event]);

  const [calves, setCalves] = useState<CalfMeta[]>(initialCalves);
  const [busyIdx, setBusyIdx] = useState<number | null>(null);
  const [confirmDeadIdx, setConfirmDeadIdx] = useState<number | null>(null);
  const [overrides, setOverrides] = useState<Record<number, { ear_number: string; body_number: string }>>({});

  // Reset state when dialog opens
  useState(() => {
    setCalves(initialCalves);
  });

  function getOverride(idx: number, c: CalfMeta) {
    return (
      overrides[idx] ?? {
        ear_number: c.ear_number ?? "",
        body_number: c.body_number ?? "",
      }
    );
  }

  function updateOverride(idx: number, patch: Partial<{ ear_number: string; body_number: string }>) {
    setOverrides((prev) => ({
      ...prev,
      [idx]: { ...getOverride(idx, calves[idx]), ...patch },
    }));
  }

  async function handleCreate(idx: number, force = false) {
    if (!event) return;
    const c = calves[idx];
    if (c.created_cow_id) {
      toast.info("این گوساله قبلاً ثبت شده است");
      return;
    }

    const ov = getOverride(idx, c);
    const ear = (ov.ear_number || "").trim();
    const body = (ov.body_number || "").trim();

    if (!c.gender) return toast.error("جنسیت گوساله مشخص نیست");
    if (!ear) return toast.error("شماره گوش الزامی است");

    const isDead = c.physical_status === "dead";
    if (isDead && !force) {
      setConfirmDeadIdx(idx);
      return;
    }

    setBusyIdx(idx);
    try {
      // Uniqueness check
      const { data: dup } = await supabase
        .from("cows")
        .select("id")
        .or(`tag_number.eq.${ear},earnumber.eq.${ear}`)
        .limit(1);
      if (dup && dup.length > 0) {
        toast.error("شماره گوش تکراری است");
        return;
      }

      // Generate next id
      const { data: maxRow } = await supabase
        .from("cows")
        .select("id")
        .order("id", { ascending: false })
        .limit(1);
      const nextId = ((maxRow?.[0]?.id as number | undefined) ?? 0) + 1;

      const isFemale = c.gender === "female";
      const earNum = Number(ear);
      const bodyNum = body ? Number(body) : null;

      const insertPayload: any = {
        id: nextId,
        tag_number: ear,
        earnumber: !isNaN(earNum) ? earNum : null,
        bodynumber: bodyNum && !isNaN(bodyNum) ? bodyNum : null,
        sex: isFemale ? 0 : 1,
        sextype: isFemale ? "ماده" : "نر",
        presence_status: isDead ? 2 : 0,
        existancestatus: isDead ? 0 : 1,
        last_fertility_status: null,
        is_dry: isFemale ? null : null,
      };

      const { error: insErr } = await supabase.from("cows").insert(insertPayload);
      if (insErr) {
        toast.error("خطا در ایجاد دام: " + insErr.message);
        return;
      }

      // Update event metadata
      const updatedCalves = calves.map((cc, i) =>
        i === idx
          ? {
              ...cc,
              ear_number: ear,
              body_number: body || null,
              created_cow_id: nextId,
              created_at: new Date().toISOString(),
              creation_status: "created",
            }
          : cc,
      );
      const newMeta = { ...((event.metadata as any) ?? {}), calves: updatedCalves };
      const { error: updErr } = await supabase
        .from("livestock_fertility_events" as any)
        .update({ metadata: newMeta })
        .eq("id", event.id);
      if (updErr) {
        toast.error("دام ایجاد شد ولی به‌روزرسانی رویداد انجام نشد: " + updErr.message);
      } else {
        toast.success("دام با موفقیت ایجاد شد");
      }
      setCalves(updatedCalves);
      onSuccess?.();
    } finally {
      setBusyIdx(null);
      setConfirmDeadIdx(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-right flex items-center gap-2">
            <Baby className="w-5 h-5 text-primary" />
            ایجاد دام از اطلاعات گوساله‌ها
          </DialogTitle>
          <DialogDescription className="text-right">
            بررسی کنید و برای هر گوساله، رکورد دام جدید ایجاد کنید.
          </DialogDescription>
        </DialogHeader>

        {calves.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            اطلاعات گوساله‌ای برای این رویداد ثبت نشده است.
          </p>
        ) : (
          <div className="space-y-3">
            {calves.map((c, idx) => {
              const created = !!c.created_cow_id;
              const isDead = c.physical_status === "dead";
              const ov = getOverride(idx, c);
              const askConfirm = confirmDeadIdx === idx;
              return (
                <div
                  key={idx}
                  className="rounded-lg border border-border bg-muted/20 p-3 space-y-2"
                >
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="font-bold text-sm">
                      گوساله {(idx + 1).toLocaleString("fa-IR")}
                    </div>
                    <div className="flex items-center gap-1 flex-wrap">
                      {c.gender_label && (
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground">
                          {c.gender_label}
                        </span>
                      )}
                      {c.physical_status_label && (
                        <span
                          className={`text-[11px] px-2 py-0.5 rounded-full ${
                            isDead
                              ? "bg-destructive/10 text-destructive"
                              : "bg-primary/10 text-primary"
                          }`}
                        >
                          {c.physical_status_label}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                    {c.birth_weight != null && (
                      <div>وزن تولد: {Number(c.birth_weight).toLocaleString("fa-IR")} کیلوگرم</div>
                    )}
                    {c.calf_record_type && (
                      <div>
                        نوع: {c.calf_record_type === "new" ? "ثبت جدید" : "موجود"}
                      </div>
                    )}
                  </div>

                  {c.notes && (
                    <p className="text-xs text-muted-foreground">{c.notes}</p>
                  )}

                  {c.image_url && (
                    <img
                      src={c.image_url}
                      alt={`گوساله ${idx + 1}`}
                      className="w-24 h-24 rounded-md object-cover border border-border"
                    />
                  )}

                  {created ? (
                    <div className="flex items-center gap-2 rounded-md bg-primary/5 border border-primary/20 p-2 text-sm text-primary">
                      <CheckCircle2 className="w-4 h-4" />
                      این گوساله قبلاً به دام تبدیل شده است
                      <span className="text-xs text-muted-foreground">
                        (#{c.created_cow_id})
                      </span>
                    </div>
                  ) : (
                    <>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <Label className="text-xs">شماره گوش *</Label>
                          <Input
                            value={ov.ear_number}
                            onChange={(e) => updateOverride(idx, { ear_number: e.target.value })}
                            dir="ltr"
                            className="h-9 text-left"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">شماره بدن</Label>
                          <Input
                            value={ov.body_number}
                            onChange={(e) => updateOverride(idx, { body_number: e.target.value })}
                            dir="ltr"
                            className="h-9 text-left"
                          />
                        </div>
                      </div>

                      {askConfirm && (
                        <div className="rounded-md bg-destructive/5 border border-destructive/20 p-2 text-xs space-y-2">
                          <div className="flex items-center gap-1.5 text-destructive">
                            <AlertTriangle className="w-4 h-4" />
                            این گوساله فوتی است. آیا می‌خواهید رکورد غیرفعال ایجاد کنید؟
                          </div>
                          <div className="flex gap-2">
                            <Button
                              type="button"
                              size="sm"
                              variant="destructive"
                              onClick={() => handleCreate(idx, true)}
                              disabled={busyIdx === idx}
                            >
                              {busyIdx === idx && (
                                <Loader2 className="w-3 h-3 ml-1 animate-spin" />
                              )}
                              تأیید و ایجاد
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => setConfirmDeadIdx(null)}
                            >
                              انصراف
                            </Button>
                          </div>
                        </div>
                      )}

                      {!askConfirm && (
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => handleCreate(idx)}
                          disabled={busyIdx === idx}
                          className="w-full"
                        >
                          {busyIdx === idx && (
                            <Loader2 className="w-3 h-3 ml-1 animate-spin" />
                          )}
                          ایجاد رکورد دام
                        </Button>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
