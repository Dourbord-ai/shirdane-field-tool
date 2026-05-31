
-- 1) Add earnumber snapshot column to livestock_milk_records
ALTER TABLE public.livestock_milk_records
  ADD COLUMN IF NOT EXISTS earnumber integer;

CREATE INDEX IF NOT EXISTS idx_livestock_milk_records_earnumber
  ON public.livestock_milk_records (earnumber);

-- 2) Backfill earnumber from cows
UPDATE public.livestock_milk_records lmr
SET earnumber = c.earnumber
FROM public.cows c
WHERE lmr.livestock_id = c.id
  AND lmr.earnumber IS DISTINCT FROM c.earnumber;

-- 3) Trigger to auto-populate earnumber from cows on insert/update
CREATE OR REPLACE FUNCTION public.fn_milk_record_set_earnumber()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.earnumber IS NULL AND NEW.livestock_id IS NOT NULL THEN
    SELECT earnumber INTO NEW.earnumber
    FROM public.cows WHERE id = NEW.livestock_id LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lmr_set_earnumber_ins ON public.livestock_milk_records;
DROP TRIGGER IF EXISTS trg_lmr_set_earnumber_upd ON public.livestock_milk_records;
CREATE TRIGGER trg_lmr_set_earnumber_ins
  BEFORE INSERT ON public.livestock_milk_records
  FOR EACH ROW EXECUTE FUNCTION public.fn_milk_record_set_earnumber();
CREATE TRIGGER trg_lmr_set_earnumber_upd
  BEFORE UPDATE OF livestock_id ON public.livestock_milk_records
  FOR EACH ROW EXECUTE FUNCTION public.fn_milk_record_set_earnumber();

-- 4) Fix milk auto-alert trigger so animal_number uses cows.earnumber, not livestock_items
CREATE OR REPLACE FUNCTION public.fn_milk_record_autoalert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_threshold numeric := 30;
  v_n         integer := 3;
  v_today     numeric;
  v_base      numeric;
  v_count     integer;
  v_diff_kg   numeric;
  v_diff_pct  numeric;
  v_animal    text;
  v_session   text;
BEGIN
  IF COALESCE(NEW.is_cancelled, false) THEN
    RETURN NEW;
  END IF;

  v_today   := COALESCE(NEW.milk_amount, 0);
  v_session := NEW.period::text;

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

  IF v_count IS NULL OR v_count = 0 OR v_base IS NULL OR v_base = 0 THEN
    RETURN NEW;
  END IF;

  v_diff_kg  := ROUND((v_today - v_base)::numeric, 2);
  v_diff_pct := ROUND(((v_today - v_base) / v_base * 100)::numeric, 2);

  IF ABS(v_diff_pct) < v_threshold THEN
    RETURN NEW;
  END IF;

  -- Use cows.earnumber as the canonical "شماره گاو", with snapshot fallback.
  SELECT COALESCE(c.earnumber::text, NEW.earnumber::text, NEW.livestock_id::text)
    INTO v_animal
  FROM public.cows c
  WHERE c.id = NEW.livestock_id
  LIMIT 1;

  IF v_animal IS NULL THEN
    v_animal := COALESCE(NEW.earnumber::text, NEW.livestock_id::text);
  END IF;

  INSERT INTO public.milk_production_alerts (
    livestock_id, animal_number, reference_date, baseline_mode,
    baseline_records_count, session, today_kg, baseline_kg,
    diff_kg, diff_pct, threshold_pct, direction, status
  ) VALUES (
    NEW.livestock_id, v_animal, NEW.record_date, 'prev3',
    v_count, v_session,
    ROUND(v_today::numeric, 2), ROUND(v_base::numeric, 2),
    v_diff_kg, v_diff_pct, v_threshold,
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

-- 5) Backfill existing alerts' animal_number from cows.earnumber
UPDATE public.milk_production_alerts a
SET animal_number = c.earnumber::text
FROM public.cows c
WHERE a.livestock_id = c.id
  AND (a.animal_number IS NULL OR a.animal_number = a.livestock_id::text OR a.animal_number IS DISTINCT FROM c.earnumber::text);
