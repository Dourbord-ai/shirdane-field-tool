import { useEffect, useMemo, useState } from "react";
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
import {
  JalaliDate,
  formatJalali,
  todayJalali,
  jalaliToGregorian,
  gregorianToJalali,
} from "@/lib/jalali";
import { toast } from "sonner";
import { Loader2, Pencil, Ban, Plus, Milk, Sun, CloudSun, Moon } from "lucide-react";

type Period = 1 | 2 | 3;

type MilkRecord = {
  id: number;
  livestock_id: number;
  milk_amount: number;
  record_date: string; // Gregorian ISO yyyy-mm-dd
  period: Period;
  description: string | null;
  is_cancelled: boolean;
  cancel_reason: string | null;
  cancelled_at: string | null;
  registered_at: string;
  created_at: string;
};

const PERIOD_LABELS: Record<Period, string> = { 1: "صبح", 2: "ظهر", 3: "شب" };
const PERIOD_ICONS: Record<Period, React.ReactNode> = {
  1: <Sun className="w-4 h-4" />,
  2: <CloudSun className="w-4 h-4" />,
  3: <Moon className="w-4 h-4" />,
};

function isoToJalaliStr(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return formatJalali(gregorianToJalali(y, m, d));
}

function jalaliToIso(j: JalaliDate): string {
  const g = jalaliToGregorian(j.year, j.month, j.day);
  return `${g.year}-${String(g.month).padStart(2, "0")}-${String(g.day).padStart(2, "0")}`;
}

function todayIso(): string {
  return jalaliToIso(todayJalali());
}

type Props = {
  cowId: number;
  isFemale: boolean;
  onChanged?: () => void;
};

