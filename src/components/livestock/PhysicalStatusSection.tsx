import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import JalaliDatePicker from "@/components/JalaliDatePicker";
import { JalaliDate, formatJalali, todayJalali } from "@/lib/jalali";
import { toast } from "sonner";
import { Loader2, Pencil, Ban, Plus, Camera, Image as ImageIcon, Scale } from "lucide-react";
// formatShamsi: تبدیل هر رشته تاریخ (شمسی ذخیره‌شده یا ISO میلادی) به نمایش
// شمسی با ارقام فارسی. این کامپوننت رکوردهای فیزیکی را با record_date نمایش
// می‌دهد و باید همه‌جا فرمت یکسان داشته باشد.
import { formatShamsi } from "@/lib/dateDisplay";

const BUCKET = "livestock-physical-status-images";

type PhysicalStatus = {
  id: number;
  livestock_id: number;
  stature: number | null;
  weight: number | null;
  body_score: number | null;
  legs_score: number | null;
  feet_score: number | null;
  udder_height: number | null;
  teat_height: number | null;
  brisket: number | null;
  back: number | null;
  tails_head: number | null;
  record_date: string;
  description: string | null;
  image_path: string | null;
  image_url: string | null;
  is_cancelled: boolean;
  cancel_reason: string | null;
  created_at: string;
};

function parseJalaliString(s: string | null): JalaliDate | null {
  if (!s) return null;
  const ascii = s.replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)));
  const m = ascii.match(/(\d{4})\D(\d{1,2})\D(\d{1,2})/);
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

const FIELDS: { key: keyof PhysicalStatus; label: string }[] = [
  { key: "weight", label: "وزن (کیلوگرم)" },
  { key: "body_score", label: "امتیاز بدنی" },
  { key: "stature", label: "قد/قامت" },
  { key: "legs_score", label: "امتیاز پاها" },
  { key: "feet_score", label: "امتیاز سُم" },
  { key: "udder_height", label: "ارتفاع پستان" },
  { key: "teat_height", label: "ارتفاع سرپستانک" },
  { key: "brisket", label: "سینه (بریسکت)" },
  { key: "back", label: "پشت" },
  { key: "tails_head", label: "سر دم" },
];

type Props = {
  cowId: number;
  onChanged?: () => void;
};

