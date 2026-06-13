CREATE OR REPLACE FUNCTION public.fn_finance_recalc_payment_request(p_request_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_total_paid numeric := 0;
  v_approved numeric := 0;
  v_payment_status text;
BEGIN
  SELECT COALESCE(SUM(amount),0) INTO v_total_paid
  FROM public.finance_payment_allocations
  WHERE payment_request_id = p_request_id
    AND COALESCE(is_deleted,false) = false
    AND COALESCE(status,'') <> 'cancelled';

  v_approved := public.fn_finance_request_approved_payable(p_request_id);

  IF v_approved <= 0 THEN
    -- No approved payable items: nothing left to pay, so it should not
    -- show up under the "unpaid" filter. Force totals to zero and mark
    -- the request as fully paid (effectively "not payable").
    v_total_paid := 0;
    v_payment_status := 'full_payment';
  ELSIF v_total_paid <= 0 THEN
    v_payment_status := 'unpaid';
  ELSIF v_total_paid + 0.000001 >= v_approved THEN
    v_payment_status := 'full_payment';
  ELSE
    v_payment_status := 'partial_payment';
  END IF;

  UPDATE public.finance_payment_requests
  SET total_paid_amount = v_total_paid,
      confirmed_amount  = v_approved,
      remaining_amount  = GREATEST(0, v_approved - v_total_paid),
      payment_status    = v_payment_status,
      updated_at        = now()
  WHERE id = p_request_id;
END;
$function$;

-- Backfill all existing requests with the corrected logic so that
-- approved requests whose items were all rejected no longer linger
-- in the "unpaid" payment filter.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.finance_payment_requests LOOP
    PERFORM public.fn_finance_recalc_payment_request(r.id);
  END LOOP;
END $$;