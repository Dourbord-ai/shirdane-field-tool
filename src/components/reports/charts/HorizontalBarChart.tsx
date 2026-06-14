// =============================================================================
// HorizontalBarChart.tsx
// -----------------------------------------------------------------------------
// Apache ECharts horizontal bar chart — used by the Open Days Distribution
// section of the Herd Fertility Performance report and reusable by any
// future report needing a category-vs-count comparison.
//
// Why horizontal (not vertical)?
//   - Persian category labels (e.g. "۹۱–۱۲۰ روز") are wider than typical
//     numeric ticks; horizontal bars give them room without rotating text.
//   - Horizontal layout reads naturally in RTL: category on the right,
//     bar growing toward the left.
// =============================================================================

import type { EChartsOption } from "echarts";
import { EChartBase } from "./EChartBase";
import { baseChartOption, DAMBAN_PALETTE, formatFa } from "./dambanEchartsTheme";

export interface HorizontalBarDatum {
  category: string;
  value: number;
}

export interface HorizontalBarChartProps {
  data: HorizontalBarDatum[];
  height?: number;
  // Optional value-axis label (e.g. "تعداد گاو"). Drawn below the bars.
  valueLabel?: string;
  // Future drill-down hook — invoked with the clicked category.
  onBarClick?: (datum: HorizontalBarDatum) => void;
}

export function HorizontalBarChart({
  data,
  height = 260,
  valueLabel,
  onBarClick,
}: HorizontalBarChartProps) {
  // ----- Prepare axes -----------------------------------------------------
  // ECharts expects parallel arrays for category labels and series values.
  // We reverse here because ECharts draws yAxis categories from bottom to
  // top by default; reversing makes the first item appear on top, matching
  // the user's mental order ("0–60 روز" first, "+۱۸۰" last).
  const categories = data.map((d) => d.category).reverse();
  const values = data.map((d) => d.value).reverse();

  const option: EChartsOption = {
    ...baseChartOption(),
    tooltip: {
      ...baseChartOption().tooltip,
      // Axis-trigger highlights the entire row, which is friendlier on mobile
      // than item-trigger (no need to hit the bar exactly).
      trigger: "axis",
      axisPointer: { type: "shadow" },
      formatter: (p: unknown) => {
        const arr = p as Array<{ name: string; value: number }>;
        if (!arr?.length) return "";
        const item = arr[0];
        return `<div><strong>${item.name}</strong></div>
                <div>${formatFa(item.value)}${valueLabel ? ` ${valueLabel}` : ""}</div>`;
      },
    },
    xAxis: {
      type: "value",
      // Persian-digit axis ticks for visual consistency with the rest of UI.
      axisLabel: {
        color: "#94A3B8",
        formatter: (v: number) => formatFa(v),
      },
      splitLine: { lineStyle: { color: "rgba(148,163,184,0.12)" } },
      name: valueLabel,
      nameTextStyle: { color: "#94A3B8", padding: [8, 0, 0, 0] },
    },
    yAxis: {
      type: "category",
      data: categories,
      axisLabel: { color: "#CBD5E1" },
      axisLine: { lineStyle: { color: "rgba(148,163,184,0.3)" } },
      axisTick: { show: false },
    },
    series: [
      {
        type: "bar",
        data: values,
        // Brand-primary green fill with rounded corners on the bar's growing
        // end (RTL: bars grow leftward, so we round the left corners).
        itemStyle: {
          color: DAMBAN_PALETTE[0],
          borderRadius: [0, 6, 6, 0],
        },
        barMaxWidth: 22,
        // In-bar value label so users don't have to cross-reference the axis.
        label: {
          show: true,
          position: "right",
          color: "#E2E8F0",
          fontFamily: "Vazirmatn, system-ui, sans-serif",
          formatter: (p: unknown) => {
            const params = p as { value: number };
            return formatFa(params.value);
          },
        },
        emphasis: { itemStyle: { color: "#7AE08A" } },
      },
    ],
  };

  // Click → drill-down (optional, currently unused but architected in).
  const events = onBarClick
    ? {
        click: (params: unknown) => {
          const p = params as { name: string; value: number };
          onBarClick({ category: p.name, value: p.value });
        },
      }
    : undefined;

  return <EChartBase option={option} height={height} onEvents={events} />;
}
