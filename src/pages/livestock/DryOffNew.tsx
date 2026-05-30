// =============================================================================
// DryOffNew (ثبت خشکی)
// -----------------------------------------------------------------------------
// Standalone page for registering a cow dry-off event. Lives at
// `/livestock/dry-off/new` and is linked from the global sidebar.
//
// Required (manual) fields:
//   - cow selection (id)
//   - dry-off date (Jalali)
//   - dry-off reason (free text)
//   - notes / description (free text)
//   - operator (app_users)
//
// Auto-detected (read-only):
//   - pregnancy status  ← cow.is_pregnancy / fertility summary
//   - expected calving date ← derived in fertility risk engine
//   - destination pen/group ← livestock_locations row whose name
//     contains "خشک" (typically "گاو خشک و تلیسه آبستن بالا", id=2)
//
// Side effects on submit:
//   1) insert into `livestock_fertility_events` (event_type='dry_off')
//   2) update `cows`: is_dry=true, last_dry_date=now, last_location_id=<dry pen>,
//      last_location_date=now
//   3) invalidate / refresh cached fertility data via syncCowFertilityCache
// =============================================================================

import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Loader2, Droplet, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { syncCowFertilityCache } from "@/lib/syncCowFertilityCache";

// UI primitives
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import SearchableSelect from "@/components/SearchableSelect";
import JalaliDatePicker from "@/components/JalaliDatePicker";

// Date helpers
import { JalaliDate, todayJalali, formatJalali } from "@/lib/jalali";
import { toGregorianForDb } from "@/lib/toGregorianForDb";
import { formatShamsi } from "@/lib/dateDisplay";

// Cow fertility summary — used to auto-detect pregnancy + expected calving date.
import { useFertilitySummary } from "@/hooks/useFertilitySummary";

// --- Local types -------------------------------------------------------------
type CowOpt = {
  id: number;
  tag_number: string | null;
  bodynumber: number | null;
  earnumber: number | null;
  is_dry: boolean | null;
  is_pregnancy: boolean | null;
};

type AppUser = { id: string; full_name: string | null; username: string };

type DryLocation = { id: number; name: string };

// Compact label for the cow search picker.
function cowLabel(c: CowOpt) {
  const tag = c.tag_number ? c.tag_number : "";
  const body = c.bodynumber ? `بدنه ${c.bodynumber}` : "";
  const ear = c.earnumber ? `گوش ${c.earnumber}` : "";
  return [tag, body, ear].filter(Boolean).join(" / ") || `#${c.id}`;
}

