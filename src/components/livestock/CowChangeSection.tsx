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
import { Textarea } from "@/components/ui/textarea";
import SearchableSelect from "@/components/SearchableSelect";
import JalaliDatePicker from "@/components/JalaliDatePicker";
import { JalaliDate, formatJalali, todayJalali } from "@/lib/jalali";

function parseJalaliString(s: string | null): JalaliDate | null {
  if (!s) return null;
  // Convert Persian digits to ASCII
  const ascii = s.replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)));
  const m = ascii.match(/(\d{4})\D(\d{1,2})\D(\d{1,2})/);
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}
import { toast } from "sonner";
// Universal Shamsi formatter — used so the date column on each history row
// renders consistently with the rest of the app.
import { formatShamsi } from "@/lib/dateDisplay";
import { Loader2, Pencil, Trash2, Plus, MapPin, Tag, HeartPulse } from "lucide-react";

export type CowChangeKind = "location" | "type" | "status";

type Config = {
  label: string; // single noun, e.g. "بهاربند"
  table: "cow_locations" | "cow_types" | "cow_statuses";
  refColumn: "location_id" | "type_id" | "status_id";
  refTable: "livestock_locations" | "livestock_types" | "livestock_statuses";
  Icon: typeof MapPin;
};

const CONFIGS: Record<CowChangeKind, Config> = {
  location: {
    label: "بهاربند",
    table: "cow_locations",
    refColumn: "location_id",
    refTable: "livestock_locations",
    Icon: MapPin,
  },
  type: {
    label: "نوع دسته‌بندی",
    table: "cow_types",
    refColumn: "type_id",
    refTable: "livestock_types",
    Icon: Tag,
  },
  status: {
    label: "وضعیت سلامت دام",
    table: "cow_statuses",
    refColumn: "status_id",
    refTable: "livestock_statuses",
    Icon: HeartPulse,
  },
};

type RefOption = { id: number; name: string };
type HistoryRow = {
  id: number;
  cow_id: number;
  event_date: string | null;
  created_at: string;
  ref_id: number | null;
  ref_name: string | null;
  description: string | null;
};

type Props = {
  cowId: number;
  kind: CowChangeKind;
  currentRefId: number | null;
  currentDate: string | null;
  onChanged?: () => void;
};

