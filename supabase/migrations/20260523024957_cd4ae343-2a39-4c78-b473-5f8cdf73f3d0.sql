
-- ============================================================
-- Group D: cows.* date columns → native date / timestamptz
-- ============================================================

-- 1) Drop dependent view (will be recreated at step 5)
DROP VIEW IF EXISTS public.analytics_fertility_legacy_chart;

-- 2) Source-of-truth columns → date (all values are ISO YYYY-MM-DD or
--    ISO with a zeroed time component; we strip the time and cast).
ALTER TABLE public.cows
  ALTER COLUMN date_of_birth TYPE date
    USING (split_part(NULLIF(btrim(date_of_birth),''),' ',1)::date),
  ALTER COLUMN existence_date TYPE date
    USING (split_part(NULLIF(btrim(existence_date),''),' ',1)::date),
  ALTER COLUMN start_date_of_calf_milk TYPE date
    USING (split_part(NULLIF(btrim(start_date_of_calf_milk),''),' ',1)::date),
  ALTER COLUMN end_date_of_calf_milk TYPE date
    USING (split_part(NULLIF(btrim(end_date_of_calf_milk),''),' ',1)::date),
  ALTER COLUMN last_milk_record_date TYPE date
    USING (split_part(NULLIF(btrim(last_milk_record_date),''),' ',1)::date);

-- 3) Cache timestamp columns → timestamptz (Tehran wall-clock).
ALTER TABLE public.cows
  ALTER COLUMN last_abortion_date         TYPE timestamptz USING (NULLIF(btrim(last_abortion_date),'')::timestamp AT TIME ZONE 'Asia/Tehran'),
  ALTER COLUMN last_birth_date            TYPE timestamptz USING (NULLIF(btrim(last_birth_date),'')::timestamp AT TIME ZONE 'Asia/Tehran'),
  ALTER COLUMN last_erotic_date           TYPE timestamptz USING (NULLIF(btrim(last_erotic_date),'')::timestamp AT TIME ZONE 'Asia/Tehran'),
  ALTER COLUMN last_inoculation_date      TYPE timestamptz USING (NULLIF(btrim(last_inoculation_date),'')::timestamp AT TIME ZONE 'Asia/Tehran'),
  ALTER COLUMN last_pregnancy_date        TYPE timestamptz USING (NULLIF(btrim(last_pregnancy_date),'')::timestamp AT TIME ZONE 'Asia/Tehran'),
  ALTER COLUMN last_fertility_status_date TYPE timestamptz USING (NULLIF(btrim(last_fertility_status_date),'')::timestamp AT TIME ZONE 'Asia/Tehran'),
  ALTER COLUMN last_sync_date             TYPE timestamptz USING (NULLIF(btrim(last_sync_date),'')::timestamp AT TIME ZONE 'Asia/Tehran'),
  ALTER COLUMN last_out_birth_date        TYPE timestamptz USING (NULLIF(btrim(last_out_birth_date),'')::timestamp AT TIME ZONE 'Asia/Tehran'),
  ALTER COLUMN last_dry_date              TYPE timestamptz USING (NULLIF(btrim(last_dry_date),'')::timestamp AT TIME ZONE 'Asia/Tehran'),
  ALTER COLUMN last_rinse_date            TYPE timestamptz USING (NULLIF(btrim(last_rinse_date),'')::timestamp AT TIME ZONE 'Asia/Tehran'),
  ALTER COLUMN last_clean_test_date       TYPE timestamptz USING (NULLIF(btrim(last_clean_test_date),'')::timestamp AT TIME ZONE 'Asia/Tehran');

