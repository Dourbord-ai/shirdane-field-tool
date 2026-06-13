-- ============================================================================
-- جدول audit مستقل برای ثبت تغییرات مبلغ آیتم درخواست تسویه
-- این جدول append-only است: هیچ UPDATE/DELETE مجاز نیست
-- ============================================================================
CREATE TABLE public.finance_payment_item_amount_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL,
  request_id uuid NOT NULL,
  old_amount numeric,
  old_confirmed_amount numeric,
  new_amount numeric NOT NULL,
  paid_amount_at_change numeric NOT NULL,
  changed_by uuid,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ایندکس‌های جستجوی متداول
CREATE INDEX idx_fpiaa_item ON public.finance_payment_item_amount_audit(item_id, created_at DESC);
CREATE INDEX idx_fpiaa_request ON public.finance_payment_item_amount_audit(request_id, created_at DESC);

-- GRANT الزامی — بدون این، PostgREST پاسخ permission denied می‌دهد
GRANT SELECT, INSERT ON public.finance_payment_item_amount_audit TO authenticated;
GRANT ALL ON public.finance_payment_item_amount_audit TO service_role;

-- فعال‌سازی RLS
ALTER TABLE public.finance_payment_item_amount_audit ENABLE ROW LEVEL SECURITY;

-- خواندن: تمام کاربران احراز هویت شده (مطابق سیاست فعلی سایر جداول مالی)
CREATE POLICY "auth can read item amount audit"
  ON public.finance_payment_item_amount_audit
  FOR SELECT TO authenticated USING (true);

-- درج: تمام کاربران احراز هویت شده (RPC با SECURITY DEFINER هم اجرا می‌شود)
CREATE POLICY "auth can insert item amount audit"
  ON public.finance_payment_item_amount_audit
  FOR INSERT TO authenticated WITH CHECK (true);

-- بدون UPDATE / DELETE — جدول immutable است


