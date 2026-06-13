// =============================================================================
// TabInsightHeader
// -----------------------------------------------------------------------------
// A small, reusable strip of "context chips" that sits ABOVE each fertility
// operation tab (تلقیح / تست آبستنی / زایش / سقط / فحلی / خشکی). It surfaces
// the most relevant subset of the FertilitySummary for the current tab so the
// user has reproductive context without scrolling back to the summary card.
//
// Inputs are pre-computed (FertilitySummary + tab key) so this component does
// zero data work — purely presentational, RTL-safe, mobile-first.
// =============================================================================

import { formatShamsi } from "@/lib/dateDisplay";
import type { FertilitySummary } from "@/lib/fertility/fertilityRiskEngine";

export type InsightTab =
  | "insemination"
  | "pregnancy_test"
  | "calving"
  | "abortion"
  | "heat"
  | "dry_off";

interface Props {
  tab: InsightTab;
  summary: FertilitySummary;
}

// Persian-digit helper (kept local to avoid leaking from the summary card).
const fa = (n: number | null | undefined, suffix = "") =>
  n == null ? "—" : `${Number(n).toLocaleString("fa-IR")}${suffix}`;

// A single chip with a label + value. `tone` switches the colour for warning
// or info chips. All colours come from semantic tokens.
function Chip({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: React.ReactNode;
  tone?: "default" | "warn" | "danger" | "info";
}) {
  const toneClass =
    tone === "warn"
      ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
      : tone === "danger"
      ? "border-destructive/30 bg-destructive/10 text-destructive"
      : tone === "info"
      ? "border-sky-500/30 bg-sky-500/10 text-sky-400"
      : "border-border bg-background/40 text-foreground";
  return (
    <div className={`rounded-md border px-2 py-1 text-[11px] ${toneClass}`}>
      <span className="text-muted-foreground ml-1">{label}:</span>
      <span className="font-bold">{value ?? "—"}</span>
    </div>
  );
}

// Convert the chip list for the current tab. Centralised here so each tab's
// "what's relevant" decision lives in one file.
function chipsForTab(tab: InsightTab, s: FertilitySummary): React.ReactNode[] {
  switch (tab) {
    case "insemination":
      return [
        <Chip key="cnt" label="تلقیح این چرخه" value={fa(s.inseminationsCurrentCycle)} />,
        <Chip key="dim" label="DIM" value={fa(s.dim, " روز")} />,
        <Chip key="heatAI" label="فاصله فحلی→تلقیح" value={fa(s.heatToAIInterval, " روز")} />,
        <Chip
          key="fail"
          label="ناموفق پشت سر هم"
          value={fa(s.consecutiveFailedAI)}
          tone={s.consecutiveFailedAI >= 3 ? "danger" : s.consecutiveFailedAI === 2 ? "warn" : "default"}
        />,
        <Chip key="sperm" label="اسپرم اخیر" value={s.lastSperm ?? "—"} />,
        <Chip key="op" label="تلقیح‌کننده" value={s.lastInseminator ?? "—"} />,
        s.lastPregnancyTest && (
          <Chip key="test" label="آخرین تست" value={s.lastPregnancyTest.result ?? "—"} tone="info" />
        ),
        s.consecutiveFailedAI >= 3 && (
          <Chip key="rb" label="هشدار" value="Repeat Breeder" tone="danger" />
        ),
      ];
    case "pregnancy_test":
      return [
        <Chip key="state" label="وضعیت" value={s.isPregnant ? "آبستن" : "باز"} tone={s.isPregnant ? "info" : "default"} />,
        <Chip key="age" label="سن آبستنی" value={fa(s.daysPregnant, " روز")} />,
        <Chip key="ai" label="تلقیح مرتبط" value={s.lastAIDate ? formatShamsi(s.lastAIDate) : "—"} />,
        <Chip key="vet" label="آخرین دامپزشک" value={s.lastPregnancyTest?.vet ?? "—"} />,
        <Chip key="op" label="آخرین اپراتور" value={s.lastPregnancyTest?.operator ?? "—"} />,
      ];
    case "calving":
      return [
        <Chip key="last" label="آخرین زایش" value={s.lastCalvingDate ? formatShamsi(s.lastCalvingDate) : "—"} />,
        <Chip key="cnt" label="تعداد زایش" value={fa(s.calvingCount)} />,
        <Chip key="gap" label="فاصله زایش قبلی" value={fa(s.prevCalvingInterval, " روز")} />,
        <Chip key="dim" label="DIM" value={fa(s.dim, " روز")} />,
      ];
    case "abortion":
      return [
        <Chip key="age" label="سن آبستنی" value={fa(s.daysPregnant, " روز")} />,
        <Chip key="ai" label="تلقیح مرتبط" value={s.lastAIDate ? formatShamsi(s.lastAIDate) : "—"} />,
        <Chip key="test" label="آخرین تست" value={s.lastPregnancyTest?.result ?? "—"} />,
      ];
    case "heat":
      return [
        <Chip key="last" label="آخرین فحلی" value={s.lastHeatDate ? formatShamsi(s.lastHeatDate) : "—"} />,
        <Chip key="from" label="از زایش" value={fa(s.dim, " روز")} />,
        <Chip key="cnt" label="فحلی از زایش" value={fa(s.heatsSinceLastCalving)} />,
        <Chip
          key="cycle"
          label="سیکل"
          value={s.lastHeatCycleNormal == null ? "—" : s.lastHeatCycleNormal ? "طبیعی" : "غیرطبیعی"}
          tone={s.lastHeatCycleNormal === false ? "warn" : "default"}
        />,
      ];
    case "dry_off":
      return [
        <Chip key="dry" label="وضعیت" value={s.isDry == null ? "—" : s.isDry ? "خشک" : "شیرده"} tone={s.isDry ? "info" : "default"} />,
        <Chip key="date" label="تاریخ خشکی" value={s.dryDate ? formatShamsi(s.dryDate) : "—"} />,
        <Chip key="dur" label="مدت خشکی" value={fa(s.dryDuration, " روز")} />,
        <Chip key="ret" label="بازگشت پیش‌بینی" value={s.expectedReturnToMilking ? formatShamsi(s.expectedReturnToMilking) : "—"} />,
      ];
  }
}

export default function TabInsightHeader({ tab, summary }: Props) {
  const chips = chipsForTab(tab, summary).filter(Boolean);
  if (chips.length === 0) return null;
  return (
    <div dir="rtl" className="flex flex-wrap gap-1.5 rounded-lg border border-border bg-muted/30 p-2 mb-3">
      {chips}
    </div>
  );
}
