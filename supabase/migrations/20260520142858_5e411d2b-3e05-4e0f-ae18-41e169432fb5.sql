-- Recreate analytics_fertility_legacy_chart so dates are derived directly from
-- the source of truth (livestock_fertility_events.event_date :: DATE) rather
-- than the legacy text cache columns on `cows` which are no longer populated.
-- Data on `cows` is left untouched — this is a read-only view change only.

DROP VIEW IF EXISTS public.analytics_fertility_legacy_chart;

CREATE VIEW public.analytics_fertility_legacy_chart AS
WITH
-- latest non-cancelled event date per cow per type, cast to a real DATE
latest AS (
  SELECT
    livestock_id,
    event_type,
    MAX(event_date::date) AS d
  FROM public.livestock_fertility_events
  WHERE is_cancelled = false
  GROUP BY livestock_id, event_type
),
base AS (
  SELECT
    c.id AS livestock_id,
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
    fs.name  AS chart_status,
    fs.color AS status_color,
    COALESCE(c.number_of_births, 0) = 0 AS is_heifer,
    -- derive real Gregorian DATEs from the events table
    (SELECT d FROM latest WHERE livestock_id = c.id AND event_type = 'insemination')   AS d_inoc,
    (SELECT d FROM latest WHERE livestock_id = c.id AND event_type = 'calving')        AS d_birth,
    (SELECT d FROM latest WHERE livestock_id = c.id AND event_type = 'dry')            AS d_dry,
    (SELECT d FROM latest WHERE livestock_id = c.id AND event_type = 'heat')           AS d_erotic,
    public.safe_text_to_date(c.date_of_birth)                                          AS d_dob,
    CASE
      WHEN ll.id IS NULL THEN NULL::text
      WHEN ll.code IS NOT NULL THEN ((ll.name || ' ('::text) || ll.code::text) || ')'::text
      ELSE ll.name
    END AS last_location_name,
    CASE WHEN c.is_dry = true THEN 'خشک'::text ELSE 'دوشا'::text END AS milking_status,
    c.last_fertility_status = ANY (ARRAY[3,4,5,8,18,20]) AS is_pregnancy_reporting
  FROM public.cows c
    LEFT JOIN public.fertility_statuses fs   ON fs.id = c.last_fertility_status
    LEFT JOIN public.livestock_locations ll  ON ll.id = c.last_location_id
  WHERE COALESCE(c.sex::integer, 0) = 0
    AND (c.existancestatus IS NULL OR c.existancestatus = 0)
),
calc AS (
  SELECT
    b.*,
    CASE WHEN b.d_inoc IS NOT NULL THEN CURRENT_DATE - b.d_inoc          END AS pregnancy_days,
    CASE WHEN b.d_inoc IS NOT NULL THEN b.d_inoc + 279                    END AS prediction_of_birth_date,
    CASE WHEN b.d_inoc IS NOT NULL THEN (b.d_inoc + 279) - CURRENT_DATE   END AS prediction_of_birth_date_days,
    CASE WHEN b.is_dry = true AND b.d_dry IS NOT NULL THEN CURRENT_DATE - b.d_dry END AS dry_days,
    CASE WHEN b.d_birth IS NOT NULL AND b.d_inoc IS NOT NULL THEN b.d_inoc - b.d_birth END AS last_birth_to_pregnancy_days
  FROM base b
)
SELECT
  livestock_id, bodynumber, earnumber, number_of_births, last_period,
  last_fertility_status, is_pregnancy, is_dry,
  last_birth_date, last_erotic_date, last_inoculation_date, last_pregnancy_date,
  last_abortion_date, last_dry_date, date_of_birth,
  chart_status, status_color, is_heifer,
  last_location_name, milking_status,
  pregnancy_days, prediction_of_birth_date, prediction_of_birth_date_days,
  dry_days, last_birth_to_pregnancy_days,
  -- expose the derived Gregorian DATEs so the UI can format them as Shamsi
  d_inoc  AS last_inoculation_date_g,
  d_birth AS last_birth_date_g,
  d_dry   AS last_dry_date_g,
  d_erotic AS last_erotic_date_g,
  prediction_of_birth_date AS prediction_of_birth_date_g,
  CASE
    WHEN is_pregnancy_reporting AND d_inoc IS NOT NULL THEN CURRENT_DATE - d_inoc
    WHEN is_dry = true AND d_dry IS NOT NULL          THEN CURRENT_DATE - d_dry
    WHEN d_birth IS NOT NULL                          THEN CURRENT_DATE - d_birth
    WHEN d_erotic IS NOT NULL                         THEN CURRENT_DATE - d_erotic
    ELSE 0
  END AS chart_days
FROM calc;