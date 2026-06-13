-- Phase 7B: link-back & duplicate prevention between factor_related_costs and
-- finance_payment_request_items. Adds bidirectional reference columns + FKs
-- and updates the submit_payment_request RPC to write the back-reference
-- atomically inside the same transaction.

-- 1. New column on items: which related-cost row produced this item (if any).
ALTER TABLE public.finance_payment_request_items
  ADD COLUMN IF NOT EXISTS source_related_cost_id uuid;

-- FK with ON DELETE SET NULL — deleting a cost row should not cascade into
-- existing settlement items (audit trail), it just orphans the link.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fpri_source_related_cost_id_fkey'
  ) THEN
    ALTER TABLE public.finance_payment_request_items
      ADD CONSTRAINT fpri_source_related_cost_id_fkey
      FOREIGN KEY (source_related_cost_id)
      REFERENCES public.factor_related_costs(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_fpri_source_related_cost_id
  ON public.finance_payment_request_items(source_related_cost_id)
  WHERE source_related_cost_id IS NOT NULL;

-- 2. Add reciprocal FK on factor_related_costs.settlement_request_item_id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'frc_settlement_request_item_id_fkey'
  ) THEN
    ALTER TABLE public.factor_related_costs
      ADD CONSTRAINT frc_settlement_request_item_id_fkey
      FOREIGN KEY (settlement_request_item_id)
      REFERENCES public.finance_payment_request_items(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- 3. Update submit_payment_request RPC to write source_related_cost_id and
-- back-fill factor_related_costs.settlement_request_item_id in the same
-- transaction. Falls back gracefully when no item carries that field.
CREATE OR REPLACE FUNCTION public.submit_payment_request(p_request jsonb, p_items jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_request_id uuid;
  v_n int;
  v_total numeric := 0;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'حداقل یک ردیف برای درخواست پرداخت لازم است.';
  END IF;

  v_n := jsonb_array_length(p_items);
  IF v_n = 0 THEN
    RAISE EXCEPTION 'حداقل یک ردیف برای درخواست پرداخت لازم است.';
  END IF;

  PERFORM 1 FROM jsonb_array_elements(p_items) AS it
   WHERE COALESCE((it->>'amount')::numeric, 0) <= 0;
  IF FOUND THEN
    RAISE EXCEPTION 'مبلغ همه ردیف‌ها باید بزرگ‌تر از صفر باشد.';
  END IF;

  SELECT COALESCE(SUM((it->>'amount')::numeric), 0)
    INTO v_total
    FROM jsonb_array_elements(p_items) AS it;

  INSERT INTO public.finance_payment_requests (
    title, description, request_type, legacy_request_type_code,
    status, total_amount, total_paid_amount, remaining_amount
  ) VALUES (
    p_request->>'title',
    p_request->>'description',
    p_request->>'request_type',
    NULLIF(p_request->>'legacy_request_type_code','')::int,
    COALESCE(p_request->>'status','pending_approval'),
    v_total, 0, v_total
  )
  RETURNING id INTO v_request_id;

  -- Insert items with the new source_related_cost_id column and capture
  -- the (item_id, source_related_cost_id) pairs into a CTE so we can
  -- back-fill factor_related_costs in the very same statement.
  WITH inserted AS (
    INSERT INTO public.finance_payment_request_items (
      payment_request_id,
      party_id,
      amount,
      confirmed_amount,
      amount_type_code,
      amount_type,
      description,
      status,
      legacy_request_type_code,
      paid_amount,
      remaining_amount,
      payment_method,
      settlement_subject_type,
      due_date,
      execution_status,
      execution_priority,
      details,
      source_related_cost_id
    )
    SELECT
      v_request_id,
      NULLIF(it->>'party_id','')::uuid,
      (it->>'amount')::numeric,
      NULL,
      NULLIF(it->>'amount_type_code','')::int,
      it->>'amount_type',
      it->>'description',
      COALESCE(it->>'status','pending_approval'),
      NULLIF(p_request->>'legacy_request_type_code','')::int,
      0,
      (it->>'amount')::numeric,
      NULLIF(it->>'payment_method',''),
      NULLIF(it->>'settlement_subject_type',''),
      NULLIF(it->>'due_date','')::date,
      COALESCE(NULLIF(it->>'execution_status',''), 'pending'),
      COALESCE(NULLIF(it->>'execution_priority','')::smallint, 3::smallint),
      COALESCE(it->'details', '{}'::jsonb),
      NULLIF(it->>'source_related_cost_id','')::uuid
    FROM jsonb_array_elements(p_items) AS it
    RETURNING id, source_related_cost_id
  )
  -- Back-fill factor_related_costs.settlement_request_item_id. Guarded
  -- with `IS NULL` so we never overwrite a previous link (defensive
  -- duplicate-prevention at the DB layer in addition to the client filter).
  UPDATE public.factor_related_costs frc
     SET settlement_request_item_id = ins.id,
         updated_at = now()
    FROM inserted ins
   WHERE ins.source_related_cost_id IS NOT NULL
     AND frc.id = ins.source_related_cost_id
     AND frc.settlement_request_item_id IS NULL;

  IF (SELECT count(*) FROM public.finance_payment_request_items
       WHERE payment_request_id = v_request_id) <> v_n THEN
    RAISE EXCEPTION 'ثبت ردیف‌های درخواست پرداخت ناموفق بود.';
  END IF;

  RETURN v_request_id;
END;
$function$;