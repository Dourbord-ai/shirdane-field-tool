
-- Atomic creation of a payment request + its items.
-- Wraps both inserts in a single transaction (function body) so that
-- a failure on the items insert rolls back the parent insert.
CREATE OR REPLACE FUNCTION public.submit_payment_request(
  p_request jsonb,
  p_items   jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  -- Per-row validation: amount > 0 and beneficiary present.
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

  INSERT INTO public.finance_payment_request_items (
    payment_request_id, party_id, amount, amount_type_code, amount_type,
    description, status, legacy_request_type_code,
    beneficiary_id, dl_ref, dl_code, beneficiary_name, beneficiary_type,
    beneficiary_balance_snapshot, beneficiary_snapshot_at
  )
  SELECT
    v_request_id,
    NULLIF(it->>'party_id','')::uuid,
    (it->>'amount')::numeric,
    NULLIF(it->>'amount_type_code','')::int,
    it->>'amount_type',
    it->>'description',
    COALESCE(it->>'status','pending_approval'),
    NULLIF(p_request->>'legacy_request_type_code','')::int,
    it->>'beneficiary_id',
    it->>'dl_ref',
    it->>'dl_code',
    it->>'beneficiary_name',
    it->>'beneficiary_type',
    NULLIF(it->>'beneficiary_balance_snapshot','')::numeric,
    CASE WHEN COALESCE(it->>'beneficiary_id','') <> '' THEN now() ELSE NULL END
  FROM jsonb_array_elements(p_items) AS it;

  -- Defensive post-condition: confirm rows landed.
  IF (SELECT count(*) FROM public.finance_payment_request_items
       WHERE payment_request_id = v_request_id) <> v_n THEN
    RAISE EXCEPTION 'ثبت ردیف‌های درخواست پرداخت ناموفق بود.';
  END IF;

  RETURN v_request_id;
END;
$$;
