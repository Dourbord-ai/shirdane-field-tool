// ---------------------------------------------------------------------------
// MilkRecordsReport — Executive milk production dashboard (Version 3)
// Mounts under /reports → tab "رکورد شیر".
//
// V3 changes (per user request):
//   • Baseline picker is now RECORD-BASED, not day-based:
//       prev3   → سه رکورد قبلی  (last 3 milk records for the cow)
//       prev6   → شش رکورد قبلی
//       prev12  → دوازده رکورد قبلی
//     Farm-level KPI uses the union of these per-cow baseline dates, but the
//     per-cow alerts (which the messaging worker will consume) always use
//     each cow's OWN last-N records — so a cow milked irregularly is judged
//     against its own history, not the herd's calendar.
//   • Default «آستانه هشدار» raised to 20% (was 10%).
//   • New «هشدار افت/افزایش تولید» section: per-cow alerts with kg + percent
//     difference, plus a button to persist them into
//     public.milk_production_alerts so a future SMS / push worker can pick
//     them up. Re-running for the same (cow, date, baseline, session)
//     upserts safely thanks to the unique index.
//   • All on-screen dates remain Shamsi.
// ---------------------------------------------------------------------------
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import ReactECharts from "echarts-for-react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { GlobalCard, KPIWidget } from "@/components/global/KPIWidget";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { formatShamsi } from "@/lib/dateDisplay";
import {
  toPersianDigits, gregorianToJalali, jalaliToGregorian,
} from "@/lib/jalali";
import ShamsiDatePicker from "@/components/ShamsiDatePicker";
import {
  AlertTriangle, ArrowDown, ArrowRight, ArrowUp, BellRing, Filter, Milk, Save,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// ------ Constants -----------------------------------------------------------
const SESSIONS: Record<number, string> = { 1: "صبح", 2: "ظهر", 3: "عصر" };
const SESSION_COLORS: Record<number, string> = {
  1: "#fbbf24",
  2: "#22d3ee",
  3: "#a78bfa",
};

// NEW — Record-based baseline. Each key maps to N = number of previous
// milk records (per cow) used to compute the baseline average.
type BaselineKey = "prev3" | "prev6" | "prev12";
const BASELINE_LABEL: Record<BaselineKey, string> = {
  prev3: "سه رکورد قبلی",
  prev6: "شش رکورد قبلی",
  prev12: "دوازده رکورد قبلی",
};
const BASELINE_N: Record<BaselineKey, number> = { prev3: 3, prev6: 6, prev12: 12 };

// ------ Date helpers --------------------------------------------------------
function isoLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d); x.setDate(x.getDate() + n); return x;
}
function isoToShamsiString(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const j = gregorianToJalali(y, m, d);
  return `${j.year}/${String(j.month).padStart(2, "0")}/${String(j.day).padStart(2, "0")}`;
}
function shamsiStringToIso(s: string): string {
  const [jy, jm, jd] = s.split("/").map(Number);
  const g = jalaliToGregorian(jy, jm, jd);
  return `${g.year}-${String(g.month).padStart(2, "0")}-${String(g.day).padStart(2, "0")}`;
}

