// =============================================================================
// FertilityHerdPerformance.tsx  —  route: /reports/fertility/herd-performance
// -----------------------------------------------------------------------------
// «گزارش عملکرد باروری گله» — the second active fertility report. It exposes
// management & industry-standard KPIs, a reproductive funnel, open-days
// distribution, trend lines, and segment tables (parity / group / protocol /
// semen) — all derived in `useHerdFertilityPerformance` from a single load.
//
// Mode persistence: the calculation mode (Management vs Industry) is stored
// in BOTH the URL query string (?mode=) and localStorage so it survives
// reloads and is shareable via copy/paste.
// =============================================================================

import { useEffect, useMemo, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { Loader2, Settings as SettingsIcon, TrendingUp, Beaker, Layers } from "lucide-react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import FertilityBreadcrumb from "@/components/reports/FertilityBreadcrumb";
// Shared ECharts chart wrappers — official Damban reporting standard.
// All report visualizations MUST come from this module (no Recharts, no
// custom <div> bars). See src/components/reports/charts/index.tsx.
import { FunnelChart, HorizontalBarChart } from "@/components/reports/charts";
import { useHerdFertilityPerformance } from "@/hooks/useHerdFertilityPerformance";
import type {
  CalcMode, HerdFilters, ParityFilter, TrendGranularity,
} from "@/lib/fertility/herdPerformance";

// -----------------------------------------------------------------------------
// LocalStorage key for the calc-mode preference. We use a namespaced key to
// avoid clashes with future reports.
// -----------------------------------------------------------------------------
const MODE_LS_KEY = "fertility.herdPerf.mode";

// Tiny helper to safely format a numeric KPI: returns "—" for null,
// otherwise the value rounded with the requested fraction digits.
function fmt(v: number | null | undefined, digits = 0, suffix = ""): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const rounded = digits === 0 ? Math.round(v) : Number(v.toFixed(digits));
  return `${rounded}${suffix}`;
}

