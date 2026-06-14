// =============================================================================
// useFertilityThresholds.ts
// -----------------------------------------------------------------------------
// React Query hook for the single-row `fertility_thresholds` table that drives
// all classification logic in the Fertility Action List report.
//
// Why one row only?
//   The table has a CHECK (id = 1) constraint so there can only ever be one
//   configuration. This keeps the settings UI trivial and avoids any "which
//   threshold profile is active right now?" ambiguity.
//
// The hook exposes:
//   - `useFertilityThresholds()` — fetch the row (with sane defaults if the
//     query is still loading, so the report can render skeletons without
//     blowing up on `undefined.preg_check_window_min`).
//   - `useUpdateFertilityThresholds()` — mutation to PATCH the row from the
//     /settings/fertility page.
// =============================================================================

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// -----------------------------------------------------------------------------
// FertilityThresholds — the shape stored in the DB row. All fields are integer
// days/counts. `updated_at` and `updated_by` are bookkeeping only.
// -----------------------------------------------------------------------------
export interface FertilityThresholds {
  id: number;
  vwp_cow_days: number;
  vwp_heifer_days: number;
  preg_check_window_min: number;
  preg_check_window_max: number;
  recheck_window_min: number;
  recheck_window_max: number;
  high_risk_dim: number;
  high_risk_services: number;
  high_risk_heats: number;
  close_to_calving_days: number;
  days_since_service_alert: number;
  days_since_heat_alert: number;
  sync_due_recheck_days: number;
  repeat_breeder_services: number;
  chronic_breeder_services: number;
  // Window (in days) for attributing an insemination to a recent sync protocol.
  // Used by the Herd Fertility Performance report's Protocol Comparison section.
  sync_to_service_window_days: number;
  updated_at: string;
  updated_by: string | null;
}

// Defaults mirror the DB defaults. We use these as the "loading-state value"
// so the report can compute placeholder counts without waiting for the row.
export const DEFAULT_FERTILITY_THRESHOLDS: FertilityThresholds = {
  id: 1,
  vwp_cow_days: 50,
  vwp_heifer_days: 395,
  preg_check_window_min: 35,
  preg_check_window_max: 45,
  recheck_window_min: 60,
  recheck_window_max: 90,
  high_risk_dim: 150,
  high_risk_services: 3,
  high_risk_heats: 3,
  close_to_calving_days: 240,
  days_since_service_alert: 60,
  days_since_heat_alert: 21,
  sync_due_recheck_days: 14,
  repeat_breeder_services: 3,
  chronic_breeder_services: 5,
  // Default 14 days — same as the DB column default we just shipped.
  sync_to_service_window_days: 14,
  updated_at: new Date().toISOString(),
  updated_by: null,
};

const QUERY_KEY = ["fertility_thresholds"] as const;

// -----------------------------------------------------------------------------
// useFertilityThresholds — read the single config row. We use a long staleTime
// because thresholds change rarely; explicit invalidation happens after the
// mutation below.
// -----------------------------------------------------------------------------
export function useFertilityThresholds() {
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: async (): Promise<FertilityThresholds> => {
      // .maybeSingle() returns null when no row exists yet — falling back to
      // the in-memory defaults keeps the UI usable even on a fresh DB.
      const { data, error } = await supabase
        .from("fertility_thresholds" as any)
        .select("*")
        .eq("id", 1)
        .maybeSingle();
      if (error) throw error;
      return ((data as unknown) as FertilityThresholds) ?? DEFAULT_FERTILITY_THRESHOLDS;
    },
    staleTime: 5 * 60_000,
  });
}

// -----------------------------------------------------------------------------
// useUpdateFertilityThresholds — PATCH the row. We always target id=1 since
// the table is pinned to a single row by the CHECK constraint.
// -----------------------------------------------------------------------------
export function useUpdateFertilityThresholds() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<Omit<FertilityThresholds, "id" | "updated_at" | "updated_by">>) => {
      const { data, error } = await supabase
        .from("fertility_thresholds" as any)
        .update(patch)
        .eq("id", 1)
        .select()
        .single();
      if (error) throw error;
      return (data as unknown) as FertilityThresholds;
    },
    onSuccess: (row) => {
      // Push the fresh row directly into the cache so the UI updates without
      // an extra round-trip, and invalidate any consumers (the report).
      qc.setQueryData(QUERY_KEY, row);
      qc.invalidateQueries({ queryKey: ["fertility_action_list"] });
    },
  });
}
