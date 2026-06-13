
CREATE OR REPLACE FUNCTION public.fn_finance_payment_allocations_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- Row-lock the parent request to prevent two concurrent allocations
  -- from each individually fitting under the cap but jointly exceeding it.
  SELECT status INTO v_request_status
  FROM public.finance_payment_requests
  WHERE id = NEW.payment_request_id
  FOR UPDATE;
  IF v_request_status NOT IN ('approved','partially_paid','paid') THEN
    RAISE EXCEPTION 'فقط درخواست‌های تأیید شده قابل اتصال تراکنش پرداختی هستند.';
  END IF;

  IF NEW.payment_request_item_id IS NULL THEN
    RAISE EXCEPTION 'آیتم درخواست پرداخت مشخص نشده است.';
  END IF;

  -- Row-lock the item too for the same race-condition reason.
  SELECT status, COALESCE(NULLIF(confirmed_amount,0), amount, 0)
    INTO v_item_status, v_item_amount
  FROM public.finance_payment_request_items
  WHERE id = NEW.payment_request_item_id
    AND payment_request_id = NEW.payment_request_id
    AND COALESCE(is_deleted,false) = false
  FOR UPDATE;
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

  -- Item-level cap (sum of active allocations for this item, excluding
  -- the current row on UPDATE).
  SELECT COALESCE(SUM(amount),0) INTO v_item_paid
  FROM public.finance_payment_allocations
  WHERE payment_request_item_id = NEW.payment_request_item_id
    AND COALESCE(is_deleted,false) = false
    AND COALESCE(status,'') <> 'cancelled'
    AND id <> NEW.id;

  IF v_item_amount > 0 AND v_item_paid + v_new_amount > v_item_amount + 0.000001 THEN
    RAISE EXCEPTION 'مبلغ تراکنش از مانده قابل پرداخت این درخواست بیشتر است.';
  END IF;

  -- Request-level cap.
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
    RAISE EXCEPTION 'مبلغ تراکنش از مانده قابل پرداخت این درخواست بیشتر است.';
  END IF;

  RETURN NEW;
END;
$function$;
