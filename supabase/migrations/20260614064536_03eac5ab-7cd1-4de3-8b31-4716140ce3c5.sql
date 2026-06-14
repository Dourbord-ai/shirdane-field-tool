
-- =============================================================================
-- fertility_thresholds — single-row configuration table for the fertility
-- action list report and related sections.
-- -----------------------------------------------------------------------------
-- The id is locked to 1 via a CHECK constraint so this table can only ever
-- hold one configuration row. This keeps the UI trivially simple ("edit the
-- one row") and removes the need to track an "active" record.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.fertility_thresholds (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),

  -- Voluntary Waiting Period — number of days after calving before a cow
  -- becomes eligible for insemination. Heifers have no calving, so we use an
  -- age-based threshold (days since birth) instead.
  vwp_cow_days int NOT NULL DEFAULT 50,
  vwp_heifer_days int NOT NULL DEFAULT 395,

  -- Window after insemination during which the first pregnancy test should
  -- be performed.
  preg_check_window_min int NOT NULL DEFAULT 35,
  preg_check_window_max int NOT NULL DEFAULT 45,

  -- Window after a positive first pregnancy test during which the
  -- confirmation recheck should be performed.
  recheck_window_min int NOT NULL DEFAULT 60,
  recheck_window_max int NOT NULL DEFAULT 90,

  -- High-risk thresholds — used by the "High Risk Open" section.
  high_risk_dim int NOT NULL DEFAULT 150,
  high_risk_services int NOT NULL DEFAULT 3,
  high_risk_heats int NOT NULL DEFAULT 3,

  -- Close-to-calving — based on GESTATION days, i.e. days since
  -- cows.last_pregnancy_date, NOT on DIM. A pregnant cow that has carried
  -- for at least this many days is approaching calving.
  close_to_calving_days int NOT NULL DEFAULT 240,

  -- "Days since" alert thresholds that drive the badge hints on each row.
  days_since_service_alert int NOT NULL DEFAULT 60,
  days_since_heat_alert int NOT NULL DEFAULT 21,

  -- Synchronization due — a cow whose next sync protocol step is due within
  -- this many days appears in the "Synchronization Due" section.
  sync_due_recheck_days int NOT NULL DEFAULT 14,

  -- Breeder classification. A cow with services_in_cycle >= repeat AND
  -- < chronic is a Repeat Breeder. >= chronic is a Chronic Breeder.
  repeat_breeder_services int NOT NULL DEFAULT 3,
  chronic_breeder_services int NOT NULL DEFAULT 5,

  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL
);

-- GRANTS — required because PostgREST has no default privileges on the public
-- schema. Without these the app cannot reach the table even with RLS allowing.
GRANT SELECT, UPDATE ON public.fertility_thresholds TO authenticated;
GRANT SELECT ON public.fertility_thresholds TO anon;
GRANT ALL ON public.fertility_thresholds TO service_role;

-- Enable RLS. This project uses placeholder auth (no Supabase auth.uid()),
-- so admin restriction is enforced in the application UI rather than via
-- auth.uid()-based policies. We allow read/update to any client, matching
-- the access pattern of other settings tables in the codebase.
ALTER TABLE public.fertility_thresholds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fertility_thresholds_read_all"
ON public.fertility_thresholds
FOR SELECT
USING (true);

CREATE POLICY "fertility_thresholds_update_all"
ON public.fertility_thresholds
FOR UPDATE
USING (true)
WITH CHECK (true);

-- Updated-at trigger — keeps updated_at fresh on every UPDATE so the
-- settings page can show when the configuration was last changed.
CREATE OR REPLACE FUNCTION public.touch_fertility_thresholds_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fertility_thresholds_updated_at ON public.fertility_thresholds;
CREATE TRIGGER trg_fertility_thresholds_updated_at
BEFORE UPDATE ON public.fertility_thresholds
FOR EACH ROW EXECUTE FUNCTION public.touch_fertility_thresholds_updated_at();

-- Seed the single configuration row with default values.
INSERT INTO public.fertility_thresholds (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;
