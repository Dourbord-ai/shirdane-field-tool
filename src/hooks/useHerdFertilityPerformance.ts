// =============================================================================
// useHerdFertilityPerformance.ts
// -----------------------------------------------------------------------------
// React Query hook that loads every dataset the Herd Fertility Performance
// report needs (cows, fertility events, syncs, reference tables) and runs
// them through the pure `computeHerdPerformance` engine.
//
// Why one hook?
//   The page renders ~9 sections that all need the same underlying data.
//   Centralising fetch + memoised compute avoids any duplicate work and lets
//   the page stay declarative.
// =============================================================================

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { FertilityEvent } from "@/lib/fertility";
import {
  DEFAULT_FERTILITY_THRESHOLDS,
  useFertilityThresholds,
} from "@/hooks/useFertilityThresholds";
import {
  computeHerdPerformance,
  type HerdCow,
  type HerdCowSync,
  type HerdFilters,
  type HerdPerformanceResult,
} from "@/lib/fertility/herdPerformance";

// -----------------------------------------------------------------------------
// Paged fetchers — Supabase caps responses at 1000 rows by default. We loop
// in ascending id order until we hit a short page.
// -----------------------------------------------------------------------------
async function fetchCows(): Promise<HerdCow[]> {
  const PAGE = 1000; let from = 0; const all: HerdCow[] = [];
  while (true) {
    const { data, error } = await supabase
      .from("cows")
      .select("id, sex, sextype, existancestatus, presence_status, is_dry, is_pregnancy, number_of_births, date_of_birth, last_birth_date, last_pregnancy_date, last_location_id")
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as unknown as HerdCow[];
    all.push(...rows);
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

async function fetchEvents(): Promise<FertilityEvent[]> {
  const PAGE = 1000; let from = 0; const all: FertilityEvent[] = [];
  while (true) {
    const { data, error } = await supabase
      .from("livestock_fertility_events")
      .select("id, livestock_id, event_type, event_date, status_code, result, result_code, operator_user_id, operator_name, notes, metadata, legacy_table_name, legacy_record_id, created_at, is_cancelled, fertility_operation_id, fertility_status_id, erotic_type_id, event_time")
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as unknown as FertilityEvent[];
    all.push(...rows);
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

async function fetchSyncs(): Promise<HerdCowSync[]> {
  const { data, error } = await supabase
    .from("cow_syncs")
    .select("id, cow_id, sync_type_id, event_date, inoculation_date_time, is_deleted")
    .or("is_deleted.is.null,is_deleted.eq.false")
    .order("event_date", { ascending: false })
    .limit(1000);
  if (error) throw error;
  return (data ?? []) as unknown as HerdCowSync[];
}

async function fetchLocations(): Promise<{ id: number; name: string | null }[]> {
  const { data, error } = await supabase
    .from("livestock_locations")
    .select("id, name")
    .or("is_deleted.is.null,is_deleted.eq.false")
    .order("name", { ascending: true })
    .limit(1000);
  if (error) throw error;
  return (data ?? []) as { id: number; name: string | null }[];
}

async function fetchSyncTypes(): Promise<{ id: number; name: string | null }[]> {
  const { data, error } = await supabase
    .from("sync_types")
    .select("id, name")
    .or("is_deleted.is.null,is_deleted.eq.false")
    .order("name", { ascending: true })
    .limit(1000);
  if (error) throw error;
  return (data ?? []) as { id: number; name: string | null }[];
}

async function fetchSperms(): Promise<{ id: number; name: string | null; code: string | null }[]> {
  const { data, error } = await supabase
    .from("sperms")
    .select("id, name, code")
    .or("is_deleted.is.null,is_deleted.eq.false")
    .order("name", { ascending: true })
    .limit(1000);
  if (error) throw error;
  return (data ?? []) as { id: number; name: string | null; code: string | null }[];
}

// -----------------------------------------------------------------------------
// Hook surface — returns query state + the computed result (or null while
// loading). Reference tables are also exposed so the filter bar can populate
// its dropdowns from the same data.
// -----------------------------------------------------------------------------
export interface HerdFertilityPerformanceData {
  isLoading: boolean;
  error: Error | null;
  result: HerdPerformanceResult | null;
  refs: {
    locations: { id: number; name: string | null }[];
    syncTypes: { id: number; name: string | null }[];
    sperms: { id: number; name: string | null; code: string | null }[];
  };
}

export function useHerdFertilityPerformance(filters: HerdFilters): HerdFertilityPerformanceData {
  const { data: thresholds = DEFAULT_FERTILITY_THRESHOLDS } = useFertilityThresholds();
  const cowsQ = useQuery({ queryKey: ["herd_perf", "cows"], queryFn: fetchCows });
  const eventsQ = useQuery({ queryKey: ["herd_perf", "events"], queryFn: fetchEvents });
  const syncsQ = useQuery({ queryKey: ["herd_perf", "syncs"], queryFn: fetchSyncs });
  const locsQ = useQuery({ queryKey: ["herd_perf", "locs"], queryFn: fetchLocations });
  const syncTypesQ = useQuery({ queryKey: ["herd_perf", "sync_types"], queryFn: fetchSyncTypes });
  const spermsQ = useQuery({ queryKey: ["herd_perf", "sperms"], queryFn: fetchSperms });

  const isLoading = cowsQ.isLoading || eventsQ.isLoading || syncsQ.isLoading || locsQ.isLoading || syncTypesQ.isLoading || spermsQ.isLoading;
  const error = (cowsQ.error || eventsQ.error || syncsQ.error || locsQ.error || syncTypesQ.error || spermsQ.error) as Error | null;

  // Build label resolvers from the reference tables.
  const locationName = useMemo(() => {
    const m = new Map((locsQ.data ?? []).map((l) => [l.id, l.name]));
    return (id: number) => m.get(id) ?? null;
  }, [locsQ.data]);
  const syncTypeName = useMemo(() => {
    const m = new Map((syncTypesQ.data ?? []).map((s) => [s.id, s.name]));
    return (id: number) => m.get(id) ?? null;
  }, [syncTypesQ.data]);
  const spermName = useMemo(() => {
    const m = new Map((spermsQ.data ?? []).map((s) => [s.id, s.name ?? s.code]));
    return (id: number) => m.get(id) ?? null;
  }, [spermsQ.data]);

  // Memoise the heavy computation. It only re-runs when filters or any input
  // dataset changes — exactly what we want.
  const result = useMemo<HerdPerformanceResult | null>(() => {
    if (!cowsQ.data || !eventsQ.data || !syncsQ.data) return null;
    return computeHerdPerformance({
      cows: cowsQ.data,
      events: eventsQ.data,
      syncs: syncsQ.data,
      thresholds,
      filters,
      locationName,
      syncTypeName,
      spermName,
    });
  }, [cowsQ.data, eventsQ.data, syncsQ.data, thresholds, filters, locationName, syncTypeName, spermName]);

  return {
    isLoading,
    error,
    result,
    refs: {
      locations: locsQ.data ?? [],
      syncTypes: syncTypesQ.data ?? [],
      sperms: spermsQ.data ?? [],
    },
  };
}
