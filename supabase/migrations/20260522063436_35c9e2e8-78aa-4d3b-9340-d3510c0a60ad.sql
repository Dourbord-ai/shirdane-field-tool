-- Drop dependent view, alter column, recreate view unchanged.
DROP VIEW IF EXISTS public.analytics_fertility_legacy_chart;

ALTER TABLE public.livestock_fertility_events
ALTER COLUMN event_date TYPE timestamp
USING event_date::timestamp;

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
            ( SELECT latest.d
                   FROM latest
                  WHERE latest.livestock_id = c.id AND latest.event_type = 'insemination'::text) AS d_inoc,
            ( SELECT latest.d
                   FROM latest
                  WHERE latest.livestock_id = c.id AND latest.event_type = 'calving'::text) AS d_birth,
            ( SELECT latest.d
                   FROM latest
                  WHERE latest.livestock_id = c.id AND latest.event_type = 'dry'::text) AS d_dry,
            ( SELECT latest.d
                   FROM latest
                  WHERE latest.livestock_id = c.id AND latest.event_type = 'heat'::text) AS d_erotic,
            safe_text_to_date(c.date_of_birth) AS d_dob,
                CASE
                    WHEN ll.id IS NULL THEN NULL::text
                    WHEN ll.code IS NOT NULL THEN ((ll.name || ' ('::text) || ll.code::text) || ')'::text
                    ELSE ll.name
                END AS last_location_name,
                CASE
                    WHEN c.is_dry = true THEN 'خشک'::text
                    ELSE 'دوشا'::text
                END AS milking_status,
            c.last_fertility_status = ANY (ARRAY[3, 4, 5, 8, 18, 20]) AS is_pregnancy_reporting
           FROM cows c
             LEFT JOIN fertility_statuses fs ON fs.id = c.last_fertility_status
             LEFT JOIN livestock_locations ll ON ll.id = c.last_location_id
          WHERE COALESCE(c.sex::integer, 0) = 0 AND (c.existancestatus IS NULL OR c.existancestatus = 0)
        ), calc AS (
         SELECT b.livestock_id,
            b.bodynumber,
            b.earnumber,
            b.number_of_births,
            b.last_period,
            b.last_fertility_status,
            b.is_pregnancy,
            b.is_dry,
            b.last_birth_date,
            b.last_erotic_date,
            b.last_inoculation_date,
            b.last_pregnancy_date,
            b.last_abortion_date,
            b.last_dry_date,
            b.date_of_birth,
            b.chart_status,
            b.status_color,
            b.is_heifer,
            b.d_inoc,
            b.d_birth,
            b.d_dry,
            b.d_erotic,
            b.d_dob,
            b.last_location_name,
            b.milking_status,
            b.is_pregnancy_reporting,
                CASE
                    WHEN b.d_inoc IS NOT NULL THEN CURRENT_DATE - b.d_inoc
                    ELSE NULL::integer
                END AS pregnancy_days,
                CASE
                    WHEN b.d_inoc IS NOT NULL THEN b.d_inoc + 279
                    ELSE NULL::date
                END AS prediction_of_birth_date,
                CASE
                    WHEN b.d_inoc IS NOT NULL THEN b.d_inoc + 279 - CURRENT_DATE
                    ELSE NULL::integer
                END AS prediction_of_birth_date_days,
                CASE
                    WHEN b.is_dry = true AND b.d_dry IS NOT NULL THEN CURRENT_DATE - b.d_dry
                    ELSE NULL::integer
                END AS dry_days,
                CASE
                    WHEN b.d_birth IS NOT NULL AND b.d_inoc IS NOT NULL THEN b.d_inoc - b.d_birth
                    ELSE NULL::integer
                END AS last_birth_to_pregnancy_days
           FROM base b
        )
 SELECT livestock_id,
    bodynumber,
    earnumber,
    number_of_births,
    last_period,
    last_fertility_status,
    is_pregnancy,
    is_dry,
    last_birth_date,
    last_erotic_date,
    last_inoculation_date,
    last_pregnancy_date,
    last_abortion_date,
    last_dry_date,
    date_of_birth,
    chart_status,
    status_color,
    is_heifer,
    last_location_name,
    milking_status,
    pregnancy_days,
    prediction_of_birth_date,
    prediction_of_birth_date_days,
    dry_days,
    last_birth_to_pregnancy_days,
    d_inoc AS last_inoculation_date_g,
    d_birth AS last_birth_date_g,
    d_dry AS last_dry_date_g,
    d_erotic AS last_erotic_date_g,
    prediction_of_birth_date AS prediction_of_birth_date_g,
        CASE
            WHEN is_pregnancy_reporting AND d_inoc IS NOT NULL THEN CURRENT_DATE - d_inoc
            WHEN is_dry = true AND d_dry IS NOT NULL THEN CURRENT_DATE - d_dry
            WHEN d_birth IS NOT NULL THEN CURRENT_DATE - d_birth
            WHEN d_erotic IS NOT NULL THEN CURRENT_DATE - d_erotic
            ELSE 0
        END AS chart_days
   FROM calc;