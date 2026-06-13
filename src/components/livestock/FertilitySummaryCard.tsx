// =============================================================================
// FertilitySummaryCard
// -----------------------------------------------------------------------------
// The big "خلاصه باروری" block on دام → پروفایل دام. Every value is derived
// from the real livestock_fertility_events timeline via useFertilitySummary.
// Cached cow.* fields are passed in only for fallback (is_dry, is_pregnancy).
//
// Design notes:
//  - Semantic tokens only (bg-card/bg-muted/text-primary/text-destructive).
//  - Risk colour-coded badge using emerald/amber/destructive/sky token aliases.
//  - Compact 2/3/4-column grid that collapses to 2 columns on mobile.
//  - Mini timeline strip at the bottom — last cycle, chip per event, scrollable.
// =============================================================================

import { useMemo } from "react";
import { useFertilitySummary } from "@/hooks/useFertilitySummary";
import { useLegacyUserNames } from "@/hooks/useLegacyUserNames";
import type { CowSnapshot } from "@/lib/fertility/fertilityRiskEngine";
import { formatShamsi } from "@/lib/dateDisplay";
import { fertilityEventLabel, eventBadgeClass } from "@/lib/fertility";
import {
  Activity,
  AlertTriangle,
  Baby,
  Calendar,
  CircleDot,
  Droplet,
  Heart,
  Loader2,
  Syringe,
  TrendingUp,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface Props {
  cow: CowSnapshot & { id: number };
}

// Persian-digit number helper — used everywhere so the card never shows Latin digits.
const fa = (n: number | null | undefined, suffix = "") =>
  n == null ? "—" : `${Number(n).toLocaleString("fa-IR")}${suffix}`;

// Map our RiskLevel union to Tailwind classes built from semantic tokens.
const RISK_STYLES: Record<string, string> = {
  green: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  yellow: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  red: "bg-destructive/10 text-destructive border-destructive/30",
  blue: "bg-sky-500/10 text-sky-400 border-sky-500/30",
};

// -----------------------------------------------------------------------------
// Metric — a single labelled value cell. Optional tooltip explains the formula
// so the field manager understands what they're looking at.
// -----------------------------------------------------------------------------
function Metric({
  label,
  value,
  tooltip,
  hint,
  icon,
}: {
  label: string;
  value: React.ReactNode;
  tooltip?: string;
  hint?: string | null;
  icon?: React.ReactNode;
}) {
  const content = (
    <div className="rounded-lg border border-border bg-background/40 p-2.5 space-y-0.5">
      <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <div className="text-sm font-bold text-foreground truncate">{value ?? "—"}</div>
      {hint && <div className="text-[10px] text-muted-foreground">{hint}</div>}
    </div>
  );
  if (!tooltip) return content;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{content}</TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs text-xs leading-relaxed">
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
}

// -----------------------------------------------------------------------------
// Group — a labelled cluster of metrics on the card.
// -----------------------------------------------------------------------------
function Group({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground">
        {icon}
        {title}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
        {children}
      </div>
    </div>
  );
}

export default function FertilitySummaryCard({ cow }: Props) {
  const { summary, timeline, events, loading } = useFertilitySummary(cow.id, { cow });

  // Collect every legacy numeric user reference across this cow's events so
  // operator/vet labels show real names (e.g. "محمد فرهمند") instead of "2".
  const operatorIds = useMemo(() => {
    const ids: Array<number | string | null> = [];
    for (const e of events) {
      ids.push(e.operator_user_id ?? null);
      ids.push(e.operator_name ?? null);
    }
    return ids;
  }, [events]);
  const { resolve: resolveName } = useLegacyUserNames(operatorIds);

  if (loading) {
    return (
      <section className="rounded-xl border border-border bg-card p-6 flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </section>
    );
  }

  const s = summary;
  const riskClass = RISK_STYLES[s.riskLevel];

  // Pre-resolved display names — `||` keeps null → "—" handling at the cell level.
  const inseminatorName = resolveName(s.lastInseminator);
  const vetName = resolveName(s.lastPregnancyTest?.vet ?? null);
  const pregOperatorName = resolveName(s.lastPregnancyTest?.operator ?? null);

  return (
    <TooltipProvider delayDuration={250}>
      <section
        dir="rtl"
        className="rounded-xl border border-border bg-card p-3 sm:p-4 space-y-4 overflow-hidden"
      >
        {/* ===== Headline: current state + risk badge ===== */}
        <header className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 min-w-0">
            <Heart className="w-5 h-5 text-primary shrink-0" />
            <h2 className="text-body-lg font-bold text-foreground truncate">
              خلاصه باروری
            </h2>
          </div>
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border ${riskClass}`}>
            <CircleDot className="w-4 h-4" />
            <span className="text-sm font-bold">{s.currentState}</span>
            <span className="text-[11px] opacity-80 hidden sm:inline">— {s.riskReason}</span>
          </div>
        </header>

        {/* ===== Pregnancy ===== */}
        <Group title="آبستنی" icon={<Baby className="w-3.5 h-3.5" />}>
          <Metric
            label="آبستن؟"
            value={s.isPregnant ? "بله" : "خیر"}
            tooltip="بر اساس آخرین تلقیح موفق یا تست آبستنی مثبت در چرخه فعلی محاسبه می‌شود."
          />
          <Metric
            label="میزان آبستنی"
            value={fa(s.daysPregnant, " روز")}
            tooltip="تعداد روزهای سپری‌شده از تاریخ تلقیح موفق (مبدأ آبستنی)."
          />
          <Metric
            label="پیش‌بینی زایش"
            value={s.expectedCalvingDate ? formatShamsi(s.expectedCalvingDate) : "—"}
            tooltip={`تاریخ تلقیح موفق + ${283} روز (طول آبستنی متوسط هلشتاین).`}
          />
          <Metric
            label="روز تا زایش"
            value={fa(s.daysToCalving, " روز")}
            hint={s.daysToCalving != null && s.daysToCalving < 0 ? "گذشت تاریخ پیش‌بینی" : null}
          />
          <Metric
            label="تلقیح این آبستنی"
            value={fa(s.inseminationsThisPregnancy)}
            tooltip="تعداد تلقیح از زایش قبلی تا تلقیح موفق."
          />
          <Metric
            label="آخرین تست آبستنی"
            value={s.lastPregnancyTest?.date ? formatShamsi(s.lastPregnancyTest.date) : "—"}
            hint={s.lastPregnancyTest?.result ?? null}
          />
          <Metric
            label="مرحله تست"
            value={s.lastPregnancyTest?.stage ?? "—"}
            tooltip="مرحله تست آبستنی ثبت‌شده در فرم (اولی/نهایی/تکمیلی/خشکی)."
          />
          <Metric
            label="دامپزشک"
            value={vetName ?? "—"}
            hint={pregOperatorName ? `اپراتور: ${pregOperatorName}` : null}
          />
        </Group>

        {/* ===== Insemination ===== */}
        <Group title="تلقیح" icon={<Syringe className="w-3.5 h-3.5" />}>
          <Metric label="کل تلقیح‌ها" value={fa(s.totalInseminations)} />
          <Metric
            label="تلقیح چرخه فعلی"
            value={fa(s.inseminationsCurrentCycle)}
            tooltip="تلقیح‌های ثبت‌شده از آخرین زایش/سقط تا کنون."
          />
          <Metric
            label="ناموفق پشت سر هم"
            value={fa(s.consecutiveFailedAI)}
            hint={s.consecutiveFailedAI >= 3 ? "Repeat Breeder" : null}
          />
          <Metric label="آخرین تلقیح" value={s.lastAIDate ? formatShamsi(s.lastAIDate) : "—"} />
          <Metric label="روز از آخرین تلقیح" value={fa(s.daysSinceLastAI, " روز")} />
          <Metric label="اسپرم" value={s.lastSperm ?? "—"} />
          <Metric label="تلقیح‌کننده" value={inseminatorName ?? "—"} />
        </Group>

        {/* ===== Heat / Estrus ===== */}
        <Group title="فحلی" icon={<Activity className="w-3.5 h-3.5" />}>
          <Metric label="آخرین فحلی" value={s.lastHeatDate ? formatShamsi(s.lastHeatDate) : "—"} />
          <Metric
            label="فاصله فحلی تا تلقیح"
            value={fa(s.heatToAIInterval, " روز")}
            tooltip="فاصله بین آخرین فحلی ثبت‌شده و آخرین تلقیح."
          />
          <Metric
            label="فحلی از زایش قبلی"
            value={fa(s.heatsSinceLastCalving)}
          />
          <Metric
            label="سیکل فحلی"
            value={
              s.lastHeatCycleNormal == null
                ? "—"
                : s.lastHeatCycleNormal
                ? "طبیعی"
                : "غیرطبیعی"
            }
            tooltip="سیکل طبیعی بین ۱۸ تا ۲۴ روز است."
          />
        </Group>

        {/* ===== Calving ===== */}
        <Group title="زایش" icon={<Baby className="w-3.5 h-3.5" />}>
          <Metric label="آخرین زایش" value={s.lastCalvingDate ? formatShamsi(s.lastCalvingDate) : "—"} />
          <Metric
            label="DIM (روز شیرواری)"
            value={fa(s.dim, " روز")}
            tooltip="Days In Milk — فاصله از آخرین زایش تا امروز."
          />
          <Metric label="تعداد زایش" value={fa(s.calvingCount)} />
          <Metric label="نوع آخرین زایش" value={s.lastCalvingType ?? "—"} />
          <Metric label="فاصله زایش قبلی" value={fa(s.prevCalvingInterval, " روز")} />
          <Metric
            label="پیش‌بینی خشکی"
            value={s.predictedDryDate ? formatShamsi(s.predictedDryDate) : "—"}
            tooltip="پیش‌بینی زایش - ۶۰ روز."
          />
        </Group>

        {/* ===== Reproductive performance ===== */}
        <Group title="راندمان باروری" icon={<TrendingUp className="w-3.5 h-3.5" />}>
          <Metric
            label="روزهای باز"
            value={fa(s.openDays, " روز")}
            tooltip="از آخرین زایش تا آبستنی (یا تا امروز اگر هنوز باز است)."
          />
          <Metric label="سن دام" value={fa(s.ageDays, " روز")} />
          <Metric
            label="ریسک باروری"
            value={
              <span
                className={`px-2 py-0.5 rounded-full text-xs border ${riskClass}`}
              >
                {s.riskReason}
              </span>
            }
          />
        </Group>

        {/* ===== Dry period ===== */}
        <Group title="دوره خشکی" icon={<Droplet className="w-3.5 h-3.5" />}>
          <Metric
            label="وضعیت دوشش"
            value={s.isDry == null ? "—" : s.isDry ? "خشک" : "شیرده"}
          />
          <Metric label="تاریخ خشکی" value={s.dryDate ? formatShamsi(s.dryDate) : "—"} />
          <Metric label="مدت خشکی" value={fa(s.dryDuration, " روز")} />
          <Metric
            label="بازگشت به شیردوشی"
            value={s.expectedReturnToMilking ? formatShamsi(s.expectedReturnToMilking) : "—"}
            tooltip="با زایش بعدی، دوره شیردوشی جدید آغاز می‌شود."
          />
        </Group>

        {/* ===== Mini timeline ===== */}
        {timeline.current && timeline.current.events.length > 0 && (
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground">
              <Calendar className="w-3.5 h-3.5" />
              تایم‌لاین چرخه فعلی
            </div>
            <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
              {timeline.current.events.map((ee) => (
                <div
                  key={ee.event.id}
                  className={`shrink-0 rounded-md border px-2 py-1 text-[10px] ${eventBadgeClass(ee.event.event_type)}`}
                  title={`${fertilityEventLabel(ee.event.event_type)} — ${formatShamsi(ee.event.event_date)}`}
                >
                  <div className="font-bold">{fertilityEventLabel(ee.event.event_type)}</div>
                  <div className="opacity-80">{formatShamsi(ee.event.event_date)}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ===== Risk banner (only when red) ===== */}
        {s.riskLevel === "red" && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{s.riskReason}</span>
          </div>
        )}
      </section>
    </TooltipProvider>
  );
}
