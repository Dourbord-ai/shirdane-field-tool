
CREATE OR REPLACE FUNCTION public.rebuild_cow_fertility_cache(p_cow_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_latest record;
  v_implied integer;
BEGIN
  SELECT pre_entry_birth_date, pre_entry_abortion_date, pre_entry_dry_date, pre_entry_period,
         last_out_birth_date, last_out_abortion_date, last_out_dry_date, last_out_period
    INTO v_pre
    FROM public.cows WHERE id = p_cow_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT max(event_date) INTO v_last_erotic FROM public.livestock_fertility_events
    WHERE livestock_id = p_cow_id AND COALESCE(is_cancelled,false)=false AND fertility_operation_id = 1;
  SELECT max(event_date) INTO v_last_inoc FROM public.livestock_fertility_events
    WHERE livestock_id = p_cow_id AND COALESCE(is_cancelled,false)=false AND fertility_operation_id = 2;
  SELECT max(event_date) INTO v_last_preg FROM public.livestock_fertility_events
    WHERE livestock_id = p_cow_id AND COALESCE(is_cancelled,false)=false AND fertility_operation_id IN (3,4,11,12);
  SELECT max(event_date) INTO v_last_abortion FROM public.livestock_fertility_events
    WHERE livestock_id = p_cow_id AND COALESCE(is_cancelled,false)=false AND fertility_operation_id = 5;
  SELECT max(event_date) INTO v_last_birth FROM public.livestock_fertility_events
    WHERE livestock_id = p_cow_id AND COALESCE(is_cancelled,false)=false AND fertility_operation_id = 6;
  SELECT max(event_date) INTO v_last_dry FROM public.livestock_fertility_events
    WHERE livestock_id = p_cow_id AND COALESCE(is_cancelled,false)=false AND fertility_operation_id = 7;
  SELECT max(event_date) INTO v_last_rinse FROM public.livestock_fertility_events
    WHERE livestock_id = p_cow_id AND COALESCE(is_cancelled,false)=false AND fertility_operation_id = 8;
  SELECT max(event_date) INTO v_last_clean FROM public.livestock_fertility_events
    WHERE livestock_id = p_cow_id AND COALESCE(is_cancelled,false)=false AND fertility_operation_id = 10;
  SELECT max(event_date) INTO v_last_sync FROM public.livestock_fertility_events
    WHERE livestock_id = p_cow_id AND COALESCE(is_cancelled,false)=false AND fertility_operation_id = 13;

  -- Latest meaningful event: prefer one with explicit fertility_status_id;
  -- otherwise fall back to the most recent event of any kind and infer status from operation.
  SELECT fertility_status_id, event_date, fertility_operation_id
    INTO v_latest
    FROM public.livestock_fertility_events
    WHERE livestock_id = p_cow_id AND COALESCE(is_cancelled,false)=false
    ORDER BY event_date DESC NULLS LAST, event_time DESC NULLS LAST, created_at DESC
    LIMIT 1;

  IF v_latest.fertility_operation_id IS NOT NULL THEN
    IF v_latest.fertility_status_id IS NOT NULL THEN
      v_last_status_id := v_latest.fertility_status_id;
    ELSE
      v_implied := CASE v_latest.fertility_operation_id
        WHEN 1 THEN 2    -- Erotic → فحل شده
        WHEN 2 THEN 3    -- Inoculation → تلقیح شده
        WHEN 5 THEN 9    -- Abortion → سقط کرده
        WHEN 6 THEN 12   -- Birth → تازه زا
        WHEN 7 THEN 10   -- Dry → باز خشک
        WHEN 8 THEN 14   -- Rinse → شستشو شده
        WHEN 10 THEN 15  -- CleanTest → کلین تست مثبت
        WHEN 13 THEN 21  -- Sync → همزمان سازی فحلی
        ELSE NULL
      END;
      v_last_status_id := v_implied;
    END IF;
    v_last_status_date := v_latest.event_date;
  END IF;

  IF v_last_status_id IS NOT NULL THEN
    SELECT
      CASE WHEN pregnancy_state = 'pregnant' THEN true
           WHEN pregnancy_state = 'open' THEN false
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
$function$;

-- Backfill existing cows from current event history
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT DISTINCT livestock_id FROM public.livestock_fertility_events WHERE COALESCE(is_cancelled,false)=false LOOP
    PERFORM public.rebuild_cow_fertility_cache(r.livestock_id);
  END LOOP;
END$$;
