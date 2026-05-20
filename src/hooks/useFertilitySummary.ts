// =============================================================================
// useFertilitySummary
// -----------------------------------------------------------------------------
// Single hook that the profile + every fertility tab consumes. Fetches the
// cow's full fertility event history (one query), runs it through the
// timeline + risk engine, and exposes both the raw timeline AND the high-level
// summary so callers can re-use the same data without re-fetching.
//
// Realtime: subscribes to inserts/updates/deletes on this cow's rows in
// `livestock_fertility_events` and invalidates the query so the UI stays in
// sync without any manual reload.
// =============================================================================

import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { FertilityEvent } from "@/lib/fertility";
import { buildTimeline, type FertilityTimeline } from "@/lib/fertility/fertilityTimeline";
import {
  deriveFertilitySummary,
  type FertilitySummary,
  type CowSnapshot,
} from "@/lib/fertility/fertilityRiskEngine";

interface Options {
  /** Cow snapshot used as fallback for dry/pregnancy fields. */
  cow?: CowSnapshot | null;
  /** Disable subscription (eg. when used in a non-realtime context). */
  realtime?: boolean;
}

export interface UseFertilitySummaryResult {
  events: FertilityEvent[];
  timeline: FertilityTimeline;
  summary: FertilitySummary;
  loading: boolean;
  refetch: () => void;
}

// Empty-state defaults so callers can render unconditionally before data loads.
const EMPTY_TIMELINE: FertilityTimeline = {
  all: [],
  cycles: [{ startDate: null, startEventType: null, events: [] }],
  current: { startDate: null, startEventType: null, events: [] },
  calvings: [],
};

export function useFertilitySummary(
  cowId: number | null | undefined,
  opts: Options = {},
): UseFertilitySummaryResult {
  const qc = useQueryClient();
  const realtime = opts.realtime ?? true;

  // -- Single query: pull ALL events for this cow (cancelled ones included
  //    so we can show them when the user toggles نمایش لغو شده). The timeline
  //    builder filters cancelled rows out for math.
  const queryKey = useMemo(() => ["fertility_summary", cowId], [cowId]);
  const { data, isLoading, refetch } = useQuery({
    queryKey,
    enabled: !!cowId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("livestock_fertility_events" as any)
        .select("*")
        .eq("livestock_id", cowId!)
        .order("event_date", { ascending: false })
        .order("event_time", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      // Normalise legacy alias so calculations don't need to special-case it.
      return ((data as any[]) ?? []).map((row) => ({
        ...row,
        event_type:
          row.event_type === "pregnancy_check" ? "pregnancy_test" : row.event_type,
      })) as FertilityEvent[];
    },
    staleTime: 30_000,
  });

  // -- Realtime sync: invalidate the query whenever a row for this cow changes.
  //    Use a unique channel name per effect-run so React StrictMode's double
  //    invoke (or rapid re-mounts) never tries to .on() a channel that has
  //    already been subscribed — Supabase forbids adding callbacks post-subscribe.
  useEffect(() => {
    if (!realtime || !cowId) return;
    const channel = supabase.channel(
      `fertility_summary_${cowId}_${Math.random().toString(36).slice(2)}`,
    );
    channel.on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "livestock_fertility_events",
        filter: `livestock_id=eq.${cowId}`,
      },
      () => {
        qc.invalidateQueries({ queryKey });
      },
    );
    channel.subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [cowId, realtime, qc, queryKey]);

  // -- Derive timeline + summary. Memoised by data reference so re-renders
  //    don't recompute on unrelated state changes.
  const timeline = useMemo(() => (data ? buildTimeline(data) : EMPTY_TIMELINE), [data]);
  const summary = useMemo(
    () =>
      deriveFertilitySummary(
        opts.cow ?? { id: cowId ?? 0 },
        timeline,
      ),
    [opts.cow, cowId, timeline],
  );

  return {
    events: data ?? [],
    timeline,
    summary,
    loading: isLoading,
    refetch,
  };
}
