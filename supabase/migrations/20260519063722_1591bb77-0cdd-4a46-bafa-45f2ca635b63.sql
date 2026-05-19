-- Recreate the fertility legacy chart view so its "present in herd" rule
-- matches the Livestock page (cows.existancestatus IS NULL OR = 0).
-- Sold animals (existancestatus = 1) must NOT appear in the fertility chart.
CREATE OR REPLACE VIEW public.analytics_fertility_legacy_chart AS
WITH base AS (
  SELECT
    c.id AS livestock_id,
    c.bodynumber,
    c.earnumber,
    COALESCE(c.number_of_births, 0) AS number_of_births,
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
    CASE
      WHEN c.last_inoculation_date IS NOT NULL
           AND (c.last_birth_date IS NULL
                OR c.last_inoculation_date::date > c.last_birth_date::date)
        THEN CURRENT_DATE - c.last_inoculation_date::date
      WHEN c.last_birth_date IS NOT NULL
        THEN CURRENT_DATE - c.last_birth_date::date
      WHEN c.last_erotic_date IS NOT NULL
        THEN CURRENT_DATE - c.last_erotic_date::date
      WHEN c.date_of_birth IS NOT NULL
        THEN CURRENT_DATE - c.date_of_birth::date
      ELSE NULL
    END AS chart_days,
    CASE
      WHEN c.last_inoculation_date IS NOT NULL
           AND (c.last_birth_date IS NULL
                OR c.last_inoculation_date::date > c.last_birth_date::date)
        THEN 'تلقیح'
      WHEN c.last_birth_date IS NOT NULL THEN 'زایش'
      WHEN c.last_erotic_date IS NOT NULL THEN 'فحلی'
      WHEN c.date_of_birth IS NOT NULL THEN 'سن تلیسه'
      ELSE 'نامشخص'
    END AS chart_day_source
  FROM public.cows c
  LEFT JOIN public.fertility_statuses fs ON fs.id = c.last_fertility_status
  WHERE
    -- ماده (canonical sex column, matches Livestock page)
    COALESCE(c.sex::integer, 0) = 0
    -- موجود در گله فقط: NULL یا 0 (مطابق صفحه «دام‌ها»)
    AND (c.existancestatus IS NULL OR c.existancestatus = 0)
)
SELECT
  livestock_id, bodynumber, earnumber, number_of_births,
  last_fertility_status, is_pregnancy, is_dry,
  last_birth_date, last_erotic_date, last_inoculation_date,
  last_pregnancy_date, last_abortion_date, last_dry_date,
  date_of_birth, chart_status, status_color, is_heifer,
  chart_days, chart_day_source
FROM base
WHERE chart_days IS NOT NULL;