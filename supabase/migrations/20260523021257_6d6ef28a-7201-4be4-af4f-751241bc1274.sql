
-- ============================================================================
-- Group A migration — convert legacy text dates to timestamptz
-- Format confirmed day-first: D/M/YYYY HH24:MI:SS
-- Source values are wall-clock at Asia/Tehran.
-- ============================================================================

-- Drop cache triggers so the column-type swap on `cows` doesn't fire them
-- with half-converted rows.
DROP TRIGGER IF EXISTS trg_rebuild_cow_location_cache ON public.cow_locations;
DROP TRIGGER IF EXISTS trg_rebuild_cow_status_cache   ON public.cow_statuses;
DROP TRIGGER IF EXISTS trg_rebuild_cow_type_cache     ON public.cow_types;

-- ---- Source tables --------------------------------------------------------
ALTER TABLE public.cow_locations
  ALTER COLUMN event_date TYPE timestamptz
  USING (to_timestamp(event_date, 'FMDD/FMMM/YYYY HH24:MI:SS') AT TIME ZONE 'Asia/Tehran');

ALTER TABLE public.cow_statuses
  ALTER COLUMN event_date TYPE timestamptz
  USING (to_timestamp(event_date, 'FMDD/FMMM/YYYY HH24:MI:SS') AT TIME ZONE 'Asia/Tehran');

ALTER TABLE public.cow_types
  ALTER COLUMN event_date TYPE timestamptz
  USING (to_timestamp(event_date, 'FMDD/FMMM/YYYY HH24:MI:SS') AT TIME ZONE 'Asia/Tehran');

-- ---- cows cache columns ---------------------------------------------------
ALTER TABLE public.cows
  ALTER COLUMN last_location_date TYPE timestamptz
    USING (to_timestamp(last_location_date, 'FMDD/FMMM/YYYY HH24:MI:SS') AT TIME ZONE 'Asia/Tehran'),
  ALTER COLUMN last_status_date TYPE timestamptz
    USING (to_timestamp(last_status_date, 'FMDD/FMMM/YYYY HH24:MI:SS') AT TIME ZONE 'Asia/Tehran'),
  ALTER COLUMN last_type_date TYPE timestamptz
    USING (to_timestamp(last_type_date, 'FMDD/FMMM/YYYY HH24:MI:SS') AT TIME ZONE 'Asia/Tehran');

-- ---- Rebuild cache functions with timestamptz types -----------------------
CREATE OR REPLACE FUNCTION public.rebuild_cow_location_cache(p_cow_id bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_id bigint; v_date timestamptz;
BEGIN
  SELECT location_id, event_date INTO v_id, v_date
    FROM public.cow_locations
    WHERE cow_id = p_cow_id AND COALESCE(is_deleted,false) = false
    ORDER BY event_date DESC NULLS LAST, created_at DESC
    LIMIT 1;
  UPDATE public.cows
     SET last_location_id = v_id, last_location_date = v_date, updated_at = now()
   WHERE id = p_cow_id;
END;$$;

CREATE OR REPLACE FUNCTION public.rebuild_cow_status_cache(p_cow_id bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_id bigint; v_date timestamptz;
BEGIN
  SELECT status_id, event_date INTO v_id, v_date
    FROM public.cow_statuses
    WHERE cow_id = p_cow_id AND COALESCE(is_deleted,false) = false
    ORDER BY event_date DESC NULLS LAST, created_at DESC
    LIMIT 1;
  UPDATE public.cows
     SET last_status_id = v_id, last_status_date = v_date, updated_at = now()
   WHERE id = p_cow_id;
END;$$;

CREATE OR REPLACE FUNCTION public.rebuild_cow_type_cache(p_cow_id bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_id bigint; v_date timestamptz;
BEGIN
  SELECT type_id, event_date INTO v_id, v_date
    FROM public.cow_types
    WHERE cow_id = p_cow_id AND COALESCE(is_deleted,false) = false
    ORDER BY event_date DESC NULLS LAST, created_at DESC
    LIMIT 1;
  UPDATE public.cows
     SET last_type_id = v_id, last_type_date = v_date, updated_at = now()
   WHERE id = p_cow_id;
END;$$;

-- ---- Reattach triggers ----------------------------------------------------
CREATE TRIGGER trg_rebuild_cow_location_cache
AFTER INSERT OR UPDATE OR DELETE ON public.cow_locations
FOR EACH ROW EXECUTE FUNCTION public.trg_rebuild_cow_location_cache();

CREATE TRIGGER trg_rebuild_cow_status_cache
AFTER INSERT OR UPDATE OR DELETE ON public.cow_statuses
FOR EACH ROW EXECUTE FUNCTION public.trg_rebuild_cow_status_cache();

CREATE TRIGGER trg_rebuild_cow_type_cache
AFTER INSERT OR UPDATE OR DELETE ON public.cow_types
FOR EACH ROW EXECUTE FUNCTION public.trg_rebuild_cow_type_cache();