-- ============================================================================
-- RPC: ویرایش امن مبلغ آیتم درخواست تسویه
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_finance_update_payment_request_item_amount(
  p_item_id uuid,
  p_new_amount numeric,
  p_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_request_id uuid;
  v_item_status text;
  v_request_status text;
  v_old_amount numeric;
  v_old_confirmed numeric;
  v_paid numeric := 0;
  v_user uuid := auth.uid();
  v_new_item record;
  v_new_request record;
BEGIN
  -- 1) اعتبارسنجی پایه مبلغ
  IF p_new_amount IS NULL OR p_new_amount <= 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT: مبلغ جدید باید عددی مثبت باشد.'
      USING ERRCODE = '22023';
  END IF;

  -- 2) قفل آیتم برای جلوگیری از race condition
  SELECT payment_request_id, status, amount, confirmed_amount
    INTO v_request_id, v_item_status, v_old_amount, v_old_confirmed
  FROM public.finance_payment_request_items
  WHERE id = p_item_id AND COALESCE(is_deleted,false) = false
  FOR UPDATE;

  IF v_request_id IS NULL THEN
    RAISE EXCEPTION 'ITEM_NOT_FOUND: آیتم درخواست یافت نشد.'
      USING ERRCODE = 'P0002';
  END IF;

  -- 3) قفل سند درخواست و بررسی وضعیت سند
  SELECT status INTO v_request_status
  FROM public.finance_payment_requests
  WHERE id = v_request_id
  FOR UPDATE;

  IF v_request_status IN ('cancelled','rejected','closed') THEN
    RAISE EXCEPTION 'REQUEST_LOCKED: درخواست در وضعیت % قابل ویرایش نیست.', v_request_status
      USING ERRCODE = '22023';
  END IF;

  -- 4) محاسبه paid_amount واقعی از allocations فعال (منبع حقیقت)
  SELECT COALESCE(SUM(amount),0) INTO v_paid
  FROM public.finance_payment_allocations
  WHERE payment_request_item_id = p_item_id
    AND COALESCE(is_deleted,false) = false
    AND COALESCE(status,'') <> 'cancelled';

  -- 5) بررسی وضعیت‌های مجاز
  -- وضعیت‌های مجاز عمومی: approved, partially_paid, sync_failed
  -- paid فقط برای افزایش مبلغ (بازگشت به partially_paid)
  IF v_item_status NOT IN ('approved','partially_paid','sync_failed','paid') THEN
    RAISE EXCEPTION 'ITEM_STATUS_LOCKED: ویرایش مبلغ در وضعیت % مجاز نیست.', v_item_status
      USING ERRCODE = '22023';
  END IF;

  IF v_item_status = 'paid' AND p_new_amount <= v_paid + 0.000001 THEN
    RAISE EXCEPTION 'PAID_REQUIRES_INCREASE: برای آیتم پرداخت‌شده، مبلغ جدید باید از مبلغ پرداخت‌شده (%) بیشتر باشد.', v_paid
      USING ERRCODE = '22023';
  END IF;

  -- 6) قاعده اصلی مالی: new_amount نباید کمتر از paid_amount باشد
  IF p_new_amount + 0.000001 < v_paid THEN
    RAISE EXCEPTION 'AMOUNT_LT_PAID: مبلغ درخواستی نمی‌تواند کمتر از مبلغ پرداخت‌شده (%) باشد.', v_paid
      USING ERRCODE = '22023';
  END IF;

  -- 7) آپدیت هر دو ستون amount و confirmed_amount
  -- تابع recalc از COALESCE(NULLIF(confirmed_amount,0), amount, 0) استفاده می‌کند
  -- بنابراین باید هر دو همگام بمانند
  UPDATE public.finance_payment_request_items
  SET amount = p_new_amount,
      confirmed_amount = p_new_amount,
      updated_at = now()
  WHERE id = p_item_id;

  -- 8) بازمحاسبه آیتم — paid_amount/remaining_amount/status را به‌روز می‌کند
  PERFORM public.fn_finance_recalc_payment_request_item(p_item_id);

  -- 9) بازمحاسبه کل درخواست — payment_status سند را به‌روز می‌کند
  PERFORM public.fn_finance_recalc_payment_request(v_request_id);

  -- 10) ثبت audit (immutable)
  INSERT INTO public.finance_payment_item_amount_audit(
    item_id, request_id, old_amount, old_confirmed_amount,
    new_amount, paid_amount_at_change, changed_by, reason
  ) VALUES (
    p_item_id, v_request_id, v_old_amount, v_old_confirmed,
    p_new_amount, v_paid, v_user, p_reason
  );

  -- 11) برگرداندن وضعیت نهایی برای UI
  SELECT amount, confirmed_amount, paid_amount, remaining_amount, status
    INTO v_new_item
  FROM public.finance_payment_request_items WHERE id = p_item_id;

  SELECT total_paid_amount, remaining_amount, payment_status, confirmed_amount
    INTO v_new_request
  FROM public.finance_payment_requests WHERE id = v_request_id;

  RETURN jsonb_build_object(
    'item', jsonb_build_object(
      'id', p_item_id,
      'amount', v_new_item.amount,
      'confirmed_amount', v_new_item.confirmed_amount,
      'paid_amount', v_new_item.paid_amount,
      'remaining_amount', v_new_item.remaining_amount,
      'status', v_new_item.status
    ),
    'request', jsonb_build_object(
      'id', v_request_id,
      'total_paid_amount', v_new_request.total_paid_amount,
      'remaining_amount', v_new_request.remaining_amount,
      'payment_status', v_new_request.payment_status,
      'confirmed_amount', v_new_request.confirmed_amount
    )
  );
END;
$function$;

-- GRANT EXECUTE به کاربران احراز هویت شده
GRANT EXECUTE ON FUNCTION public.fn_finance_update_payment_request_item_amount(uuid, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_finance_update_payment_request_item_amount(uuid, numeric, text) TO service_role;