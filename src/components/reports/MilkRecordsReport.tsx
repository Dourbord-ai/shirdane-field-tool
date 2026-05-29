// ---------------------------------------------------------------------------
// MilkRecordsReport — Executive milk production dashboard (Version 1)
// Mounts under /reports → tab "رکورد شیر".
//
// Sections:
//   1) KPI cards     — Today, Yesterday, %Δ, Avg per milking cow
//   2) Trend chart   — Daily total milk (7/30/90 days) — ECharts line
//   3) Session bar   — Today by morning/noon/evening — ECharts stacked bar
//   4) Top 10 cows   — Today vs Yesterday with diff
//   5) Detail drawer — Per-cow 7-day mini trend (ECharts line)
//
// Filters (global): date, milking session, cow number
//   - All sections recompute instantly via TanStack Query keys.
//
// Schema used:
//   livestock_milk_records(livestock_id, record_date, period{1,2,3},
//                          milk_amount, is_cancelled)
//   livestock_items(id, animal_number)
// ---------------------------------------------------------------------------
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import ReactECharts from "echarts-for-react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { GlobalCard, KPIWidget } from "@/components/global/KPIWidget";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { formatShamsi } from "@/lib/dateDisplay";
import { toPersianDigits } from "@/lib/jalali";
import { ArrowDown, ArrowRight, ArrowUp, Filter, Milk } from "lucide-react";
import { cn } from "@/lib/utils";

// ------ Helpers -------------------------------------------------------------
// Period codes used in livestock_milk_records.period (smallint).
const SESSIONS: Record<number, string> = { 1: "صبح", 2: "ظهر", 3: "عصر" };
const SESSION_COLORS: Record<number, string> = {
  1: "#fbbf24", // amber morning
  2: "#22d3ee", // cyan noon
  3: "#a78bfa", // violet evening
};

// Returns YYYY-MM-DD for a Date in LOCAL time (we never want UTC drift since
// `record_date` is a calendar date stored without timezone).
function isoLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function fmtKg(n: number): string {
  // Persian digits + thousand separators; one decimal so small totals don't read as zero.
  return toPersianDigits(n.toLocaleString("en-US", { maximumFractionDigits: 1 })) + " kg";
}
function fmtPct(n: number): string {
  // Negative sign forced LTR-style at left (matches the project's number style).
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  const abs = Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 1 });
  return `${sign}${toPersianDigits(abs)}%`;
}

