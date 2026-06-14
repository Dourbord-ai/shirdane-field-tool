// =============================================================================
// EChartBase.tsx
// -----------------------------------------------------------------------------
// Thin wrapper around `echarts-for-react` that every Damban report chart uses.
//
// Responsibilities:
//   1. Apply consistent sizing (responsive width, configurable height).
//   2. Auto-resize on window resize and on parent-container resize, so charts
//      look correct inside flex/grid layouts that change size dynamically
//      (e.g. when the sidebar collapses or the mobile bottom nav appears).
//   3. Forward `onEvents` so wrappers can opt into click drill-downs later
//      without having to know about ECharts internals.
//
// Why a wrapper instead of using ReactECharts directly?
//   - Centralises the ResizeObserver logic (otherwise every chart would
//     duplicate the same useEffect).
//   - Gives us a single place to swap the renderer (canvas vs svg) project-
//     wide should we ever need to.
// =============================================================================

import { useEffect, useRef } from "react";
import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";

export interface EChartBaseProps {
  // The fully-built ECharts option object. Wrappers (FunnelChart, BarChart…)
  // are responsible for constructing this; EChartBase only renders it.
  option: EChartsOption;
  // Pixel height of the chart container. Width is always 100% of the parent.
  height?: number;
  // Optional event handlers (e.g. `{ click: (params) => … }`). Forwarded
  // straight to ECharts. Designed so future drill-downs can be added without
  // touching this file.
  onEvents?: Record<string, (params: unknown) => void>;
  className?: string;
}

export function EChartBase({ option, height = 280, onEvents, className }: EChartBaseProps) {
  // We keep a ref to the underlying ReactECharts instance so we can call
  // `.getEchartsInstance().resize()` whenever the parent container size
  // changes. Without this, ECharts only resizes on window resize events,
  // which misses sidebar collapses and mobile rotations inside flex layouts.
  const chartRef = useRef<ReactECharts | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // Guard: if the container isn't mounted yet, bail out.
    const el = containerRef.current;
    if (!el) return;

    // ResizeObserver fires whenever the wrapped <div> changes size for any
    // reason (window resize, sidebar toggle, parent flex reflow). On every
    // tick we ask ECharts to recompute its canvas dimensions.
    const observer = new ResizeObserver(() => {
      chartRef.current?.getEchartsInstance().resize();
    });
    observer.observe(el);

    // Cleanup on unmount — never leave an observer attached.
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={containerRef} className={className} style={{ width: "100%" }}>
      <ReactECharts
        ref={chartRef}
        option={option}
        // notMerge=true prevents stale series from previous renders bleeding
        // into the new option when data changes shape (e.g. funnel stages
        // re-ordering). lazyUpdate batches DOM writes for smoother updates.
        notMerge
        lazyUpdate
        style={{ height: `${height}px`, width: "100%" }}
        onEvents={onEvents}
      />
    </div>
  );
}