// KPI card — small, mode-agnostic, dark-friendly. Mirrors Action List visuals.
function KpiCard({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card px-4 py-3">
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      <div className={`text-2xl font-extrabold ${accent ?? "text-foreground"}`}>{value}</div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Date helpers for the default range (last 90 days). We expose them as ISO
// `YYYY-MM-DD` strings for the date inputs.
// -----------------------------------------------------------------------------
const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const today = () => new Date();
const ninetyDaysAgo = () => {
  const d = new Date();
  d.setDate(d.getDate() - 90);
  return d;
};

export default function FertilityHerdPerformance() {
  // ---- Mode (Management vs Industry) ---------------------------------------
  // Source of truth precedence: URL > localStorage > default.
  const [searchParams, setSearchParams] = useSearchParams();
  const initialMode: CalcMode = useMemo(() => {
    const fromUrl = searchParams.get("mode") as CalcMode | null;
    if (fromUrl === "management" || fromUrl === "industry") return fromUrl;
    if (typeof window !== "undefined") {
      const fromLs = window.localStorage.getItem(MODE_LS_KEY);
      if (fromLs === "management" || fromLs === "industry") return fromLs;
    }
    return "management";
  }, []); // intentionally one-shot
  const [mode, setMode] = useState<CalcMode>(initialMode);

  // Persist to URL + localStorage whenever the user toggles.
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    next.set("mode", mode);
    setSearchParams(next, { replace: true });
    if (typeof window !== "undefined") window.localStorage.setItem(MODE_LS_KEY, mode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // ---- Other filters --------------------------------------------------------
  const [fromDate, setFromDate] = useState<string>(isoDate(ninetyDaysAgo()));
  const [toDate, setToDate] = useState<string>(isoDate(today()));
  const [groupId, setGroupId] = useState<string>("all");
  const [parity, setParity] = useState<ParityFilter>("all");
  const [syncTypeId, setSyncTypeId] = useState<string>("all");
  const [spermId, setSpermId] = useState<string>("all");
  const [granularity, setGranularity] = useState<TrendGranularity>("monthly");

  // Build the typed filter object once per state change.
  const filters: HerdFilters = useMemo(() => ({
    fromDate: new Date(fromDate),
    toDate: new Date(toDate + "T23:59:59"),
    groupId: groupId === "all" ? null : Number(groupId),
    parity,
    syncTypeId: syncTypeId === "all" ? null : Number(syncTypeId),
    spermId: spermId === "all" ? null : Number(spermId),
    granularity,
    mode,
  }), [fromDate, toDate, groupId, parity, syncTypeId, spermId, granularity, mode]);

  const { isLoading, error, result, refs } = useHerdFertilityPerformance(filters);

  return (
    <div className="space-y-5 py-4" dir="rtl">
      <FertilityBreadcrumb currentPage="عملکرد باروری گله" />

      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-foreground">عملکرد باروری گله</h1>
          <p className="text-sm text-muted-foreground mt-1">
            شاخص‌های مدیریتی و استاندارد صنعتی، قیف تولیدمثل، توزیع روزهای باز و
            مقایسه‌ها بر اساس شکم، گروه، پروتکل و اسپرم.
          </p>
        </div>
        <Button asChild variant="outline" size="sm" className="gap-2">
          <Link to="/settings/fertility">
            <SettingsIcon className="w-4 h-4" />
            تنظیمات آستانه‌ها
          </Link>
        </Button>
      </header>

      {/* Mode tabs — persisted to URL + localStorage */}
      <Tabs value={mode} onValueChange={(v) => setMode(v as CalcMode)}>
        <TabsList>
          <TabsTrigger value="management">شاخص‌های مدیریتی</TabsTrigger>
          <TabsTrigger value="industry">شاخص‌های استاندارد صنعت</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Filters bar */}
      <div className="rounded-2xl border border-border bg-card p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">از تاریخ</Label>
          <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="text-right" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">تا تاریخ</Label>
          <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="text-right" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">گروه (موقت: مکان)</Label>
          <Select value={groupId} onValueChange={setGroupId}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">همه گروه‌ها</SelectItem>
              {refs.locations.map((l) => (
                <SelectItem key={l.id} value={String(l.id)}>{l.name ?? `#${l.id}`}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">شکم زایش</Label>
          <Select value={parity} onValueChange={(v) => setParity(v as ParityFilter)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">همه</SelectItem>
              <SelectItem value="heifer">تلیسه</SelectItem>
              <SelectItem value="primiparous">Primiparous (شکم ۱)</SelectItem>
              <SelectItem value="multiparous">Multiparous (شکم ۲+)</SelectItem>
              <SelectItem value="1">شکم ۱</SelectItem>
              <SelectItem value="2">شکم ۲</SelectItem>
              <SelectItem value="3">شکم ۳</SelectItem>
              <SelectItem value="4plus">شکم ۴+</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">پروتکل همزمانی</Label>
          <Select value={syncTypeId} onValueChange={setSyncTypeId}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">همه</SelectItem>
              {refs.syncTypes.map((s) => (
                <SelectItem key={s.id} value={String(s.id)}>{s.name ?? `#${s.id}`}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">اسپرم</Label>
          <Select value={spermId} onValueChange={setSpermId}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">همه</SelectItem>
              {refs.sperms.slice(0, 200).map((s) => (
                <SelectItem key={s.id} value={String(s.id)}>{s.name ?? s.code ?? `#${s.id}`}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">تفکیک روند</Label>
          <Select value={granularity} onValueChange={(v) => setGranularity(v as TrendGranularity)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="monthly">ماهانه</SelectItem>
              <SelectItem value="quarterly">فصلی</SelectItem>
              <SelectItem value="yearly">سالانه</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Body */}
      {error ? (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/10 text-destructive p-4 text-sm">
          خطا در بارگذاری داده‌ها: {error.message}
        </div>
      ) : isLoading || !result ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          در حال محاسبه…
        </div>
      ) : (
        <>
          {/* KPI strip */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <KpiCard label="گاوهای واجد شرایط" value={fmt(result.kpis.eligibleCows)} accent="text-primary" />
            <KpiCard label="گاوهای آبستن" value={fmt(result.kpis.pregnantCows)} accent="text-primary" />
            <KpiCard label="گاوهای باز" value={fmt(result.kpis.openCows)} />
            <KpiCard label="نرخ آبستنی" value={fmt(result.kpis.pregnancyRate, 1, "%")} accent="text-primary" />
            <KpiCard label="نرخ گیرایی" value={fmt(result.kpis.conceptionRate, 1, "%")} />
            <KpiCard label="نرخ تشخیص فحلی" value={fmt(result.kpis.heatDetectionRate, 1, "%")} />
            <KpiCard label="نرخ سرویس‌دهی" value={fmt(result.kpis.serviceRate, 1, "%")} />
            <KpiCard label="نرخ موفقیت اولین تلقیح" value={fmt(result.kpis.firstServiceConceptionRate, 1, "%")} />
            <KpiCard label="میانگین روزهای باز" value={fmt(result.kpis.averageOpenDays)} />
            <KpiCard label="زایش تا اولین تلقیح" value={fmt(result.kpis.daysToFirstService)} />
            <KpiCard label="زایش تا آبستن شدن" value={fmt(result.kpis.daysToConception)} />
            <KpiCard label="میانگین تلقیح/آبستنی" value={fmt(result.kpis.averageServicesPerConception, 1)} />
            <KpiCard label="Repeat Breeder %" value={fmt(result.kpis.repeatBreederRate, 1, "%")} accent="text-amber-400" />
            <KpiCard label="Chronic Breeder %" value={fmt(result.kpis.chronicBreederRate, 1, "%")} accent="text-destructive" />
            <KpiCard label="نرخ سقط" value={fmt(result.kpis.abortionRate, 1, "%")} accent="text-destructive" />
            <KpiCard label="نرخ از دست رفتن آبستنی" value={fmt(result.kpis.pregnancyLossRate, 1, "%")} accent="text-destructive" />
          </div>

          {/* Reproductive funnel */}
          <FunnelSection stages={result.funnel} />

          {/* Open-days distribution (between KPI strip and trend) */}
          <OpenDaysDistribution data={result.openDaysDistribution} />

          {/* Trend */}
          <TrendSection data={result.trend} granularity={granularity} />

          {/* Parity segmentation */}
          <SegmentTable
            title="تفکیک بر اساس شکم زایش"
            icon={<Layers className="w-4 h-4 text-primary" />}
            rows={result.parityRows}
          />

          {/* Group comparison */}
          <SegmentTable
            title="مقایسه گروهی (موقت: مکان) — حداکثر ۲۰ مورد"
            icon={<Layers className="w-4 h-4 text-primary" />}
            rows={result.groupRows}
            note="گروه‌بندی موقت بر اساس مکان (پروکسی) است تا زمانی که رابطه واقعی گروه افزوده شود."
          />

          {/* Protocol comparison */}
          <ProtocolTable rows={result.protocolRows} />

          {/* Semen performance — top 15 */}
          <SemenTable rows={result.semenRows} />
        </>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// FunnelSection — five-stage reproductive funnel rendered with Apache ECharts.
//
// Per the Damban Reporting & Visualization Standard, every report chart MUST
// use ECharts (no custom <div> bars, no Recharts). We delegate the actual
// drawing to the shared FunnelChart wrapper which applies the unified theme
// (Vazirmatn font, transparent background, Persian-digit labels, brand
// palette) so the funnel looks identical to every other report.
// -----------------------------------------------------------------------------
function FunnelSection({ stages }: { stages: { eligible: number; heat: number; service: number; pregnancyTest: number; pregnant: number } }) {
  // Map the report-specific stage shape into the generic FunnelChart contract.
  // Order matters — the funnel preserves caller order (sort: 'none') because
  // the order itself represents the biological pipeline.
  const data = [
    { name: "واجد شرایط", value: stages.eligible },
    { name: "فحلی", value: stages.heat },
    { name: "تلقیح", value: stages.service },
    { name: "تست آبستنی", value: stages.pregnancyTest },
    { name: "آبستن", value: stages.pregnant },
  ];
  return (
    <section className="rounded-2xl border border-border bg-card p-4 space-y-3">
      <h2 className="text-base font-bold text-foreground flex items-center gap-2">
        <Beaker className="w-4 h-4 text-primary" /> قیف تولیدمثل
      </h2>
      {/* FunnelChart computes per-stage conversion ratios internally and
          renders them inline on each segment, so we don't need a separate
          conversion legend here. */}
      <FunnelChart stages={data} height={340} />
    </section>
  );
}

// -----------------------------------------------------------------------------
// OpenDaysDistribution — histogram of open-days buckets, rendered with the
// shared ECharts HorizontalBarChart wrapper. Persian-friendly horizontal
// layout means long bucket labels (e.g. "۱۵۱–۱۸۰ روز") aren't cramped.
// -----------------------------------------------------------------------------
function OpenDaysDistribution({ data }: { data: { bucket: string; count: number }[] }) {
  // Convert {bucket,count} → {category,value} expected by the wrapper.
  const chartData = data.map((d) => ({ category: d.bucket, value: d.count }));
  return (
    <section className="rounded-2xl border border-border bg-card p-4 space-y-3">
      <h2 className="text-base font-bold text-foreground">توزیع روزهای باز</h2>
      <HorizontalBarChart data={chartData} height={260} valueLabel="تعداد گاو" />
    </section>
  );
}

// -----------------------------------------------------------------------------
// TrendSection — table of period buckets with three rates and three volumes.
// Kept tabular (not a chart library) to stay light; can be upgraded later.
// -----------------------------------------------------------------------------
function TrendSection({ data, granularity }: { data: { period: string; pregnancyRate: number; conceptionRate: number; heatDetectionRate: number; services: number; pregnancies: number; abortions: number }[]; granularity: TrendGranularity }) {
  const granLabel = granularity === "monthly" ? "ماه" : granularity === "quarterly" ? "فصل" : "سال";
  return (
    <section className="rounded-2xl border border-border bg-card overflow-hidden">
      <header className="px-4 py-3 border-b border-border flex items-center justify-between">
        <h2 className="text-base font-bold text-foreground flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-primary" /> روند تغییرات ({granLabel})
        </h2>
        <Badge variant="secondary">{data.length}</Badge>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 text-muted-foreground">
            <tr>
              <th className="text-right px-3 py-2 font-medium">دوره</th>
              <th className="text-right px-3 py-2 font-medium">نرخ آبستنی</th>
              <th className="text-right px-3 py-2 font-medium">نرخ گیرایی</th>
              <th className="text-right px-3 py-2 font-medium">نرخ تشخیص فحلی</th>
              <th className="text-right px-3 py-2 font-medium">تلقیح‌ها</th>
              <th className="text-right px-3 py-2 font-medium">آبستنی‌ها</th>
              <th className="text-right px-3 py-2 font-medium">سقط‌ها</th>
            </tr>
          </thead>
          <tbody>
            {data.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-6 text-muted-foreground">داده‌ای برای این بازه ثبت نشده است</td></tr>
            ) : data.map((r) => (
              <tr key={r.period} className="border-t border-border">
                <td className="px-3 py-2 text-foreground">{r.period}</td>
                <td className="px-3 py-2">{r.pregnancyRate.toFixed(1)}%</td>
                <td className="px-3 py-2">{r.conceptionRate.toFixed(1)}%</td>
                <td className="px-3 py-2">{r.heatDetectionRate.toFixed(1)}%</td>
                <td className="px-3 py-2">{r.services}</td>
                <td className="px-3 py-2">{r.pregnancies}</td>
                <td className="px-3 py-2">{r.abortions}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="px-4 py-2 text-[11px] text-muted-foreground border-t border-border">
        روند نرخ‌ها برای دوره‌های گذشته بر مبنای داده فعلی محاسبه می‌شود — مقادیر مرجع تاریخی ذخیره نمی‌شوند.
      </p>
    </section>
  );
}

// -----------------------------------------------------------------------------
// SegmentTable — generic table used by Parity and Group sections.
// -----------------------------------------------------------------------------
import type { SegmentRow } from "@/lib/fertility/herdPerformance";
function SegmentTable({ title, rows, note, icon }: { title: string; rows: SegmentRow[]; note?: string; icon?: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-card overflow-hidden">
      <header className="px-4 py-3 border-b border-border flex items-center justify-between">
        <h2 className="text-base font-bold text-foreground flex items-center gap-2">{icon}{title}</h2>
        <Badge variant="secondary">{rows.length}</Badge>
      </header>
      {note && <p className="px-4 py-2 text-[11px] text-muted-foreground border-b border-border">{note}</p>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 text-muted-foreground">
            <tr>
              <th className="text-right px-3 py-2 font-medium">عنوان</th>
              <th className="text-right px-3 py-2 font-medium">تعداد</th>
              <th className="text-right px-3 py-2 font-medium">نرخ آبستنی</th>
              <th className="text-right px-3 py-2 font-medium">نرخ گیرایی</th>
              <th className="text-right px-3 py-2 font-medium">تلقیح/آبستنی</th>
              <th className="text-right px-3 py-2 font-medium">میانگین روز باز</th>
              <th className="text-right px-3 py-2 font-medium">DTFS</th>
              <th className="text-right px-3 py-2 font-medium">DTC</th>
              <th className="text-right px-3 py-2 font-medium">Repeat %</th>
              <th className="text-right px-3 py-2 font-medium">Chronic %</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-t border-border">
                <td className="px-3 py-2 text-foreground">{r.label}</td>
                <td className="px-3 py-2">{r.cowCount}</td>
                <td className="px-3 py-2">{fmt(r.pregnancyRate, 1, "%")}</td>
                <td className="px-3 py-2">{fmt(r.conceptionRate, 1, "%")}</td>
                <td className="px-3 py-2">{fmt(r.servicesPerConception, 1)}</td>
                <td className="px-3 py-2">{fmt(r.averageOpenDays)}</td>
                <td className="px-3 py-2">{fmt(r.daysToFirstService)}</td>
                <td className="px-3 py-2">{fmt(r.daysToConception)}</td>
                <td className="px-3 py-2">{fmt(r.repeatBreederPct, 1, "%")}</td>
                <td className="px-3 py-2">{fmt(r.chronicBreederPct, 1, "%")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// -----------------------------------------------------------------------------
// ProtocolTable — Synchronization protocol comparison.
// -----------------------------------------------------------------------------
import type { ProtocolRow, SemenRow } from "@/lib/fertility/herdPerformance";
function ProtocolTable({ rows }: { rows: ProtocolRow[] }) {
  return (
    <section className="rounded-2xl border border-border bg-card overflow-hidden">
      <header className="px-4 py-3 border-b border-border flex items-center justify-between">
        <h2 className="text-base font-bold text-foreground">مقایسه پروتکل‌های همزمان‌سازی</h2>
        <Badge variant="secondary">{rows.length}</Badge>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 text-muted-foreground">
            <tr>
              <th className="text-right px-3 py-2 font-medium">پروتکل</th>
              <th className="text-right px-3 py-2 font-medium">تعداد همزمانی</th>
              <th className="text-right px-3 py-2 font-medium">تلقیح‌های منتسب</th>
              <th className="text-right px-3 py-2 font-medium">نرخ سرویس</th>
              <th className="text-right px-3 py-2 font-medium">نرخ گیرایی</th>
              <th className="text-right px-3 py-2 font-medium">تلقیح/آبستنی</th>
              <th className="text-right px-3 py-2 font-medium">میانگین فاصله</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-6 text-muted-foreground">داده‌ای برای این بازه ثبت نشده است</td></tr>
            ) : rows.map((r) => (
              <tr key={r.key} className="border-t border-border">
                <td className="px-3 py-2 text-foreground">{r.label}</td>
                <td className="px-3 py-2">{r.syncCount}</td>
                <td className="px-3 py-2">{r.resultingServices}</td>
                <td className="px-3 py-2">{fmt(r.serviceRate, 1, "%")}</td>
                <td className="px-3 py-2">{fmt(r.conceptionRate, 1, "%")}</td>
                <td className="px-3 py-2">{fmt(r.servicesPerConception, 1)}</td>
                <td className="px-3 py-2">{fmt(r.avgDaysSyncToService, 1)} روز</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// -----------------------------------------------------------------------------
// SemenTable — Semen / bull performance. Future-proof columns render "—".
// -----------------------------------------------------------------------------
function SemenTable({ rows }: { rows: SemenRow[] }) {
  return (
    <section className="rounded-2xl border border-border bg-card overflow-hidden">
      <header className="px-4 py-3 border-b border-border flex items-center justify-between">
        <h2 className="text-base font-bold text-foreground">عملکرد اسپرم (Top ۱۵)</h2>
        <Badge variant="secondary">{rows.length}</Badge>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 text-muted-foreground">
            <tr>
              <th className="text-right px-3 py-2 font-medium">اسپرم</th>
              <th className="text-right px-3 py-2 font-medium">تلقیح‌ها</th>
              <th className="text-right px-3 py-2 font-medium">نرخ گیرایی</th>
              <th className="text-right px-3 py-2 font-medium">نرخ اولین تلقیح</th>
              <th className="text-right px-3 py-2 font-medium">تلقیح/آبستنی</th>
              <th className="text-right px-3 py-2 font-medium">از دست رفتن آبستنی</th>
              <th className="text-right px-3 py-2 font-medium">تعداد دختر</th>
              <th className="text-right px-3 py-2 font-medium">% گوساله ماده</th>
              <th className="text-right px-3 py-2 font-medium">% گوساله نر</th>
              <th className="text-right px-3 py-2 font-medium">% سقط</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={10} className="text-center py-6 text-muted-foreground">داده‌ای برای این بازه ثبت نشده است</td></tr>
            ) : rows.map((r) => (
              <tr key={r.key} className="border-t border-border">
                <td className="px-3 py-2 text-foreground">{r.label}</td>
                <td className="px-3 py-2">{r.inseminations}</td>
                <td className="px-3 py-2">{fmt(r.conceptionRate, 1, "%")}</td>
                <td className="px-3 py-2">{fmt(r.firstServiceCR, 1, "%")}</td>
                <td className="px-3 py-2">{fmt(r.servicesPerConception, 1)}</td>
                <td className="px-3 py-2">{fmt(r.pregnancyLossRate, 1, "%")}</td>
                <td className="px-3 py-2">{fmt(r.daughterCount)}</td>
                <td className="px-3 py-2">{fmt(r.femaleCalfPct, 1, "%")}</td>
                <td className="px-3 py-2">{fmt(r.maleCalfPct, 1, "%")}</td>
                <td className="px-3 py-2">{fmt(r.abortionPct, 1, "%")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
