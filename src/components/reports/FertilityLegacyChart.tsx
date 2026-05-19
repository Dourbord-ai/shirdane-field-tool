// FertilityLegacyChart — Damban Persian RTL fertility chart.
// Reads from the `analytics_fertility_legacy_chart` view in Supabase,
// renders an Apache ECharts bar chart with horizontal management lines,
// heifer triangle markers, filters, KPI cards, and a status legend.
//
// All visible labels are Persian. Comments explain *why* each block exists
// so future maintainers can follow the design.
import { useEffect, useMemo, useRef, useState } from "react";
import ReactECharts from "echarts-for-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { GlobalCard } from "@/components/global/KPIWidget";
import { useIsMobile } from "@/hooks/use-mobile";
import { RefreshCcw, X, Filter } from "lucide-react";

// Row shape returned by the view. All optional because Supabase may return
// null for cows with missing fertility data.
export interface FertilityChartRow {
  livestock_id: number;
  bodynumber: number | null;
  earnumber: number | null;
  chart_days: number | null;
  chart_status: string | null;
  status_color: string | null;
  is_heifer: boolean | null;
  chart_day_source: string | null;
  last_fertility_status: number | null;
  is_pregnancy: boolean | null;
  is_dry: boolean | null;
  number_of_births: number | null;
  // last_period = شکم/دوره شیردهی (lactation period). Comes from cows.last_period.
  // 0/NULL = تلیسه (no calving yet); 1..7+ = شکم اول … شکم هفتم.
  last_period: number | null;
  last_birth_date: string | null;
  last_erotic_date: string | null;
  last_inoculation_date: string | null;
  last_pregnancy_date: string | null;
  last_abortion_date: string | null;
  last_dry_date: string | null;
}

// Persian digit helper for the period dropdown labels.
// Keeps the UI consistent with the rest of the Damban Persian RTL pages.
const PERIOD_LABEL: Record<string, string> = {
  "1": "شکم اول",
  "2": "شکم دوم",
  "3": "شکم سوم",
  "4": "شکم چهارم",
  "5": "شکم پنجم",
  "6": "شکم ششم",
  "7": "شکم هفتم",
};

// Sort modes — Persian labels mapped to comparator keys.
type SortKey = "days_desc" | "days_asc" | "body" | "status";

// Heifer filter modes
type HeiferMode = "all" | "heifer" | "cow";

// Pregnancy/dry filter modes
type PregMode = "all" | "pregnant" | "open" | "dry";

// Day-range presets — match the legacy CRM thresholds.
type DayRange = "all" | "32" | "60" | "130" | "220" | "250";

// Persian fallback dash for empty values.
const dash = "—";

