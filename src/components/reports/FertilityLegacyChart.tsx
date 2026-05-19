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

// Legacy CRM color palette by fertility status id — matches the old
// reporting screen exactly so users transitioning from the legacy system
// see the same colors for each وضعیت تولیدمثل. Falls back to
// `status_color` from the DB when an id isn't in this map.
const LEGACY_STATUS_COLOR_BY_ID: Record<number, string> = {
  1: "#A9CCE3",  // بدون وضعیت — light blue
  2: "#F5B041",  // فحل شده — peach/orange
  3: "#E67E22",  // تلقیح شده — orange
  4: "#27AE60",  // تست اولیه مثبت — green
  5: "#A9D08E",  // تست اولیه مشکوک — light green
  6: "#E74C3C",  // تست اولیه منفی — red
  7: "#CD6155",  // تست نهایی منفی — soft red
  8: "#5B6FA8",  // آبستن قطعی — blue/purple
  9: "#F1C40F",  // سقط کرده — yellow
  12: "#ECF0F1", // تازه زا — white/off-white
  14: "#F5B7B1", // شستشو شده — pink
  15: "#BDC3C7", // کلین تست مثبت — gray
  16: "#B03A2E", // تحت درمان — brownish red
  17: "#E6B0AA", // تست تکمیلی منفی — pinkish red
  18: "#7F8C8D", // تست تکمیلی مثبت — dark gray
  19: "#F5B7B1", // تست خشکی منفی — pink
  20: "#95A5A6", // تست خشکی مثبت — gray
  21: "#5DADE2", // همزمان شده جهت فحلی — blue
  22: "#FADBD8", // توقف برنامه همزمان سازی — very light pink
};

