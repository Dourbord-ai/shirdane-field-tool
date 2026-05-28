
ALTER TABLE public.factor_accounting_map
  DROP CONSTRAINT IF EXISTS factor_accounting_map_factor_type_chk;
ALTER TABLE public.factor_accounting_map
  DROP CONSTRAINT IF EXISTS factor_accounting_map_product_type_chk;

ALTER TABLE public.factor_accounting_map
  ADD CONSTRAINT factor_accounting_map_factor_type_chk
  CHECK (factor_type = ANY (ARRAY[
    'buy_livestock','sell_livestock',
    'buy_feed','sell_feed',
    'buy_medicine','sell_medicine',
    'buy_sperm','sell_sperm',
    'buy_manure','sell_manure',
    'buy_services','sell_services'
  ]));

ALTER TABLE public.factor_accounting_map
  ADD CONSTRAINT factor_accounting_map_product_type_chk
  CHECK (product_type = ANY (ARRAY[
    'livestock','feed','medicine','sperm','manure','services'
  ]));

INSERT INTO public.factor_accounting_map
  (factor_type, product_type, line_role, side, account_code, account_label, is_active, priority)
SELECT v.factor_type, v.product_type, v.line_role::line_role, v.side,
       v.account_code, v.account_label, true, 100
FROM (VALUES
  ('buy_feed','feed','inventory','DR','INV-FEED','موجودی خوراک'),
  ('buy_feed','feed','ap','CR','AP-DEFAULT','حساب پرداختنی'),
  ('sell_feed','feed','ar','DR','AR-DEFAULT','حساب دریافتنی'),
  ('sell_feed','feed','revenue','CR','REV-FEED','فروش خوراک'),
  ('buy_medicine','medicine','inventory','DR','INV-MEDICINE','موجودی دارو'),
  ('buy_medicine','medicine','ap','CR','AP-DEFAULT','حساب پرداختنی'),
  ('sell_medicine','medicine','ar','DR','AR-DEFAULT','حساب دریافتنی'),
  ('sell_medicine','medicine','revenue','CR','REV-MEDICINE','فروش دارو'),
  ('buy_sperm','sperm','inventory','DR','INV-SPERM','موجودی اسپرم'),
  ('buy_sperm','sperm','ap','CR','AP-DEFAULT','حساب پرداختنی'),
  ('sell_sperm','sperm','ar','DR','AR-DEFAULT','حساب دریافتنی'),
  ('sell_sperm','sperm','revenue','CR','REV-SPERM','فروش اسپرم'),
  ('buy_manure','manure','inventory','DR','INV-MANURE','موجودی کود دامی'),
  ('buy_manure','manure','ap','CR','AP-DEFAULT','حساب پرداختنی'),
  ('sell_manure','manure','ar','DR','AR-DEFAULT','حساب دریافتنی'),
  ('sell_manure','manure','revenue','CR','REV-MANURE','فروش کود دامی'),
  ('buy_services','services','inventory','DR','EXP-SERVICES','هزینه خدمات'),
  ('buy_services','services','ap','CR','AP-DEFAULT','حساب پرداختنی'),
  ('sell_services','services','ar','DR','AR-DEFAULT','حساب دریافتنی'),
  ('sell_services','services','revenue','CR','REV-SERVICES','درآمد خدمات')
) AS v(factor_type, product_type, line_role, side, account_code, account_label)
WHERE NOT EXISTS (
  SELECT 1 FROM public.factor_accounting_map m
  WHERE m.factor_type = v.factor_type
    AND m.product_type = v.product_type
    AND m.line_role::text = v.line_role
    AND m.side = v.side
);

