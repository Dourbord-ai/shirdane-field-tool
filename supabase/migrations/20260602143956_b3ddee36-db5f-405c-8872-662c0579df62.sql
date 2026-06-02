-- ──────────────────────────────────────────────────────────────────────
-- STEP A — Soft-delete duplicate Excel-sourced transactions, keeping the
-- OLDEST row in each (bank, datetime, type, amount, normalized desc) group.
-- Only touches rows currently active (is_deleted=false) and source_type='excel'.
-- We use created_at ASC then id ASC as a tie-breaker so behavior is stable.
-- ──────────────────────────────────────────────────────────────────────
WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY
        bank_id,
        transaction_datetime,
        transaction_type,
        amount,
        regexp_replace(trim(coalesce(description,'')), '\s+', ' ', 'g')
      ORDER BY created_at ASC NULLS LAST, id ASC
    ) AS rn
  FROM public.finance_bank_transactions
  WHERE is_deleted = false
    AND source_type = 'excel'
)
UPDATE public.finance_bank_transactions t
SET is_deleted = true,
    updated_at = now()
FROM ranked r
WHERE t.id = r.id
  AND r.rn > 1;

-- ──────────────────────────────────────────────────────────────────────
-- STEP B — Create the legacy partial unique index. Now that duplicates
-- are gone this should succeed.
-- ──────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uq_finance_bank_tx_excel_legacy_dedupe
ON public.finance_bank_transactions (
  bank_id,
  transaction_datetime,
  transaction_type,
  amount,
  (regexp_replace(trim(coalesce(description,'')), '\s+', ' ', 'g'))
)
WHERE is_deleted = false
  AND source_type = 'excel';

-- ──────────────────────────────────────────────────────────────────────
-- STEP C — Rewrite the bulk-insert RPC so EITHER unique index silently
-- skips duplicates. Using untargeted `ON CONFLICT DO NOTHING` because
-- inferring conflict targets on partial expression indexes from
-- PostgREST/PLpgSQL is fragile. ord→id mapping is preserved so the
-- client can still tell apart inserted vs conflict-skipped rows.
-- ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.finance_bank_tx_bulk_insert(payloads jsonb)
 RETURNS TABLE(ord integer, id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      (input.elem->>'bank_id')::uuid,
      (input.elem->>'transaction_datetime')::timestamptz,
      input.elem->>'transaction_type',
      COALESCE((input.elem->>'deposit_amount')::numeric, 0),
      COALESCE((input.elem->>'withdraw_amount')::numeric, 0),
      NULLIF(input.elem->>'amount','')::numeric,
      input.elem->>'description',
      NULLIF(input.elem->>'document_number',''),
      NULLIF(input.elem->>'reference_number',''),
      NULLIF(input.elem->>'tracking_number',''),
      input.elem->>'source_type',
      COALESCE(NULLIF(input.elem->>'assignment_status',''),'unassigned'),
      input.elem->>'original_file_name',
      input.elem->>'imported_file_name',
      input.elem->>'imported_file_path',
      input.elem->'raw_data'
    FROM input
    ORDER BY input.ord
    ON CONFLICT DO NOTHING
    RETURNING
      finance_bank_transactions.id,
      finance_bank_transactions.bank_id,
      finance_bank_transactions.transaction_datetime,
      COALESCE(finance_bank_transactions.amount, 0::numeric)        AS k_amount,
      COALESCE(finance_bank_transactions.document_number, '')       AS k_doc,
      COALESCE(finance_bank_transactions.reference_number, '')      AS k_ref,
      COALESCE(finance_bank_transactions.tracking_number, '')       AS k_track
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
$function$;