// =============================================================================
// charts/index.ts
// -----------------------------------------------------------------------------
// Barrel module for the Damban ECharts reporting library.
//
// Two of these wrappers are fully implemented today (FunnelChart,
// HorizontalBarChart) because they're needed by the Herd Fertility
// Performance report. The remaining wrappers (LineTrend, MultiSeriesLine,
// ComparisonBar, Pie, Scatter, Gauge, Heatmap, Treemap) are placeholders
// that re-use the same `baseChartOption()` theme and `EChartBase` shell so
// future reports can build on a consistent foundation without rewriting the
// theming layer.
//
// Each placeholder is a thin generic wrapper that simply hands `option`
// straight to ECharts. They exist primarily to (a) reserve the public API
// surface so future imports are stable, and (b) give linting/IDE search a
// single canonical location for every chart type.
// =============================================================================

import type { EChartsOption } from "echarts";
import { EChartBase } from "./EChartBase";
import { baseChartOption } from "./dambanEchartsTheme";

export { EChartBase } from "./EChartBase";
export { FunnelChart } from "./FunnelChart";
export { HorizontalBarChart } from "./HorizontalBarChart";
export {
  baseChartOption,
  DAMBAN_PALETTE,
  formatFa,
} from "./dambanEchartsTheme";

// ---------------------------------------------------------------------------
// Generic passthrough — used by the placeholder wrappers below.
// Wrappers spread `baseChartOption()` so they inherit Damban theming, then
// merge the caller-supplied option on top so callers can override anything.
// ---------------------------------------------------------------------------
interface GenericProps {
  option: EChartsOption;
  height?: number;
}

function GenericChart({ option, height }: GenericProps) {
  const merged: EChartsOption = { ...baseChartOption(), ...option };
  return <EChartBase option={merged} height={height} />;
}

// Placeholders — each one is intentionally a thin wrapper. When a future
// report actually needs e.g. a gauge, the wrapper here gets fleshed out with
// sensible series defaults (just like FunnelChart was).
export const LineTrendChart = GenericChart;
export const MultiSeriesLineChart = GenericChart;
export const ComparisonBarChart = GenericChart;
export const PieChart = GenericChart;
export const ScatterChart = GenericChart;
export const GaugeChart = GenericChart;
export const HeatmapChart = GenericChart;
export const TreemapChart = GenericChart;
