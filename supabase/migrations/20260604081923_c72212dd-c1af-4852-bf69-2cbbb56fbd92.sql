-- =============================================================================
-- Task 4 — Freight route fields on related costs + reusable geo_locations table
-- =============================================================================

-- 1) geo_locations: a small dictionary of reusable origins/destinations.
--    Kept intentionally simple; future tasks may add lat/lng/geocoding.
CREATE TABLE public.geo_locations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  province     text NULL,
  city         text NULL,
  kind         text NOT NULL DEFAULT 'both'
               CHECK (kind IN ('origin','destination','both','generic')),
  notes        text NULL,
  is_deleted   boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid NULL,
  updated_by   uuid NULL
);

-- Grants MUST come before RLS policies (per project convention).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.geo_locations TO authenticated;
GRANT ALL ON public.geo_locations TO service_role;

ALTER TABLE public.geo_locations ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can read / write. Soft-delete via is_deleted column.
CREATE POLICY "geo_locations_select_authenticated"
  ON public.geo_locations FOR SELECT TO authenticated USING (true);
CREATE POLICY "geo_locations_insert_authenticated"
  ON public.geo_locations FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "geo_locations_update_authenticated"
  ON public.geo_locations FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "geo_locations_delete_authenticated"
  ON public.geo_locations FOR DELETE TO authenticated USING (true);

-- Reuse the project-standard updated_at trigger function if it exists,
-- otherwise create a local one.
CREATE OR REPLACE FUNCTION public.tg_geo_locations_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER geo_locations_set_updated_at
BEFORE UPDATE ON public.geo_locations
FOR EACH ROW EXECUTE FUNCTION public.tg_geo_locations_set_updated_at();

CREATE INDEX geo_locations_name_idx ON public.geo_locations (name) WHERE is_deleted = false;

-- 2) factor_related_costs — additive columns for freight route info.
ALTER TABLE public.factor_related_costs
  ADD COLUMN origin_location_id      uuid        NULL REFERENCES public.geo_locations(id) ON DELETE SET NULL,
  ADD COLUMN destination_location_id uuid        NULL REFERENCES public.geo_locations(id) ON DELETE SET NULL,
  ADD COLUMN origin_text             text        NULL,
  ADD COLUMN destination_text        text        NULL,
  ADD COLUMN route_distance_km       numeric     NULL,
  ADD COLUMN route_duration_minutes  integer     NULL,
  ADD COLUMN route_source            text        NULL,
  ADD COLUMN route_note              text        NULL,
  ADD COLUMN route_api_provider      text        NULL,
  ADD COLUMN route_api_response      jsonb       NULL,
  ADD COLUMN route_checked_at        timestamptz NULL,
  ADD COLUMN route_checked_by        uuid        NULL,
  ADD COLUMN vehicle_type            text        NULL,
  ADD COLUMN cargo_weight            numeric     NULL;

ALTER TABLE public.factor_related_costs
  ADD CONSTRAINT factor_related_costs_route_source_chk
  CHECK (route_source IS NULL OR route_source IN ('manual','estimated','api'));

-- Helpful indexes for future route analytics.
CREATE INDEX factor_related_costs_origin_loc_idx
  ON public.factor_related_costs (origin_location_id)
  WHERE origin_location_id IS NOT NULL;
CREATE INDEX factor_related_costs_destination_loc_idx
  ON public.factor_related_costs (destination_location_id)
  WHERE destination_location_id IS NOT NULL;
