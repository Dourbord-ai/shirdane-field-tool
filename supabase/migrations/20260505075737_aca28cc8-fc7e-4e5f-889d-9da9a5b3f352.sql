-- 1. Add pre-entry baseline fields
ALTER TABLE public.cows
  ADD COLUMN IF NOT EXISTS pre_entry_birth_date text NULL,
  ADD COLUMN IF NOT EXISTS pre_entry_abortion_date text NULL,
  ADD COLUMN IF NOT EXISTS pre_entry_dry_date text NULL,
  ADD COLUMN IF NOT EXISTS pre_entry_period integer NULL,
  ADD COLUMN IF NOT EXISTS pre_entry_note text NULL;

-- 3. Column comments
COMMENT ON COLUMN public.cows.pre_entry_birth_date IS 'Baseline birth date before animal entered this farm. Legacy equivalent: LastOutBirthDate.';
COMMENT ON COLUMN public.cows.pre_entry_abortion_date IS 'Baseline abortion date before animal entered this farm. Legacy equivalent: LastOutAbortionDate.';
COMMENT ON COLUMN public.cows.pre_entry_dry_date IS 'Baseline dry date before animal entered this farm. Legacy equivalent: LastOutDryDate.';
COMMENT ON COLUMN public.cows.pre_entry_period IS 'Baseline period/lactation days before animal entered this farm. Legacy equivalent: LastOutPeriod.';
COMMENT ON COLUMN public.cows.pre_entry_note IS 'Optional note describing fertility baseline before entry to farm.';

COMMENT ON COLUMN public.cows.last_out_birth_date IS 'Legacy field (LastOutBirthDate). Mirrors pre_entry_birth_date; kept for migration compatibility.';
COMMENT ON COLUMN public.cows.last_out_abortion_date IS 'Legacy field (LastOutAbortionDate). Mirrors pre_entry_abortion_date; kept for migration compatibility.';
COMMENT ON COLUMN public.cows.last_out_dry_date IS 'Legacy field (LastOutDryDate). Mirrors pre_entry_dry_date; kept for migration compatibility.';
COMMENT ON COLUMN public.cows.last_out_period IS 'Legacy field (LastOutPeriod). Mirrors pre_entry_period; kept for migration compatibility.';

