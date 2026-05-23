-- Finance integrity hardening: single-use bank transactions and strict payable caps.

-- A bank transaction can have at most one active payment allocation.
DROP INDEX IF EXISTS public.uq_finance_payment_alloc_active_bank_tx;
CREATE UNIQUE INDEX IF NOT EXISTS uq_finance_payment_alloc_active_bank_tx
ON public.finance_payment_allocations (bank_transaction_id)
WHERE bank_transaction_id IS NOT NULL
  AND COALESCE(is_deleted, false) = false
  AND COALESCE(status, '') NOT IN ('cancelled', 'rejected');

-- A bank transaction can have at most one active receive identification.
DROP INDEX IF EXISTS public.uq_finance_receive_id_active_bank_tx;
CREATE UNIQUE INDEX IF NOT EXISTS uq_finance_receive_id_active_bank_tx
ON public.finance_receive_identifications (bank_transaction_id)
WHERE bank_transaction_id IS NOT NULL
  AND COALESCE(is_deleted, false) = false
  AND COALESCE(status, '') NOT IN ('cancelled', 'rejected');

-- Guard payment allocations with row locks and cross-workflow transaction reuse checks.
CREATE OR REPLACE FUNCTION public.fn_finance_payment_allocations_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request_status text;
  v_item_status text;
  v_item_payable numeric := 0;
  v_item_already_paid numeric := 0;
  v_request_approved numeric := 0;
  v_request_already_paid numeric := 0;
  v_new_amount numeric := 0;
  v_tx_type text;
  v_tx_assignment_status text;
  v_tx_amount numeric := 0;
  v_duplicate_allocation_id uuid;
  v_duplicate_identification_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  -- Cancelled/deleted allocations do not reserve a bank transaction.
  IF COALESCE(NEW.is_deleted, false) = true OR COALESCE(NEW.status, '') IN ('cancelled', 'rejected') THEN
    RETURN NEW;
  END IF;

  v_new_amount := COALESCE(NEW.amount, 0);
  IF v_new_amount <= 0 THEN
    RAISE EXCEPTION 'مبلغ تخصیص باید بزرگ‌تر از صفر باشد.';
  END IF;

  IF NEW.bank_transaction_id IS NULL THEN
    RAISE EXCEPTION 'تراکنش بانکی مشخص نشده است.';
  END IF;

  -- Lock the bank transaction first so concurrent users cannot reserve the same transaction.
  SELECT transaction_type,
         assignment_status,
         COALESCE(withdraw_amount, deposit_amount, amount, 0)
    INTO v_tx_type, v_tx_assignment_status, v_tx_amount
  FROM public.finance_bank_transactions
  WHERE id = NEW.bank_transaction_id
    AND COALESCE(is_deleted, false) = false
  FOR UPDATE;

  IF v_tx_type IS NULL THEN
    RAISE EXCEPTION 'تراکنش بانکی یافت نشد.';
  END IF;
  IF v_tx_type <> 'withdraw' THEN
    RAISE EXCEPTION 'فقط تراکنش برداشت قابل اتصال است.';
  END IF;
  IF v_tx_assignment_status IS NOT NULL
     AND v_tx_assignment_status NOT IN ('unassigned', 'rejected')
     AND NOT (TG_OP = 'UPDATE' AND NEW.id = OLD.id) THEN
    RAISE EXCEPTION 'این تراکنش قبلاً استفاده شده است.';
  END IF;
  IF v_new_amount > v_tx_amount + 0.000001 THEN
    RAISE EXCEPTION 'مبلغ تخصیص از مبلغ تراکنش بانکی بیشتر است.';
  END IF;

  -- Cross-workflow duplicate prevention: allocation vs allocation.
  SELECT id INTO v_duplicate_allocation_id
  FROM public.finance_payment_allocations
  WHERE bank_transaction_id = NEW.bank_transaction_id
    AND COALESCE(is_deleted, false) = false
    AND COALESCE(status, '') NOT IN ('cancelled', 'rejected')
    AND id <> NEW.id
  LIMIT 1;
  IF v_duplicate_allocation_id IS NOT NULL THEN
    RAISE EXCEPTION 'این تراکنش قبلاً استفاده شده است.';
  END IF;

  -- Cross-workflow duplicate prevention: receive identification vs allocation.
  SELECT id INTO v_duplicate_identification_id
  FROM public.finance_receive_identifications
  WHERE bank_transaction_id = NEW.bank_transaction_id
    AND COALESCE(is_deleted, false) = false
    AND COALESCE(status, '') NOT IN ('cancelled', 'rejected')
  LIMIT 1;
  IF v_duplicate_identification_id IS NOT NULL THEN
    RAISE EXCEPTION 'این تراکنش قبلاً استفاده شده است.';
  END IF;

  -- Lock the parent request to prevent concurrent overpayment against the same request.
  SELECT status INTO v_request_status
  FROM public.finance_payment_requests
  WHERE id = NEW.payment_request_id
  FOR UPDATE;
  IF v_request_status IS NULL THEN
    RAISE EXCEPTION 'درخواست پرداخت یافت نشد.';
  END IF;
  IF v_request_status NOT IN ('approved', 'partially_paid', 'paid') THEN
    RAISE EXCEPTION 'فقط درخواست‌های تأیید شده قابل اتصال تراکنش پرداختی هستند.';
  END IF;

  IF NEW.payment_request_item_id IS NULL THEN
    RAISE EXCEPTION 'آیتم درخواست پرداخت مشخص نشده است.';
  END IF;

  -- Lock the item to prevent concurrent overpayment against the same item.
  SELECT status,
         COALESCE(NULLIF(confirmed_amount, 0), amount, 0)
    INTO v_item_status, v_item_payable
  FROM public.finance_payment_request_items
  WHERE id = NEW.payment_request_item_id
    AND payment_request_id = NEW.payment_request_id
    AND COALESCE(is_deleted, false) = false
  FOR UPDATE;

  IF v_item_status IS NULL THEN
    RAISE EXCEPTION 'آیتم انتخاب‌شده برای این درخواست معتبر نیست.';
  END IF;
  IF v_item_status NOT IN ('approved', 'partially_paid', 'paid', 'sync_failed') THEN
    RAISE EXCEPTION 'فقط آیتم‌های تأیید شده قابل پرداخت هستند.';
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_item_already_paid
  FROM public.finance_payment_allocations
  WHERE payment_request_item_id = NEW.payment_request_item_id
    AND COALESCE(is_deleted, false) = false
    AND COALESCE(status, '') NOT IN ('cancelled', 'rejected')
    AND id <> NEW.id;

  IF v_item_already_paid + v_new_amount > v_item_payable + 0.000001 THEN
    RAISE EXCEPTION 'مبلغ تراکنش از مانده قابل پرداخت این درخواست بیشتر است.';
  END IF;

  v_request_approved := public.fn_finance_request_approved_payable(NEW.payment_request_id);
  IF v_request_approved <= 0 THEN
    RAISE EXCEPTION 'هیچ آیتم تأیید شده‌ای برای این درخواست وجود ندارد.';
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_request_already_paid
  FROM public.finance_payment_allocations
  WHERE payment_request_id = NEW.payment_request_id
    AND COALESCE(is_deleted, false) = false
    AND COALESCE(status, '') NOT IN ('cancelled', 'rejected')
    AND id <> NEW.id;

  IF v_request_already_paid + v_new_amount > v_request_approved + 0.000001 THEN
    RAISE EXCEPTION 'مبلغ تراکنش از مانده قابل پرداخت این درخواست بیشتر است.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_finance_payment_allocations_guard ON public.finance_payment_allocations;
