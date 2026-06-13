
CREATE OR REPLACE FUNCTION public.rebuild_cow_location_cache(p_cow_id bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id bigint; v_date text;
BEGIN
  SELECT location_id, event_date INTO v_id, v_date
    FROM public.cow_locations
    WHERE cow_id = p_cow_id AND COALESCE(is_deleted,false) = false
    ORDER BY event_date DESC NULLS LAST, created_at DESC
    LIMIT 1;
  UPDATE public.cows SET last_location_id = v_id, last_location_date = v_date, updated_at = now()
    WHERE id = p_cow_id;
END;$$;

CREATE OR REPLACE FUNCTION public.rebuild_cow_type_cache(p_cow_id bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id bigint; v_date text;
BEGIN
  SELECT type_id, event_date INTO v_id, v_date
    FROM public.cow_types
    WHERE cow_id = p_cow_id AND COALESCE(is_deleted,false) = false
    ORDER BY event_date DESC NULLS LAST, created_at DESC
    LIMIT 1;
  UPDATE public.cows SET last_type_id = v_id, last_type_date = v_date, updated_at = now()
    WHERE id = p_cow_id;
END;$$;

CREATE OR REPLACE FUNCTION public.rebuild_cow_status_cache(p_cow_id bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id bigint; v_date text;
BEGIN
  SELECT status_id, event_date INTO v_id, v_date
    FROM public.cow_statuses
    WHERE cow_id = p_cow_id AND COALESCE(is_deleted,false) = false
    ORDER BY event_date DESC NULLS LAST, created_at DESC
    LIMIT 1;
  UPDATE public.cows SET last_status_id = v_id, last_status_date = v_date, updated_at = now()
    WHERE id = p_cow_id;
END;$$;

CREATE OR REPLACE FUNCTION public.trg_rebuild_cow_location_cache()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.rebuild_cow_location_cache(OLD.cow_id); RETURN OLD;
  ELSE
    PERFORM public.rebuild_cow_location_cache(NEW.cow_id);
    IF TG_OP='UPDATE' AND OLD.cow_id IS DISTINCT FROM NEW.cow_id THEN
      PERFORM public.rebuild_cow_location_cache(OLD.cow_id);
    END IF;
    RETURN NEW;
  END IF;
END;$$;

CREATE OR REPLACE FUNCTION public.trg_rebuild_cow_type_cache()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.rebuild_cow_type_cache(OLD.cow_id); RETURN OLD;
  ELSE
    PERFORM public.rebuild_cow_type_cache(NEW.cow_id);
    IF TG_OP='UPDATE' AND OLD.cow_id IS DISTINCT FROM NEW.cow_id THEN
      PERFORM public.rebuild_cow_type_cache(OLD.cow_id);
    END IF;
    RETURN NEW;
  END IF;
END;$$;

CREATE OR REPLACE FUNCTION public.trg_rebuild_cow_status_cache()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.rebuild_cow_status_cache(OLD.cow_id); RETURN OLD;
  ELSE
    PERFORM public.rebuild_cow_status_cache(NEW.cow_id);
    IF TG_OP='UPDATE' AND OLD.cow_id IS DISTINCT FROM NEW.cow_id THEN
      PERFORM public.rebuild_cow_status_cache(OLD.cow_id);
    END IF;
    RETURN NEW;
  END IF;
END;$$;

DROP TRIGGER IF EXISTS cow_locations_rebuild_cache ON public.cow_locations;
CREATE TRIGGER cow_locations_rebuild_cache AFTER INSERT OR UPDATE OR DELETE ON public.cow_locations
  FOR EACH ROW EXECUTE FUNCTION public.trg_rebuild_cow_location_cache();

DROP TRIGGER IF EXISTS cow_types_rebuild_cache ON public.cow_types;
CREATE TRIGGER cow_types_rebuild_cache AFTER INSERT OR UPDATE OR DELETE ON public.cow_types
  FOR EACH ROW EXECUTE FUNCTION public.trg_rebuild_cow_type_cache();

DROP TRIGGER IF EXISTS cow_statuses_rebuild_cache ON public.cow_statuses;
CREATE TRIGGER cow_statuses_rebuild_cache AFTER INSERT OR UPDATE OR DELETE ON public.cow_statuses
  FOR EACH ROW EXECUTE FUNCTION public.trg_rebuild_cow_status_cache();
