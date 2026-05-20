// =============================================================================
// useLegacyUserNames
// -----------------------------------------------------------------------------
// Resolves legacy numeric user IDs (the ones stored in
// `livestock_fertility_events.operator_user_id` and the historical
// `operator_name` text column — which the importer filled with the user_id
// instead of the real name) into a "first_name last_name" display string.
//
// The mapping lives in `public.hr_users`. We query once per session per ID
// (cached by react-query), so the operator/vet labels render real names like
// "محمد فرهمند" instead of bare numbers like "2".
// =============================================================================

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// Result type — a stable lookup function plus the raw map.
export interface LegacyNameLookup {
  resolve: (id: number | string | null | undefined) => string | null;
  map: Map<number, string>;
}

// Internal helper — turn a legacy ID into a numeric key, or null if not parseable.
function asNumericId(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  // operator_name historically stores either the real name OR the user_id as a
  // string (e.g. "2"). We only want to look up the latter.
  const n = typeof v === "number" ? v : /^\d+$/.test(v.trim()) ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

/**
 * Fetch display names for the given set of legacy hr_users IDs.
 * Pass any mix of `operator_user_id` (number) and `operator_name` (text) values
 * — the hook filters out non-numeric strings (those are already real names).
 */
export function useLegacyUserNames(
  rawIds: ReadonlyArray<number | string | null | undefined>,
): LegacyNameLookup {
  // De-duplicate + only keep numeric IDs (real names pass through unchanged).
  const ids = useMemo(() => {
    const set = new Set<number>();
    for (const r of rawIds) {
      const n = asNumericId(r);
      if (n != null) set.add(n);
    }
    return Array.from(set).sort((a, b) => a - b);
  }, [rawIds]);

  // Query key uses the sorted ID list so adding/removing cows re-fetches.
  const { data } = useQuery({
    queryKey: ["legacy_user_names", ids.join(",")],
    enabled: ids.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hr_users")
        .select("id, first_name, last_name")
        .in("id", ids);
      if (error) throw error;
      return (data ?? []) as Array<{
        id: number;
        first_name: string | null;
        last_name: string | null;
      }>;
    },
  });

  // Build the Map<id, "first last"> once per fetched batch.
  const map = useMemo(() => {
    const m = new Map<number, string>();
    for (const u of data ?? []) {
      const name = [u.first_name, u.last_name].filter(Boolean).join(" ").trim();
      if (name) m.set(u.id, name);
    }
    return m;
  }, [data]);

  // resolve(id) — returns the real name if known, otherwise the original
  // string when it's already a non-numeric name, otherwise null.
  const resolve = (v: number | string | null | undefined): string | null => {
    if (v == null || v === "") return null;
    const n = asNumericId(v);
    if (n != null) return map.get(n) ?? `#${n}`;
    // Already a non-numeric name → return as-is.
    return typeof v === "string" ? v : null;
  };

  return { resolve, map };
}