CREATE TRIGGER trg_finance_payment_allocations_guard
BEFORE INSERT OR UPDATE ON public.finance_payment_allocations
FOR EACH ROW
EXECUTE FUNCTION public.fn_finance_payment_allocations_guard();

-- Guard receive identifications with row locks and cross-workflow transaction reuse checks.
CREATE OR REPLACE FUNCTION public.fn_finance_receive_identifications_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tx_type text;
  v_tx_assignment_status text;
  v_tx_amount numeric := 0;
  v_new_amount numeric := 0;
  v_duplicate_allocation_id uuid;
  v_duplicate_identification_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  -- Cancelled/deleted/rejected identifications do not reserve a bank transaction.
  IF COALESCE(NEW.is_deleted, false) = true OR COALESCE(NEW.status, '') IN ('cancelled', 'rejected') THEN
    RETURN NEW;
  END IF;

  IF NEW.bank_transaction_id IS NULL THEN
    RAISE EXCEPTION 'تراکنش بانکی مشخص نشده است.';
  END IF;

  v_new_amount := COALESCE(NEW.amount, 0);
  IF v_new_amount <= 0 THEN
    RAISE EXCEPTION 'مبلغ واریز معتبر نیست.';
  END IF;

  -- Lock the bank transaction first so concurrent users cannot reserve the same transaction.
  SELECT transaction_type,
         assignment_status,
         COALESCE(deposit_amount, withdraw_amount, amount, 0)
    INTO v_tx_type, v_tx_assignment_status, v_tx_amount
  FROM public.finance_bank_transactions
  WHERE id = NEW.bank_transaction_id
    AND COALESCE(is_deleted, false) = false
  FOR UPDATE;

  IF v_tx_type IS NULL THEN
    RAISE EXCEPTION 'تراکنش بانکی یافت نشد.';
  END IF;
  IF v_tx_type <> 'deposit' THEN
    RAISE EXCEPTION 'فقط تراکنش واریز قابل شناسایی است.';
  END IF;
  IF v_tx_assignment_status IS NOT NULL
     AND v_tx_assignment_status NOT IN ('unassigned', 'rejected')
     AND NOT (TG_OP = 'UPDATE' AND NEW.id = OLD.id) THEN
    RAISE EXCEPTION 'این تراکنش قبلاً استفاده شده است.';
  END IF;
  IF v_new_amount > v_tx_amount + 0.000001 THEN
    RAISE EXCEPTION 'مبلغ شناسایی از مبلغ تراکنش بانکی بیشتر است.';
  END IF;

  -- Cross-workflow duplicate prevention: receive identification vs receive identification.
  SELECT id INTO v_duplicate_identification_id
  FROM public.finance_receive_identifications
  WHERE bank_transaction_id = NEW.bank_transaction_id
    AND COALESCE(is_deleted, false) = false
    AND COALESCE(status, '') NOT IN ('cancelled', 'rejected')
    AND id <> NEW.id
  LIMIT 1;
  IF v_duplicate_identification_id IS NOT NULL THEN
    RAISE EXCEPTION 'این تراکنش قبلاً استفاده شده است.';
  END IF;

  -- Cross-workflow duplicate prevention: allocation vs receive identification.
  SELECT id INTO v_duplicate_allocation_id
  FROM public.finance_payment_allocations
  WHERE bank_transaction_id = NEW.bank_transaction_id
    AND COALESCE(is_deleted, false) = false
    AND COALESCE(status, '') NOT IN ('cancelled', 'rejected')
  LIMIT 1;
  IF v_duplicate_allocation_id IS NOT NULL THEN
    RAISE EXCEPTION 'این تراکنش قبلاً استفاده شده است.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_finance_receive_identifications_guard ON public.finance_receive_identifications;
CREATE TRIGGER trg_finance_receive_identifications_guard
BEFORE INSERT OR UPDATE ON public.finance_receive_identifications
FOR EACH ROW
EXECUTE FUNCTION public.fn_finance_receive_identifications_guard();