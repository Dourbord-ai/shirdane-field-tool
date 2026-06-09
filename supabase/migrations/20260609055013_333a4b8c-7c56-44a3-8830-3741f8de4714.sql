-- Update list_factors_filtered to match on factor_items.product_type as well,
-- so a "mixed" factor that contains at least one row of the selected
-- product_type is included by the category filter. The header product_type
-- match is kept so legacy single-type factors (livestock/feed/...) still match.
CREATE OR REPLACE FUNCTION public.list_factors_filtered(
  p_from_date        timestamptz DEFAULT NULL,
  p_to_date          timestamptz DEFAULT NULL,
  p_invoice_number   text        DEFAULT NULL,
  p_finance_party_id uuid        DEFAULT NULL,
  p_direction        text        DEFAULT NULL,
  p_product_types    text[]      DEFAULT NULL,
  p_statuses         text[]      DEFAULT NULL,
  p_limit            integer     DEFAULT 50,
  p_offset           integer     DEFAULT 0
)
RETURNS TABLE(
  id uuid, invoice_number text, invoice_date timestamptz, product_type text,
  invoice_type text, factor_type_id smallint, finance_party_id uuid,
  party_name text, company text, payable_amount numeric, lifecycle_state text,
  voucher_id uuid, sepidar_voucher_id text, sepidar_voucher_number text,
  last_posting_error text, posting_attempt_count integer, derived_status text,
  total_count bigint
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH base AS (
    SELECT
      f.id,
      f.invoice_number,
      f.invoice_date,
      f.product_type,
      f.invoice_type,
      f.factor_type_id,
      f.finance_party_id,
      COALESCE(
        fp.sepidar_full_name,
        fp.company_name,
        NULLIF(btrim(COALESCE(fp.first_name,'') || ' ' || COALESCE(fp.last_name,'')), '')
      ) AS party_name,
      f.company,
      f.payable_amount,
      f.lifecycle_state,
      f.voucher_id,
      f.sepidar_voucher_id,
      f.sepidar_voucher_number,
      f.last_posting_error,
      f.posting_attempt_count,
      f.created_at,
      CASE
        WHEN f.sepidar_voucher_id IS NOT NULL THEN 'posted'
        WHEN f.lifecycle_state = 'posted' AND f.sepidar_voucher_number IS NOT NULL THEN 'posted'
        WHEN f.lifecycle_state = 'sepidar_failed' THEN 'sepidar_failed'
        WHEN f.lifecycle_state = 'voucher_failed' THEN 'voucher_failed'
        WHEN f.lifecycle_state = 'cancelled'      THEN 'cancelled'
        WHEN f.lifecycle_state = 'approved'       THEN 'approved'
        ELSE 'draft'
      END AS derived_status
    FROM public.factors f
    LEFT JOIN public.finance_parties fp ON fp.id = f.finance_party_id
  ),
  filtered AS (
    SELECT * FROM base b
    WHERE (p_from_date        IS NULL OR b.invoice_date >= p_from_date)
      AND (p_to_date          IS NULL OR b.invoice_date <  p_to_date)
      AND (p_invoice_number   IS NULL OR b.invoice_number ILIKE '%' || p_invoice_number || '%')
      AND (p_finance_party_id IS NULL OR b.finance_party_id = p_finance_party_id)
      AND (
        p_direction IS NULL
        OR (p_direction = 'purchase' AND (b.factor_type_id = 1 OR b.invoice_type = 'buy'))
        OR (p_direction = 'sale'     AND (b.factor_type_id = 2 OR b.invoice_type IN ('sell','retail_sell')))
      )
      AND (
        p_product_types IS NULL
        -- Header-level match (legacy single-type factors and any future
        -- non-mixed factor whose header product_type matches directly).
        OR b.product_type = ANY(p_product_types)
        -- Item-level existence match: include the factor if at least one
        -- of its factor_items rows has product_type in the selected set.
        -- This is what makes the filter work for `product_type='mixed'`
        -- factors which can contain several different product categories.
        OR EXISTS (
          SELECT 1
          FROM public.factor_items fi
          WHERE fi.factor_id = b.id
            AND fi.product_type = ANY(p_product_types)
        )
      )
      AND (p_statuses      IS NULL OR b.derived_status = ANY(p_statuses))
  )
  SELECT
    id, invoice_number, invoice_date, product_type, invoice_type, factor_type_id,
    finance_party_id, party_name, company, payable_amount, lifecycle_state, voucher_id,
    sepidar_voucher_id, sepidar_voucher_number, last_posting_error, posting_attempt_count, derived_status,
    COUNT(*) OVER() AS total_count
  FROM filtered
  ORDER BY invoice_date DESC NULLS LAST, created_at DESC
  LIMIT GREATEST(1, LEAST(p_limit, 500))
  OFFSET GREATEST(0, p_offset);
$function$;