// Resolve final bar color: prefer the legacy palette by status id, then
// the DB-provided status_color, then a neutral gray fallback.
const resolveStatusColor = (
  statusId: number | null | undefined,
  fallback: string | null | undefined,
): string => {
  if (statusId != null && LEGACY_STATUS_COLOR_BY_ID[statusId]) {
    return LEGACY_STATUS_COLOR_BY_ID[statusId];
  }
  return fallback ?? "#9CA3AF";
};

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
  // Legacy CRM-derived fields (added in the view to match the old C# chart):
  // - pregnancy_days: روز از آخرین تلقیح (today - last_inoculation_date)
  // - prediction_of_birth_date: last_inoculation_date + 279 روز
  // - prediction_of_birth_date_days: روز باقی‌مانده تا زایش پیش‌بینی شده
  // - dry_days: روز خشکی (today - last_dry_date) فقط وقتی is_dry = true
  // - last_birth_to_pregnancy_days: فاصله آخرین زایش تا تلقیح بعدی
  pregnancy_days: number | null;
  prediction_of_birth_date: string | null;
  prediction_of_birth_date_days: number | null;
  dry_days: number | null;
  last_birth_to_pregnancy_days: number | null;
  // Added in the view: pen/location label and Persian milking status.
  last_location_name: string | null;
  milking_status: string | null;
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
  // Default selected statuses — per product spec, the chart opens showing
  // only the three most operationally relevant fertility states. Users can
  // click any other state in راهنمای وضعیت to reveal more bars.
  const DEFAULT_STATUSES = ["آبستن قطعی", "تست اولیه مثبت", "تلقیح شده"];
  const [statusFilter, setStatusFilter] = useState<string[]>(DEFAULT_STATUSES);
  const [heiferMode, setHeiferMode] = useState<HeiferMode>("all");
  const [dayRange, setDayRange] = useState<DayRange>("all");
  const [pregMode, setPregMode] = useState<PregMode>("all");
  // periodFilter — set of selected شکم values as strings ("1".."7").
  // Stored as string[] (not a single string) so the user can multi-select
  // several دوره‌ها at once, just like the chart_status pills above.
  const [periodFilter, setPeriodFilter] = useState<string[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>("days_desc");
  const [filtersOpen, setFiltersOpen] = useState(!isMobile);

  // Pending click — when a user clicks a bar we capture the cow here and
  // open a confirmation dialog. Confirming opens the cow profile in a new
  // tab; cancelling clears the pending selection.
  const [pendingCow, setPendingCow] = useState<FertilityChartRow | null>(null);

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
      // دوره (شکم) filter — multi-select. If the user picked any شکم values
      // the cow's last_period must match one of them (OR semantics across
      // periods, AND with all other filter categories — same pattern as the
      // status pills above).
      if (periodFilter.length > 0) {
        // Stringify so we can compare against the dropdown values directly.
        const lp = String(r.last_period ?? "");
        if (!periodFilter.includes(lp)) return false;
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

  // Legend rows — aggregated per status. Built from rows ignoring the
  // current statusFilter so users can always see ALL available statuses in
  // راهنمای وضعیت and click any of them to add/remove bars from the chart.
  // Counts reflect all other active filters (search, heifer, day range…).
  const legend = useMemo(() => {
    const q = debouncedSearch.trim();
    const dayMin = dayRange === "all" ? 0 : parseInt(dayRange, 10);
    const baseRows = rows.filter((r) => {
      if (q) {
        const bodyMatch = r.bodynumber != null && String(r.bodynumber).includes(q);
        const earMatch = r.earnumber != null && String(r.earnumber).includes(q);
        if (!bodyMatch && !earMatch) return false;
      }
      if (heiferMode === "heifer" && !r.is_heifer) return false;
      if (heiferMode === "cow" && r.is_heifer) return false;
      if (dayMin > 0 && (r.chart_days ?? 0) <= dayMin) return false;
      if (pregMode === "pregnant" && !r.is_pregnancy) return false;
      if (pregMode === "open" && r.is_pregnancy) return false;
      if (pregMode === "dry" && !r.is_dry) return false;
      if (periodFilter.length > 0) {
        const lp = String(r.last_period ?? "");
        if (!periodFilter.includes(lp)) return false;
      }
      return true;
    });

    const map = new Map<string, { color: string; count: number }>();
    baseRows.forEach((r) => {
      const k = r.chart_status ?? "نامشخص";
      const c = resolveStatusColor(r.last_fertility_status, r.status_color);
      const cur = map.get(k) ?? { color: c, count: 0 };
      cur.count += 1;
      cur.color = c;
      map.set(k, cur);
    });
    const total = baseRows.length || 1;
    return Array.from(map.entries())
      .map(([status, v]) => ({ status, color: v.color, count: v.count, pct: (v.count / total) * 100 }))
      .sort((a, b) => b.count - a.count);
  }, [rows, debouncedSearch, heiferMode, dayRange, pregMode, periodFilter]);

  // Build ECharts option. Memoized so React doesn't rebuild it
  // unless filtered data actually changes.
  const option = useMemo(() => {
    const xLabels = filtered.map((r) => r.bodynumber != null ? String(r.bodynumber) : `#${r.livestock_id}`);

    // Bar series with per-cow color via itemStyle callback.
    const barData = filtered.map((r) => ({
      value: r.chart_days ?? 0,
      itemStyle: {
        // Apply the legacy CRM palette per status id (falls back to the
        // DB-provided status_color when an id isn't mapped).
        color: resolveStatusColor(r.last_fertility_status, r.status_color),
        borderRadius: [4, 4, 0, 0],
      },
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
          return `<div style="direction:rtl;text-align:right;font-family:Vazirmatn,sans-serif;min-width:240px">
            ${line("بدن", r.bodynumber)}
            ${line("گوش", r.earnumber)}
            ${line("میزان آبستنی", r.pregnancy_days)}
            ${line("مدت زایش تا آبستنی", r.last_birth_to_pregnancy_days)}
            ${line("تعداد زایش", r.number_of_births)}
            ${line("آخرین تلقیح", r.last_inoculation_date)}
            ${line("پیش بینی زایش", r.prediction_of_birth_date)}
            ${line("در بهاربند", r.last_location_name)}
            ${line("وضعیت باروری فعلی", r.chart_status)}
            ${line("وضعیت دوشش", r.milking_status)}
            ${line("میزان خشکی", r.dry_days)}
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
          // ---- Management threshold lines (روزهای کلیدی باروری) ----
          // Each threshold gets its own color (cool → warm) so the user can
          // distinguish them at a glance. Labels sit on a colored pill that's
          // always visible, and emphasis.lineStyle makes the line glow when
          // the user hovers near it (ECharts auto-emphasizes the closest mark).
          markLine: {
            // silent:false → markLines emit hover events so emphasis works.
            silent: false,
            symbol: ["none", "none"],
            // Default styling (overridden per-line via data[].lineStyle).
            lineStyle: { width: 1.5, type: "dashed", opacity: 0.85 },
            label: {
              show: true,
              position: "insideEndTop",
              color: "#0B1220",
              fontFamily: "Vazirmatn, sans-serif",
              fontSize: 11,
              fontWeight: 700,
              padding: [2, 6, 2, 6],
              borderRadius: 4,
            },
            // Hover state — thicker, fully opaque, label scales up.
            emphasis: {
              lineStyle: { width: 3, opacity: 1, shadowBlur: 8, shadowColor: "rgba(255,255,255,0.35)" },
              label: { fontSize: 13, padding: [3, 8, 3, 8] },
            },
            // Per-threshold colors picked to match the legacy CRM semantics:
            //  32  → اولین فحلی پس از زایش (blue)
            //  60  → آماده‌ی تلقیح (teal)
            //  130 → باید آبستن باشد (amber)
            //  220 → دیر-آبستن (orange)
            //  250 → خشک‌شدن (red)
            //  270 → نزدیک زایش (deep red)
            data: [
              { yAxis: 32,  lineStyle: { color: "#38BDF8" }, label: { formatter: "۳۲", backgroundColor: "#38BDF8" } },
              { yAxis: 60,  lineStyle: { color: "#14B8A6" }, label: { formatter: "۶۰", backgroundColor: "#14B8A6" } },
              { yAxis: 130, lineStyle: { color: "#F59E0B" }, label: { formatter: "۱۳۰", backgroundColor: "#F59E0B" } },
              { yAxis: 220, lineStyle: { color: "#F97316" }, label: { formatter: "۲۲۰", backgroundColor: "#F97316" } },
              { yAxis: 250, lineStyle: { color: "#EF4444" }, label: { formatter: "۲۵۰", backgroundColor: "#EF4444" } },
              { yAxis: 270, lineStyle: { color: "#B91C1C" }, label: { formatter: "۲۷۰", backgroundColor: "#B91C1C" } },
            ],
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

  // Bar-click → open a confirmation dialog ("ورود به پروفایل").
  // On confirm we open the cow profile in a NEW TAB so the user's place
  // in the chart (filters, zoom, scroll) is preserved.
  const onChartClick = (params: any) => {
    // Guard: clicking on markLines / scatter / empty area also fires this
    // handler but without a valid bar dataIndex. Only react when we
    // actually clicked a cow bar — otherwise ECharts internals can throw
    // "Cannot read properties of undefined (reading 'getRawIndex')".
    if (!params || params.componentType !== "series" || params.seriesType !== "bar") return;
    const idx = params?.dataIndex;
    if (typeof idx !== "number") return;
    const r = filtered[idx];
    if (!r) return;
    // Stage the cow for the AlertDialog — actual navigation happens on
    // confirm so accidental clicks don't whisk the user away.
    setPendingCow(r);
  };

  // Confirm handler — opens the cow profile in a new browser tab.
  // We use window.open with noopener,noreferrer for safer cross-tab access.
  const confirmOpenProfile = () => {
    if (!pendingCow) return;
    const url = `/livestock/${pendingCow.livestock_id}`;
    try {
      window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      // Fallback: in-app navigation if window.open is blocked.
      navigate(url);
      toast(`شناسه دام: ${pendingCow.livestock_id}`);
    }
    setPendingCow(null);
  };

  // Reset all filter state back to defaults.
  const resetFilters = () => {
    setSearch("");
    setStatusFilter(DEFAULT_STATUSES);
    setHeiferMode("all");
    setDayRange("all");
    setPregMode("all");
    // Reset the شکم/دوره picker back to "همه" so all periods are shown again.
    // Empty array means "no period filter" — matches the multi-select semantics.
    setPeriodFilter([]);
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
            {/* Each filter is wrapped in a labeled block so the user can tell
                exactly what the input/select is going to filter. Labels use
                muted-foreground so they don't compete visually with values. */}
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground font-medium">جستجو</label>
              <Input
                placeholder="شماره بدنه / شماره گوش"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="text-right"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs text-muted-foreground font-medium">نوع دام</label>
              <Select value={heiferMode} onValueChange={(v) => setHeiferMode(v as HeiferMode)}>
                <SelectTrigger><SelectValue placeholder="تلیسه" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">همه</SelectItem>
                  <SelectItem value="heifer">فقط تلیسه‌ها</SelectItem>
                  <SelectItem value="cow">فقط گاوها</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <label className="text-xs text-muted-foreground font-medium">بازه روز</label>
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
            </div>

            <div className="space-y-1">
              <label className="text-xs text-muted-foreground font-medium">آبستنی / خشکی</label>
              <Select value={pregMode} onValueChange={(v) => setPregMode(v as PregMode)}>
                <SelectTrigger><SelectValue placeholder="آبستنی / خشکی" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">همه</SelectItem>
                  <SelectItem value="pregnant">فقط آبستن</SelectItem>
                  <SelectItem value="open">فقط غیرآبستن</SelectItem>
                  <SelectItem value="dry">فقط خشک</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <label className="text-xs text-muted-foreground font-medium">مرتب‌سازی</label>
              <Select value={sortKey} onValueChange={(v) => setSortKey(v as SortKey)}>
                <SelectTrigger><SelectValue placeholder="مرتب‌سازی" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="days_desc">بیشترین روز</SelectItem>
                  <SelectItem value="days_asc">کمترین روز</SelectItem>
                  <SelectItem value="body">شماره بدنه</SelectItem>
                  <SelectItem value="status">وضعیت تولیدمثل</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* دوره (شکم) — multi-select pills (شکم اول … شکم هفتم).
                Spans 3 columns on desktop so all 7 pills sit on one row. */}
            <div className="space-y-1 sm:col-span-2 lg:col-span-3">
              <label className="text-xs text-muted-foreground font-medium">
                دوره (شکم) — انتخاب چندتایی
              </label>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(PERIOD_LABEL).map(([value, label]) => {
                  // active = is this شکم currently in the selected set?
                  const active = periodFilter.includes(value);
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() =>
                        // Toggle pattern: if already selected → remove,
                        // otherwise → append. Same UX as the status pills.
                        setPeriodFilter((prev) =>
                          prev.includes(value)
                            ? prev.filter((x) => x !== value)
                            : [...prev, value],
                        )
                      }
                      className={`text-xs px-2.5 py-1 rounded-full border transition ${
                        active
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-card text-muted-foreground border-border hover:border-primary/40"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Status multi-select rendered as toggleable pills (chart_status). */}
            <div className="space-y-1 sm:col-span-2 lg:col-span-4">
              <label className="text-xs text-muted-foreground font-medium">
                وضعیت تولیدمثل — انتخاب چندتایی
              </label>
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

      {/* Confirmation dialog shown after clicking a bar. Asks the user
          whether they want to open the cow profile in a new tab. Using
          AlertDialog (vs a plain Dialog) because this is a navigational
          action the user should explicitly acknowledge. */}
      <AlertDialog
        open={pendingCow !== null}
        onOpenChange={(open) => { if (!open) setPendingCow(null); }}
      >
        <AlertDialogContent dir="rtl" className="text-right">
          <AlertDialogHeader>
            <AlertDialogTitle>ورود به پروفایل</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingCow ? (
                <>
                  آیا می‌خواهید پروفایل دام
                  {" "}
                  <strong>
                    {pendingCow.bodynumber != null
                      ? `بدنه ${pendingCow.bodynumber}`
                      : `#${pendingCow.livestock_id}`}
                  </strong>
                  {pendingCow.earnumber != null && <> (گوش {pendingCow.earnumber})</>}
                  {" "}
                  در یک تب جدید باز شود؟
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel>انصراف</AlertDialogCancel>
            <AlertDialogAction onClick={confirmOpenProfile}>
              ورود به پروفایل
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