// ============================================================================
export default function MilkRecordsReport() {
  // -- Global filter state --------------------------------------------------
  // `date` is the "reference day" used by KPI cards, session bar, and top-cow
  // comparison. Trend chart is anchored to this date and looks back `range` days.
  const [date, setDate] = useState<string>(() => isoLocal(new Date()));
  const [session, setSession] = useState<"all" | "1" | "2" | "3">("all");
  const [cowFilter, setCowFilter] = useState<string>("");
  const [range, setRange] = useState<7 | 30 | 90>(7);

  // Derived dates we reuse below.
  const yest = useMemo(() => isoLocal(addDays(new Date(date), -1)), [date]);
  const rangeFrom = useMemo(() => isoLocal(addDays(new Date(date), -(range - 1))), [date, range]);

  // -------------------------------------------------------------------------
  // Q1 — KPI totals for selected day & previous day (respecting session filter)
  // -------------------------------------------------------------------------
  const kpis = useQuery({
    queryKey: ["milk-kpis", date, yest, session],
    queryFn: async () => {
      let q = supabase
        .from("livestock_milk_records")
        .select("livestock_id, milk_amount, record_date, period")
        .in("record_date", [date, yest])
        .or("is_cancelled.is.null,is_cancelled.eq.false");
      if (session !== "all") q = q.eq("period", Number(session));
      const { data, error } = await q;
      if (error) throw error;

      let today = 0, yesterday = 0;
      const todayCows = new Set<number>();
      for (const r of data || []) {
        const amt = Number(r.milk_amount) || 0;
        if (r.record_date === date) { today += amt; todayCows.add(Number(r.livestock_id)); }
        else if (r.record_date === yest) yesterday += amt;
      }
      const change = yesterday > 0 ? ((today - yesterday) / yesterday) * 100 : 0;
      const avg = todayCows.size > 0 ? today / todayCows.size : 0;
      return { today, yesterday, change, avg, cowCount: todayCows.size };
    },
  });

  // -------------------------------------------------------------------------
  // Q2 — Trend chart: daily totals over [rangeFrom .. date]
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
      // Aggregate by day, then fill missing days with 0 so the chart is continuous.
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

  // -------------------------------------------------------------------------
  // Q3 — Session breakdown for the selected day (always shows all 3 sessions
  //      regardless of session filter, so managers see distribution).
  // -------------------------------------------------------------------------
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
  // Q4 — Top 10 producing cows for the selected day.
  //      Pull today + yesterday in one query, group client-side, then resolve
  //      animal_number for the top ids only.
  // -------------------------------------------------------------------------
  const top = useQuery({
    queryKey: ["milk-top", date, yest, session, cowFilter],
    queryFn: async () => {
      let q = supabase
        .from("livestock_milk_records")
        .select("livestock_id, milk_amount, record_date, period")
        .in("record_date", [date, yest])
        .or("is_cancelled.is.null,is_cancelled.eq.false");
      if (session !== "all") q = q.eq("period", Number(session));
      const { data, error } = await q;
      if (error) throw error;
      // Aggregate per cow into {today, yesterday}.
      const map = new Map<number, { today: number; yesterday: number }>();
      for (const r of data || []) {
        const id = Number(r.livestock_id);
        const cur = map.get(id) || { today: 0, yesterday: 0 };
        const amt = Number(r.milk_amount || 0);
        if (r.record_date === date) cur.today += amt; else cur.yesterday += amt;
        map.set(id, cur);
      }
      // Resolve animal_number for these cows in one round-trip.
      const ids = Array.from(map.keys());
      let nums = new Map<number, string>();
      if (ids.length) {
        const { data: items } = await supabase
          .from("livestock_items").select("id, animal_number").in("id", ids as any);
        for (const it of items || []) nums.set(Number(it.id), String(it.animal_number ?? it.id));
      }
      // Build rows, optional cow-number text filter, sort desc by today, take 10.
      const rows = Array.from(map.entries())
        .map(([id, v]) => ({
          livestock_id: id,
          animal_number: nums.get(id) || String(id),
          today: Number(v.today.toFixed(1)),
          yesterday: Number(v.yesterday.toFixed(1)),
          diff: Number((v.today - v.yesterday).toFixed(1)),
        }))
        .filter((r) => !cowFilter.trim() || r.animal_number.includes(cowFilter.trim()))
        .sort((a, b) => b.today - a.today)
        .slice(0, 10);
      return rows;
    },
  });

  // -------------------------------------------------------------------------
  // ECharts options (memoized so they don't reinit on every render).
  // -------------------------------------------------------------------------
  const trendOption = useMemo(() => {
    const days = trend.data?.days || [];
    const values = trend.data?.values || [];
    return {
      grid: { left: 48, right: 16, top: 24, bottom: 56 },
      tooltip: {
        trigger: "axis",
        formatter: (params: any) => {
          const p = params?.[0];
          if (!p) return "";
          return `${formatShamsi(p.axisValue)}<br/><b>${toPersianDigits(p.data)}</b> kg`;
        },
      },
      xAxis: {
        type: "category",
        data: days,
        boundaryGap: false,
        axisLabel: {
          formatter: (v: string) => formatShamsi(v).slice(5), // MM/DD only
          color: "#94a3b8",
        },
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
      series: [
        {
          name: "تولید روزانه",
          type: "line",
          smooth: true,
          symbol: "circle",
          symbolSize: 6,
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
        },
      ],
    };
  }, [trend.data]);

  const sessionOption = useMemo(() => {
    const v = sessionBreakdown.data?.values || { 1: 0, 2: 0, 3: 0 };
    const total = sessionBreakdown.data?.total || 0;
    const pct = (n: number) => (total > 0 ? ((n / total) * 100).toFixed(1) : "0");
    return {
      grid: { left: 48, right: 16, top: 24, bottom: 28 },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        formatter: (params: any) => {
          const p = params?.[0];
          if (!p) return "";
          return `${p.name}<br/><b>${toPersianDigits(p.data)}</b> kg (${toPersianDigits(pct(p.data))}%)`;
        },
      },
      xAxis: {
        type: "category",
        data: [SESSIONS[1], SESSIONS[2], SESSIONS[3]],
        axisLabel: { color: "#cbd5e1", fontSize: 13 },
      },
      yAxis: {
        type: "value",
        axisLabel: { color: "#94a3b8", formatter: (val: number) => toPersianDigits(val) },
        splitLine: { lineStyle: { color: "rgba(255,255,255,0.06)" } },
      },
      series: [
        {
          type: "bar",
          barWidth: 48,
          data: [
            { value: Number(v[1].toFixed(1)), itemStyle: { color: SESSION_COLORS[1], borderRadius: [6, 6, 0, 0] } },
            { value: Number(v[2].toFixed(1)), itemStyle: { color: SESSION_COLORS[2], borderRadius: [6, 6, 0, 0] } },
            { value: Number(v[3].toFixed(1)), itemStyle: { color: SESSION_COLORS[3], borderRadius: [6, 6, 0, 0] } },
          ],
          label: {
            show: true, position: "top", color: "#cbd5e1",
            formatter: (p: any) => `${toPersianDigits(pct(p.data))}%`,
          },
        },
      ],
    };
  }, [sessionBreakdown.data]);

  // -- Per-cow detail (drawer) ----------------------------------------------
  const [selected, setSelected] = useState<null | { livestock_id: number; animal_number: string; today: number; yesterday: number }>(null);
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
      const days: string[] = [];
      const values: number[] = [];
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
      lineStyle: { width: 2.5, color: "#22d3ee" },
      itemStyle: { color: "#22d3ee" },
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
  const change = kpis.data?.change ?? 0;
  const TrendIcon = change > 0 ? ArrowUp : change < 0 ? ArrowDown : ArrowRight;

  return (
    <div className="space-y-5" dir="rtl">
      {/* ---------- Filters bar ---------- */}
      <GlobalCard className="p-3 sm:p-4">
        <div className="flex flex-col sm:flex-row sm:items-end gap-3">
          <div className="flex items-center gap-2 text-foreground font-bold">
            <Filter className="w-4 h-4 text-primary" /> فیلترها
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 flex-1">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">تاریخ</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
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
          </div>
        </div>
      </GlobalCard>

      {/* ---------- Section 1: KPI cards ---------- */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KPIWidget
          label="تولید امروز"
          value={kpis.isLoading ? "…" : fmtKg(kpis.data?.today || 0)}
          hint={formatShamsi(date)}
          accent="green"
        />
        <KPIWidget
          label="تولید دیروز"
          value={kpis.isLoading ? "…" : fmtKg(kpis.data?.yesterday || 0)}
          hint={formatShamsi(yest)}
          accent="blue"
        />
        <GlobalCard className="kpi-tile w-full text-right">
          <p className="kpi-label">تغییر نسبت به دیروز</p>
          <div className="flex items-center gap-2 mt-1">
            <span
              className={cn(
                "kpi-value whitespace-nowrap",
                change > 0 ? "text-[#57D364]" : change < 0 ? "text-red-400" : "text-foreground",
              )}
              dir="ltr"
            >
              {kpis.isLoading ? "…" : fmtPct(change)}
            </span>
            <TrendIcon
              className={cn(
                "w-5 h-5",
                change > 0 ? "text-[#57D364]" : change < 0 ? "text-red-400" : "text-muted-foreground",
              )}
            />
          </div>
        </GlobalCard>
        <KPIWidget
          label="میانگین هر گاو شیری"
          value={kpis.isLoading ? "…" : fmtKg(kpis.data?.avg || 0)}
          hint={`${toPersianDigits(kpis.data?.cowCount || 0)} گاو`}
          accent="purple"
        />
      </div>

      {/* ---------- Section 2: Trend chart ---------- */}
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

      {/* ---------- Section 3 + 4 side by side on lg ---------- */}
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
                  <th className="text-right py-2 px-2">دیروز</th>
                  <th className="text-right py-2 px-2">اختلاف</th>
                </tr>
              </thead>
              <tbody>
                {top.isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i}><td colSpan={4} className="py-2"><Skeleton className="h-6 w-full" /></td></tr>
                  ))
                ) : (top.data || []).length === 0 ? (
                  <tr><td colSpan={4} className="py-6 text-center text-muted-foreground">رکوردی یافت نشد</td></tr>
                ) : (
                  (top.data || []).map((r) => (
                    <tr
                      key={r.livestock_id}
                      className="border-b border-border/50 hover:bg-muted/40 cursor-pointer transition-colors"
                      onClick={() => setSelected(r)}
                    >
                      <td className="py-2 px-2 font-bold text-foreground">{toPersianDigits(r.animal_number)}</td>
                      <td className="py-2 px-2 font-mono tabular-nums" dir="ltr">
                        {toPersianDigits(r.today)}
                      </td>
                      <td className="py-2 px-2 font-mono tabular-nums text-muted-foreground" dir="ltr">
                        {toPersianDigits(r.yesterday)}
                      </td>
                      <td
                        className={cn(
                          "py-2 px-2 font-mono tabular-nums",
                          r.diff > 0 ? "text-[#57D364]" : r.diff < 0 ? "text-red-400" : "text-muted-foreground",
                        )}
                        dir="ltr"
                      >
                        {r.diff > 0 ? "+" : r.diff < 0 ? "−" : ""}
                        {toPersianDigits(Math.abs(r.diff))}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </GlobalCard>
      </div>

      {/* ---------- Section 5: Cow detail drawer ---------- */}
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
              <p className="text-xs text-muted-foreground">دیروز</p>
              <p className="text-lg font-bold font-mono tabular-nums text-muted-foreground" dir="ltr">
                {toPersianDigits(selected?.yesterday ?? 0)} kg
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