// ------ Format helpers ------------------------------------------------------
function fmtKg(n: number): string {
  return toPersianDigits(n.toLocaleString("en-US", { maximumFractionDigits: 1 })) + " kg";
}
function fmtKgSigned(n: number): string {
  // For diff_kg display: explicit sign so "+2.4" / "−3.1" are unambiguous.
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sign}${toPersianDigits(Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 1 }))} kg`;
}
function fmtPct(n: number): string {
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  const abs = Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 1 });
  return `${sign}${toPersianDigits(abs)}%`;
}

// ============================================================================
export default function MilkRecordsReport() {
  // -- Global filter state --------------------------------------------------
  const [date, setDate] = useState<string>(() => isoLocal(new Date()));
  const [session, setSession] = useState<"all" | "1" | "2" | "3">("all");
  const [cowFilter, setCowFilter] = useState<string>("");
  const [range, setRange] = useState<7 | 30 | 90>(7);
  // NEW — record-based baseline; default threshold bumped to 20%.
  const [baseline, setBaseline] = useState<BaselineKey>("prev3");
  const [threshold, setThreshold] = useState<number>(20);

  const queryClient = useQueryClient();
  const rangeFrom = useMemo(() => isoLocal(addDays(new Date(date), -(range - 1))), [date, range]);
  const baselineN = BASELINE_N[baseline];

  // -------------------------------------------------------------------------
  // Q-CORE — One wide fetch that powers KPIs, top-10, and per-cow alerts.
  //
  // We pull every record from the previous 120 days for cows that have at
  // least one record on `date`. 120 days is enough to almost always cover
  // 12 previous records even for cows milked twice a week, while keeping
  // the payload bounded. Slicing per-cow happens in JS.
  // -------------------------------------------------------------------------
  const core = useQuery({
    queryKey: ["milk-core", date, session, baseline],
    queryFn: async () => {
      // Step 1 — Find cows that produced milk on the reference date.
      let todayQ = supabase
        .from("livestock_milk_records")
        .select("livestock_id, milk_amount, period")
        .eq("record_date", date)
        .or("is_cancelled.is.null,is_cancelled.eq.false");
      if (session !== "all") todayQ = todayQ.eq("period", Number(session));
      const { data: todayRows, error: e1 } = await todayQ;
      if (e1) throw e1;

      // Per-cow total for today (sums across sessions if session = "all").
      const todayByCow = new Map<number, number>();
      for (const r of todayRows || []) {
        const id = Number(r.livestock_id);
        todayByCow.set(id, (todayByCow.get(id) || 0) + Number(r.milk_amount || 0));
      }
      const cowIds = Array.from(todayByCow.keys());

      // Animal numbers (denormalised onto alerts table later).
      const numbers = new Map<number, string>();
      if (cowIds.length) {
        const { data: items } = await supabase
          .from("livestock_items").select("id, animal_number").in("id", cowIds as any);
        for (const it of items || []) numbers.set(Number(it.id), String(it.animal_number ?? it.id));
      }

      // Step 2 — Pull historic records for those cows in a 120-day window
      // before `date`. We slice per-cow in JS to get the last N records.
      const windowFrom = isoLocal(addDays(new Date(date), -120));
      const windowTo = isoLocal(addDays(new Date(date), -1));
      let histRows: Array<{ livestock_id: number; milk_amount: number; record_date: string; period: number }> = [];
      if (cowIds.length) {
        let histQ = supabase
          .from("livestock_milk_records")
          .select("livestock_id, milk_amount, record_date, period")
          .in("livestock_id", cowIds as any)
          .gte("record_date", windowFrom)
          .lte("record_date", windowTo)
          .or("is_cancelled.is.null,is_cancelled.eq.false")
          .order("record_date", { ascending: false })
          .limit(10000);
        if (session !== "all") histQ = histQ.eq("period", Number(session));
        const { data, error: e2 } = await histQ;
        if (e2) throw e2;
        histRows = (data || []).map((r) => ({
          livestock_id: Number(r.livestock_id),
          milk_amount: Number(r.milk_amount || 0),
          record_date: r.record_date as string,
          period: Number(r.period),
        }));
      }

      // Step 3 — Build per-cow analysis: today, last-N average, diff.
      //
      // "Record" here = one (record_date, period) entry per cow. When the
      // session filter is "all" we still treat each period as a separate
      // record so prev3 = "last 3 sessions" rather than "last 3 days".
      const perCow: Array<{
        livestock_id: number;
        animal_number: string;
        today: number;
        base: number;          // average of last N records (kg per record)
        baseDailyAvg: number;  // for the farm-level KPI, average daily kg
        diff_kg: number;
        diff_pct: number;
        records_used: number;
        baseline_dates: string[];
      }> = [];

      // Group historic rows by cow.
      const histByCow = new Map<number, Array<{ record_date: string; period: number; milk_amount: number }>>();
      for (const r of histRows) {
        const arr = histByCow.get(r.livestock_id) || [];
        arr.push(r);
        histByCow.set(r.livestock_id, arr);
      }

      for (const id of cowIds) {
        // Already ordered desc by record_date thanks to the query, but we
        // also need to break ties on period — newer period first within a day.
        const arr = (histByCow.get(id) || []).slice().sort((a, b) => {
          if (a.record_date < b.record_date) return 1;
          if (a.record_date > b.record_date) return -1;
          return b.period - a.period;
        });
        const lastN = arr.slice(0, baselineN);
        const recordsUsed = lastN.length;
        const sumN = lastN.reduce((s, r) => s + r.milk_amount, 0);
        const base = recordsUsed > 0 ? sumN / recordsUsed : 0;
        // For the herd KPI we want kg/day, so aggregate baseline by date and
        // average the daily totals instead of per-record values.
        const dailyMap = new Map<string, number>();
        for (const r of lastN) {
          dailyMap.set(r.record_date, (dailyMap.get(r.record_date) || 0) + r.milk_amount);
        }
        const baseDailyAvg = dailyMap.size > 0
          ? Array.from(dailyMap.values()).reduce((a, b) => a + b, 0) / dailyMap.size
          : 0;
        const today = todayByCow.get(id) || 0;
        // Comparison is record-vs-record: today's kg (this session or full
        // day depending on filter) against the per-record average.
        const refToday = session === "all" ? today : today; // unchanged either way
        const refBase = session === "all" ? baseDailyAvg : base;
        const diff_kg = Number((refToday - refBase).toFixed(2));
        const diff_pct = refBase > 0 ? Number((((refToday - refBase) / refBase) * 100).toFixed(2)) : 0;
        perCow.push({
          livestock_id: id,
          animal_number: numbers.get(id) || String(id),
          today: Number(refToday.toFixed(2)),
          base: Number(refBase.toFixed(2)),
          baseDailyAvg: Number(baseDailyAvg.toFixed(2)),
          diff_kg,
          diff_pct,
          records_used: recordsUsed,
          baseline_dates: Array.from(dailyMap.keys()).sort(),
        });
      }

      // Herd-level KPI: sum of today and sum of baseline daily averages.
      const todayTotal = perCow.reduce((s, c) => s + c.today, 0);
      const baseTotal = perCow.reduce((s, c) => s + c.baseDailyAvg, 0);
      const change = baseTotal > 0 ? ((todayTotal - baseTotal) / baseTotal) * 100 : 0;
      const avg = perCow.length > 0 ? todayTotal / perCow.length : 0;

      return {
        perCow,
        todayTotal,
        baseTotal,
        change,
        avg,
        cowCount: perCow.length,
      };
    },
  });

  // -------------------------------------------------------------------------
  // Trend chart query (unchanged behaviour: daily totals over [rangeFrom..date])
  // -------------------------------------------------------------------------
  const trend = useQuery({
    queryKey: ["milk-trend", rangeFrom, date, session],
    queryFn: async () => {
      let q = supabase
        .from("livestock_milk_records")
        .select("record_date, milk_amount, period")
        .gte("record_date", rangeFrom)
        .lte("record_date", date)
        .or("is_cancelled.is.null,is_cancelled.eq.false");
      if (session !== "all") q = q.eq("period", Number(session));
      const { data, error } = await q;
      if (error) throw error;
      const byDay = new Map<string, number>();
      for (const r of data || []) {
        byDay.set(r.record_date, (byDay.get(r.record_date) || 0) + Number(r.milk_amount || 0));
      }
      const days: string[] = [];
      const values: number[] = [];
      for (let i = 0; i < range; i++) {
        const d = isoLocal(addDays(new Date(rangeFrom), i));
        days.push(d);
        values.push(Number((byDay.get(d) || 0).toFixed(1)));
      }
      return { days, values };
    },
  });

  // Session breakdown for the selected day (always shows all 3 sessions).
  const sessionBreakdown = useQuery({
    queryKey: ["milk-session", date],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("livestock_milk_records")
        .select("milk_amount, period")
        .eq("record_date", date)
        .or("is_cancelled.is.null,is_cancelled.eq.false");
      if (error) throw error;
      const acc: Record<number, number> = { 1: 0, 2: 0, 3: 0 };
      for (const r of data || []) acc[Number(r.period)] = (acc[Number(r.period)] || 0) + Number(r.milk_amount || 0);
      const total = acc[1] + acc[2] + acc[3];
      return { values: acc, total };
    },
  });

  // -------------------------------------------------------------------------
  // Derived: top-10 cows (sorted by today desc) and the alerts list.
  // -------------------------------------------------------------------------
  const filteredCows = useMemo(() => {
    const all = core.data?.perCow || [];
    return all
      .filter((r) => !cowFilter.trim() || r.animal_number.includes(cowFilter.trim()))
      .sort((a, b) => b.today - a.today);
  }, [core.data, cowFilter]);

  const topRows = useMemo(() => filteredCows.slice(0, 10), [filteredCows]);

  // Alerts = every cow whose |Δ%| crosses the threshold AND has at least
  // one baseline record (otherwise there's nothing to compare against).
  const alerts = useMemo(() => {
    const t = threshold || 0;
    if (t <= 0) return [];
    return filteredCows
      .filter((c) => c.records_used > 0 && Math.abs(c.diff_pct) >= t)
      // Most severe drops first; surges after.
      .sort((a, b) => a.diff_pct - b.diff_pct);
  }, [filteredCows, threshold]);

  const drops = alerts.filter((a) => a.diff_pct < 0);
  const surges = alerts.filter((a) => a.diff_pct > 0);

  // -------------------------------------------------------------------------
  // Persist alerts: bulk-upsert to public.milk_production_alerts.
  // The DB has a unique index on (livestock_id, reference_date, baseline_mode,
  // COALESCE(session,'all')) so re-running for the same combo updates rather
  // than duplicates.
  // -------------------------------------------------------------------------
  const persistAlerts = useMutation({
    mutationFn: async () => {
      if (alerts.length === 0) throw new Error("هیچ هشداری برای ثبت وجود ندارد.");
      const rows = alerts.map((a) => ({
        livestock_id: a.livestock_id,
        animal_number: a.animal_number,
        reference_date: date,
        baseline_mode: baseline,
        baseline_records_count: a.records_used,
        session: session === "all" ? null : session,
        today_kg: a.today,
        baseline_kg: a.base,
        diff_kg: a.diff_kg,
        diff_pct: a.diff_pct,
        threshold_pct: threshold,
        direction: a.diff_pct < 0 ? "drop" : "surge",
        status: "open",
      }));
      const { error } = await supabase
        .from("milk_production_alerts")
        .upsert(rows as any, {
          // Match the functional unique index. Supabase needs the column list
          // here even though the actual uniqueness comes from a partial expr.
          onConflict: "livestock_id,reference_date,baseline_mode,session",
        });
      if (error) throw error;
      return rows.length;
    },
    onSuccess: (n) => {
      toast.success(`${toPersianDigits(n)} هشدار ذخیره شد`);
      queryClient.invalidateQueries({ queryKey: ["milk-alerts-saved"] });
    },
    onError: (err: any) => {
      toast.error(err?.message || "خطا در ذخیره هشدارها");
    },
  });

  // List of previously-saved alerts for this reference date (so the user
  // can confirm the messaging queue already has them).
  const savedAlerts = useQuery({
    queryKey: ["milk-alerts-saved", date, baseline, session],
    queryFn: async () => {
      let q = supabase
        .from("milk_production_alerts")
        .select("id, animal_number, today_kg, baseline_kg, diff_kg, diff_pct, direction, status, created_at")
        .eq("reference_date", date)
        .eq("baseline_mode", baseline)
        .order("diff_pct", { ascending: true });
      if (session === "all") q = q.is("session", null);
      else q = q.eq("session", session);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
  });

  // -------------------------------------------------------------------------
  // ECharts options
  // -------------------------------------------------------------------------
  const trendOption = useMemo(() => {
    const days = trend.data?.days || [];
    const values = trend.data?.values || [];
    return {
      grid: { left: 48, right: 16, top: 24, bottom: 56 },
      tooltip: {
        trigger: "axis",
        formatter: (params: any) => {
          const p = params?.[0]; if (!p) return "";
          return `${formatShamsi(p.axisValue)}<br/><b>${toPersianDigits(p.data)}</b> kg`;
        },
      },
      xAxis: {
        type: "category", data: days, boundaryGap: false,
        axisLabel: { formatter: (v: string) => formatShamsi(v).slice(5), color: "#94a3b8" },
      },
      yAxis: {
        type: "value",
        axisLabel: { color: "#94a3b8", formatter: (v: number) => toPersianDigits(v) },
        splitLine: { lineStyle: { color: "rgba(255,255,255,0.06)" } },
      },
      dataZoom: [
        { type: "inside" },
        { type: "slider", height: 18, bottom: 12, borderColor: "transparent" },
      ],
      series: [{
        name: "تولید روزانه", type: "line", smooth: true, symbol: "circle", symbolSize: 6,
        data: values,
        lineStyle: { width: 3, color: "#57D364" },
        itemStyle: { color: "#57D364" },
        areaStyle: {
          color: {
            type: "linear", x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: "rgba(87,211,100,0.35)" },
              { offset: 1, color: "rgba(87,211,100,0.0)" },
            ],
          },
        },
      }],
    };
  }, [trend.data]);

  const sessionOption = useMemo(() => {
    const v = sessionBreakdown.data?.values || { 1: 0, 2: 0, 3: 0 };
    const total = sessionBreakdown.data?.total || 0;
    const pct = (n: number) => (total > 0 ? ((n / total) * 100).toFixed(1) : "0");
    return {
      grid: { left: 48, right: 16, top: 24, bottom: 28 },
      tooltip: {
        trigger: "axis", axisPointer: { type: "shadow" },
        formatter: (params: any) => {
          const p = params?.[0]; if (!p) return "";
          return `${p.name}<br/><b>${toPersianDigits(p.data)}</b> kg (${toPersianDigits(pct(p.data))}%)`;
        },
      },
      xAxis: {
        type: "category", data: [SESSIONS[1], SESSIONS[2], SESSIONS[3]],
        axisLabel: { color: "#cbd5e1", fontSize: 13 },
      },
      yAxis: {
        type: "value",
        axisLabel: { color: "#94a3b8", formatter: (val: number) => toPersianDigits(val) },
        splitLine: { lineStyle: { color: "rgba(255,255,255,0.06)" } },
      },
      series: [{
        type: "bar", barWidth: 48,
        data: [
          { value: Number(v[1].toFixed(1)), itemStyle: { color: SESSION_COLORS[1], borderRadius: [6, 6, 0, 0] } },
          { value: Number(v[2].toFixed(1)), itemStyle: { color: SESSION_COLORS[2], borderRadius: [6, 6, 0, 0] } },
          { value: Number(v[3].toFixed(1)), itemStyle: { color: SESSION_COLORS[3], borderRadius: [6, 6, 0, 0] } },
        ],
        label: {
          show: true, position: "top", color: "#cbd5e1",
          formatter: (p: any) => `${toPersianDigits(pct(p.data))}%`,
        },
      }],
    };
  }, [sessionBreakdown.data]);

  // -- Per-cow detail drawer (unchanged) ------------------------------------
  const [selected, setSelected] = useState<null | { livestock_id: number; animal_number: string; today: number; base: number }>(null);
  const cowTrend = useQuery({
    enabled: !!selected,
    queryKey: ["milk-cow-trend", selected?.livestock_id, date],
    queryFn: async () => {
      const from = isoLocal(addDays(new Date(date), -6));
      const { data, error } = await supabase
        .from("livestock_milk_records")
        .select("record_date, milk_amount")
        .eq("livestock_id", selected!.livestock_id)
        .gte("record_date", from)
        .lte("record_date", date)
        .or("is_cancelled.is.null,is_cancelled.eq.false");
      if (error) throw error;
      const byDay = new Map<string, number>();
      for (const r of data || []) byDay.set(r.record_date, (byDay.get(r.record_date) || 0) + Number(r.milk_amount || 0));
      const days: string[] = []; const values: number[] = [];
      for (let i = 0; i < 7; i++) {
        const d = isoLocal(addDays(new Date(from), i));
        days.push(d);
        values.push(Number((byDay.get(d) || 0).toFixed(1)));
      }
      return { days, values };
    },
  });
  const cowTrendOption = useMemo(() => ({
    grid: { left: 40, right: 12, top: 16, bottom: 28 },
    tooltip: {
      trigger: "axis",
      formatter: (params: any) => {
        const p = params?.[0]; if (!p) return "";
        return `${formatShamsi(p.axisValue)}<br/><b>${toPersianDigits(p.data)}</b> kg`;
      },
    },
    xAxis: {
      type: "category", data: cowTrend.data?.days || [], boundaryGap: false,
      axisLabel: { color: "#94a3b8", formatter: (v: string) => formatShamsi(v).slice(5) },
    },
    yAxis: {
      type: "value",
      axisLabel: { color: "#94a3b8", formatter: (v: number) => toPersianDigits(v) },
      splitLine: { lineStyle: { color: "rgba(255,255,255,0.06)" } },
    },
    series: [{
      type: "line", smooth: true, symbol: "circle", symbolSize: 5,
      data: cowTrend.data?.values || [],
      lineStyle: { width: 2.5, color: "#22d3ee" }, itemStyle: { color: "#22d3ee" },
      areaStyle: {
        color: { type: "linear", x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [
            { offset: 0, color: "rgba(34,211,238,0.35)" },
            { offset: 1, color: "rgba(34,211,238,0.0)" },
          ] },
      },
    }],
  }), [cowTrend.data]);

  // -- Render ---------------------------------------------------------------
  const change = core.data?.change ?? 0;
  const TrendIcon = change > 0 ? ArrowUp : change < 0 ? ArrowDown : ArrowRight;
  const thresholdHit = Math.abs(change) >= (threshold || 0) && (threshold || 0) > 0;
  const isDanger = thresholdHit && change < 0;

  return (
    <div className="space-y-5" dir="rtl">
      {/* ---------- Filters bar ---------- */}
      <GlobalCard className="p-3 sm:p-4">
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 text-foreground font-bold">
            <Filter className="w-4 h-4 text-primary" /> فیلترها
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">تاریخ</Label>
              <ShamsiDatePicker
                value={isoToShamsiString(date)}
                onChange={(v) => v && setDate(shamsiStringToIso(v))}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">نوبت دوشش</Label>
              <Select value={session} onValueChange={(v) => setSession(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">همه</SelectItem>
                  <SelectItem value="1">صبح</SelectItem>
                  <SelectItem value="2">ظهر</SelectItem>
                  <SelectItem value="3">عصر</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">شماره گاو</Label>
              <Input placeholder="مثلاً ۱۲۳۴" value={cowFilter} onChange={(e) => setCowFilter(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">بازه روند</Label>
              <Select value={String(range)} onValueChange={(v) => setRange(Number(v) as 7 | 30 | 90)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="7">۷ روز اخیر</SelectItem>
                  <SelectItem value="30">۳۰ روز اخیر</SelectItem>
                  <SelectItem value="90">۹۰ روز اخیر</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {/* CHANGED — baseline is now record-count based. */}
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">مقایسه با</Label>
              <Select value={baseline} onValueChange={(v) => setBaseline(v as BaselineKey)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="prev3">{BASELINE_LABEL.prev3}</SelectItem>
                  <SelectItem value="prev6">{BASELINE_LABEL.prev6}</SelectItem>
                  <SelectItem value="prev12">{BASELINE_LABEL.prev12}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">آستانه هشدار (%)</Label>
              <Input
                type="number" min={0} max={100}
                value={threshold}
                onChange={(e) => setThreshold(Math.max(0, Number(e.target.value) || 0))}
                placeholder="مثلاً ۲۰"
              />
            </div>
          </div>
        </div>
      </GlobalCard>

      {/* ---------- KPI cards ---------- */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KPIWidget
          label="تولید امروز"
          value={core.isLoading ? "…" : fmtKg(core.data?.todayTotal || 0)}
          hint={formatShamsi(date)}
          accent="green"
        />
        <KPIWidget
          label={`میانگین ${BASELINE_LABEL[baseline]}`}
          value={core.isLoading ? "…" : fmtKg(core.data?.baseTotal || 0)}
          hint={`${toPersianDigits(baselineN)} رکورد به ازای هر دام`}
          accent="blue"
        />
        <GlobalCard className="kpi-tile w-full text-right">
          <p className="kpi-label">تغییر نسبت به {BASELINE_LABEL[baseline]}</p>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span
              className={cn(
                "kpi-value whitespace-nowrap",
                change > 0 ? "text-[#57D364]" : change < 0 ? "text-red-400" : "text-foreground",
              )}
              dir="ltr"
            >
              {core.isLoading ? "…" : fmtPct(change)}
            </span>
            <TrendIcon
              className={cn(
                "w-5 h-5",
                change > 0 ? "text-[#57D364]" : change < 0 ? "text-red-400" : "text-muted-foreground",
              )}
            />
            {thresholdHit && (
              <span
                className={cn(
                  "inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-md border",
                  isDanger
                    ? "bg-destructive/10 text-destructive border-destructive/30"
                    : "bg-amber-500/10 text-amber-400 border-amber-500/30",
                )}
              >
                <AlertTriangle className="w-3.5 h-3.5" />
                {isDanger ? "خطر افت تولید" : "نوسان غیرعادی"}
              </span>
            )}
          </div>
        </GlobalCard>
        <KPIWidget
          label="میانگین هر گاو شیری"
          value={core.isLoading ? "…" : fmtKg(core.data?.avg || 0)}
          hint={`${toPersianDigits(core.data?.cowCount || 0)} گاو`}
          accent="purple"
        />
      </div>

      {/* ---------- NEW: Alerts section ---------- */}
      <GlobalCard className="p-4">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h2 className="font-bold text-foreground flex items-center gap-2">
            <BellRing className="w-4 h-4 text-destructive" />
            هشدار افت / افزایش تولید
            <span className="text-xs font-normal text-muted-foreground mr-1">
              ({toPersianDigits(drops.length)} افت، {toPersianDigits(surges.length)} افزایش)
            </span>
          </h2>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              مرجع: {formatShamsi(date)} • آستانه {toPersianDigits(threshold)}٪ • {BASELINE_LABEL[baseline]}
            </span>
            <Button
              size="sm"
              variant="default"
              disabled={alerts.length === 0 || persistAlerts.isPending}
              onClick={() => persistAlerts.mutate()}
              className="gap-1"
            >
              <Save className="w-4 h-4" />
              ثبت هشدارها برای پیامک
            </Button>
          </div>
        </div>

        {core.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : alerts.length === 0 ? (
          <div className="text-center py-6 text-sm text-muted-foreground">
            هیچ دامی از آستانه {toPersianDigits(threshold)}٪ عبور نکرده است.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-muted-foreground text-xs">
                <tr className="border-b border-border">
                  <th className="text-right py-2 px-2">شماره گاو</th>
                  <th className="text-right py-2 px-2">جهت</th>
                  <th className="text-right py-2 px-2">امروز</th>
                  <th className="text-right py-2 px-2">میانگین {BASELINE_LABEL[baseline]}</th>
                  <th className="text-right py-2 px-2">اختلاف (kg)</th>
                  <th className="text-right py-2 px-2">اختلاف (%)</th>
                  <th className="text-right py-2 px-2">تعداد رکورد پایه</th>
                  <th className="text-right py-2 px-2">وضعیت</th>
                </tr>
              </thead>
              <tbody>
                {alerts.map((a) => {
                  const drop = a.diff_pct < 0;
                  return (
                    <tr
                      key={a.livestock_id}
                      className="border-b border-border/50 hover:bg-muted/40 cursor-pointer"
                      onClick={() => setSelected({
                        livestock_id: a.livestock_id,
                        animal_number: a.animal_number,
                        today: a.today,
                        base: a.base,
                      })}
                    >
                      <td className="py-2 px-2 font-bold text-foreground">{toPersianDigits(a.animal_number)}</td>
                      <td className="py-2 px-2">
                        <span className={cn(
                          "inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded border",
                          drop
                            ? "bg-destructive/10 text-destructive border-destructive/30"
                            : "bg-amber-500/10 text-amber-400 border-amber-500/30",
                        )}>
                          <AlertTriangle className="w-3 h-3" />
                          {drop ? "افت" : "افزایش"}
                        </span>
                      </td>
                      <td className="py-2 px-2 font-mono tabular-nums" dir="ltr">{toPersianDigits(a.today)}</td>
                      <td className="py-2 px-2 font-mono tabular-nums text-muted-foreground" dir="ltr">{toPersianDigits(a.base)}</td>
                      <td className={cn(
                        "py-2 px-2 font-mono tabular-nums",
                        drop ? "text-red-400" : "text-[#57D364]",
                      )} dir="ltr">
                        {fmtKgSigned(a.diff_kg)}
                      </td>
                      <td className={cn(
                        "py-2 px-2 font-mono tabular-nums",
                        drop ? "text-red-400" : "text-[#57D364]",
                      )} dir="ltr">
                        {fmtPct(a.diff_pct)}
                      </td>
                      <td className="py-2 px-2 text-muted-foreground" dir="ltr">
                        {toPersianDigits(a.records_used)}/{toPersianDigits(baselineN)}
                      </td>
                      <td className="py-2 px-2">
                        {(() => {
                          // Show whether this alert is already persisted in the DB
                          // (so the messaging worker can pick it up).
                          const saved = (savedAlerts.data || []).find(
                            (s: any) => String(s.animal_number) === String(a.animal_number),
                          );
                          if (!saved) return <span className="text-muted-foreground text-xs">ثبت نشده</span>;
                          return (
                            <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded border bg-primary/10 text-primary border-primary/30">
                              ذخیره شد
                            </span>
                          );
                        })()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </GlobalCard>

      {/* ---------- Trend chart ---------- */}
      <GlobalCard className="p-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-bold text-foreground flex items-center gap-2">
            <Milk className="w-4 h-4 text-primary" />
            روند تولید روزانه شیر
          </h2>
          <span className="text-xs text-muted-foreground">
            {formatShamsi(rangeFrom)} — {formatShamsi(date)}
          </span>
        </div>
        {trend.isLoading ? (
          <Skeleton className="h-72 w-full" />
        ) : (
          <ReactECharts option={trendOption} style={{ height: 320 }} notMerge lazyUpdate />
        )}
      </GlobalCard>

      {/* ---------- Sessions + Top 10 ---------- */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <GlobalCard className="p-4">
          <h2 className="font-bold text-foreground mb-2">تحلیل نوبت‌های دوشش — {formatShamsi(date)}</h2>
          {sessionBreakdown.isLoading ? (
            <Skeleton className="h-72 w-full" />
          ) : (
            <ReactECharts option={sessionOption} style={{ height: 300 }} notMerge lazyUpdate />
          )}
        </GlobalCard>

        <GlobalCard className="p-4">
          <h2 className="font-bold text-foreground mb-2">۱۰ گاو پربازده امروز</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-muted-foreground text-xs">
                <tr className="border-b border-border">
                  <th className="text-right py-2 px-2">شماره گاو</th>
                  <th className="text-right py-2 px-2">امروز</th>
                  <th className="text-right py-2 px-2">{BASELINE_LABEL[baseline]}</th>
                  <th className="text-right py-2 px-2">اختلاف</th>
                  <th className="text-right py-2 px-2">هشدار</th>
                </tr>
              </thead>
              <tbody>
                {core.isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i}><td colSpan={5} className="py-2"><Skeleton className="h-6 w-full" /></td></tr>
                  ))
                ) : topRows.length === 0 ? (
                  <tr><td colSpan={5} className="py-6 text-center text-muted-foreground">رکوردی یافت نشد</td></tr>
                ) : (
                  topRows.map((r) => {
                    const cowHit = Math.abs(r.diff_pct) >= (threshold || 0) && (threshold || 0) > 0;
                    const cowDanger = cowHit && r.diff_pct < 0;
                    return (
                      <tr
                        key={r.livestock_id}
                        className="border-b border-border/50 hover:bg-muted/40 cursor-pointer transition-colors"
                        onClick={() => setSelected(r)}
                      >
                        <td className="py-2 px-2 font-bold text-foreground">{toPersianDigits(r.animal_number)}</td>
                        <td className="py-2 px-2 font-mono tabular-nums" dir="ltr">{toPersianDigits(r.today)}</td>
                        <td className="py-2 px-2 font-mono tabular-nums text-muted-foreground" dir="ltr">{toPersianDigits(r.base)}</td>
                        <td className={cn(
                          "py-2 px-2 font-mono tabular-nums",
                          r.diff_kg > 0 ? "text-[#57D364]" : r.diff_kg < 0 ? "text-red-400" : "text-muted-foreground",
                        )} dir="ltr">
                          {fmtKgSigned(r.diff_kg)}
                        </td>
                        <td className="py-2 px-2">
                          {cowHit ? (
                            <span className={cn(
                              "inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded border",
                              cowDanger
                                ? "bg-destructive/10 text-destructive border-destructive/30"
                                : "bg-amber-500/10 text-amber-400 border-amber-500/30",
                            )}>
                              <AlertTriangle className="w-3 h-3" />
                              {fmtPct(r.diff_pct)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </GlobalCard>
      </div>

      {/* ---------- Cow detail drawer ---------- */}
      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent side="left" className="w-full sm:max-w-md" dir="rtl">
          <SheetHeader>
            <SheetTitle>گاو شماره {toPersianDigits(selected?.animal_number || "")}</SheetTitle>
            <SheetDescription>روند تولید ۷ روز اخیر</SheetDescription>
          </SheetHeader>

          <div className="grid grid-cols-2 gap-3 mt-4">
            <div className="rounded-lg border border-border p-3">
              <p className="text-xs text-muted-foreground">امروز</p>
              <p className="text-lg font-bold font-mono tabular-nums" dir="ltr">
                {toPersianDigits(selected?.today ?? 0)} kg
              </p>
            </div>
            <div className="rounded-lg border border-border p-3">
              <p className="text-xs text-muted-foreground">{BASELINE_LABEL[baseline]}</p>
              <p className="text-lg font-bold font-mono tabular-nums text-muted-foreground" dir="ltr">
                {toPersianDigits(selected?.base ?? 0)} kg
              </p>
            </div>
          </div>

          <div className="mt-4">
            {cowTrend.isLoading ? (
              <Skeleton className="h-56 w-full" />
            ) : (
              <ReactECharts option={cowTrendOption} style={{ height: 240 }} notMerge lazyUpdate />
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
