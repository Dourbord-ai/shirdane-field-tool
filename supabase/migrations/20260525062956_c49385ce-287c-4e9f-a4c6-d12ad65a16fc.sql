
CREATE OR REPLACE FUNCTION public.finance_bank_tx_bulk_insert(payloads jsonb)
RETURNS TABLE(ord integer, id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH input AS (
    SELECT t.ord::int AS ord, t.elem AS elem
    FROM jsonb_array_elements(payloads) WITH ORDINALITY AS t(elem, ord)
  ),
  ins AS (
    INSERT INTO public.finance_bank_transactions (
      bank_id, transaction_datetime, transaction_type,
      deposit_amount, withdraw_amount, amount,
      description, document_number, reference_number, tracking_number,
      source_type, assignment_status,
      original_file_name, imported_file_name, imported_file_path, raw_data
    )
    SELECT
      (elem->>'bank_id')::uuid,
      (elem->>'transaction_datetime')::timestamptz,
      elem->>'transaction_type',
      COALESCE((elem->>'deposit_amount')::numeric, 0),
      COALESCE((elem->>'withdraw_amount')::numeric, 0),
      NULLIF(elem->>'amount','')::numeric,
      elem->>'description',
      NULLIF(elem->>'document_number',''),
      NULLIF(elem->>'reference_number',''),
      NULLIF(elem->>'tracking_number',''),
      elem->>'source_type',
      COALESCE(NULLIF(elem->>'assignment_status',''),'unassigned'),
      elem->>'original_file_name',
      elem->>'imported_file_name',
      elem->>'imported_file_path',
      elem->'raw_data'
    FROM input
    ORDER BY ord
    ON CONFLICT (
      bank_id,
      transaction_datetime,
      COALESCE(amount, 0::numeric),
      COALESCE(reference_number, ''::text),
      COALESCE(tracking_number, ''::text),
      COALESCE(document_number, ''::text)
    ) WHERE is_deleted = false
    DO NOTHING
    RETURNING
      id,
      bank_id,
      transaction_datetime,
      COALESCE(amount, 0::numeric)        AS k_amount,
      COALESCE(document_number, '')       AS k_doc,
      COALESCE(reference_number, '')      AS k_ref,
      COALESCE(tracking_number, '')       AS k_track
  )
  SELECT i.ord, ins.id
  FROM input i
  LEFT JOIN ins
    ON ins.bank_id = (i.elem->>'bank_id')::uuid
   AND ins.transaction_datetime = (i.elem->>'transaction_datetime')::timestamptz
   AND ins.k_amount = COALESCE(NULLIF(i.elem->>'amount','')::numeric, 0)
   AND ins.k_doc    = COALESCE(NULLIF(i.elem->>'document_number',''),'')
   AND ins.k_ref    = COALESCE(NULLIF(i.elem->>'reference_number',''),'')
   AND ins.k_track  = COALESCE(NULLIF(i.elem->>'tracking_number',''),'')
  ORDER BY i.ord;
END;
$$;

REVOKE ALL ON FUNCTION public.finance_bank_tx_bulk_insert(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finance_bank_tx_bulk_insert(jsonb) TO authenticated, anon, service_role;