// Debounce helper for the search input. Returns the debounced value
// so the chart isn't recalculated on every keystroke.
function useDebounced<T>(value: T, delay = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

export default function FertilityLegacyChart() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();

  // Raw data, loaded once on mount + on manual refresh.
  const [rows, setRows] = useState<FertilityChartRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filter state — every change re-derives memoized data, no refetch.
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounced(search, 250);
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [heiferMode, setHeiferMode] = useState<HeiferMode>("all");
  const [dayRange, setDayRange] = useState<DayRange>("all");
  const [pregMode, setPregMode] = useState<PregMode>("all");
  // periodFilter — "all" or a specific شکم value as string ("1".."7").
  // Stored as string so the shadcn Select can use it directly without coercion.
  const [periodFilter, setPeriodFilter] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey>("days_desc");
  const [filtersOpen, setFiltersOpen] = useState(!isMobile);

  // Stable ref to the ECharts instance so we can resize on layout changes.
  const chartRef = useRef<ReactECharts | null>(null);

  // Data loader. Wrapped so the refresh button can call it directly.
  const loadData = async () => {
    setLoading(true);
    setError(null);
    // We cast to any because this view is not in the generated types yet.
    const { data, error } = await (supabase as any)
      .from("analytics_fertility_legacy_chart")
      .select("*");
    if (error) {
      // Persian message for the user; full error stays in dev console only.
      console.error("[FertilityLegacyChart] supabase error:", error);
      const missing = (error.message || "").toLowerCase().includes("not exist") ||
        (error.code === "42P01");
      setError(
        missing
          ? "نمای تحلیلی analytics_fertility_legacy_chart در پایگاه داده پیدا نشد."
          : "خطا در دریافت داده‌های نمودار."
      );
      setRows([]);
    } else {
      setRows((data ?? []) as FertilityChartRow[]);
    }
    setLoading(false);
  };

  // Initial fetch only — explicit "بروزرسانی" triggers re-fetch.
  useEffect(() => {
    loadData();
  }, []);

  // Unique chart_status values — populate the status multi-select dynamically.
  const statusOptions = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => { if (r.chart_status) set.add(r.chart_status); });
    return Array.from(set).sort();
  }, [rows]);

  // The single source of truth for filtered + sorted rows.
  const filtered = useMemo(() => {
    const q = debouncedSearch.trim();
    const dayMin = dayRange === "all" ? 0 : parseInt(dayRange, 10);

    const out = rows.filter((r) => {
      if (q) {
        const bodyMatch = r.bodynumber != null && String(r.bodynumber).includes(q);
        const earMatch = r.earnumber != null && String(r.earnumber).includes(q);
        if (!bodyMatch && !earMatch) return false;
      }
      if (statusFilter.length > 0 && (!r.chart_status || !statusFilter.includes(r.chart_status))) {
        return false;
      }
      if (heiferMode === "heifer" && !r.is_heifer) return false;
      if (heiferMode === "cow" && r.is_heifer) return false;
      if (dayMin > 0 && (r.chart_days ?? 0) <= dayMin) return false;
      if (pregMode === "pregnant" && !r.is_pregnancy) return false;
      if (pregMode === "open" && r.is_pregnancy) return false;
      if (pregMode === "dry" && !r.is_dry) return false;
      // دوره (شکم) filter — match cows by their lactation period (last_period).
      // Only applied when the user picks a specific شکم; "all" skips the check.
      if (periodFilter !== "all") {
        // Parse the dropdown value once; defensive coercion in case of bad data.
        const want = parseInt(periodFilter, 10);
        if ((r.last_period ?? 0) !== want) return false;
      }
      return true;
    });

    // Sort comparators — chart x-axis order follows this.
    out.sort((a, b) => {
      switch (sortKey) {
        case "days_asc": return (a.chart_days ?? 0) - (b.chart_days ?? 0);
        case "body": return (a.bodynumber ?? 0) - (b.bodynumber ?? 0);
        case "status": return (a.chart_status ?? "").localeCompare(b.chart_status ?? "", "fa");
        default: return (b.chart_days ?? 0) - (a.chart_days ?? 0);
      }
    });
    return out;
  }, [rows, debouncedSearch, statusFilter, heiferMode, dayRange, pregMode, periodFilter, sortKey]);

  // KPI cards reflect filtered data (per spec).
  const kpis = useMemo(() => {
    const total = filtered.length;
    const heifers = filtered.filter((r) => r.is_heifer).length;
    const over130 = filtered.filter((r) => (r.chart_days ?? 0) > 130).length;
    const over220 = filtered.filter((r) => (r.chart_days ?? 0) > 220).length;
    const over250 = filtered.filter((r) => (r.chart_days ?? 0) > 250).length;
    const avg = total === 0 ? 0
      : Math.round(filtered.reduce((s, r) => s + (r.chart_days ?? 0), 0) / total);
    const pregnant = filtered.filter((r) => r.is_pregnancy).length;
    const dry = filtered.filter((r) => r.is_dry).length;
    return { total, heifers, over130, over220, over250, avg, pregnant, dry };
  }, [filtered]);

  // Legend rows — aggregated per status for the side panel.
  const legend = useMemo(() => {
    const map = new Map<string, { color: string; count: number }>();
    filtered.forEach((r) => {
      const k = r.chart_status ?? "نامشخص";
      const c = r.status_color ?? "#9CA3AF";
      const cur = map.get(k) ?? { color: c, count: 0 };
      cur.count += 1;
      cur.color = c;
      map.set(k, cur);
    });
    const total = filtered.length || 1;
    return Array.from(map.entries())
      .map(([status, v]) => ({ status, color: v.color, count: v.count, pct: (v.count / total) * 100 }))
      .sort((a, b) => b.count - a.count);
  }, [filtered]);

  // Build ECharts option. Memoized so React doesn't rebuild it
  // unless filtered data actually changes.
  const option = useMemo(() => {
    const xLabels = filtered.map((r) => r.bodynumber != null ? String(r.bodynumber) : `#${r.livestock_id}`);

    // Bar series with per-cow color via itemStyle callback.
    const barData = filtered.map((r) => ({
      value: r.chart_days ?? 0,
      itemStyle: { color: r.status_color ?? "#9CA3AF", borderRadius: [4, 4, 0, 0] },
      // Stash row in extra so tooltip can look it up by dataIndex.
    }));

    // Triangle markers above heifer bars only.
    const heiferScatter = filtered
      .map((r, i) => r.is_heifer ? [i, (r.chart_days ?? 0) + 5] : null)
      .filter(Boolean) as [number, number][];

    return {
      backgroundColor: "transparent",
      title: {
        text: "نمودار وضعیت تولیدمثل دام‌ها",
        left: "center",
        textStyle: { color: "#E5E7EB", fontFamily: "Vazirmatn, sans-serif", fontSize: 16 },
      },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        backgroundColor: "rgba(7,17,27,0.95)",
        borderColor: "rgba(87,211,100,0.4)",
        textStyle: { color: "#E5E7EB", fontFamily: "Vazirmatn, sans-serif" },
        // Custom RTL Persian tooltip.
        formatter: (params: any) => {
          const p = Array.isArray(params) ? params[0] : params;
          const r = filtered[p.dataIndex];
          if (!r) return "";
          const line = (label: string, value: any) =>
            `<div><span style="color:#94a3b8">${label}:</span> <strong>${value ?? dash}</strong></div>`;
          return `<div style="direction:rtl;text-align:right;font-family:Vazirmatn,sans-serif;min-width:220px">
            ${line("شماره دام", r.bodynumber)}
            ${line("شماره گوش", r.earnumber)}
            ${line("تعداد روز", r.chart_days)}
            ${line("وضعیت", r.chart_status)}
            ${line("تلیسه", r.is_heifer ? "بله" : "خیر")}
            ${line("منبع محاسبه روز", r.chart_day_source)}
            ${line("آخرین زایش", r.last_birth_date)}
            ${line("آخرین فحلی", r.last_erotic_date)}
            ${line("آخرین تلقیح", r.last_inoculation_date)}
            ${line("آخرین تست آبستنی", r.last_pregnancy_date)}
            ${line("آخرین سقط", r.last_abortion_date)}
            ${line("آخرین خشکی", r.last_dry_date)}
          </div>`;
        },
      },
      grid: { left: 50, right: 24, top: 56, bottom: 96, containLabel: true },
      xAxis: {
        type: "category",
        data: xLabels,
        axisLabel: {
          color: "#94a3b8",
          rotate: 75,
          fontFamily: "Vazirmatn, sans-serif",
          fontSize: 10,
        },
        axisLine: { lineStyle: { color: "rgba(148,163,184,0.3)" } },
        axisTick: { show: false },
      },
      yAxis: {
        type: "value",
        name: "تعداد روز",
        // Hard cap at 300 — fertility legacy chart only meaningfully shows
        // 0..300 days. Any data rows with absurd values (e.g. 250000) come
        // from bad legacy imports and get clipped instead of breaking scale.
        min: 0,
        max: 300,
        interval: 20,
        nameTextStyle: { color: "#94a3b8", fontFamily: "Vazirmatn, sans-serif" },
        axisLabel: { color: "#94a3b8", fontFamily: "Vazirmatn, sans-serif" },
        splitLine: { lineStyle: { color: "rgba(148,163,184,0.1)" } },
      },
      dataZoom: [
        { type: "inside", xAxisIndex: 0 },
        { type: "slider", xAxisIndex: 0, height: 18, bottom: 8,
          backgroundColor: "rgba(148,163,184,0.08)",
          fillerColor: "rgba(87,211,100,0.18)",
          borderColor: "rgba(148,163,184,0.2)",
          handleStyle: { color: "#57D364" },
          textStyle: { color: "#94a3b8", fontFamily: "Vazirmatn, sans-serif" },
        },
      ],
      series: [
        {
          name: "روزها",
          type: "bar",
          data: barData,
          barMaxWidth: 22,
          markLine: {
            silent: true,
            symbol: ["none", "none"],
            label: { color: "#94a3b8", fontFamily: "Vazirmatn, sans-serif", fontSize: 10 },
            lineStyle: { color: "rgba(239,68,68,0.4)", type: "dashed" },
            data: [32, 60, 130, 220, 250, 270].map((y) => ({ yAxis: y, label: { formatter: `${y}` } })),
          },
        },
        {
          name: "تلیسه",
          type: "scatter",
          symbol: "triangle",
          symbolSize: 12,
          itemStyle: { color: "#000000", borderColor: "#ffffff", borderWidth: 1 },
          data: heiferScatter,
          tooltip: { show: false },
        },
      ],
    };
  }, [filtered]);

  // Bar-click → navigate to livestock profile. Wrapped in try/catch so
  // a missing route never crashes the chart.
  const onChartClick = (params: any) => {
    const idx = params?.dataIndex;
    const r = filtered[idx];
    if (!r) return;
    try {
      navigate(`/livestock/${r.livestock_id}`);
    } catch {
      toast(`شناسه دام: ${r.livestock_id}`);
    }
  };

  // Reset all filter state back to defaults.
  const resetFilters = () => {
    setSearch("");
    setStatusFilter([]);
    setHeiferMode("all");
    setDayRange("all");
    setPregMode("all");
    // Reset the شکم/دوره picker back to "همه" so all periods are shown again.
    setPeriodFilter("all");
    setSortKey("days_desc");
  };

  // Toggle one status pill in/out of the multi-select.
  const toggleStatus = (s: string) => {
    setStatusFilter((prev) => prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]);
  };

  // ---- Render ----

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-[420px] lg:h-[620px] w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="card-dashboard text-center py-12">
        <p className="text-destructive font-semibold">{error}</p>
        <Button onClick={loadData} variant="outline" className="mt-4">
          <RefreshCcw className="h-4 w-4 ml-2" /> تلاش مجدد
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4" dir="rtl">
      {/* Filter panel — collapsible on mobile to save space */}
      <div className="card-dashboard">
        <div className="flex items-center justify-between mb-3">
          <button
            type="button"
            onClick={() => setFiltersOpen((v) => !v)}
            className="flex items-center gap-2 text-sm font-semibold text-foreground"
          >
            <Filter className="h-4 w-4" />
            فیلترها
          </button>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={resetFilters}>
              <X className="h-4 w-4 ml-1" /> حذف فیلترها
            </Button>
            <Button size="sm" variant="outline" onClick={loadData}>
              <RefreshCcw className="h-4 w-4 ml-1" /> بروزرسانی
            </Button>
          </div>
        </div>

        {filtersOpen && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <Input
              placeholder="جستجوی شماره بدنه / شماره گوش"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="text-right"
            />
            <Select value={heiferMode} onValueChange={(v) => setHeiferMode(v as HeiferMode)}>
              <SelectTrigger><SelectValue placeholder="تلیسه" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">همه</SelectItem>
                <SelectItem value="heifer">فقط تلیسه‌ها</SelectItem>
                <SelectItem value="cow">فقط گاوها</SelectItem>
              </SelectContent>
            </Select>
            <Select value={dayRange} onValueChange={(v) => setDayRange(v as DayRange)}>
              <SelectTrigger><SelectValue placeholder="بازه روز" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">همه</SelectItem>
                <SelectItem value="32">بالای ۳۲ روز</SelectItem>
                <SelectItem value="60">بالای ۶۰ روز</SelectItem>
                <SelectItem value="130">بالای ۱۳۰ روز</SelectItem>
                <SelectItem value="220">بالای ۲۲۰ روز</SelectItem>
                <SelectItem value="250">بالای ۲۵۰ روز</SelectItem>
              </SelectContent>
            </Select>
            <Select value={pregMode} onValueChange={(v) => setPregMode(v as PregMode)}>
              <SelectTrigger><SelectValue placeholder="آبستنی / خشکی" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">همه</SelectItem>
                <SelectItem value="pregnant">فقط آبستن</SelectItem>
                <SelectItem value="open">فقط غیرآبستن</SelectItem>
                <SelectItem value="dry">فقط خشک</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sortKey} onValueChange={(v) => setSortKey(v as SortKey)}>
              <SelectTrigger><SelectValue placeholder="مرتب‌سازی" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="days_desc">بیشترین روز</SelectItem>
                <SelectItem value="days_asc">کمترین روز</SelectItem>
                <SelectItem value="body">شماره بدنه</SelectItem>
                <SelectItem value="status">وضعیت تولیدمثل</SelectItem>
              </SelectContent>
            </Select>

            {/* Status multi-select rendered as toggleable pills since shadcn
                Select has no multi-select. Pills auto-list every chart_status
                value present in the data. */}
            <div className="sm:col-span-2 lg:col-span-3">
              <div className="flex flex-wrap gap-1.5">
                {statusOptions.map((s) => {
                  const active = statusFilter.includes(s);
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => toggleStatus(s)}
                      className={`text-xs px-2.5 py-1 rounded-full border transition ${
                        active
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-card text-muted-foreground border-border hover:border-primary/40"
                      }`}
                    >
                      {s}
                    </button>
                  );
                })}
                {statusOptions.length === 0 && (
                  <span className="text-xs text-muted-foreground">وضعیتی برای فیلتر یافت نشد.</span>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* KPI cards — reflect filtered data */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
        {([
          ["کل دام‌ها", kpis.total],
          ["تعداد تلیسه‌ها", kpis.heifers],
          ["بالای ۱۳۰ روز", kpis.over130],
          ["بالای ۲۲۰ روز", kpis.over220],
          ["بالای ۲۵۰ روز", kpis.over250],
          ["میانگین روز", kpis.avg],
          ["تعداد آبستن", kpis.pregnant],
          ["تعداد خشک", kpis.dry],
        ] as const).map(([label, value]) => (
          <GlobalCard key={label} className="p-3">
            <p className="text-[11px] text-muted-foreground">{label}</p>
            <p className="text-lg font-bold text-foreground mt-0.5">{value.toLocaleString("fa-IR")}</p>
          </GlobalCard>
        ))}
      </div>

      {/* Status legend — placed ABOVE the chart as horizontal pills so it
          reads as a header ("راهنمای وضعیت") instead of competing with the
          chart for horizontal space. Counts + percentages reflect filtered data. */}
      <div className="card-dashboard p-3">
        <h3 className="text-sm font-semibold text-foreground mb-2">راهنمای وضعیت</h3>
        {legend.length === 0 ? (
          <p className="text-xs text-muted-foreground">موردی برای نمایش نیست.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {legend.map((l) => (
              <div
                key={l.status}
                className="flex items-center gap-2 text-xs px-2.5 py-1 rounded-full border border-border bg-card/60"
              >
                <span className="inline-block w-3 h-3 rounded-sm shrink-0" style={{ background: l.color }} />
                <span className="text-foreground whitespace-nowrap">{l.status}</span>
                <span className="text-muted-foreground whitespace-nowrap">
                  {l.count.toLocaleString("fa-IR")} • {l.pct.toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Chart — now spans full width since the legend moved on top. */}
      <div className="card-dashboard p-2">
        {filtered.length === 0 ? (
          <div className="py-24 text-center text-muted-foreground">داده‌ای برای نمایش وجود ندارد.</div>
        ) : (
          <ReactECharts
            ref={chartRef}
            option={option}
            notMerge
            lazyUpdate
            style={{ height: isMobile ? 420 : 620, width: "100%" }}
            onEvents={{ click: onChartClick }}
          />
        )}
      </div>
    </div>
  );
}
