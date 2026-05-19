
CREATE OR REPLACE VIEW public.analytics_fertility_legacy_chart
WITH (security_invoker = true) AS
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
    fs.name AS chart_status,
    fs.color AS status_color,
    (COALESCE(c.number_of_births, 0) = 0) AS is_heifer,
    CASE
      WHEN c.last_inoculation_date IS NOT NULL
        AND (c.last_birth_date IS NULL OR c.last_inoculation_date::date > c.last_birth_date::date)
        THEN ((CURRENT_DATE - c.last_inoculation_date::date))
      WHEN c.last_birth_date IS NOT NULL
        THEN ((CURRENT_DATE - c.last_birth_date::date))
      WHEN c.last_erotic_date IS NOT NULL
        THEN ((CURRENT_DATE - c.last_erotic_date::date))
      WHEN c.date_of_birth IS NOT NULL
        THEN ((CURRENT_DATE - c.date_of_birth::date))
      ELSE NULL
    END AS chart_days,
    CASE
      WHEN c.last_inoculation_date IS NOT NULL
        AND (c.last_birth_date IS NULL OR c.last_inoculation_date::date > c.last_birth_date::date)
        THEN 'تلقیح'
      WHEN c.last_birth_date IS NOT NULL THEN 'زایش'
      WHEN c.last_erotic_date IS NOT NULL THEN 'فحلی'
      WHEN c.date_of_birth IS NOT NULL THEN 'سن تلیسه'
      ELSE 'نامشخص'
    END AS chart_day_source
  FROM public.cows c
  LEFT JOIN public.fertility_statuses fs ON fs.id = c.last_fertility_status
  WHERE COALESCE(c.sex, 0) = 0
    AND COALESCE(c.existancestatus, 0) IN (0, 1)
)
SELECT * FROM base WHERE chart_days IS NOT NULL;

GRANT SELECT ON public.analytics_fertility_legacy_chart TO anon, authenticated;
