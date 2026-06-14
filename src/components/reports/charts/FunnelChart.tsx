// =============================================================================
// FunnelChart.tsx
// -----------------------------------------------------------------------------
// Apache ECharts funnel visualization for Damban reports.
//
// Used by the Reproductive Funnel section of the Herd Fertility Performance
// report (Eligible → Heat → Service → Pregnancy Test → Pregnant).
//
// Design choices:
//   - `sort: 'none'` so stages stay in the exact order the caller passes
//     (we never want the funnel to be re-sorted by value — the *order*
//     itself encodes the biological pipeline).
//   - `orient: 'vertical'` because Persian RTL reads top→bottom naturally
//     and vertical funnels are the de-facto standard in dashboards.
//   - Labels show: stage name + Persian-digit value + conversion-from-prev%
//     so users can read the funnel without a separate legend.
//   - `onSegmentClick` is plumbed through (currently unused) so a future
//     drill-down can be wired up by passing a handler.
// =============================================================================

import type { EChartsOption } from "echarts";
import { EChartBase } from "./EChartBase";
import { baseChartOption, DAMBAN_PALETTE, formatFa } from "./dambanEchartsTheme";

export interface FunnelStage {
  name: string;
  value: number;
}

export interface FunnelChartProps {
  stages: FunnelStage[];
  height?: number;
  // Future drill-down hook: receives the stage that was clicked. Currently
  // optional and unused by the herd-performance report, but every Damban
  // chart wrapper exposes this so reports can opt in later without changes.
  onSegmentClick?: (stage: FunnelStage) => void;
}

export function FunnelChart({ stages, height = 320, onSegmentClick }: FunnelChartProps) {
  // ----- Compute conversion percentages from one stage to the next --------
  // We attach the conversion ratio onto each ECharts data point so the
  // formatter (below) can render it without recomputing on every label call.
  const data = stages.map((s, i) => {
    const prev = i === 0 ? null : stages[i - 1].value;
    const conv =
      prev && prev > 0 ? Math.round((s.value / prev) * 100) : null;
    return {
      name: s.name,
      value: s.value,
      // Custom payload survives into label/tooltip formatters via `params.data`.
      _conv: conv,
      // Cycle through the Damban palette so each stage has a distinct color
      // while still staying on-brand (primary green is index 0).
      itemStyle: { color: DAMBAN_PALETTE[i % DAMBAN_PALETTE.length] },
    };
  });

  // ----- Build the ECharts option -----------------------------------------
  // Start from the shared base (font, tooltip, colors, transparent bg) and
  // then layer the funnel-specific config on top.
  const option: EChartsOption = {
    ...baseChartOption(),
    // Funnel charts don't use the cartesian grid; clearing it avoids warnings.
    grid: undefined,
    tooltip: {
      ...baseChartOption().tooltip,
      trigger: "item",
      formatter: (p: unknown) => {
        // ECharts gives us a loose `any`-shaped params object; narrow it.
        const params = p as { name: string; value: number; data?: { _conv?: number | null } };
        const conv = params.data?._conv;
        const convLine =
          conv != null
            ? `<div style="opacity:.8;font-size:11px;margin-top:2px">نرخ تبدیل: ${formatFa(conv)}٪</div>`
            : "";
        return `<div><strong>${params.name}</strong></div>
                <div>${formatFa(params.value)}</div>${convLine}`;
      },
    },
    series: [
      {
        type: "funnel",
        // Horizontal stretch within the container; vertical orientation keeps
        // the longest (eligible) stage at the top and narrows downward.
        left: "10%",
        right: "10%",
        top: 10,
        bottom: 10,
        // Maintain the order passed by the caller — biological pipeline.
        sort: "none",
        gap: 3,
        funnelAlign: "center",
        // Min size ensures even the smallest stage has a readable label.
        minSize: "20%",
        maxSize: "100%",
        label: {
          show: true,
          position: "inside",
          color: "#0F172A", // dark text on bright funnel segments
          fontFamily: "Vazirmatn, system-ui, sans-serif",
          fontWeight: "bold",
          formatter: (p: unknown) => {
            const params = p as { name: string; value: number; data?: { _conv?: number | null } };
            const conv = params.data?._conv;
            const convPart = conv != null ? `  •  ${formatFa(conv)}٪` : "";
            return `${params.name}: ${formatFa(params.value)}${convPart}`;
          },
        },
        labelLine: { show: false },
        emphasis: { label: { fontSize: 14 } },
        data,
      },
    ],
  };

  // Forward click events only when the caller wired a handler — keeps the
  // chart cheap when drill-down is not needed yet.
  const events = onSegmentClick
    ? {
        click: (params: unknown) => {
          const p = params as { name: string; value: number };
          onSegmentClick({ name: p.name, value: p.value });
        },
      }
    : undefined;

  return <EChartBase option={option} height={height} onEvents={events} />;
}
