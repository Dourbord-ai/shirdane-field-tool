
-- ids are identity columns; just ensure boolean defaults
ALTER TABLE public.livestock_groups ALTER COLUMN is_active SET DEFAULT true, ALTER COLUMN is_deleted SET DEFAULT false;
ALTER TABLE public.livestock_types ALTER COLUMN is_active SET DEFAULT true, ALTER COLUMN is_deleted SET DEFAULT false;
ALTER TABLE public.livestock_statuses ALTER COLUMN is_active SET DEFAULT true, ALTER COLUMN is_deleted SET DEFAULT false;
ALTER TABLE public.livestock_locations ALTER COLUMN is_active SET DEFAULT true, ALTER COLUMN is_deleted SET DEFAULT false;

DROP TRIGGER IF EXISTS trg_livestock_groups_updated_at ON public.livestock_groups;
CREATE TRIGGER trg_livestock_groups_updated_at BEFORE UPDATE ON public.livestock_groups
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_livestock_types_updated_at ON public.livestock_types;
CREATE TRIGGER trg_livestock_types_updated_at BEFORE UPDATE ON public.livestock_types
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_livestock_statuses_updated_at ON public.livestock_statuses;
CREATE TRIGGER trg_livestock_statuses_updated_at BEFORE UPDATE ON public.livestock_statuses
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_livestock_locations_updated_at ON public.livestock_locations;
CREATE TRIGGER trg_livestock_locations_updated_at BEFORE UPDATE ON public.livestock_locations
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE UNIQUE INDEX IF NOT EXISTS uq_livestock_groups_name_active
  ON public.livestock_groups(lower(name)) WHERE is_deleted = false;
CREATE UNIQUE INDEX IF NOT EXISTS uq_livestock_statuses_name_active
  ON public.livestock_statuses(lower(name)) WHERE is_deleted = false;
CREATE UNIQUE INDEX IF NOT EXISTS uq_livestock_locations_name_active
  ON public.livestock_locations(lower(name)) WHERE is_deleted = false;
CREATE UNIQUE INDEX IF NOT EXISTS uq_livestock_types_name_group_active
  ON public.livestock_types(lower(name), COALESCE(group_id, 0)) WHERE is_deleted = false;

CREATE OR REPLACE FUNCTION public.validate_livestock_location_capacity()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.max_capacity IS NOT NULL AND NEW.desirable_capacity IS NOT NULL
     AND NEW.max_capacity < NEW.desirable_capacity THEN
    RAISE EXCEPTION 'max_capacity (%) must be >= desirable_capacity (%)',
      NEW.max_capacity, NEW.desirable_capacity;
  END IF;
  RETURN NEW;
END;$$;

DROP TRIGGER IF EXISTS trg_livestock_locations_capacity ON public.livestock_locations;
CREATE TRIGGER trg_livestock_locations_capacity
BEFORE INSERT OR UPDATE ON public.livestock_locations
FOR EACH ROW EXECUTE FUNCTION public.validate_livestock_location_capacity();
