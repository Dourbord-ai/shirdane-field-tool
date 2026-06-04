// ---------------------------------------------------------------------------
// Task 4 — Tiny CRUD wrapper around the new `geo_locations` dictionary table.
//
// Why this thin lib (instead of inlining supabase calls in the editor):
//   - Keeps the editor component free of DB shape coupling.
//   - Single place to evolve search/ordering (e.g. when we add lat/lng).
//   - Lets us unit-test list/search behavior independently of React.
//
// The table itself was created in the Task 4 migration. All policies are
// authenticated-only, so the supabase client (with the user's session)
// already has the right grants — no service_role calls here.
// ---------------------------------------------------------------------------

import { supabase } from "@/integrations/supabase/client";

/**
 * Row shape exposed to the UI. We only surface the columns the editor and
 * the row-detail view actually need — id, name, province, city, kind, notes.
 * The DB has audit/timestamps that the client doesn't care about.
 */
export interface GeoLocation {
  id: string;
  name: string;
  province: string | null;
  city: string | null;
  // Soft hint about typical use: "origin" / "destination" / "both" / "generic".
  // Not enforced in the UI (the operator can still pick any location for any
  // role), but lets us pre-filter the dropdown later if the list grows.
  kind: "origin" | "destination" | "both" | "generic";
  notes: string | null;
}

/**
 * List all non-deleted geo_locations, ordered by name.
 *
 * We deliberately don't paginate here — the freight network is small
 * (a handful of farms + a few destinations), so a single fetch is fine and
 * lets the editor render an instant searchable dropdown without extra round-
 * trips. If this grows past a few hundred rows we can switch to server-side
 * filtering keyed by the search input.
 */
export async function listGeoLocations(): Promise<GeoLocation[]> {
  const { data, error } = await supabase
    .from("geo_locations")
    // Select only what the UI binds against; reduces payload + decouples us
    // from the audit columns that may be added later.
    .select("id, name, province, city, kind, notes")
    .eq("is_deleted", false)
    .order("name", { ascending: true });
  if (error) throw error;
  // Cast through unknown to silence the kind literal mismatch; the CHECK
  // constraint guarantees the four values at the DB level.
  return ((data as unknown) as GeoLocation[]) ?? [];
}

/**
 * Insert a brand-new geo_location.
 *
 * Used by the editor's quick-create flow when the operator types a name
 * that isn't in the dictionary yet. We return the full row (id included) so
 * the caller can immediately select it without a second list fetch.
 */
export async function createGeoLocation(input: {
  name: string;
  province?: string | null;
  city?: string | null;
  kind?: GeoLocation["kind"];
  notes?: string | null;
}): Promise<GeoLocation> {
  // Trim the name — operators often paste with stray whitespace. Empty name
  // is rejected by the NOT NULL constraint at the DB level, but we also
  // guard here so the error is in Persian and immediate.
  const name = (input.name || "").trim();
  if (!name) throw new Error("نام مکان نباید خالی باشد");

  const { data, error } = await supabase
    .from("geo_locations")
    .insert({
      name,
      province: input.province ?? null,
      city: input.city ?? null,
      // Default to "both" so the location is usable as either origin or
      // destination. Operators can refine it later from a future admin page.
      kind: input.kind ?? "both",
      notes: input.notes ?? null,
    })
    .select("id, name, province, city, kind, notes")
    .single();
  if (error) throw error;
  return (data as unknown) as GeoLocation;
}
