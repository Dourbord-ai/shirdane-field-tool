
-- 1) Add payment_status column on finance_payment_requests
ALTER TABLE public.finance_payment_requests
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'unpaid';

-- Backfill based on existing amounts
UPDATE public.finance_payment_requests
SET payment_status = CASE
  WHEN COALESCE(total_paid_amount,0) <= 0 THEN 'unpaid'
  WHEN COALESCE(total_paid_amount,0) + 0.000001 >= COALESCE(NULLIF(confirmed_amount,0), total_amount, 0)
       AND COALESCE(NULLIF(confirmed_amount,0), total_amount, 0) > 0 THEN 'full_payment'
  ELSE 'partial_payment'
END;

-- 2) Recalc + overpayment-guard trigger on finance_payment_allocations
CREATE OR REPLACE FUNCTION public.fn_finance_recalc_payment_request(p_request_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_paid numeric := 0;
  v_approved numeric := 0;
  v_status text;
  v_payment_status text;
  v_header_status text;
BEGIN
  -- Sum active (non-cancelled, non-deleted) allocations
  SELECT COALESCE(SUM(amount),0) INTO v_total_paid
  FROM public.finance_payment_allocations
  WHERE payment_request_id = p_request_id
    AND COALESCE(is_deleted,false) = false
    AND COALESCE(status,'') <> 'cancelled';

  SELECT COALESCE(NULLIF(confirmed_amount,0), total_amount, 0), status
    INTO v_approved, v_header_status
  FROM public.finance_payment_requests
  WHERE id = p_request_id;

  IF v_total_paid <= 0 THEN
    v_payment_status := 'unpaid';
  ELSIF v_approved > 0 AND v_total_paid + 0.000001 >= v_approved THEN
    v_payment_status := 'full_payment';
  ELSE
    v_payment_status := 'partial_payment';
  END IF;

  UPDATE public.finance_payment_requests
  SET total_paid_amount = v_total_paid,
      remaining_amount  = GREATEST(0, v_approved - v_total_paid),
      payment_status    = v_payment_status,
      updated_at        = now()
  WHERE id = p_request_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_finance_payment_allocations_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_already numeric := 0;
  v_approved numeric := 0;
  v_status text;
  v_new_amount numeric := 0;
  v_request_id uuid;
BEGIN
  -- Only enforce on active (non-cancelled, non-deleted) rows after INSERT/UPDATE
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  v_request_id := NEW.payment_request_id;

  IF COALESCE(NEW.is_deleted,false) = true OR COALESCE(NEW.status,'') = 'cancelled' THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(confirmed_amount,0), total_amount, 0), status
    INTO v_approved, v_status
  FROM public.finance_payment_requests
  WHERE id = v_request_id;

  IF v_status NOT IN ('approved','partially_paid','paid') THEN
    RAISE EXCEPTION 'فقط درخواست‌های تأیید شده قابل اتصال تراکنش پرداختی هستند.';
  END IF;

  SELECT COALESCE(SUM(amount),0) INTO v_already
  FROM public.finance_payment_allocations
  WHERE payment_request_id = v_request_id
    AND COALESCE(is_deleted,false) = false
    AND COALESCE(status,'') <> 'cancelled'
    AND id <> NEW.id;

  v_new_amount := COALESCE(NEW.amount,0);

  IF v_approved > 0 AND v_already + v_new_amount > v_approved + 0.000001 THEN
    RAISE EXCEPTION 'مبلغ پرداختی نمی‌تواند بیشتر از مبلغ درخواست تأیید شده باشد.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_finance_payment_allocations_recalc()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.fn_finance_recalc_payment_request(OLD.payment_request_id);
    RETURN OLD;
  END IF;
  PERFORM public.fn_finance_recalc_payment_request(NEW.payment_request_id);
  IF TG_OP = 'UPDATE' AND OLD.payment_request_id IS DISTINCT FROM NEW.payment_request_id THEN
    PERFORM public.fn_finance_recalc_payment_request(OLD.payment_request_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_finance_payment_allocations_guard ON public.finance_payment_allocations;
CREATE TRIGGER trg_finance_payment_allocations_guard
  BEFORE INSERT OR UPDATE ON public.finance_payment_allocations
  FOR EACH ROW EXECUTE FUNCTION public.fn_finance_payment_allocations_guard();

DROP TRIGGER IF EXISTS trg_finance_payment_allocations_recalc ON public.finance_payment_allocations;
CREATE TRIGGER trg_finance_payment_allocations_recalc
  AFTER INSERT OR UPDATE OR DELETE ON public.finance_payment_allocations
  FOR EACH ROW EXECUTE FUNCTION public.fn_finance_payment_allocations_recalc();
