
-- Helper: compute approved payable amount from items
CREATE OR REPLACE FUNCTION public.fn_finance_request_approved_payable(p_request_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(COALESCE(NULLIF(confirmed_amount,0), amount, 0)), 0)
  FROM public.finance_payment_request_items
  WHERE payment_request_id = p_request_id
    AND COALESCE(is_deleted, false) = false
    AND status IN ('approved', 'partially_paid', 'paid', 'sync_failed');
$$;

-- Rewrite recalc to use approved items
CREATE OR REPLACE FUNCTION public.fn_finance_recalc_payment_request(p_request_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
    v_payment_status := 'unpaid';
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
$$;

-- Rewrite guard to use approved-items total instead of confirmed_amount/total_amount fallback
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
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  v_request_id := NEW.payment_request_id;

  IF COALESCE(NEW.is_deleted,false) = true OR COALESCE(NEW.status,'') = 'cancelled' THEN
    RETURN NEW;
  END IF;

  SELECT status INTO v_status FROM public.finance_payment_requests WHERE id = v_request_id;
  IF v_status NOT IN ('approved','partially_paid','paid') THEN
    RAISE EXCEPTION 'فقط درخواست‌های تأیید شده قابل اتصال تراکنش پرداختی هستند.';
  END IF;

  v_approved := public.fn_finance_request_approved_payable(v_request_id);
  IF v_approved <= 0 THEN
    RAISE EXCEPTION 'هیچ آیتم تأیید شده‌ای برای این درخواست وجود ندارد.';
  END IF;

  SELECT COALESCE(SUM(amount),0) INTO v_already
  FROM public.finance_payment_allocations
  WHERE payment_request_id = v_request_id
    AND COALESCE(is_deleted,false) = false
    AND COALESCE(status,'') <> 'cancelled'
    AND id <> NEW.id;

  v_new_amount := COALESCE(NEW.amount,0);

  IF v_already + v_new_amount > v_approved + 0.000001 THEN
    RAISE EXCEPTION 'مبلغ پرداختی نمی‌تواند بیشتر از مبلغ آیتم‌های تأیید شده باشد.';
  END IF;

  RETURN NEW;
END;
$$;

-- Trigger on items: recalc parent request whenever item status/amount/deletion changes
CREATE OR REPLACE FUNCTION public.fn_finance_payment_items_recalc()
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

DROP TRIGGER IF EXISTS trg_finance_payment_items_recalc ON public.finance_payment_request_items;
CREATE TRIGGER trg_finance_payment_items_recalc
AFTER INSERT OR UPDATE OF status, amount, confirmed_amount, is_deleted OR DELETE
ON public.finance_payment_request_items
FOR EACH ROW EXECUTE FUNCTION public.fn_finance_payment_items_recalc();

-- Ensure allocations triggers still bound (recreate to be safe)
DROP TRIGGER IF EXISTS trg_finance_payment_allocations_guard ON public.finance_payment_allocations;
CREATE TRIGGER trg_finance_payment_allocations_guard
BEFORE INSERT OR UPDATE ON public.finance_payment_allocations
FOR EACH ROW EXECUTE FUNCTION public.fn_finance_payment_allocations_guard();

DROP TRIGGER IF EXISTS trg_finance_payment_allocations_recalc ON public.finance_payment_allocations;
CREATE TRIGGER trg_finance_payment_allocations_recalc
AFTER INSERT OR UPDATE OR DELETE ON public.finance_payment_allocations
FOR EACH ROW EXECUTE FUNCTION public.fn_finance_payment_allocations_recalc();

-- Backfill all existing requests
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.finance_payment_requests LOOP
    PERFORM public.fn_finance_recalc_payment_request(r.id);
  END LOOP;
END $$;
