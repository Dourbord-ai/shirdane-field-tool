
-- Realtime milk drop/surge alert trigger.
-- On insert (or un-cancel) of a livestock_milk_records row, look at the last
-- 3 prior non-cancelled records for the SAME cow and SAME period (نوبت),
-- compute diff% vs their average and, when |diff%| >= 30, upsert a row into
-- public.milk_production_alerts. Threshold = 30, baseline_mode = 'prev3',
-- session = the period of the new record as text ('1'|'2'|'3').

CREATE OR REPLACE FUNCTION public.fn_milk_record_autoalert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_threshold numeric := 30;          -- آستانه هشدار 30%
  v_n         integer := 3;           -- مقایسه با ۳ رکورد قبلی
  v_today     numeric;
  v_base      numeric;
  v_count     integer;
  v_diff_kg   numeric;
  v_diff_pct  numeric;
  v_animal    text;
  v_session   text;
BEGIN
  -- Only act on active (non-cancelled) rows.
  IF COALESCE(NEW.is_cancelled, false) THEN
    RETURN NEW;
  END IF;

  v_today   := COALESCE(NEW.milk_amount, 0);
  v_session := NEW.period::text;

  -- Average of the last N prior non-cancelled records for same cow & period.
  SELECT AVG(milk_amount), COUNT(*)
    INTO v_base, v_count
  FROM (
    SELECT milk_amount
    FROM public.livestock_milk_records
    WHERE livestock_id = NEW.livestock_id
      AND period       = NEW.period
      AND COALESCE(is_cancelled, false) = false
      AND id <> NEW.id
      AND (record_date < NEW.record_date
        OR (record_date = NEW.record_date AND id < NEW.id))
    ORDER BY record_date DESC, id DESC
    LIMIT v_n
  ) p;

  -- Need at least one baseline record and a non-zero baseline.
  IF v_count IS NULL OR v_count = 0 OR v_base IS NULL OR v_base = 0 THEN
    RETURN NEW;
  END IF;

  v_diff_kg  := ROUND((v_today - v_base)::numeric, 2);
  v_diff_pct := ROUND(((v_today - v_base) / v_base * 100)::numeric, 2);

  IF ABS(v_diff_pct) < v_threshold THEN
    RETURN NEW;
  END IF;

  -- Resolve animal number (denormalised on the alert row).
  SELECT COALESCE(animal_number::text, NEW.livestock_id::text)
    INTO v_animal
  FROM public.livestock_items
  WHERE id = NEW.livestock_id
  LIMIT 1;

  INSERT INTO public.milk_production_alerts (
    livestock_id, animal_number, reference_date, baseline_mode,
    baseline_records_count, session, today_kg, baseline_kg,
    diff_kg, diff_pct, threshold_pct, direction, status
  ) VALUES (
    NEW.livestock_id,
    COALESCE(v_animal, NEW.livestock_id::text),
    NEW.record_date,
    'prev3',
    v_count,
    v_session,
    ROUND(v_today::numeric, 2),
    ROUND(v_base::numeric,  2),
    v_diff_kg,
    v_diff_pct,
    v_threshold,
    CASE WHEN v_diff_pct < 0 THEN 'drop' ELSE 'surge' END,
    'open'
  )
  ON CONFLICT (livestock_id, reference_date, baseline_mode, COALESCE(session, 'all'))
  DO UPDATE SET
    animal_number          = EXCLUDED.animal_number,
    baseline_records_count = EXCLUDED.baseline_records_count,
    today_kg               = EXCLUDED.today_kg,
    baseline_kg            = EXCLUDED.baseline_kg,
    diff_kg                = EXCLUDED.diff_kg,
    diff_pct               = EXCLUDED.diff_pct,
    threshold_pct          = EXCLUDED.threshold_pct,
    direction              = EXCLUDED.direction,
    updated_at             = now();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_milk_record_autoalert_ins ON public.livestock_milk_records;
CREATE TRIGGER trg_milk_record_autoalert_ins
AFTER INSERT ON public.livestock_milk_records
FOR EACH ROW
EXECUTE FUNCTION public.fn_milk_record_autoalert();

DROP TRIGGER IF EXISTS trg_milk_record_autoalert_upd ON public.livestock_milk_records;
CREATE TRIGGER trg_milk_record_autoalert_upd
AFTER UPDATE OF milk_amount, is_cancelled, period, record_date
ON public.livestock_milk_records
FOR EACH ROW
WHEN (COALESCE(NEW.is_cancelled, false) = false)
EXECUTE FUNCTION public.fn_milk_record_autoalert();
