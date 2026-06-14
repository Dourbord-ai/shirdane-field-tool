// =============================================================================
// dambanEchartsTheme.ts
// -----------------------------------------------------------------------------
// Unified Damban reporting theme defaults for Apache ECharts.
//
// Why a single file?
//   Every report visualization across Damban must look and behave identically:
//   same Persian font, same RTL-friendly tooltip, same agricultural-green
//   accent, transparent background that lets the dark-navy `bg-card` show
//   through, and consistent number formatting. Centralising those choices in
//   one module means individual chart wrappers (FunnelChart, HorizontalBar…)
//   only have to declare their *data*, not their *theme*.
//
// How is it used?
//   - `DAMBAN_PALETTE`  → series colors (primary first, then supporting hues).
//   - `formatFa(n)`     → Persian-digit number formatter for axis labels &
//                         tooltip values.
//   - `baseChartOption()` → returns an ECharts option *fragment* with shared
//                         tooltip, grid, textStyle defaults that every chart
//                         spreads on top of its own series-specific config.
// =============================================================================

// ---------------------------------------------------------------------------
// Color palette
// ---------------------------------------------------------------------------
// We deliberately list explicit hex codes here instead of reading CSS
// variables because ECharts canvas rendering cannot resolve CSS custom
// properties at draw time. The first color matches the Damban primary
// (#57D364 agricultural green from mem://design/tokens) so single-series
// charts automatically inherit brand identity.
export const DAMBAN_PALETTE = [
  "#57D364", // primary green (Damban brand)
  "#3FB8EF", // info blue
  "#F2C94C", // warning amber
  "#EF6F6C", // danger coral
  "#A78BFA", // accent violet
  "#22D3EE", // teal
  "#F472B6", // pink
  "#FBBF24", // gold
];

// ---------------------------------------------------------------------------
// Persian number formatter
// ---------------------------------------------------------------------------
// Reports must always render numbers in Persian digits (fa-IR) because the
// rest of the app uses Vazirmatn + Persian locale. Wrapping `toLocaleString`
// keeps callers tidy and gives us a single place to tweak rounding later.
export function formatFa(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return String(value);
  return num.toLocaleString("fa-IR");
}

// ---------------------------------------------------------------------------
// Base ECharts option fragment
// ---------------------------------------------------------------------------
// Returns the *shared* portion of every Damban chart option. Wrappers spread
// this object and add their own `series`, `xAxis`, `yAxis`, etc.
//
// Notes:
//   - `backgroundColor: 'transparent'` ensures the parent `bg-card` shows
//     through so we keep the unified dark surface look.
//   - `textStyle.fontFamily: 'Vazirmatn'` reuses the locally-bundled font so
//     no extra network requests are made.
//   - Tooltip uses `axisPointer.type: 'shadow'` which is the most readable
//     option for both bar and funnel charts; per-chart wrappers can override.
//   - The grid is intentionally tight on the right side (RTL: that's the
//     "leading" edge in Persian) so y-axis labels don't get cut off.
export function baseChartOption() {
  return {
    backgroundColor: "transparent",
    color: DAMBAN_PALETTE,
    textStyle: {
      fontFamily: "Vazirmatn, system-ui, sans-serif",
      color: "#E2E8F0", // matches text-foreground on dark surfaces
    },
    animationDuration: 400,
    animationEasing: "cubicOut" as const,
    tooltip: {
      trigger: "axis" as const,
      backgroundColor: "rgba(7, 17, 27, 0.95)", // dark navy w/ slight transparency
      borderColor: "rgba(87, 211, 100, 0.4)",   // subtle green border
      borderWidth: 1,
      textStyle: {
        color: "#F8FAFC",
        fontFamily: "Vazirmatn, system-ui, sans-serif",
        fontSize: 12,
      },
      axisPointer: {
        type: "shadow" as const,
        shadowStyle: { color: "rgba(87, 211, 100, 0.08)" },
      },
    },
    legend: {
      textStyle: {
        color: "#CBD5E1",
        fontFamily: "Vazirmatn, system-ui, sans-serif",
      },
      icon: "roundRect" as const,
      itemWidth: 12,
      itemHeight: 12,
    },
    grid: {
      // Leave space for axis labels; RTL means right-side labels need room.
      left: 16,
      right: 24,
      top: 24,
      bottom: 24,
      containLabel: true,
    },
  };
}
