
-- ---- Helper: write one audit row to the existing factor_posting_attempts ----
-- The existing table schema is:
--   id, factor_id, voucher_id, idempotency_key, request_payload (jsonb),
--   response_payload (jsonb), success, error_code, duration_ms, created_at
-- We map our step/message/raw_error/attempt_number/context into request_payload
-- and response_payload so we don't need to alter the existing table.
CREATE OR REPLACE FUNCTION public._log_factor_posting_attempt(
  p_factor_id        uuid,
  p_attempt_number   integer,
  p_step             text,
  p_success          boolean,
  p_message          text,
  p_raw_error        text   DEFAULT NULL,
  p_voucher_id       uuid   DEFAULT NULL,
  p_idempotency_key  text   DEFAULT NULL,
  p_context          jsonb  DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  -- We pack the new MVP fields (step, message, attempt_number, raw_error,
  -- context) inside the existing jsonb columns. `error_code` reuses the
  -- existing column to carry our `step` value for fast filtering in SQL.
  INSERT INTO public.factor_posting_attempts
    (factor_id, voucher_id, idempotency_key,
     request_payload, response_payload,
     success, error_code, duration_ms)
  VALUES
    (p_factor_id, p_voucher_id, p_idempotency_key,
     jsonb_build_object(
       'attempt_number', p_attempt_number,
       'step', p_step,
       'context', COALESCE(p_context, '{}'::jsonb)
     ),
     jsonb_build_object(
       'message', p_message,
       'raw_error', p_raw_error
     ),
     p_success, p_step, NULL)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- ---- Main RPC: post_approved_factor ----------------------------------------
CREATE OR REPLACE FUNCTION public.post_approved_factor(
  p_factor_id    uuid,
  p_triggered_by uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
BEGIN
  -- Step 0: load and lock factor row to serialize concurrent posting attempts.
  SELECT * INTO v_factor FROM public.factors WHERE id = p_factor_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'step', 'load_factor',
      'attempt_number', 0, 'voucher_id', NULL, 'posted_lines', 0,
      'message', 'فاکتور یافت نشد.');
  END IF;

  v_attempt := COALESCE(v_factor.posting_attempt_count, 0) + 1;
  v_idempo  := COALESCE(v_factor.idempotency_key, 'factor:' || p_factor_id::text);

  -- Already posted (idempotent retry → succeed silently with existing voucher).
  IF v_factor.voucher_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'step', 'already_posted',
      'attempt_number', v_attempt, 'voucher_id', v_factor.voucher_id,
      'posted_lines', 0,
      'message', 'این فاکتور قبلاً سند مالی دارد.');
  END IF;

  -- Pre-check: must be in an approvable/retryable lifecycle state.
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

  -- Classify: MVP supports livestock only.
  IF COALESCE(v_factor.product_type, '') <> 'livestock' THEN
    PERFORM public._log_factor_posting_attempt(
      p_factor_id, v_attempt, 'classify', false,
      'موتور ثبت سند فعلاً فقط برای فاکتورهای دام پشتیبانی می‌شود.',
      NULL, NULL, v_idempo,
      jsonb_build_object('product_type', v_factor.product_type));
    UPDATE public.factors SET posting_attempt_count = v_attempt,
      last_posting_attempted_at = now(),
      last_posting_error = 'product_type پشتیبانی نمی‌شود.' WHERE id = p_factor_id;
    RETURN jsonb_build_object('success', false, 'step', 'classify',
      'attempt_number', v_attempt, 'voucher_id', NULL, 'posted_lines', 0,
      'message', 'موتور ثبت سند فعلاً فقط برای فاکتورهای دام پشتیبانی می‌شود.');
  END IF;

  v_factor_type := CASE v_factor.factor_type_id
    WHEN 1 THEN 'buy_livestock'
    WHEN 2 THEN 'sell_livestock'
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

  -- Resolve mapping rows (active + within effective range).
  SELECT COUNT(*),
         COUNT(*) FILTER (WHERE account_code LIKE 'TBD-%')
    INTO v_map_count, v_tbd_count
  FROM public.factor_accounting_map
  WHERE factor_type = v_factor_type
    AND product_type = 'livestock'
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
      'برخی کدهای حساب هنوز placeholder هستند (TBD-). تا جایگزینی کد واقعی، ثبت سند مالی متوقف است.',
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

  -- Build voucher header.
  INSERT INTO public.finance_vouchers
    (voucher_type, source_operation_type, source_operation_id,
     voucher_date, title, description, status, sepidar_sync_status,
     idempotency_key, created_by)
  VALUES
    (v_factor_type, 'factor', p_factor_id,
     COALESCE(v_factor.invoice_date, now()),
     'سند ' || (CASE v_factor_type WHEN 'buy_livestock' THEN 'خرید دام' ELSE 'فروش دام' END)
       || ' شماره ' || COALESCE(v_factor.invoice_number, '-'),
     v_factor.description,
     'draft', 'pending',
     v_idempo, p_triggered_by)
  RETURNING id INTO v_voucher_id;

  -- Build one item per active map row using a simple role → amount table.
  FOR v_map_row IN
    SELECT * FROM public.factor_accounting_map
    WHERE factor_type = v_factor_type
      AND product_type = 'livestock'
      AND is_active = true
      AND (effective_from IS NULL OR effective_from <= now())
      AND (effective_to   IS NULL OR effective_to   >  now())
    ORDER BY priority ASC, line_role::text ASC, side ASC
  LOOP
    v_amount := CASE v_map_row.line_role::text
      WHEN 'inventory' THEN COALESCE(v_factor.total_amount, 0)
      WHEN 'ap'        THEN COALESCE(v_factor.payable_amount, 0)
      WHEN 'ar'        THEN COALESCE(v_factor.payable_amount, 0)
      WHEN 'revenue'   THEN COALESCE(v_factor.total_amount, 0) - COALESCE(v_factor.tax_amount, 0)
      WHEN 'tax'       THEN COALESCE(v_factor.tax_amount, 0)
      WHEN 'discount'  THEN COALESCE(v_factor.discount, 0)
      WHEN 'freight'   THEN COALESCE(v_factor.shipping, 0)
      WHEN 'cogs'      THEN 0   -- TODO post-MVP: needs cow cost basis
      WHEN 'rounding'  THEN 0   -- balancing plug (engine populates later)
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
      'هیچ ردیف قابل ثبتی برای این فاکتور تولید نشد (همه مبالغ صفر بودند).',
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
      'بدهکار و بستانکار سند برابر نیست. بدهکار=' || v_total_debit::text
        || ' بستانکار=' || v_total_credit::text,
      NULL, NULL, v_idempo,
      jsonb_build_object('debit', v_total_debit, 'credit', v_total_credit));
    UPDATE public.factors SET posting_attempt_count = v_attempt,
      last_posting_attempted_at = now(),
      last_posting_error = 'عدم توازن بدهکار/بستانکار.',
      lifecycle_state = 'voucher_failed' WHERE id = p_factor_id;
    RETURN jsonb_build_object('success', false, 'step', 'balance_check',
      'attempt_number', v_attempt, 'voucher_id', NULL, 'posted_lines', v_row_count,
      'message', 'بدهکار و بستانکار سند برابر نیست. ثبت متوقف شد.');
  END IF;

  -- Persist linkage + advance lifecycle.
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
    'سند مالی با موفقیت ایجاد شد. ' || v_row_count::text || ' ردیف. در انتظار ثبت در سپیدار.',
    NULL, v_voucher_id, v_idempo,
    jsonb_build_object('debit', v_total_debit, 'credit', v_total_credit, 'rows', v_row_count));

  RETURN jsonb_build_object('success', true, 'step', 'completed',
    'attempt_number', v_attempt, 'voucher_id', v_voucher_id,
    'posted_lines', v_row_count,
    'message', 'سند مالی با موفقیت ساخته شد.');
END;
$$;

COMMENT ON FUNCTION public.post_approved_factor(uuid, uuid) IS
  'M3r-MVP: build finance_voucher + items for an approved factor using factor_accounting_map. Refuses TBD- placeholders. Returns jsonb result.';

GRANT EXECUTE ON FUNCTION public.post_approved_factor(uuid, uuid) TO authenticated, service_role;
