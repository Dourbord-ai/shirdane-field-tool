// =============================================================================
// FertilitySettings.tsx  —  route: /settings/fertility
// -----------------------------------------------------------------------------
// Admin-facing form for the single `fertility_thresholds` row. Every value
// rendered in the Reproductive Action List report is driven by this row, so
// changes here propagate immediately to the report (we invalidate the
// `fertility_action_list` query in the update mutation).
//
// Layout: a single grouped card with three sections matching the conceptual
// buckets — waiting periods, check/recheck windows, and risk thresholds.
// =============================================================================

import { useEffect, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import {
  DEFAULT_FERTILITY_THRESHOLDS,
  type FertilityThresholds,
  useFertilityThresholds,
  useUpdateFertilityThresholds,
} from "@/hooks/useFertilityThresholds";

// -----------------------------------------------------------------------------
// Field definition for the form — keeps render & state-setup DRY.
// -----------------------------------------------------------------------------
interface FieldDef {
  key: keyof Omit<FertilityThresholds, "id" | "updated_at" | "updated_by">;
  label: string;
  hint?: string;
}

const SECTIONS: { title: string; fields: FieldDef[] }[] = [
  {
    title: "دوره انتظار اختیاری (VWP)",
    fields: [
      { key: "vwp_cow_days", label: "VWP گاو بالغ (روز پس از زایش)" },
      { key: "vwp_heifer_days", label: "VWP تلیسه (روز از تولد)" },
    ],
  },
  {
    title: "پنجره‌های تست",
    fields: [
      { key: "preg_check_window_min", label: "تست آبستنی — حداقل روز پس از تلقیح" },
      { key: "preg_check_window_max", label: "تست آبستنی — حداکثر روز پس از تلقیح" },
      { key: "recheck_window_min", label: "تست مجدد — حداقل روز پس از تست مثبت" },
      { key: "recheck_window_max", label: "تست مجدد — حداکثر روز پس از تست مثبت" },
    ],
  },
  {
    title: "آستانه‌های ریسک و دسته‌بندی",
    fields: [
      { key: "high_risk_dim", label: "DIM آستانه پرریسک" },
      { key: "high_risk_services", label: "تعداد تلقیح آستانه پرریسک" },
      { key: "high_risk_heats", label: "تعداد فحلی آستانه پرریسک" },
      { key: "repeat_breeder_services", label: "تعداد تلقیح Repeat Breeder" },
      { key: "chronic_breeder_services", label: "تعداد تلقیح Chronic Breeder" },
    ],
  },
  {
    title: "اعلان‌ها و سایر آستانه‌ها",
    fields: [
      {
        key: "close_to_calving_days",
        label: "نزدیک زایش (روز آبستنی)",
        hint: "بر اساس روزهای آبستنی (gestation) محاسبه می‌شود نه DIM.",
      },
      { key: "days_since_service_alert", label: "هشدار بازه پس از آخرین تلقیح" },
      { key: "days_since_heat_alert", label: "هشدار بازه پس از آخرین فحلی" },
      { key: "sync_due_recheck_days", label: "همزمان‌سازی — بازه پیگیری (روز)" },
    ],
  },
  {
    // Used by the «عملکرد باروری گله» report. Determines how many days
    // after a synchronization protocol ends an insemination is still
    // considered "caused by" that protocol.
    title: "انتساب تلقیح به همزمان‌سازی",
    fields: [
      {
        key: "sync_to_service_window_days",
        label: "پنجره انتساب تلقیح به پروتکل همزمانی (روز)",
        hint: "حداکثر فاصله مجاز بین پایان همزمانی و تلقیح برای انتساب به پروتکل (پیش‌فرض ۱۴).",
      },
    ],
  },
];

export default function FertilitySettings() {
  // The row from the DB (or in-memory defaults while loading). We mirror it
  // into local state so the inputs are controlled.
  const { data: row, isLoading } = useFertilityThresholds();
  const update = useUpdateFertilityThresholds();
  const [form, setForm] = useState<FertilityThresholds>(DEFAULT_FERTILITY_THRESHOLDS);

  // Sync local form whenever a fresh row arrives from the server.
  useEffect(() => {
    if (row) setForm(row);
  }, [row]);

  // Helper that produces the onChange handler for each numeric input.
  const onNum = (key: FieldDef["key"]) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value.replace(/[^\d-]/g, ""));
    setForm((f) => ({ ...f, [key]: Number.isFinite(v) ? v : 0 }));
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Strip bookkeeping fields before sending — DB recomputes updated_at.
    const { id: _id, updated_at: _u, updated_by: _ub, ...patch } = form;
    try {
      await update.mutateAsync(patch);
      toast({ title: "تنظیمات ذخیره شد", description: "آستانه‌های تولیدمثلی به‌روزرسانی شد." });
    } catch (err: any) {
      toast({
        title: "خطا در ذخیره تنظیمات",
        description: err?.message ?? String(err),
        variant: "destructive",
      });
    }
  };

  return (
    <div className="py-6 space-y-6" dir="rtl">
      <header>
        <h1 className="text-2xl font-extrabold text-foreground">تنظیمات تولیدمثل</h1>
        <p className="text-sm text-muted-foreground mt-1">
          آستانه‌های گزارش «گاوهای نیازمند اقدام تولیدمثلی» را از این صفحه مدیریت کنید.
        </p>
      </header>

      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          در حال بارگذاری…
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-6">
          {SECTIONS.map((section) => (
            <div
              key={section.title}
              className="rounded-2xl border border-border bg-card p-5 space-y-4"
            >
              <h2 className="text-lg font-bold text-foreground">{section.title}</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {section.fields.map((f) => (
                  <div key={f.key} className="space-y-1.5">
                    <Label htmlFor={f.key} className="text-sm text-foreground">
                      {f.label}
                    </Label>
                    <Input
                      id={f.key}
                      type="number"
                      inputMode="numeric"
                      min={0}
                      value={form[f.key] as number}
                      onChange={onNum(f.key)}
                      className="text-right"
                    />
                    {f.hint && (
                      <p className="text-xs text-muted-foreground">{f.hint}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}

          <div className="flex items-center justify-end gap-3">
            <Button type="submit" disabled={update.isPending} className="gap-2">
              {update.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              ذخیره تنظیمات
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