-- 5. Rebuild fertility cache function
CREATE OR REPLACE FUNCTION public.rebuild_cow_fertility_cache(p_cow_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_last_erotic text;
  v_last_inoc text;
  v_last_preg text;
  v_last_abortion text;
  v_last_birth text;
  v_last_dry text;
  v_last_rinse text;
  v_last_clean text;
  v_last_sync text;
  v_last_status_id integer;
  v_last_status_date text;
  v_is_preg boolean;
  v_is_dry boolean;
  v_pre record;
BEGIN
  SELECT pre_entry_birth_date, pre_entry_abortion_date, pre_entry_dry_date, pre_entry_period,
         last_out_birth_date, last_out_abortion_date, last_out_dry_date, last_out_period
    INTO v_pre
    FROM public.cows WHERE id = p_cow_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT max(event_date) INTO v_last_erotic
    FROM public.livestock_fertility_events
    WHERE livestock_id = p_cow_id AND COALESCE(is_cancelled,false) = false
      AND fertility_operation_id = 1;

  SELECT max(event_date) INTO v_last_inoc
    FROM public.livestock_fertility_events
    WHERE livestock_id = p_cow_id AND COALESCE(is_cancelled,false) = false
      AND fertility_operation_id = 2;

  SELECT max(event_date) INTO v_last_preg
    FROM public.livestock_fertility_events
    WHERE livestock_id = p_cow_id AND COALESCE(is_cancelled,false) = false
      AND fertility_operation_id IN (3,4,11,12);

  SELECT max(event_date) INTO v_last_abortion
    FROM public.livestock_fertility_events
    WHERE livestock_id = p_cow_id AND COALESCE(is_cancelled,false) = false
      AND fertility_operation_id = 5;

  SELECT max(event_date) INTO v_last_birth
    FROM public.livestock_fertility_events
    WHERE livestock_id = p_cow_id AND COALESCE(is_cancelled,false) = false
      AND fertility_operation_id = 6;

  SELECT max(event_date) INTO v_last_dry
    FROM public.livestock_fertility_events
    WHERE livestock_id = p_cow_id AND COALESCE(is_cancelled,false) = false
      AND fertility_operation_id = 7;

  SELECT max(event_date) INTO v_last_rinse
    FROM public.livestock_fertility_events
    WHERE livestock_id = p_cow_id AND COALESCE(is_cancelled,false) = false
      AND fertility_operation_id = 8;

  SELECT max(event_date) INTO v_last_clean
    FROM public.livestock_fertility_events
    WHERE livestock_id = p_cow_id AND COALESCE(is_cancelled,false) = false
      AND fertility_operation_id = 10;

  SELECT max(event_date) INTO v_last_sync
    FROM public.livestock_fertility_events
    WHERE livestock_id = p_cow_id AND COALESCE(is_cancelled,false) = false
      AND fertility_operation_id = 13;

  SELECT fertility_status_id, event_date
    INTO v_last_status_id, v_last_status_date
    FROM public.livestock_fertility_events
    WHERE livestock_id = p_cow_id AND COALESCE(is_cancelled,false) = false
      AND fertility_status_id IS NOT NULL
    ORDER BY event_date DESC NULLS LAST, created_at DESC
    LIMIT 1;

  IF v_last_status_id IS NOT NULL THEN
    SELECT
      CASE WHEN pregnancy_state = 'pregnant' THEN true
           WHEN pregnancy_state = 'not_pregnant' THEN false
           ELSE NULL END,
      CASE WHEN milking_state = 'dry' THEN true
           WHEN milking_state = 'milking' THEN false
           ELSE NULL END
      INTO v_is_preg, v_is_dry
    FROM public.fertility_statuses WHERE id = v_last_status_id;
  END IF;

  UPDATE public.cows SET
    last_erotic_date = v_last_erotic,
    last_inoculation_date = v_last_inoc,
    last_pregnancy_date = v_last_preg,
    last_abortion_date = COALESCE(v_last_abortion, v_pre.pre_entry_abortion_date, v_pre.last_out_abortion_date),
    last_birth_date = COALESCE(v_last_birth, v_pre.pre_entry_birth_date, v_pre.last_out_birth_date),
    last_dry_date = COALESCE(v_last_dry, v_pre.pre_entry_dry_date, v_pre.last_out_dry_date),
    last_rinse_date = v_last_rinse,
    last_clean_test_date = v_last_clean,
    last_sync_date = v_last_sync,
    last_period = COALESCE(last_period, v_pre.pre_entry_period, v_pre.last_out_period),
    last_fertility_status = COALESCE(v_last_status_id, last_fertility_status),
    last_fertility_status_date = COALESCE(v_last_status_date, last_fertility_status_date),
    is_pregnancy = COALESCE(v_is_preg, is_pregnancy),
    is_dry = COALESCE(v_is_dry, is_dry),
    updated_at = now()
  WHERE id = p_cow_id;
END;
$$;

-- 6. Trigger
CREATE OR REPLACE FUNCTION public.trg_rebuild_cow_fertility_cache()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.rebuild_cow_fertility_cache(OLD.livestock_id);
    RETURN OLD;
  ELSE
    PERFORM public.rebuild_cow_fertility_cache(NEW.livestock_id);
    IF TG_OP = 'UPDATE' AND OLD.livestock_id IS DISTINCT FROM NEW.livestock_id THEN
      PERFORM public.rebuild_cow_fertility_cache(OLD.livestock_id);
    END IF;
    RETURN NEW;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS livestock_fertility_events_rebuild_cache ON public.livestock_fertility_events;
CREATE TRIGGER livestock_fertility_events_rebuild_cache
AFTER INSERT OR UPDATE OR DELETE ON public.livestock_fertility_events
FOR EACH ROW EXECUTE FUNCTION public.trg_rebuild_cow_fertility_cache();