-- Allow anon (and authenticated) full access to geo_locations.
-- The app currently uses placeholder/API-based auth (no Supabase session),
-- so all PostgREST requests arrive as the `anon` role. The previously
-- installed policies were scoped only to `authenticated`, which caused
-- INSERT/SELECT to be rejected when the operator tried to add a new
-- origin/destination from the freight cost editor.
--
-- We match the pattern used by other dictionary tables in this project
-- (e.g. finance_parties) which expose a permissive policy for anon +
-- authenticated. RLS stays ENABLED so we can tighten it later when real
-- auth lands.

DROP POLICY IF EXISTS geo_locations_select_authenticated ON public.geo_locations;
DROP POLICY IF EXISTS geo_locations_insert_authenticated ON public.geo_locations;
DROP POLICY IF EXISTS geo_locations_update_authenticated ON public.geo_locations;
DROP POLICY IF EXISTS geo_locations_delete_authenticated ON public.geo_locations;

CREATE POLICY geo_locations_all_access
  ON public.geo_locations
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

-- Guarantee a friendly DB-level error for duplicate names so the editor
-- can translate it into Persian instead of leaking a raw constraint.
-- Case-insensitive uniqueness on name+province+city among non-deleted rows.
CREATE UNIQUE INDEX IF NOT EXISTS geo_locations_unique_name_idx
  ON public.geo_locations (
    lower(name),
    COALESCE(lower(province), ''),
    COALESCE(lower(city), '')
  )
  WHERE is_deleted = false;