CREATE OR REPLACE FUNCTION public.post_approved_factor(p_factor_id uuid, p_triggered_by uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_factor       public.factors%ROWTYPE;
  v_factor_type  text;
  v_attempt      integer;
  v_voucher_id   uuid;
  v_map_count    integer;
  v_tbd_count    integer;
  v_total_debit  numeric := 0;
  v_total_credit numeric := 0;
  v_row_count    integer := 0;
  v_idempo       text;
  v_map_row      record;
  v_amount       numeric;
  v_supported_products text[] := ARRAY[
    'livestock','feed','medicine','sperm','manure','services'
  ];
  v_product_label_fa text;
BEGIN
  SELECT * INTO v_factor FROM public.factors WHERE id = p_factor_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'step', 'load_factor',
      'attempt_number', 0, 'voucher_id', NULL, 'posted_lines', 0,
      'message', 'فاکتور یافت نشد.');
  END IF;

  v_attempt := COALESCE(v_factor.posting_attempt_count, 0) + 1;
  v_idempo  := COALESCE(v_factor.idempotency_key, 'factor:' || p_factor_id::text);

  IF v_factor.voucher_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'step', 'already_posted',
      'attempt_number', v_attempt, 'voucher_id', v_factor.voucher_id,
      'posted_lines', 0,
      'message', 'این فاکتور قبلاً سند مالی دارد.');
  END IF;

  IF COALESCE(v_factor.lifecycle_state, '') NOT IN ('approved','voucher_failed','sepidar_failed') THEN
    PERFORM public._log_factor_posting_attempt(
      p_factor_id, v_attempt, 'precheck', false,
      'فاکتور در وضعیت قابل ثبت نیست. ابتدا فاکتور را تأیید کنید.',
      NULL, NULL, v_idempo,
      jsonb_build_object('lifecycle_state', v_factor.lifecycle_state));
    UPDATE public.factors
       SET posting_attempt_count = v_attempt,
           last_posting_attempted_at = now(),
           last_posting_error = 'فاکتور در وضعیت قابل ثبت نیست.'
     WHERE id = p_factor_id;
    RETURN jsonb_build_object('success', false, 'step', 'precheck',
      'attempt_number', v_attempt, 'voucher_id', NULL, 'posted_lines', 0,
      'message', 'فاکتور در وضعیت قابل ثبت نیست. ابتدا فاکتور را تأیید کنید.');
  END IF;

  IF NOT (COALESCE(v_factor.product_type, '') = ANY (v_supported_products)) THEN
    PERFORM public._log_factor_posting_attempt(
      p_factor_id, v_attempt, 'classify', false,
      'این نوع فاکتور هنوز توسط موتور ثبت سند پشتیبانی نمی‌شود.',
      NULL, NULL, v_idempo,
      jsonb_build_object('product_type', v_factor.product_type));
    UPDATE public.factors SET posting_attempt_count = v_attempt,
      last_posting_attempted_at = now(),
      last_posting_error = 'product_type پشتیبانی نمی‌شود.' WHERE id = p_factor_id;
    RETURN jsonb_build_object('success', false, 'step', 'classify',
      'attempt_number', v_attempt, 'voucher_id', NULL, 'posted_lines', 0,
      'message', 'این نوع فاکتور هنوز توسط موتور ثبت سند پشتیبانی نمی‌شود.');
  END IF;

  v_factor_type := CASE v_factor.factor_type_id
    WHEN 1 THEN 'buy_'  || v_factor.product_type
    WHEN 2 THEN 'sell_' || v_factor.product_type
    ELSE NULL END;
  IF v_factor_type IS NULL THEN
    PERFORM public._log_factor_posting_attempt(
      p_factor_id, v_attempt, 'classify', false,
      'نوع فاکتور (خرید/فروش) مشخص نیست.',
      NULL, NULL, v_idempo,
      jsonb_build_object('factor_type_id', v_factor.factor_type_id));
    UPDATE public.factors SET posting_attempt_count = v_attempt,
      last_posting_attempted_at = now(),
      last_posting_error = 'factor_type_id نامعتبر است.' WHERE id = p_factor_id;
    RETURN jsonb_build_object('success', false, 'step', 'classify',
      'attempt_number', v_attempt, 'voucher_id', NULL, 'posted_lines', 0,
      'message', 'نوع فاکتور (خرید/فروش) مشخص نیست.');
  END IF;

  SELECT COUNT(*),
         COUNT(*) FILTER (WHERE account_code LIKE 'TBD-%')
    INTO v_map_count, v_tbd_count
  FROM public.factor_accounting_map
  WHERE factor_type = v_factor_type
    AND product_type = v_factor.product_type
    AND is_active = true
    AND (effective_from IS NULL OR effective_from <= now())
    AND (effective_to   IS NULL OR effective_to   >  now());

  IF v_map_count = 0 THEN
    PERFORM public._log_factor_posting_attempt(
      p_factor_id, v_attempt, 'resolve_map', false,
      'هیچ نگاشت حسابداری فعالی برای این نوع فاکتور تعریف نشده است.',
      NULL, NULL, v_idempo, jsonb_build_object('factor_type', v_factor_type));
    UPDATE public.factors SET posting_attempt_count = v_attempt,
      last_posting_attempted_at = now(),
      last_posting_error = 'نگاشت حسابداری فعال موجود نیست.',
      lifecycle_state = 'voucher_failed'
     WHERE id = p_factor_id;
    RETURN jsonb_build_object('success', false, 'step', 'resolve_map',
      'attempt_number', v_attempt, 'voucher_id', NULL, 'posted_lines', 0,
      'message', 'هیچ نگاشت حسابداری فعالی برای این نوع فاکتور تعریف نشده است.');
  END IF;

  IF v_tbd_count > 0 THEN
    PERFORM public._log_factor_posting_attempt(
      p_factor_id, v_attempt, 'resolve_map', false,
      'برخی کدهای حساب هنوز placeholder هستند (TBD-).',
      NULL, NULL, v_idempo, jsonb_build_object('tbd_count', v_tbd_count));
    UPDATE public.factors SET posting_attempt_count = v_attempt,
      last_posting_attempted_at = now(),
      last_posting_error = 'کدهای حساب TBD- هنوز جایگزین نشده‌اند.',
      lifecycle_state = 'voucher_failed'
     WHERE id = p_factor_id;
    RETURN jsonb_build_object('success', false, 'step', 'resolve_map',
      'attempt_number', v_attempt, 'voucher_id', NULL, 'posted_lines', 0,
      'message', 'کدهای حساب TBD- هنوز با کدهای واقعی سپیدار جایگزین نشده‌اند.');
  END IF;

  v_product_label_fa := CASE v_factor.product_type
    WHEN 'livestock' THEN 'دام'
    WHEN 'feed'      THEN 'خوراک'
    WHEN 'medicine'  THEN 'دارو'
    WHEN 'sperm'     THEN 'اسپرم'
    WHEN 'manure'    THEN 'کود دامی'
    WHEN 'services'  THEN 'خدمات'
    ELSE v_factor.product_type END;

  INSERT INTO public.finance_vouchers
    (voucher_type, source_operation_type, source_operation_id,
     voucher_date, title, description, status, sepidar_sync_status,
     idempotency_key, created_by)
  VALUES
    (v_factor_type, 'factor', p_factor_id,
     COALESCE(v_factor.invoice_date, now()),
     'سند ' || (CASE v_factor.factor_type_id WHEN 1 THEN 'خرید ' ELSE 'فروش ' END)
       || v_product_label_fa
       || ' شماره ' || COALESCE(v_factor.invoice_number, '-'),
     v_factor.description,
     'draft', 'pending',
     v_idempo, p_triggered_by)
  RETURNING id INTO v_voucher_id;

  FOR v_map_row IN
    SELECT * FROM public.factor_accounting_map
    WHERE factor_type = v_factor_type
      AND product_type = v_factor.product_type
      AND is_active = true
      AND (effective_from IS NULL OR effective_from <= now())
      AND (effective_to   IS NULL OR effective_to   >  now())
    ORDER BY priority ASC, line_role::text ASC, side ASC
  LOOP
    v_amount := CASE v_map_row.line_role::text
      WHEN 'inventory' THEN COALESCE(v_factor.payable_amount, 0)
      WHEN 'ap'        THEN COALESCE(v_factor.payable_amount, 0)
      WHEN 'ar'        THEN COALESCE(v_factor.payable_amount, 0)
      WHEN 'revenue'   THEN COALESCE(v_factor.payable_amount, 0)
      ELSE 0 END;

    IF v_amount <= 0 THEN CONTINUE; END IF;

    v_row_count := v_row_count + 1;
    INSERT INTO public.finance_voucher_items
      (voucher_id, row_number, account_type, debit, credit, description)
    VALUES
      (v_voucher_id, v_row_count, v_map_row.line_role::text,
       CASE WHEN v_map_row.side = 'DR' THEN v_amount ELSE 0 END,
       CASE WHEN v_map_row.side = 'CR' THEN v_amount ELSE 0 END,
       COALESCE(v_map_row.account_label, v_map_row.account_code));

    IF v_map_row.side = 'DR' THEN v_total_debit := v_total_debit + v_amount;
    ELSE v_total_credit := v_total_credit + v_amount; END IF;
  END LOOP;

  IF v_row_count = 0 THEN
    DELETE FROM public.finance_voucher_items WHERE voucher_id = v_voucher_id;
    DELETE FROM public.finance_vouchers WHERE id = v_voucher_id;
    PERFORM public._log_factor_posting_attempt(
      p_factor_id, v_attempt, 'build_voucher', false,
      'هیچ ردیف قابل ثبتی برای این فاکتور تولید نشد.',
      NULL, NULL, v_idempo, '{}'::jsonb);
    UPDATE public.factors SET posting_attempt_count = v_attempt,
      last_posting_attempted_at = now(),
      last_posting_error = 'ردیف‌های سند صفر بودند.',
      lifecycle_state = 'voucher_failed' WHERE id = p_factor_id;
    RETURN jsonb_build_object('success', false, 'step', 'build_voucher',
      'attempt_number', v_attempt, 'voucher_id', NULL, 'posted_lines', 0,
      'message', 'هیچ ردیف قابل ثبتی برای این فاکتور تولید نشد.');
  END IF;

  IF ABS(v_total_debit - v_total_credit) > 0.01 THEN
    DELETE FROM public.finance_voucher_items WHERE voucher_id = v_voucher_id;
    DELETE FROM public.finance_vouchers WHERE id = v_voucher_id;
    PERFORM public._log_factor_posting_attempt(
      p_factor_id, v_attempt, 'balance_check', false,
      'بدهکار و بستانکار سند برابر نیست.',
      NULL, NULL, v_idempo,
      jsonb_build_object('debit', v_total_debit, 'credit', v_total_credit));
    UPDATE public.factors SET posting_attempt_count = v_attempt,
      last_posting_attempted_at = now(),
      last_posting_error = 'عدم توازن بدهکار/بستانکار.',
      lifecycle_state = 'voucher_failed' WHERE id = p_factor_id;
    RETURN jsonb_build_object('success', false, 'step', 'balance_check',
      'attempt_number', v_attempt, 'voucher_id', NULL, 'posted_lines', v_row_count,
      'message', 'بدهکار و بستانکار سند برابر نیست.');
  END IF;

  UPDATE public.factors
     SET voucher_id = v_voucher_id,
         lifecycle_state = 'voucher_created',
         posting_attempt_count = v_attempt,
         last_posting_attempted_at = now(),
         last_posting_error = NULL,
         idempotency_key = v_idempo
   WHERE id = p_factor_id;

  PERFORM public._log_factor_posting_attempt(
    p_factor_id, v_attempt, 'completed', true,
    'سند مالی با موفقیت ایجاد شد.',
    NULL, v_voucher_id, v_idempo,
    jsonb_build_object('debit', v_total_debit, 'credit', v_total_credit, 'rows', v_row_count));

  RETURN jsonb_build_object('success', true, 'step', 'completed',
    'attempt_number', v_attempt, 'voucher_id', v_voucher_id,
    'posted_lines', v_row_count,
    'message', 'سند مالی با موفقیت ساخته شد.');
END;
$function$;