-- 4a) Rewrite rebuild_cow_milk_cache — last_milk_record_date is now date,
--     so we assign the date value directly (no ::text coercion).
CREATE OR REPLACE FUNCTION public.rebuild_cow_milk_cache(p_cow_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_last_date date;
  v_last_amount numeric;
  v_daily_total numeric;
begin
  select record_date, milk_amount
    into v_last_date, v_last_amount
  from public.livestock_milk_records
  where livestock_id = p_cow_id and is_cancelled = false
  order by record_date desc, period desc, registered_at desc
  limit 1;

  if v_last_date is not null then
    select coalesce(sum(milk_amount), 0)
      into v_daily_total
    from public.livestock_milk_records
    where livestock_id = p_cow_id and is_cancelled = false and record_date = v_last_date;
  else
    v_daily_total := null;
  end if;

  update public.cows
     set last_milk_record_date = v_last_date,
         last_milk_amount = v_last_amount,
         last_daily_milk_total = v_daily_total
   where id = p_cow_id;
end;
$function$;

-- 4b) Rewrite rebuild_cow_fertility_cache — all writes are native
--     timestamps. livestock_fertility_events.event_date is `timestamp`
--     (naive Tehran wall-clock); we anchor it at Asia/Tehran on read so
--     the cached timestamptz preserves the same wall-clock moment.
--     The pre_entry_* / last_out_* fallback columns remain TEXT for now
--     (out of scope per user instruction); we cast them inline with the
--     same Tehran-anchoring rule.
CREATE OR REPLACE FUNCTION public.rebuild_cow_fertility_cache(p_cow_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  -- All "v_last_*" holders are now timestamptz to match the new cow columns.
  v_last_erotic   timestamptz;
  v_last_inoc     timestamptz;
  v_last_preg     timestamptz;
  v_last_abortion timestamptz;
  v_last_birth    timestamptz;
  v_last_dry      timestamptz;
  v_last_rinse    timestamptz;
  v_last_clean    timestamptz;
  v_last_sync     timestamptz;
  v_last_status_id integer;
  v_last_status_date timestamptz;
  v_is_preg boolean;
  v_is_dry boolean;
  v_pre record;
  v_latest record;
  v_implied integer;
  v_sex smallint;
BEGIN
  SELECT sex INTO v_sex FROM public.cows WHERE id = p_cow_id;
  IF NOT FOUND THEN RETURN; END IF;

  IF v_sex <> 0 THEN
    UPDATE public.cows SET
      last_erotic_date = NULL, last_inoculation_date = NULL, last_pregnancy_date = NULL,
      last_abortion_date = NULL, last_birth_date = NULL, last_dry_date = NULL,
      last_rinse_date = NULL, last_clean_test_date = NULL, last_sync_date = NULL,
      last_fertility_status = NULL, last_fertility_status_date = NULL,
      is_pregnancy = NULL, is_dry = NULL, updated_at = now()
    WHERE id = p_cow_id;
    RETURN;
  END IF;

  SELECT pre_entry_birth_date, pre_entry_abortion_date, pre_entry_dry_date, pre_entry_period,
         last_out_birth_date, last_out_abortion_date, last_out_dry_date, last_out_period
    INTO v_pre FROM public.cows WHERE id = p_cow_id;

  -- Source events are `timestamp` (naive Tehran wall-clock). Anchor at
  -- Asia/Tehran when promoting to timestamptz so the wall-clock moment
  -- the operator entered is preserved.
  SELECT max(event_date AT TIME ZONE 'Asia/Tehran') INTO v_last_erotic
    FROM public.livestock_fertility_events
    WHERE livestock_id = p_cow_id AND COALESCE(is_cancelled,false)=false AND fertility_operation_id = 1;
  SELECT max(event_date AT TIME ZONE 'Asia/Tehran') INTO v_last_inoc
    FROM public.livestock_fertility_events
    WHERE livestock_id = p_cow_id AND COALESCE(is_cancelled,false)=false AND fertility_operation_id = 2;
  SELECT max(event_date AT TIME ZONE 'Asia/Tehran') INTO v_last_preg
    FROM public.livestock_fertility_events
    WHERE livestock_id = p_cow_id AND COALESCE(is_cancelled,false)=false AND fertility_operation_id IN (3,4,11,12);
  SELECT max(event_date AT TIME ZONE 'Asia/Tehran') INTO v_last_abortion
    FROM public.livestock_fertility_events
    WHERE livestock_id = p_cow_id AND COALESCE(is_cancelled,false)=false AND fertility_operation_id = 5;
  SELECT max(event_date AT TIME ZONE 'Asia/Tehran') INTO v_last_birth
    FROM public.livestock_fertility_events
    WHERE livestock_id = p_cow_id AND COALESCE(is_cancelled,false)=false AND fertility_operation_id = 6;
  SELECT max(event_date AT TIME ZONE 'Asia/Tehran') INTO v_last_dry
    FROM public.livestock_fertility_events
    WHERE livestock_id = p_cow_id AND COALESCE(is_cancelled,false)=false AND fertility_operation_id = 7;
  SELECT max(event_date AT TIME ZONE 'Asia/Tehran') INTO v_last_rinse
    FROM public.livestock_fertility_events
    WHERE livestock_id = p_cow_id AND COALESCE(is_cancelled,false)=false AND fertility_operation_id = 8;
  SELECT max(event_date AT TIME ZONE 'Asia/Tehran') INTO v_last_clean
    FROM public.livestock_fertility_events
    WHERE livestock_id = p_cow_id AND COALESCE(is_cancelled,false)=false AND fertility_operation_id = 10;
  SELECT max(event_date AT TIME ZONE 'Asia/Tehran') INTO v_last_sync
    FROM public.livestock_fertility_events
    WHERE livestock_id = p_cow_id AND COALESCE(is_cancelled,false)=false AND fertility_operation_id = 13;

  SELECT fertility_status_id, event_date, fertility_operation_id
    INTO v_latest
    FROM public.livestock_fertility_events
    WHERE livestock_id = p_cow_id
      AND COALESCE(is_cancelled,false)=false
      AND (fertility_status_id IS NOT NULL OR fertility_operation_id IS NOT NULL)
    ORDER BY event_date DESC NULLS LAST, event_time DESC NULLS LAST, created_at DESC
    LIMIT 1;

  IF v_latest.fertility_operation_id IS NOT NULL OR v_latest.fertility_status_id IS NOT NULL THEN
    IF v_latest.fertility_status_id IS NOT NULL THEN
      v_last_status_id := v_latest.fertility_status_id;
    ELSE
      v_implied := CASE v_latest.fertility_operation_id
        WHEN 1 THEN 2 WHEN 2 THEN 3 WHEN 5 THEN 9 WHEN 6 THEN 12
        WHEN 7 THEN 10 WHEN 8 THEN 14 WHEN 10 THEN 15 WHEN 13 THEN 21
        ELSE NULL END;
      v_last_status_id := v_implied;
    END IF;
    -- Promote the source (naive timestamp) to timestamptz at Tehran wall-clock.
    v_last_status_date := v_latest.event_date AT TIME ZONE 'Asia/Tehran';
  END IF;

  IF v_last_status_id IS NOT NULL THEN
    SELECT
      CASE WHEN pregnancy_state = 'pregnant' THEN true
           WHEN pregnancy_state = 'open' THEN false ELSE NULL END,
      CASE WHEN milking_state = 'dry' THEN true
           WHEN milking_state = 'milking' THEN false ELSE NULL END
      INTO v_is_preg, v_is_dry
    FROM public.fertility_statuses WHERE id = v_last_status_id;
  END IF;

  UPDATE public.cows SET
    last_erotic_date = v_last_erotic,
    last_inoculation_date = v_last_inoc,
    last_pregnancy_date = v_last_preg,
    -- pre_entry_* / last_out_* remain TEXT (out of scope). Cast each fallback
    -- with the same Tehran-anchoring rule so the assignment stays type-safe.
    last_abortion_date = COALESCE(
      v_last_abortion,
      (NULLIF(btrim(v_pre.pre_entry_abortion_date),'')::timestamp AT TIME ZONE 'Asia/Tehran'),
      (NULLIF(btrim(v_pre.last_out_abortion_date),'')::timestamp AT TIME ZONE 'Asia/Tehran')
    ),
    last_birth_date = COALESCE(
      v_last_birth,
      (NULLIF(btrim(v_pre.pre_entry_birth_date),'')::timestamp AT TIME ZONE 'Asia/Tehran'),
      (NULLIF(btrim(v_pre.last_out_birth_date),'')::timestamp AT TIME ZONE 'Asia/Tehran')
    ),
    last_dry_date = COALESCE(
      v_last_dry,
      (NULLIF(btrim(v_pre.pre_entry_dry_date),'')::timestamp AT TIME ZONE 'Asia/Tehran'),
      (NULLIF(btrim(v_pre.last_out_dry_date),'')::timestamp AT TIME ZONE 'Asia/Tehran')
    ),
    last_rinse_date = v_last_rinse,
    last_clean_test_date = v_last_clean,
    last_sync_date = v_last_sync,
    last_period = COALESCE(last_period, v_pre.pre_entry_period, v_pre.last_out_period),
    last_fertility_status = v_last_status_id,
    last_fertility_status_date = v_last_status_date,
    is_pregnancy = COALESCE(v_is_preg, is_pregnancy),
    is_dry = COALESCE(v_is_dry, is_dry),
    updated_at = now()
  WHERE id = p_cow_id;
END;
$function$;

-- 5) Recreate analytics_fertility_legacy_chart. The only substantive change
--    is that c.date_of_birth is now a native date, so we drop the
--    safe_text_to_date() wrapper and reference the column directly.
CREATE VIEW public.analytics_fertility_legacy_chart AS
WITH latest AS (
  SELECT livestock_fertility_events.livestock_id,
         livestock_fertility_events.event_type,
         max(livestock_fertility_events.event_date::date) AS d
  FROM livestock_fertility_events
  WHERE livestock_fertility_events.is_cancelled = false
  GROUP BY livestock_fertility_events.livestock_id, livestock_fertility_events.event_type
), base AS (
  SELECT c.id AS livestock_id,
         c.bodynumber,
         c.earnumber,
         COALESCE(c.number_of_births, 0) AS number_of_births,
         c.last_period,
         c.last_fertility_status,
         c.is_pregnancy,
         c.is_dry,
         c.last_birth_date,
         c.last_erotic_date,
         c.last_inoculation_date,
         c.last_pregnancy_date,
         c.last_abortion_date,
         c.last_dry_date,
         c.date_of_birth,
         fs.name AS chart_status,
         fs.color AS status_color,
         COALESCE(c.number_of_births, 0) = 0 AS is_heifer,
         (SELECT latest.d FROM latest WHERE latest.livestock_id = c.id AND latest.event_type = 'insemination'::text) AS d_inoc,
         (SELECT latest.d FROM latest WHERE latest.livestock_id = c.id AND latest.event_type = 'calving'::text) AS d_birth,
         (SELECT latest.d FROM latest WHERE latest.livestock_id = c.id AND latest.event_type = 'dry'::text) AS d_dry,
         (SELECT latest.d FROM latest WHERE latest.livestock_id = c.id AND latest.event_type = 'heat'::text) AS d_erotic,
         -- date_of_birth is now a native date; reference directly.
         c.date_of_birth AS d_dob,
         CASE
           WHEN ll.id IS NULL THEN NULL::text
           WHEN ll.code IS NOT NULL THEN ((ll.name || ' ('::text) || ll.code::text) || ')'::text
           ELSE ll.name
         END AS last_location_name,
         CASE WHEN c.is_dry = true THEN 'خشک'::text ELSE 'دوشا'::text END AS milking_status,
         c.last_fertility_status = ANY (ARRAY[3, 4, 5, 8, 18, 20]) AS is_pregnancy_reporting
  FROM cows c
    LEFT JOIN fertility_statuses fs ON fs.id = c.last_fertility_status
    LEFT JOIN livestock_locations ll ON ll.id = c.last_location_id
  WHERE COALESCE(c.sex::integer, 0) = 0 AND (c.existancestatus IS NULL OR c.existancestatus = 0)
), calc AS (
  SELECT b.*,
         CASE WHEN b.d_inoc IS NOT NULL THEN CURRENT_DATE - b.d_inoc ELSE NULL::integer END AS pregnancy_days,
         CASE WHEN b.d_inoc IS NOT NULL THEN b.d_inoc + 279 ELSE NULL::date END AS prediction_of_birth_date,
         CASE WHEN b.d_inoc IS NOT NULL THEN b.d_inoc + 279 - CURRENT_DATE ELSE NULL::integer END AS prediction_of_birth_date_days,
         CASE WHEN b.is_dry = true AND b.d_dry IS NOT NULL THEN CURRENT_DATE - b.d_dry ELSE NULL::integer END AS dry_days,
         CASE WHEN b.d_birth IS NOT NULL AND b.d_inoc IS NOT NULL THEN b.d_inoc - b.d_birth ELSE NULL::integer END AS last_birth_to_pregnancy_days
  FROM base b
)
SELECT * FROM calc;