export default function DryOffNew() {
  const navigate = useNavigate();
  // Optional `?cowId=<id>` query param. When present we auto-select that cow
  // so users coming from the cow profile / fertility actions don't have to
  // search again. Falls back to the manual searchable picker otherwise.
  const [searchParams] = useSearchParams();
  const prefilledCowId = searchParams.get("cowId") ?? "";

  // -- Lookup data -----------------------------------------------------------
  const [cows, setCows] = useState<CowOpt[]>([]);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [dryLocation, setDryLocation] = useState<DryLocation | null>(null);
  const [loadingLookups, setLoadingLookups] = useState(true);

  // -- Form state ------------------------------------------------------------
  const [cowId, setCowId] = useState<string>(prefilledCowId);
  const [date, setDate] = useState<JalaliDate | null>(todayJalali());
  const [reason, setReason] = useState("");
  const [description, setDescription] = useState("");
  const [operatorId, setOperatorId] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  // Duplicate-prevention guard. When the currently selected cow has an
  // active dry-off (latest dry_off event newer than latest calving event,
  // OR cows.is_dry === true) we block submission and show an inline alert
  // instead of letting the user create a duplicate row.
  const [activeDryBlock, setActiveDryBlock] = useState<string | null>(null);

  // Load eligible cows (female, in herd, not already dry) + operators + dry pen.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoadingLookups(true);

      // We intentionally do NOT filter is_dry=false on the server — a user might
      // want to inspect an already-dry cow. We highlight the badge in the UI.
      const [{ data: cowsData }, { data: usersData }, { data: locData }] = await Promise.all([
        supabase
          .from("cows")
          .select("id, tag_number, bodynumber, earnumber, is_dry, is_pregnancy, sex, existancestatus")
          .eq("sex", 0) // female only — only females can be dried off
          .in("existancestatus", [0]) // in-herd
          .order("bodynumber", { ascending: true })
          .limit(2000),
        supabase
          .from("app_users")
          .select("id, full_name, username")
          .eq("is_active", true)
          .order("full_name"),
        // Find the dry pen by name pattern; fallback handled below.
        supabase
          .from("livestock_locations")
          .select("id, name")
          .ilike("name", "%خشک%")
          .limit(1),
      ]);

      if (cancelled) return;
      setCows(((cowsData as any[]) ?? []) as CowOpt[]);
      setUsers(((usersData as any[]) ?? []) as AppUser[]);
      // Prefer a pen whose name contains "خشک"; otherwise fall back to id=2
      // (legacy convention: "گاو خشک و تلیسه آبستن بالا").
      const loc = (locData as any[])?.[0];
      setDryLocation(loc ? { id: loc.id, name: loc.name } : { id: 2, name: "گاو خشک و تلیسه آبستن بالا" });
      setLoadingLookups(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  // Currently selected cow (used for the auto-detected info panel).
  const selectedCow = useMemo(
    () => cows.find((c) => String(c.id) === cowId) ?? null,
    [cows, cowId],
  );

  // Pull the fertility summary for the selected cow so we can show the
  // auto-detected pregnancy status + expected calving date.
  const { summary, loading: summaryLoading } = useFertilitySummary(
    selectedCow?.id ?? null,
    {
      cow: selectedCow
        ? { id: selectedCow.id, is_dry: selectedCow.is_dry, is_pregnancy: selectedCow.is_pregnancy }
        : null,
    },
  );

  // Whenever the selected cow changes, look up the latest dry_off + calving
  // events for that cow and decide whether dry-off registration should be
  // blocked. This mirrors the same rule used in FertilitySection so both
  // entry points stay in sync: a cow is "currently dry" when either
  //   - cows.is_dry === true, OR
  //   - the latest non-cancelled dry_off event is newer than the latest
  //     non-cancelled calving event (i.e. no calving has reset the cycle).
  useEffect(() => {
    let cancelled = false;
    if (!selectedCow) {
      setActiveDryBlock(null);
      return;
    }
    if (selectedCow.is_dry) {
      setActiveDryBlock("این دام در حال حاضر خشک است و امکان ثبت مجدد خشکی وجود ندارد.");
      return;
    }
    (async () => {
      const { data } = await supabase
        .from("livestock_fertility_events" as any)
        .select("event_type, event_date, is_cancelled")
        .eq("livestock_id", selectedCow.id)
        // Include legacy alias 'dry' for backwards compatibility — old rows in the
        // database used event_type='dry' before we standardized on 'dry_off'. New
        // inserts always use 'dry_off' (see the insert below).
        .in("event_type", ["dry_off", "dry", "calving"])
        .order("event_date", { ascending: false })
        .limit(50);
      if (cancelled) return;
      const rows = ((data as any[]) ?? []).filter((r) => !r.is_cancelled);
      const lastDry =
        rows.find((r) => r.event_type === "dry_off" || r.event_type === "dry")?.event_date ?? null;
      const lastCalv = rows.find((r) => r.event_type === "calving")?.event_date ?? null;
      const active =
        !!lastDry && (!lastCalv || new Date(lastDry).getTime() > new Date(lastCalv).getTime());
      setActiveDryBlock(
        active
          ? "برای این دام یک رویداد خشک کردن فعال ثبت شده و هنوز زایش بعدی ثبت نشده است."
          : null,
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedCow]);

  // -- Submit handler --------------------------------------------------------
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;

    // Mandatory validation per spec: cow + date.
    if (!cowId) return toast.error("لطفاً دام را انتخاب کنید");
    if (!date) return toast.error("لطفاً تاریخ خشکی را انتخاب کنید");
    // Duplicate prevention — short-circuit before touching the DB.
    if (activeDryBlock) return toast.error(activeDryBlock);

    setSubmitting(true);
    try {
      const livestockId = Number(cowId);
      const operator = users.find((u) => String(u.id) === operatorId);
      const operatorName = operator?.full_name ?? operator?.username ?? null;

      // Snapshot the auto-detected context so we have an audit trail of what
      // the system "knew" at the moment of registration.
      const metadata = {
        dry_off_reason: reason.trim() || null,
        operator_name: operatorName,
        auto_detected: {
          is_pregnant: summary?.isPregnant ?? null,
          expected_calving_date: summary?.expectedCalvingDate
            ? summary.expectedCalvingDate.toISOString()
            : null,
          destination_location_id: dryLocation?.id ?? null,
          destination_location_name: dryLocation?.name ?? null,
        },
      } as Record<string, unknown>;

      // 1) Insert the fertility event row.
      const { error: evErr } = await supabase
        .from("livestock_fertility_events" as any)
        .insert({
          livestock_id: livestockId,
          event_type: "dry_off",
          // No dedicated fertility_operations row for dry-off in this DB.
          fertility_operation_id: null,
          event_date: toGregorianForDb(date, null),
          operator_user_id: null,
          operator_name: operatorName,
          notes: description.trim() || null,
          legacy_table_name: "manual",
          legacy_record_id: null,
          metadata,
        });
      if (evErr) {
        toast.error("خطا در ثبت خشکی: " + evErr.message);
        setSubmitting(false);
        return;
      }

      // 2) Update the cow row: mark dry, stamp dates, move to dry pen.
      const nowIso = new Date().toISOString();
      const cowPatch = {
        is_dry: true,
        last_dry_date: nowIso,
        ...(dryLocation?.id
          ? { last_location_id: dryLocation.id, last_location_date: nowIso }
          : {}),
      };
      const { error: cowErr } = await supabase
        .from("cows")
        .update(cowPatch)
        .eq("id", livestockId);

      if (cowErr) {
        // Event was already saved — surface the partial-failure clearly.
        toast.error("خشکی ثبت شد ولی به‌روزرسانی دام انجام نشد: " + cowErr.message);
      } else {
        // Refresh cached fertility derivations so the cow profile updates.
        await syncCowFertilityCache(livestockId);
        toast.success("خشکی با موفقیت ثبت شد");
      }

      // Navigate back to the cow profile so the user can verify.
      navigate(`/livestock/${livestockId}`);
    } finally {
      setSubmitting(false);
    }
  }

  // -- Render ----------------------------------------------------------------
  return (
    <div dir="rtl" className="max-w-3xl mx-auto p-4 lg:p-6 space-y-4">
      <header className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-2xl bg-gradient-primary flex items-center justify-center glow-primary">
          <Droplet className="w-5 h-5 text-primary-foreground" />
        </div>
        <div>
          <h1 className="text-2xl font-extrabold text-foreground">ثبت خشکی</h1>
          <p className="text-sm text-muted-foreground">Cow Dry-Off Registration</p>
        </div>
      </header>

      {loadingLookups ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">اطلاعات اصلی</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Cow selector — searchable list driven by tag/body/ear numbers */}
              <div className="space-y-1.5">
                <Label>
                  انتخاب دام (شماره گوش / بدنه) <span className="text-destructive">*</span>
                </Label>
                <SearchableSelect
                  value={cowId}
                  onChange={setCowId}
                  placeholder="جستجو و انتخاب دام..."
                  options={cows.map((c) => ({
                    value: String(c.id),
                    label: cowLabel(c) + (c.is_dry ? "  •  (در حال حاضر خشک)" : ""),
                  }))}
                />
              </div>

              {/* Dry-off date — Jalali picker, persisted as Gregorian to DB */}
              <div className="space-y-1.5">
                <Label>
                  تاریخ خشکی <span className="text-destructive">*</span>
                </Label>
                <JalaliDatePicker value={date} onChange={setDate} />
                {date && (
                  <p className="text-xs text-muted-foreground">
                    تاریخ انتخاب شده: {formatJalali(date)}
                  </p>
                )}
              </div>

              {/* Reason — free text, not strictly required by spec but kept */}
              <div className="space-y-1.5">
                <Label>دلیل خشکی</Label>
                <Input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="مثلاً پایان دوره شیردهی، کاهش تولید، آماده‌سازی برای زایش"
                />
              </div>

              {/* Operator */}
              <div className="space-y-1.5">
                <Label>ثبت‌کننده عملیات</Label>
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

              {/* Notes */}
              <div className="space-y-1.5">
                <Label>توضیحات</Label>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="اختیاری"
                  rows={3}
                />
              </div>
            </CardContent>
          </Card>

          {/* Auto-detected panel — read-only, refreshed when cow changes. */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">اطلاعات تشخیص خودکار سیستم</CardTitle>
            </CardHeader>
            <CardContent>
              {!selectedCow ? (
                <p className="text-sm text-muted-foreground">
                  پس از انتخاب دام، وضعیت آبستنی، تاریخ پیش‌بینی زایش و جایگاه مقصد به‌صورت
                  خودکار از داده‌های موجود استخراج می‌شود.
                </p>
              ) : summaryLoading ? (
                <div className="flex items-center gap-2 text-muted-foreground text-sm">
                  <Loader2 className="w-4 h-4 animate-spin" /> در حال محاسبه...
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                  <ReadOnlyField
                    label="وضعیت آبستنی"
                    value={
                      summary?.isPregnant === true
                        ? "آبستن"
                        : summary?.isPregnant === false
                        ? "غیر آبستن"
                        : "نامشخص"
                    }
                  />
                  <ReadOnlyField
                    label="تاریخ پیش‌بینی زایش"
                    value={
                      summary?.expectedCalvingDate
                        ? formatShamsi(summary.expectedCalvingDate.toISOString())
                        : "—"
                    }
                  />
                  <ReadOnlyField
                    label="جایگاه مقصد (گله خشک)"
                    value={dryLocation?.name ?? "—"}
                  />
                </div>
              )}
            </CardContent>
          </Card>

          {/* Duplicate-prevention banner — shown only when the selected cow
              is currently in an active dry-off cycle. Mirrors the same
              gating logic used inside FertilitySection. */}
          {activeDryBlock && (
            <div className="rounded-xl border border-destructive/40 bg-destructive/10 text-destructive px-3 py-2 flex items-start gap-2 text-sm">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <p>{activeDryBlock}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <Button type="submit" disabled={submitting || !!activeDryBlock} className="flex-1">
              {submitting && <Loader2 className="w-4 h-4 animate-spin ml-2" />}
              ثبت خشکی
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={submitting}
              onClick={() => navigate(-1)}
            >
              انصراف
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

// Small presentational helper for the read-only auto-detected panel.
function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-secondary/40 px-3 py-2">
      <p className="text-[11px] text-muted-foreground mb-1">{label}</p>
      <p className="font-bold text-foreground">{value}</p>
    </div>
  );
}