export default function PhysicalStatusSection({ cowId, onChanged }: Props) {
  const [rows, setRows] = useState<PhysicalStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<PhysicalStatus | null>(null);
  const [cancelling, setCancelling] = useState<PhysicalStatus | null>(null);
  const [cancelReason, setCancelReason] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await (supabase as any)
        .from("livestock_physical_statuses")
        .select("*")
        .eq("livestock_id", cowId)
        .order("record_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(100);
      if (cancelled) return;
      setRows((data ?? []) as PhysicalStatus[]);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [cowId, reload]);

  const visible = rows.filter((r) => !r.is_cancelled);
  const latest = visible[0] ?? null;

  function refresh() {
    setReload((k) => k + 1);
    onChanged?.();
  }

  async function handleCancel() {
    if (!cancelling) return;
    const { error } = await (supabase as any)
      .from("livestock_physical_statuses")
      .update({
        is_cancelled: true,
        cancelled_at: new Date().toISOString(),
        cancel_reason: cancelReason || null,
      })
      .eq("id", cancelling.id);
    if (error) {
      toast.error("خطا در لغو: " + error.message);
      return;
    }
    toast.success("رکورد لغو شد");
    setCancelling(null);
    setCancelReason("");
    refresh();
  }

  return (
    <section className="rounded-xl border border-border bg-card p-4 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 inline-flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary shrink-0">
            <Scale className="w-4 h-4" />
          </span>
          <div>
            <h2 className="text-body-lg font-bold text-foreground">وضعیت فیزیکی و تصاویر دام</h2>
            <p className="text-xs text-muted-foreground mt-0.5">ارزیابی دوره‌ای بدن، وزن، امتیازات و عکس</p>
          </div>
        </div>
        <Button
          size="sm"
          className="gap-1 shrink-0"
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          <Plus className="w-4 h-4" />
          ثبت وضعیت فیزیکی جدید
        </Button>
      </div>

      {/* Latest summary */}
      {latest && (
        <div className="rounded-lg border border-border bg-background p-3 flex gap-3">
          {latest.image_url ? (
            <img
              src={latest.image_url}
              alt="آخرین تصویر دام"
              className="w-20 h-20 rounded-lg object-cover border border-border shrink-0"
            />
          ) : (
            <div className="w-20 h-20 rounded-lg border border-dashed border-border flex items-center justify-center text-muted-foreground shrink-0">
              <ImageIcon className="w-6 h-6 opacity-50" />
            </div>
          )}
          <div className="flex-1 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
            <div>
              <span className="text-muted-foreground">وزن: </span>
              <span className="font-medium">{latest.weight ?? "—"}</span>
            </div>
            <div>
              <span className="text-muted-foreground">امتیاز بدنی: </span>
              <span className="font-medium">{latest.body_score ?? "—"}</span>
            </div>
            <div className="col-span-2 text-xs text-muted-foreground">آخرین ارزیابی: {latest.record_date}</div>
          </div>
        </div>
      )}

      {/* History */}
      <div className="space-y-2">
        <h3 className="text-xs font-bold text-muted-foreground">تاریخچه</h3>
        {loading ? (
          <div className="flex justify-center py-6 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-3 text-center">رکوردی ثبت نشده است</p>
        ) : (
          <ol className="space-y-2">
            {rows.map((r) => (
              <li
                key={r.id}
                className={`rounded-lg border border-border bg-background p-3 space-y-2 ${
                  r.is_cancelled ? "opacity-60" : ""
                }`}
              >
                <div className="flex gap-3">
                  {r.image_url ? (
                    <img
                      src={r.image_url}
                      alt=""
                      className="w-16 h-16 rounded object-cover border border-border shrink-0"
                    />
                  ) : (
                    <div className="w-16 h-16 rounded border border-dashed border-border flex items-center justify-center text-muted-foreground shrink-0">
                      <ImageIcon className="w-5 h-5 opacity-40" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span className="text-xs text-muted-foreground">{r.record_date}</span>
                      {r.is_cancelled && (
                        <span className="text-[11px] px-2 py-0.5 rounded-full border bg-destructive/10 text-destructive border-destructive/20">
                          لغو شده
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
                      <div>
                        <span className="text-muted-foreground">وزن: </span>
                        <span>{r.weight ?? "—"}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">امتیاز بدنی: </span>
                        <span>{r.body_score ?? "—"}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">پاها: </span>
                        <span>{r.legs_score ?? "—"}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">سُم: </span>
                        <span>{r.feet_score ?? "—"}</span>
                      </div>
                    </div>
                    {r.description && (
                      <p className="text-xs text-muted-foreground break-words">{r.description}</p>
                    )}
                    {r.is_cancelled && r.cancel_reason && (
                      <p className="text-[11px] text-destructive">دلیل لغو: {r.cancel_reason}</p>
                    )}
                  </div>
                </div>
                {!r.is_cancelled && (
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1 gap-1 h-8"
                      onClick={() => {
                        setEditing(r);
                        setFormOpen(true);
                      }}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      ویرایش
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1 gap-1 h-8 text-destructive hover:bg-destructive/5"
                      onClick={() => setCancelling(r)}
                    >
                      <Ban className="w-3.5 h-3.5" />
                      لغو
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>

      <PhysicalStatusFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        cowId={cowId}
        editing={editing}
        onSaved={() => {
          setFormOpen(false);
          setEditing(null);
          refresh();
        }}
      />

      <AlertDialog open={!!cancelling} onOpenChange={(o) => !o && (setCancelling(null), setCancelReason(""))}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-right">لغو رکورد وضعیت فیزیکی</AlertDialogTitle>
            <AlertDialogDescription className="text-right">
              این رکورد به عنوان لغو شده علامت می‌خورد و از محاسبات آخرین وضعیت کنار گذاشته می‌شود.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label>دلیل لغو (اختیاری)</Label>
            <Textarea value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} rows={2} />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>انصراف</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleCancel}
            >
              لغو رکورد
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function PhysicalStatusFormDialog({
  open,
  onOpenChange,
  cowId,
  editing,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  cowId: number;
  editing: PhysicalStatus | null;
  onSaved: () => void;
}) {
  const [date, setDate] = useState<JalaliDate | null>(todayJalali());
  const [values, setValues] = useState<Record<string, string>>({});
  const [description, setDescription] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [existingImageUrl, setExistingImageUrl] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setDate(parseJalaliString(editing.record_date) ?? todayJalali());
      const v: Record<string, string> = {};
      for (const f of FIELDS) {
        const val = (editing as any)[f.key];
        v[f.key as string] = val == null ? "" : String(val);
      }
      setValues(v);
      setDescription(editing.description ?? "");
      setExistingImageUrl(editing.image_url);
      setImagePreview(null);
      setImageFile(null);
    } else {
      setDate(todayJalali());
      setValues({});
      setDescription("");
      setImageFile(null);
      setImagePreview(null);
      setExistingImageUrl(null);
    }
  }, [open, editing]);

  function onPickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setImageFile(f);
    const url = URL.createObjectURL(f);
    setImagePreview(url);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    if (!date) return toast.error("تاریخ را انتخاب کنید");
    setSubmitting(true);

    const numFields: Record<string, number | null> = {};
    for (const f of FIELDS) {
      const raw = values[f.key as string];
      numFields[f.key as string] = raw && raw.trim() !== "" ? Number(raw) : null;
    }

    const basePayload: any = {
      livestock_id: cowId,
      record_date: formatJalali(date),
      description: description || null,
      ...numFields,
    };

    let recordId = editing?.id;
    let error;
    if (editing) {
      ({ error } = await (supabase as any)
        .from("livestock_physical_statuses")
        .update(basePayload)
        .eq("id", editing.id));
    } else {
      const ins = await (supabase as any)
        .from("livestock_physical_statuses")
        .insert(basePayload)
        .select("id")
        .single();
      error = ins.error;
      recordId = ins.data?.id;
    }
    if (error) {
      setSubmitting(false);
      toast.error("خطا در ذخیره: " + error.message);
      return;
    }

    if (imageFile && recordId) {
      const ext = imageFile.name.split(".").pop() || "jpg";
      const path = `physical-statuses/${cowId}/${recordId}/${Date.now()}.${ext}`;
      const up = await supabase.storage.from(BUCKET).upload(path, imageFile, { upsert: true });
      if (up.error) {
        setSubmitting(false);
        toast.error("خطا در آپلود تصویر: " + up.error.message);
        return;
      }
      const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
      await (supabase as any)
        .from("livestock_physical_statuses")
        .update({ image_path: path, image_url: pub.publicUrl })
        .eq("id", recordId);
    }

    setSubmitting(false);
    toast.success(editing ? "رکورد به‌روزرسانی شد" : "وضعیت فیزیکی ثبت شد");
    onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-right">
            {editing ? "ویرایش وضعیت فیزیکی" : "ثبت وضعیت فیزیکی جدید"}
          </DialogTitle>
          <DialogDescription className="text-right">
            ارزیابی بدن، وزن، امتیازات و تصویر دام.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label>
              تاریخ ارزیابی <span className="text-destructive">*</span>
            </Label>
            <JalaliDatePicker value={date} onChange={setDate} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            {FIELDS.map((f) => (
              <div key={f.key as string} className="space-y-1.5">
                <Label className="text-xs">{f.label}</Label>
                <Input
                  type="number"
                  inputMode="decimal"
                  value={values[f.key as string] ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key as string]: e.target.value }))}
                  dir="ltr"
                  className="text-left"
                />
              </div>
            ))}
          </div>

          <div className="space-y-1.5">
            <Label>توضیحات</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="اختیاری"
              rows={3}
            />
          </div>

          <div className="space-y-1.5">
            <Label>تصویر دام</Label>
            <div className="flex items-center gap-3">
              <label className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-border bg-background cursor-pointer text-sm hover:bg-muted">
                <Camera className="w-4 h-4" />
                انتخاب تصویر
                <input type="file" accept="image/*" className="hidden" onChange={onPickImage} />
              </label>
              {(imagePreview || existingImageUrl) && (
                <img
                  src={imagePreview ?? existingImageUrl ?? ""}
                  alt="پیش‌نمایش"
                  className="w-16 h-16 rounded object-cover border border-border"
                />
              )}
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <Button type="submit" disabled={submitting} className="flex-1">
              {submitting && <Loader2 className="w-4 h-4 animate-spin ml-2" />}
              {editing ? "ذخیره تغییرات" : "ثبت"}
            </Button>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              انصراف
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