export default function MilkRecordsSection({ cowId, isFemale, onChanged }: Props) {
  const [rows, setRows] = useState<MilkRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<MilkRecord | null>(null);
  const [cancelling, setCancelling] = useState<MilkRecord | null>(null);
  const [cancelReason, setCancelReason] = useState("");

  // Form state
  const [date, setDate] = useState<JalaliDate>(todayJalali());
  const [period, setPeriod] = useState<Period>(1);
  const [amount, setAmount] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await (supabase as any)
        .from("livestock_milk_records")
        .select("*")
        .eq("livestock_id", cowId)
        .order("record_date", { ascending: false })
        .order("period", { ascending: false })
        .limit(60);
      if (cancelled) return;
      setRows((data ?? []) as MilkRecord[]);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [cowId, reload]);

  const visible = rows.filter((r) => !r.is_cancelled);
  const today = todayIso();
  const todays = visible.filter((r) => r.record_date === today);
  const todayTotal = todays.reduce((s, r) => s + Number(r.milk_amount || 0), 0);
  const byPeriodToday: Record<Period, MilkRecord | undefined> = {
    1: todays.find((r) => r.period === 1),
    2: todays.find((r) => r.period === 2),
    3: todays.find((r) => r.period === 3),
  };
  const latest = visible[0] ?? null;

  // 7-day average (sum per day, average across days with any record in last 7 calendar days)
  const sevenDayAvg = useMemo(() => {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 6);
    const cutoff = cutoffDate.toISOString().slice(0, 10);
    const recent = visible.filter((r) => r.record_date >= cutoff);
    const totals = new Map<string, number>();
    for (const r of recent) {
      totals.set(r.record_date, (totals.get(r.record_date) ?? 0) + Number(r.milk_amount || 0));
    }
    if (totals.size < 2) return null;
    const sum = Array.from(totals.values()).reduce((a, b) => a + b, 0);
    return sum / totals.size;
  }, [visible]);

  function refresh() {
    setReload((k) => k + 1);
    onChanged?.();
  }

  function openAdd(presetPeriod?: Period) {
    if (!isFemale) {
      toast.error("ثبت رکورد شیر فقط برای دام ماده مجاز است");
      return;
    }
    setEditing(null);
    setDate(todayJalali());
    setPeriod(presetPeriod ?? 1);
    setAmount("");
    setDescription("");
    setFormOpen(true);
  }

  function openEdit(r: MilkRecord) {
    setEditing(r);
    const [y, m, d] = r.record_date.split("-").map(Number);
    setDate(gregorianToJalali(y, m, d));
    setPeriod(r.period);
    setAmount(String(r.milk_amount));
    setDescription(r.description ?? "");
    setFormOpen(true);
  }

  async function handleSave() {
    if (!isFemale) {
      toast.error("ثبت رکورد شیر فقط برای دام ماده مجاز است");
      return;
    }
    const num = Number(amount);
    if (!isFinite(num) || num <= 0) {
      toast.error("مقدار شیر باید بزرگ‌تر از صفر باشد");
      return;
    }
    setSaving(true);
    const iso = jalaliToIso(date);
    const payload = {
      livestock_id: cowId,
      record_date: iso,
      period,
      milk_amount: num,
      description: description.trim() || null,
    };

    if (editing) {
      const { error } = await (supabase as any)
        .from("livestock_milk_records")
        .update(payload)
        .eq("id", editing.id);
      setSaving(false);
      if (error) {
        if ((error as any).code === "23505") {
          toast.error("برای این تاریخ و وعده، رکوردی قبلاً ثبت شده است");
        } else {
          toast.error("خطا در ذخیره: " + error.message);
        }
        return;
      }
      toast.success("رکورد شیر ویرایش شد");
    } else {
      // Pre-check duplicate so we can offer edit
      const { data: existing } = await (supabase as any)
        .from("livestock_milk_records")
        .select("*")
        .eq("livestock_id", cowId)
        .eq("record_date", iso)
        .eq("period", period)
        .eq("is_cancelled", false)
        .maybeSingle();
      if (existing) {
        setSaving(false);
        toast.error(
          `برای ${PERIOD_LABELS[period]} این روز رکوردی موجود است. آن را ویرایش کنید.`
        );
        openEdit(existing as MilkRecord);
        return;
      }
      const { error } = await (supabase as any)
        .from("livestock_milk_records")
        .insert(payload);
      setSaving(false);
      if (error) {
        if ((error as any).code === "23505") {
          toast.error("برای این تاریخ و وعده، رکوردی قبلاً ثبت شده است");
        } else {
          toast.error("خطا در ذخیره: " + error.message);
        }
        return;
      }
      toast.success("رکورد شیر ثبت شد");
    }
    setFormOpen(false);
    setEditing(null);
    refresh();
  }

  async function handleCancel() {
    if (!cancelling) return;
    const { error } = await (supabase as any)
      .from("livestock_milk_records")
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

  if (!isFemale) return null;

  return (
    <section className="rounded-xl border border-border bg-card p-4 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 inline-flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary shrink-0">
            <Milk className="w-4 h-4" />
          </span>
          <div>
            <h2 className="text-body-lg font-bold text-foreground">رکورد شیر</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              ثبت دوشش روزانه: صبح، ظهر، شب
            </p>
          </div>
        </div>
        <Button size="sm" className="gap-1 shrink-0" onClick={() => openAdd()}>
          <Plus className="w-4 h-4" />
          ثبت رکورد شیر
        </Button>
      </div>

      {/* Today summary */}
      <div className="rounded-lg border border-border bg-background p-3 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">امروز ({isoToJalaliStr(today)})</span>
          <span className="text-sm font-bold">
            مجموع روزانه: {todayTotal.toLocaleString("fa-IR")} کیلوگرم
          </span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {([1, 2, 3] as Period[]).map((p) => {
            const r = byPeriodToday[p];
            return (
              <button
                key={p}
                onClick={() => (r ? openEdit(r) : openAdd(p))}
                className={`rounded-lg border p-2 flex flex-col items-center gap-1 transition-colors ${
                  r
                    ? "border-primary/40 bg-primary/5"
                    : "border-dashed border-border hover:border-primary/40 hover:bg-muted/30"
                }`}
              >
                <span className="inline-flex items-center gap-1 text-xs font-medium">
                  {PERIOD_ICONS[p]}
                  {PERIOD_LABELS[p]}
                </span>
                <span className="text-sm font-bold">
                  {r ? `${Number(r.milk_amount).toLocaleString("fa-IR")} kg` : "—"}
                </span>
              </button>
            );
          })}
        </div>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            آخرین رکورد: {latest ? isoToJalaliStr(latest.record_date) : "—"}
            {latest && (
              <> • {PERIOD_LABELS[latest.period]} • {Number(latest.milk_amount).toLocaleString("fa-IR")} kg</>
            )}
          </span>
          {sevenDayAvg != null && (
            <span>میانگین ۷ روز: {sevenDayAvg.toFixed(1)} kg</span>
          )}
        </div>
      </div>

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
                className={`rounded-lg border border-border bg-background p-3 space-y-1 ${
                  r.is_cancelled ? "opacity-60" : ""
                }`}
              >
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-medium">{isoToJalaliStr(r.record_date)}</span>
                    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border bg-muted/40">
                      {PERIOD_ICONS[r.period]}
                      {PERIOD_LABELS[r.period]}
                    </span>
                    <span className="text-sm font-bold">
                      {Number(r.milk_amount).toLocaleString("fa-IR")} kg
                    </span>
                  </div>
                  {r.is_cancelled && (
                    <span className="text-[11px] px-2 py-0.5 rounded-full border bg-destructive/10 text-destructive border-destructive/20">
                      لغو شده
                    </span>
                  )}
                </div>
                {r.description && (
                  <p className="text-xs text-muted-foreground break-words">{r.description}</p>
                )}
                {r.is_cancelled && r.cancel_reason && (
                  <p className="text-[11px] text-destructive">دلیل لغو: {r.cancel_reason}</p>
                )}
                {!r.is_cancelled && (
                  <div className="flex gap-2 pt-1">
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1 gap-1 h-8"
                      onClick={() => openEdit(r)}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      ویرایش
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1 gap-1 h-8 text-destructive hover:text-destructive"
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

      {/* Form Dialog */}
      <Dialog open={formOpen} onOpenChange={(o) => !o && setFormOpen(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "ویرایش رکورد شیر" : "ثبت رکورد شیر"}</DialogTitle>
            <DialogDescription>
              برای هر دام در هر روز فقط یک رکورد در هر وعده مجاز است.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>تاریخ</Label>
              <JalaliDatePicker value={date} onChange={setDate} />
            </div>
            <div className="space-y-1.5">
              <Label>وعده دوشش</Label>
              <div className="grid grid-cols-3 gap-2">
                {([1, 2, 3] as Period[]).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPeriod(p)}
                    className={`rounded-lg border p-3 flex flex-col items-center gap-1 transition-colors ${
                      period === p
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border hover:bg-muted/40"
                    }`}
                  >
                    {PERIOD_ICONS[p]}
                    <span className="text-sm font-medium">{PERIOD_LABELS[p]}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="milk-amount">مقدار شیر (کیلوگرم)</Label>
              <Input
                id="milk-amount"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.1"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="مثلا 12.5"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="milk-desc">توضیحات (اختیاری)</Label>
              <Textarea
                id="milk-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
              />
            </div>
            <div className="flex gap-2 pt-2">
              <Button variant="outline" className="flex-1" onClick={() => setFormOpen(false)} disabled={saving}>
                انصراف
              </Button>
              <Button className="flex-1 gap-1" onClick={handleSave} disabled={saving}>
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                ذخیره
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Cancel confirm */}
      <AlertDialog open={!!cancelling} onOpenChange={(o) => !o && setCancelling(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>لغو رکورد شیر</AlertDialogTitle>
            <AlertDialogDescription>
              آیا از لغو این رکورد مطمئن هستید؟ این عملیات به صورت منطقی انجام می‌شود.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="cancel-reason">دلیل (اختیاری)</Label>
            <Textarea
              id="cancel-reason"
              rows={2}
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>بازگشت</AlertDialogCancel>
            <AlertDialogAction onClick={handleCancel} className="bg-destructive hover:bg-destructive/90">
              لغو رکورد
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
