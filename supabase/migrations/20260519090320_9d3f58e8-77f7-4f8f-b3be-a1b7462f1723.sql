
-- Rebuild the legacy chart view. Only animals whose current fertility status
-- is in the "pregnancy reporting" set get chart_days based on last_inoculation_date.
-- All other cows fall back to dry → birth → erotic → date_of_birth.
DROP VIEW IF EXISTS public.analytics_fertility_legacy_chart;
CREATE VIEW public.analytics_fertility_legacy_chart AS
WITH base AS (
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
    public.safe_text_to_date(c.last_inoculation_date) AS d_inoc,
    public.safe_text_to_date(c.last_birth_date)       AS d_birth,
    public.safe_text_to_date(c.last_dry_date)         AS d_dry,
    public.safe_text_to_date(c.last_erotic_date)      AS d_erotic,
    public.safe_text_to_date(c.date_of_birth)         AS d_dob,
    -- Legacy CRM constant: FertilityStatusIdsPregnancyDaysReporting.
    -- Only these statuses indicate an active pregnancy workflow where
    -- "روز از تلقیح" is meaningful as the chart bar height.
    --   3  = تلقیح شده
    --   4  = تست اولیه مثبت
    --   5  = تست اولیه مشکوک
    --   8  = آبستن قطعی
    --   18 = تست تکمیلی مثبت
    --   20 = تست خشکی مثبت
    (c.last_fertility_status IN (3, 4, 5, 8, 18, 20)) AS is_pregnancy_reporting
  FROM public.cows c
  LEFT JOIN public.fertility_statuses fs ON fs.id = c.last_fertility_status
  WHERE
    COALESCE(c.sex::integer, 0) = 0
    AND (c.existancestatus IS NULL OR c.existancestatus = 0)
),
calc AS (
  SELECT
    b.*,
    -- These derived fields are always exposed (for the tooltip), even when
    -- chart_days falls back to a different source.
    CASE WHEN d_inoc IS NOT NULL THEN (CURRENT_DATE - d_inoc) END AS pregnancy_days,
    CASE WHEN d_inoc IS NOT NULL THEN (d_inoc + 279) END         AS prediction_of_birth_date,
    CASE WHEN d_inoc IS NOT NULL THEN ((d_inoc + 279) - CURRENT_DATE) END AS prediction_of_birth_date_days,
    CASE WHEN b.is_dry = true AND d_dry IS NOT NULL THEN (CURRENT_DATE - d_dry) END AS dry_days,
    CASE WHEN d_birth IS NOT NULL AND d_inoc IS NOT NULL THEN (d_inoc - d_birth) END AS last_birth_to_pregnancy_days
  FROM base b
)
SELECT
  livestock_id, bodynumber, earnumber, number_of_births, last_period,
  last_fertility_status, is_pregnancy, is_dry,
  last_birth_date, last_erotic_date, last_inoculation_date,
  last_pregnancy_date, last_abortion_date, last_dry_date,
  date_of_birth, chart_status, status_color, is_heifer,
  pregnancy_days,
  prediction_of_birth_date,
  prediction_of_birth_date_days,
  dry_days,
  last_birth_to_pregnancy_days,
  -- chart_days priority:
  --   1) Inoculation — ONLY when status is in pregnancy-reporting set
  --   2) Dry         — when is_dry = true
  --   3) Birth       — fallback for negative-test / aborted / no-status cows
  --   4) Erotic
  --   5) Date of birth (heifers)
  CASE
    WHEN is_pregnancy_reporting AND d_inoc IS NOT NULL THEN (CURRENT_DATE - d_inoc)
    WHEN is_dry = true AND d_dry IS NOT NULL          THEN (CURRENT_DATE - d_dry)
    WHEN d_birth  IS NOT NULL                          THEN (CURRENT_DATE - d_birth)
    WHEN d_erotic IS NOT NULL                          THEN (CURRENT_DATE - d_erotic)
    WHEN d_dob    IS NOT NULL                          THEN (CURRENT_DATE - d_dob)
    ELSE NULL
  END AS chart_days,
  CASE
    WHEN is_pregnancy_reporting AND d_inoc IS NOT NULL THEN 'تلقیح'
    WHEN is_dry = true AND d_dry IS NOT NULL          THEN 'خشکی'
    WHEN d_birth  IS NOT NULL                          THEN 'زایش'
    WHEN d_erotic IS NOT NULL                          THEN 'فحلی'
    WHEN d_dob    IS NOT NULL                          THEN 'سن تلیسه'
    ELSE 'نامشخص'
  END AS chart_day_source
FROM calc
WHERE
  CASE
    WHEN is_pregnancy_reporting AND d_inoc IS NOT NULL THEN (CURRENT_DATE - d_inoc)
    WHEN is_dry = true AND d_dry IS NOT NULL          THEN (CURRENT_DATE - d_dry)
    WHEN d_birth  IS NOT NULL                          THEN (CURRENT_DATE - d_birth)
    WHEN d_erotic IS NOT NULL                          THEN (CURRENT_DATE - d_erotic)
    WHEN d_dob    IS NOT NULL                          THEN (CURRENT_DATE - d_dob)
    ELSE NULL
  END IS NOT NULL;