export default function CowChangeSection({ cowId, kind, currentRefId, currentDate, onChanged }: Props) {
  const cfg = CONFIGS[kind];
  const Icon = cfg.Icon;
  const [refs, setRefs] = useState<RefOption[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<HistoryRow | null>(null);
  const [deleting, setDeleting] = useState<HistoryRow | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [{ data: refData }, { data: histData }] = await Promise.all([
        (supabase as any).from(cfg.refTable).select("id, name").order("name"),
        (supabase as any)
          .from(cfg.table)
          .select(`id, cow_id, event_date, created_at, description, ${cfg.refColumn}, ref:${cfg.refTable}(id, name)`)
          .eq("cow_id", cowId)
          .eq("is_deleted", false)
          .order("event_date", { ascending: false })
          .order("created_at", { ascending: false })
          .limit(50),
      ]);
      if (cancelled) return;
      setRefs((refData ?? []) as RefOption[]);
      setHistory(
        ((histData ?? []) as any[]).map((r) => ({
          id: r.id,
          cow_id: r.cow_id,
          event_date: r.event_date,
          created_at: r.created_at,
          ref_id: r[cfg.refColumn] ?? r.ref?.id ?? null,
          ref_name: r.ref?.name ?? null,
          description: r.description ?? null,
        })),
      );
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [cowId, kind, reload]);

  const currentName = useMemo(() => {
    if (!currentRefId) return null;
    return refs.find((r) => r.id === currentRefId)?.name ?? history[0]?.ref_name ?? null;
  }, [currentRefId, refs, history]);

  function refreshAfterChange() {
    setReload((k) => k + 1);
    onChanged?.();
  }

  async function handleDelete() {
    if (!deleting) return;
    const { error } = await (supabase as any)
      .from(cfg.table)
      .update({ is_deleted: true, deleted_date: new Date().toISOString() })
      .eq("id", deleting.id);
    if (error) {
      toast.error("خطا در حذف: " + error.message);
      return;
    }
    toast.success("رکورد لغو شد");
    setDeleting(null);
    refreshAfterChange();
  }

  return (
    <section className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 inline-flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary shrink-0">
            <Icon className="w-4 h-4" />
          </span>
          <div className="min-w-0">
            <h2 className="text-body-lg font-bold text-foreground">{cfg.label}</h2>
            <p className="text-sm text-foreground mt-0.5 truncate">
              {currentName ? <span className="font-medium">{currentName}</span> : <span className="text-muted-foreground">ثبت نشده</span>}
            </p>
            {currentDate && (
              {/* currentDate ممکن است شمسی متنی یا ISO میلادی باشد. formatShamsi
                  هر دو حالت را به نمایش شمسی با ارقام فارسی تبدیل می‌کند تا
                  همه‌جای پروفایل دام تاریخ یک‌دست دیده شود. */}
              <p className="text-xs text-muted-foreground mt-0.5">آخرین تغییر: {formatShamsi(currentDate)}</p>
            )}
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
          تغییر {cfg.label}
        </Button>
      </div>

      <div className="space-y-2">
        <h3 className="text-xs font-bold text-muted-foreground">تاریخچه</h3>
        {loading ? (
          <div className="flex justify-center py-6 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : history.length === 0 ? (
          <p className="text-sm text-muted-foreground py-3 text-center">رکوردی ثبت نشده است</p>
        ) : (
          <ol className="space-y-2">
            {history.map((row, idx) => {
              const prev = history[idx + 1];
              return (
                <li key={row.id} className="rounded-lg border border-border bg-background p-3 space-y-1.5">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <p className="text-sm font-medium text-foreground">{row.ref_name ?? "—"}</p>
                    {/* Prefer the human-entered event_date (already Shamsi text in DB).
                        Fall back to created_at via the universal Shamsi formatter so
                        we never leak a Gregorian date into the timeline. */}
                    <span className="text-xs text-muted-foreground">{formatShamsi(row.event_date ?? row.created_at)}</span>
                  </div>
                  {prev?.ref_name && (
                    <p className="text-xs text-muted-foreground">از: {prev.ref_name}</p>
                  )}
                  {row.description && (
                    <p className="text-xs text-muted-foreground break-words">{row.description}</p>
                  )}
                  <div className="flex gap-2 pt-1">
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1 gap-1 h-8"
                      onClick={() => {
                        setEditing(row);
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
                      onClick={() => setDeleting(row)}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      حذف
                    </Button>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      <CowChangeFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        cowId={cowId}
        cfg={cfg}
        refs={refs}
        editing={editing}
        onSaved={() => {
          setFormOpen(false);
          setEditing(null);
          refreshAfterChange();
        }}
      />

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-right">حذف رکورد {cfg.label}</AlertDialogTitle>
            <AlertDialogDescription className="text-right">
              آیا از حذف این رکورد مطمئن هستید؟ این عملیات قابل بازگشت نیست.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>انصراف</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDelete}
            >
              حذف
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function CowChangeFormDialog({
  open,
  onOpenChange,
  cowId,
  cfg,
  refs,
  editing,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  cowId: number;
  cfg: Config;
  refs: RefOption[];
  editing: HistoryRow | null;
  onSaved: () => void;
}) {
  const [refId, setRefId] = useState<string>("");
  const [date, setDate] = useState<JalaliDate | null>(todayJalali());
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setRefId(editing.ref_id ? String(editing.ref_id) : "");
      setDate(parseJalaliString(editing.event_date) ?? todayJalali());
      setDescription(editing.description ?? "");
    } else {
      setRefId("");
      setDate(todayJalali());
      setDescription("");
    }
  }, [open, editing]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    if (!refId) return toast.error(`${cfg.label} را انتخاب کنید`);
    if (!date) return toast.error("تاریخ را انتخاب کنید");
    setSubmitting(true);
    const payload: any = {
      cow_id: cowId,
      [cfg.refColumn]: Number(refId),
      event_date: formatJalali(date),
      description: description || null,
      is_deleted: false,
    };
    let error;
    if (editing) {
      ({ error } = await (supabase as any).from(cfg.table).update(payload).eq("id", editing.id));
    } else {
      ({ error } = await (supabase as any).from(cfg.table).insert(payload));
    }
    setSubmitting(false);
    if (error) {
      toast.error("خطا در ذخیره: " + error.message);
      return;
    }
    toast.success(editing ? "رکورد به‌روزرسانی شد" : `${cfg.label} ثبت شد`);
    onSaved();
  }

  const options = refs.map((r) => ({ value: String(r.id), label: r.name }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-right">
            {editing ? "ویرایش" : "ثبت"} {cfg.label}
          </DialogTitle>
          <DialogDescription className="text-right">
            {cfg.label} جدید این دام را وارد کنید.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label>
              {cfg.label} <span className="text-destructive">*</span>
            </Label>
            <SearchableSelect
              options={options}
              value={refId}
              onChange={setRefId}
              placeholder={`انتخاب ${cfg.label}`}
            />
          </div>
          <div className="space-y-1.5">
            <Label>
              تاریخ تغییر <span className="text-destructive">*</span>
            </Label>
            <JalaliDatePicker value={date} onChange={setDate} />
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
