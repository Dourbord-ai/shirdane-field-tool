
-- =====================================================================
-- get_beneficiaries_balance_report
-- ---------------------------------------------------------------------
-- WHY: The "وضعیت ذینفعان" report (finance ▸ گزارش‌ها) used to aggregate
--      finance_voucher_items on the client per visible page. That had two
--      structural problems:
--        1. It re-implemented business logic outside the DB, so any other
--           consumer (export, dashboard) would diverge.
--        2. It silently hit Supabase's 1000-row response limit when a party
--           had many vouchers, returning wrong totals.
--
-- WHAT: A SECURITY DEFINER function that performs the aggregation in SQL
--       using the exact contract requested by product:
--         debit_total  = SUM(COALESCE(vi.debit, 0))
--         credit_total = SUM(COALESCE(vi.credit, 0))
--         balance      = credit_total - debit_total
--         status       = 'creditor' (>0) | 'debtor' (<0) | 'settled' (=0)
--
-- LEFT JOIN: The deleted-voucher predicate lives in the JOIN ON clause,
--   NOT in WHERE. Putting `v.is_deleted = false` in WHERE would convert
--   the LEFT JOIN into an effective INNER JOIN and drop every party that
--   has zero vouchers — which violates the spec ("party with no activity
--   must still appear with 0/0/0").
--
-- Pagination + search are handled inside the function so the client can
-- stay thin and we still return an accurate `total_count` (window-function
-- over the filtered set, before LIMIT/OFFSET).
-- =====================================================================
CREATE OR REPLACE FUNCTION public.get_beneficiaries_balance_report(
  p_search TEXT  DEFAULT NULL,   -- free-text filter on the computed party name
  p_limit  INTEGER DEFAULT 25,   -- page size
  p_offset INTEGER DEFAULT 0     -- page offset
)
RETURNS TABLE (
  party_id        UUID,
  party_name      TEXT,
  company_name    TEXT,
  first_name      TEXT,
  last_name       TEXT,
  sepidar_full_name TEXT,
  national_code   TEXT,
  national_id     TEXT,
  mobile          TEXT,
  ownership_type  TEXT,
  debit_total     NUMERIC,
  credit_total    NUMERIC,
  balance         NUMERIC,
  balance_status  TEXT,
  total_count     BIGINT          -- same on every row → easy to read once
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- Step 1: aggregate per party in a CTE so the row-level fields and the
  -- numeric totals come from a single grouped projection.
  WITH agg AS (
    SELECT
      fp.id  AS party_id,

      -- Display name: prefer person-style "first last", else company,
      -- else Sepidar's stored full name, else a safe sentinel so we
      -- never produce NULL (the UI relies on locale-compare for sorting).
      COALESCE(
        NULLIF(TRIM(CONCAT_WS(' ', fp.first_name, fp.last_name)), ''),
        fp.company_name,
        fp.sepidar_full_name,
        'بدون نام'
      ) AS party_name,

      fp.company_name,
      fp.first_name,
      fp.last_name,
      fp.sepidar_full_name,
      fp.national_code,
      fp.national_id,
      fp.mobile,
      fp.ownership_type,

      -- Aggregates: COALESCE inside SUM handles NULL line amounts;
      -- COALESCE outside SUM handles the all-NULL case (zero rows joined).
      COALESCE(SUM(COALESCE(vi.debit, 0)), 0)  AS debit_total,
      COALESCE(SUM(COALESCE(vi.credit, 0)), 0) AS credit_total,
      COALESCE(
        SUM(COALESCE(vi.credit, 0) - COALESCE(vi.debit, 0)),
        0
      ) AS balance
    FROM public.finance_parties fp
    -- LEFT JOIN keeps zero-activity parties in the result set.
    LEFT JOIN public.finance_voucher_items vi
      ON vi.party_id = fp.id
    -- Deleted-voucher filter MUST live here (JOIN ON), not in WHERE,
    -- otherwise LEFT JOIN semantics collapse to INNER JOIN.
    LEFT JOIN public.finance_vouchers v
      ON v.id = vi.voucher_id
     AND COALESCE(v.is_deleted, FALSE) = FALSE
    WHERE COALESCE(fp.is_deleted, FALSE) = FALSE
    GROUP BY
      fp.id,
      fp.first_name,
      fp.last_name,
      fp.company_name,
      fp.sepidar_full_name,
      fp.national_code,
      fp.national_id,
      fp.mobile,
      fp.ownership_type
  ),
  -- Step 2: apply the (optional) text search on top of the aggregated
  -- party_name so the user can search by what they actually see.
  filtered AS (
    SELECT *
    FROM agg
    WHERE
      p_search IS NULL
      OR length(btrim(p_search)) = 0
      OR party_name        ILIKE '%' || p_search || '%'
      OR COALESCE(company_name, '')      ILIKE '%' || p_search || '%'
      OR COALESCE(sepidar_full_name, '') ILIKE '%' || p_search || '%'
      OR COALESCE(national_code, '')     ILIKE '%' || p_search || '%'
      OR COALESCE(national_id, '')       ILIKE '%' || p_search || '%'
      OR COALESCE(mobile, '')            ILIKE '%' || p_search || '%'
  )
  SELECT
    f.party_id,
    f.party_name,
    f.company_name,
    f.first_name,
    f.last_name,
    f.sepidar_full_name,
    f.national_code,
    f.national_id,
    f.mobile,
    f.ownership_type,
    f.debit_total,
    f.credit_total,
    f.balance,
    -- Bucket derived from the same balance value used in the UI so the
    -- chip color and number color can never disagree.
    CASE
      WHEN f.balance < 0 THEN 'debtor'
      WHEN f.balance > 0 THEN 'creditor'
      ELSE 'settled'
    END AS balance_status,
    COUNT(*) OVER () AS total_count
  FROM filtered f
  ORDER BY f.party_name
  LIMIT  GREATEST(COALESCE(p_limit, 25), 1)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$$;

-- The Supabase Data API (PostgREST) needs explicit EXECUTE grants per role.
-- Reports are auth-only; no anon access.
REVOKE ALL ON FUNCTION public.get_beneficiaries_balance_report(TEXT, INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_beneficiaries_balance_report(TEXT, INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_beneficiaries_balance_report(TEXT, INTEGER, INTEGER) TO service_role;
