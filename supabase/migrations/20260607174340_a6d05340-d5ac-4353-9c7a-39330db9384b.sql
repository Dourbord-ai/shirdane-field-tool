CREATE OR REPLACE FUNCTION public.fn_finance_list_bank_import_files()
RETURNS TABLE (
  imported_file_name text,
  original_file_name text,
  imported_by uuid,
  uploaded_by_name text,
  latest_imported_at timestamptz,
  transaction_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH agg AS (
    SELECT
      t.imported_file_name,
      -- Pick the most-recent non-null original_file_name per file. Using
      -- (imported_at DESC NULLS LAST, ctid) makes the choice deterministic.
      (ARRAY_AGG(t.original_file_name ORDER BY t.imported_at DESC NULLS LAST))[1] AS original_file_name,
      (ARRAY_AGG(t.imported_by         ORDER BY t.imported_at DESC NULLS LAST))[1] AS imported_by,
      MAX(t.imported_at) AS latest_imported_at,
      COUNT(*)           AS transaction_count
    FROM finance_bank_transactions t
    WHERE COALESCE(t.is_deleted, false) = false
      AND t.imported_file_name IS NOT NULL
    GROUP BY t.imported_file_name
  )
  SELECT
    a.imported_file_name,
    a.original_file_name,
    a.imported_by,
    COALESCE(NULLIF(BTRIM(u.full_name), ''), u.username) AS uploaded_by_name,
    a.latest_imported_at,
    a.transaction_count
  FROM agg a
  LEFT JOIN app_users u ON u.id = a.imported_by
  ORDER BY a.latest_imported_at DESC NULLS LAST;
$$;

GRANT EXECUTE ON FUNCTION public.fn_finance_list_bank_import_files() TO authenticated, service_role, anon;