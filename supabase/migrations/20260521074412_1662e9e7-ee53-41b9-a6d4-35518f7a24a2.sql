
-- Per-item recalc: paid + remaining + (approved-family) status promotion.
CREATE OR REPLACE FUNCTION public.fn_finance_recalc_payment_request_item(p_item_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_amount numeric := 0;
  v_paid numeric := 0;
  v_status text;
  v_next text;
BEGIN
  SELECT COALESCE(NULLIF(confirmed_amount,0), amount, 0), status
    INTO v_amount, v_status
  FROM public.finance_payment_request_items
  WHERE id = p_item_id;

  SELECT COALESCE(SUM(amount),0) INTO v_paid
  FROM public.finance_payment_allocations
  WHERE payment_request_item_id = p_item_id
    AND COALESCE(is_deleted,false) = false
    AND COALESCE(status,'') <> 'cancelled';

  -- Only progress approved-family items; never overwrite rejected/cancelled.
  IF v_status IN ('approved','partially_paid','paid','sync_failed') THEN
    IF v_paid <= 0 THEN
      v_next := 'approved';
    ELSIF v_amount > 0 AND v_paid + 0.000001 >= v_amount THEN
      v_next := 'paid';
    ELSE
      v_next := 'partially_paid';
    END IF;
  ELSE
    v_next := v_status;
  END IF;

  UPDATE public.finance_payment_request_items
  SET paid_amount      = v_paid,
      remaining_amount = GREATEST(0, v_amount - v_paid),
      status           = v_next,
      updated_at       = now()
  WHERE id = p_item_id;
END;
$$;

-- Strengthen the allocation guard: enforce item-level approval + item cap.
CREATE OR REPLACE FUNCTION public.fn_finance_payment_allocations_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request_status text;
  v_item_status text;
  v_item_amount numeric := 0;
  v_item_paid numeric := 0;
  v_request_approved numeric := 0;
  v_request_already numeric := 0;
  v_new_amount numeric := 0;
BEGIN
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;

  -- Skip guards for soft-cancelled rows.
  IF COALESCE(NEW.is_deleted,false) = true OR COALESCE(NEW.status,'') = 'cancelled' THEN
    RETURN NEW;
  END IF;

  -- Parent request must be approved-family.
  SELECT status INTO v_request_status
  FROM public.finance_payment_requests WHERE id = NEW.payment_request_id;
  IF v_request_status NOT IN ('approved','partially_paid','paid') THEN
    RAISE EXCEPTION 'فقط درخواست‌های تأیید شده قابل اتصال تراکنش پرداختی هستند.';
  END IF;

  -- Target item must exist, must belong to the same request, and be approved-family.
  IF NEW.payment_request_item_id IS NULL THEN
    RAISE EXCEPTION 'آیتم درخواست پرداخت مشخص نشده است.';
  END IF;
  SELECT status, COALESCE(NULLIF(confirmed_amount,0), amount, 0)
    INTO v_item_status, v_item_amount
  FROM public.finance_payment_request_items
  WHERE id = NEW.payment_request_item_id
    AND payment_request_id = NEW.payment_request_id
    AND COALESCE(is_deleted,false) = false;
  IF v_item_status IS NULL THEN
    RAISE EXCEPTION 'آیتم انتخاب‌شده برای این درخواست معتبر نیست.';
  END IF;
  IF v_item_status NOT IN ('approved','partially_paid','paid','sync_failed') THEN
    RAISE EXCEPTION 'فقط آیتم‌های تأیید شده قابل پرداخت هستند.';
  END IF;

  v_new_amount := COALESCE(NEW.amount,0);
  IF v_new_amount <= 0 THEN
    RAISE EXCEPTION 'مبلغ تخصیص باید بزرگ‌تر از صفر باشد.';
  END IF;

  -- Item-level cap: sum of active allocations for this item (excluding the
  -- current row when updating) plus the new amount must not exceed the
  -- approved item amount.
  SELECT COALESCE(SUM(amount),0) INTO v_item_paid
  FROM public.finance_payment_allocations
  WHERE payment_request_item_id = NEW.payment_request_item_id
    AND COALESCE(is_deleted,false) = false
    AND COALESCE(status,'') <> 'cancelled'
    AND id <> NEW.id;

  IF v_item_amount > 0 AND v_item_paid + v_new_amount > v_item_amount + 0.000001 THEN
    RAISE EXCEPTION 'مبلغ پرداختی نمی‌تواند بیشتر از مبلغ آیتم تأیید شده باشد.';
  END IF;

  -- Request-level cap: sum across the entire request cannot exceed the
  -- approved payable total (sum of approved items, kept in confirmed_amount).
  v_request_approved := public.fn_finance_request_approved_payable(NEW.payment_request_id);
  IF v_request_approved <= 0 THEN
    RAISE EXCEPTION 'هیچ آیتم تأیید شده‌ای برای این درخواست وجود ندارد.';
  END IF;
  SELECT COALESCE(SUM(amount),0) INTO v_request_already
  FROM public.finance_payment_allocations
  WHERE payment_request_id = NEW.payment_request_id
    AND COALESCE(is_deleted,false) = false
    AND COALESCE(status,'') <> 'cancelled'
    AND id <> NEW.id;
  IF v_request_already + v_new_amount > v_request_approved + 0.000001 THEN
    RAISE EXCEPTION 'مبلغ پرداختی نمی‌تواند بیشتر از مبلغ آیتم‌های تأیید شده باشد.';
  END IF;

  RETURN NEW;
END;
$$;

-- After allocations change, recalc the targeted item first, then the parent.
CREATE OR REPLACE FUNCTION public.fn_finance_payment_allocations_recalc()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.payment_request_item_id IS NOT NULL THEN
      PERFORM public.fn_finance_recalc_payment_request_item(OLD.payment_request_item_id);
    END IF;
    PERFORM public.fn_finance_recalc_payment_request(OLD.payment_request_id);
    RETURN OLD;
  END IF;

  IF NEW.payment_request_item_id IS NOT NULL THEN
    PERFORM public.fn_finance_recalc_payment_request_item(NEW.payment_request_item_id);
  END IF;
  PERFORM public.fn_finance_recalc_payment_request(NEW.payment_request_id);

  IF TG_OP = 'UPDATE' THEN
    IF OLD.payment_request_item_id IS DISTINCT FROM NEW.payment_request_item_id
       AND OLD.payment_request_item_id IS NOT NULL THEN
      PERFORM public.fn_finance_recalc_payment_request_item(OLD.payment_request_item_id);
    END IF;
    IF OLD.payment_request_id IS DISTINCT FROM NEW.payment_request_id THEN
      PERFORM public.fn_finance_recalc_payment_request(OLD.payment_request_id);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Backfill: recompute paid/remaining for every existing item, then parents.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.finance_payment_request_items LOOP
    PERFORM public.fn_finance_recalc_payment_request_item(r.id);
  END LOOP;
  FOR r IN SELECT id FROM public.finance_payment_requests LOOP
    PERFORM public.fn_finance_recalc_payment_request(r.id);
  END LOOP;
END $$;
