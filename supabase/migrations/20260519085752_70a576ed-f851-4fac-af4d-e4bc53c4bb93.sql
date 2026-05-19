
-- Helper: convert mixed-format text dates (Gregorian YYYY-MM-DD or Jalali YYYY/MM/DD)
-- to a proper PostgreSQL date. Returns NULL when the input cannot be parsed.
CREATE OR REPLACE FUNCTION public.safe_text_to_date(p_text text)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  s text;
  y int; m int; d int;
  -- Jalali → Gregorian conversion constants (Birashk algorithm)
  jy int; jm int; jd int;
  gy int; gm int; gd int;
  days int;
  jy2 int;
BEGIN
  IF p_text IS NULL THEN RETURN NULL; END IF;
  s := trim(p_text);
  IF s = '' THEN RETURN NULL; END IF;
  -- Strip trailing time component if present (e.g. "2026-04-22 00:00:00.000")
  s := split_part(s, ' ', 1);
  s := split_part(s, 'T', 1);

  -- ISO Gregorian: YYYY-MM-DD
  IF s ~ '^\d{4}-\d{1,2}-\d{1,2}$' THEN
    BEGIN
      RETURN to_date(s, 'YYYY-MM-DD');
    EXCEPTION WHEN OTHERS THEN RETURN NULL;
    END;
  END IF;

  -- Jalali/Shamsi: YYYY/MM/DD (year > 1300 → treat as Jalali)
  IF s ~ '^\d{3,4}/\d{1,2}/\d{1,2}$' THEN
    jy := split_part(s, '/', 1)::int;
    jm := split_part(s, '/', 2)::int;
    jd := split_part(s, '/', 3)::int;

    IF jy > 1700 THEN
      -- Looks like Gregorian-with-slashes
      BEGIN
        RETURN make_date(jy, jm, jd);
      EXCEPTION WHEN OTHERS THEN RETURN NULL;
      END;
    END IF;

    -- Jalali → Gregorian (Birashk)
    jy2 := jy + 1595;
    days := -355668 + (365 * jy2) + ((jy2 / 33) * 8) + (((jy2 % 33) + 3) / 4) + jd;
    IF jm < 7 THEN
      days := days + (jm - 1) * 31;
    ELSE
      days := days + ((jm - 7) * 30) + 186;
    END IF;
    gy := 400 * (days / 146097);
    days := days % 146097;
    IF days > 36524 THEN
      days := days - 1;
      gy := gy + 100 * (days / 36524);
      days := days % 36524;
      IF days >= 365 THEN days := days + 1; END IF;
    END IF;
    gy := gy + 4 * (days / 1461);
    days := days % 1461;
    IF days > 365 THEN
      gy := gy + ((days - 1) / 365);
      days := (days - 1) % 365;
    END IF;
    gd := days + 1;
    -- Month lookup
    DECLARE
      sal_a int[] := ARRAY[0,31,
        CASE WHEN (gy % 4 = 0 AND gy % 100 <> 0) OR gy % 400 = 0 THEN 29 ELSE 28 END,
        31,30,31,30,31,31,30,31,30,31];
      i int := 1;
    BEGIN
      gm := 0;
      WHILE i <= 12 AND gd > sal_a[i+1] LOOP
        gd := gd - sal_a[i+1];
        gm := gm + 1;
        i := i + 1;
      END LOOP;
      gm := gm + 1;
    END;
    BEGIN
      RETURN make_date(gy, gm, gd);
    EXCEPTION WHEN OTHERS THEN RETURN NULL;
    END;
  END IF;

  RETURN NULL;
END;
$$;

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
    -- Parsed date columns (safe across mixed Gregorian/Jalali text)
    public.safe_text_to_date(c.last_inoculation_date) AS d_inoc,
    public.safe_text_to_date(c.last_birth_date)       AS d_birth,
    public.safe_text_to_date(c.last_dry_date)         AS d_dry,
    public.safe_text_to_date(c.last_erotic_date)      AS d_erotic,
    public.safe_text_to_date(c.date_of_birth)         AS d_dob
  FROM public.cows c
  LEFT JOIN public.fertility_statuses fs ON fs.id = c.last_fertility_status
  WHERE
    COALESCE(c.sex::integer, 0) = 0
    AND (c.existancestatus IS NULL OR c.existancestatus = 0)
),
calc AS (
  SELECT
    b.*,
    -- Legacy CRM derived fields
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
  -- chart_days: legacy priority (insemination > dry > birth > erotic > DOB)
  CASE
    WHEN d_inoc   IS NOT NULL THEN (CURRENT_DATE - d_inoc)
    WHEN is_dry = true AND d_dry IS NOT NULL THEN (CURRENT_DATE - d_dry)
    WHEN d_birth  IS NOT NULL THEN (CURRENT_DATE - d_birth)
    WHEN d_erotic IS NOT NULL THEN (CURRENT_DATE - d_erotic)
    WHEN d_dob    IS NOT NULL THEN (CURRENT_DATE - d_dob)
    ELSE NULL
  END AS chart_days,
  CASE
    WHEN d_inoc   IS NOT NULL THEN 'تلقیح'
    WHEN is_dry = true AND d_dry IS NOT NULL THEN 'خشکی'
    WHEN d_birth  IS NOT NULL THEN 'زایش'
    WHEN d_erotic IS NOT NULL THEN 'فحلی'
    WHEN d_dob    IS NOT NULL THEN 'سن تلیسه'
    ELSE 'نامشخص'
  END AS chart_day_source
FROM calc
WHERE
  CASE
    WHEN d_inoc   IS NOT NULL THEN (CURRENT_DATE - d_inoc)
    WHEN is_dry = true AND d_dry IS NOT NULL THEN (CURRENT_DATE - d_dry)
    WHEN d_birth  IS NOT NULL THEN (CURRENT_DATE - d_birth)
    WHEN d_erotic IS NOT NULL THEN (CURRENT_DATE - d_erotic)
    WHEN d_dob    IS NOT NULL THEN (CURRENT_DATE - d_dob)
    ELSE NULL
  END IS NOT NULL;
