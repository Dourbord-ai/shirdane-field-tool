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
  v_current_status text;
  v_next_status text;
BEGIN
  -- Recompute payment totals from active allocations only.
  SELECT COALESCE(SUM(amount),0) INTO v_total_paid
  FROM public.finance_payment_allocations
  WHERE payment_request_id = p_request_id
    AND COALESCE(is_deleted,false) = false
    AND COALESCE(status,'') <> 'cancelled';

  v_approved := public.fn_finance_request_approved_payable(p_request_id);

  IF v_approved <= 0 THEN
    v_total_paid := 0;
    v_payment_status := 'full_payment';
  ELSIF v_total_paid <= 0 THEN
    v_payment_status := 'unpaid';
  ELSIF v_total_paid + 0.000001 >= v_approved THEN
    v_payment_status := 'full_payment';
  ELSE
    v_payment_status := 'partial_payment';
  END IF;

  -- Lifecycle/approval status healing:
  -- The header `status` column is intended to hold ONLY lifecycle values
  -- (draft / pending_approval / approved / rejected / cancelled). Older rows
  -- (and a few legacy code paths) wrote payment-bucket values ('paid' /
  -- 'partially_paid') into it. After any allocation/voucher rollback the
  -- request is no longer paid, so any stale legacy value must be healed back
  -- to 'approved' (items remain approved). Terminal lifecycle values
  -- (cancelled/rejected) and proper pre-approval values are preserved.
  SELECT status INTO v_current_status
  FROM public.finance_payment_requests
  WHERE id = p_request_id;

  IF v_current_status IN ('paid', 'partially_paid') THEN
    v_next_status := 'approved';
  ELSE
    v_next_status := v_current_status;
  END IF;

  UPDATE public.finance_payment_requests
  SET total_paid_amount = v_total_paid,
      confirmed_amount  = v_approved,
      remaining_amount  = GREATEST(0, v_approved - v_total_paid),
      payment_status    = v_payment_status,
      status            = v_next_status,
      updated_at        = now()
  WHERE id = p_request_id;
END;
$function$;

-- Backfill: heal any historical rows that are currently sitting on the
-- legacy payment-bucket values. They should be 'approved' because their items
-- are still in approved-family states (the recalc itself does not gate on
-- this — the next allocation event would otherwise leave them stuck).
UPDATE public.finance_payment_requests
SET status = 'approved',
    updated_at = now()
WHERE status IN ('paid', 'partially_paid')
  AND COALESCE(is_deleted, false) = false;