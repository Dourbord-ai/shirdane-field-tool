
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
    'livestock','feed','medicine','sperm','manure','services','mixed'
  ];
  v_simple_products text[] := ARRAY[
    'livestock','feed','medicine','sperm','manure','services'
  ];
  v_is_mixed     boolean;
  v_is_buy       boolean;
  v_grp          record;
  v_party_side   text;
  v_party_code   text;
  v_party_label  text;
  v_product_label_fa text;
  -- NEW: party_id to stamp ONLY on AP/AR lines. NULL when factor has no
  -- finance_party_id (defensive — should not normally happen for approved
  -- factors, but we never want to crash the post on it).
  v_party_uuid   uuid;
BEGIN
  SELECT * INTO v_factor FROM public.factors WHERE id = p_factor_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'step', 'load_factor',
      'attempt_number', 0, 'voucher_id', NULL, 'posted_lines', 0,
      'message', 'فاکتور یافت نشد.');
  END IF;

  v_attempt := COALESCE(v_factor.posting_attempt_count, 0) + 1;
  v_idempo  := COALESCE(v_factor.idempotency_key, 'factor:' || p_factor_id::text);
  v_party_uuid := v_factor.finance_party_id;  -- may be NULL

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

  IF v_factor.factor_type_id NOT IN (1,2) THEN
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

  v_is_mixed := (v_factor.product_type = 'mixed');
  v_is_buy   := (v_factor.factor_type_id = 1);
  v_factor_type := CASE WHEN v_is_buy THEN 'buy_'  || v_factor.product_type
                        ELSE                'sell_' || v_factor.product_type END;

  v_product_label_fa := CASE v_factor.product_type
    WHEN 'livestock' THEN 'دام'
    WHEN 'feed'      THEN 'خوراک'
    WHEN 'medicine'  THEN 'دارو'
    WHEN 'sperm'     THEN 'اسپرم'
    WHEN 'manure'    THEN 'کود دامی'
    WHEN 'services'  THEN 'خدمات'
    WHEN 'mixed'     THEN 'ترکیبی'
    ELSE v_factor.product_type END;

  INSERT INTO public.finance_vouchers
    (voucher_type, source_operation_type, source_operation_id,
     voucher_date, title, description, status, sepidar_sync_status,
     idempotency_key, created_by)
  VALUES
    (v_factor_type, 'factor', p_factor_id,
     COALESCE(v_factor.invoice_date, now()),
     'سند ' || (CASE WHEN v_is_buy THEN 'خرید ' ELSE 'فروش ' END)
       || v_product_label_fa
       || ' شماره ' || COALESCE(v_factor.invoice_number, '-'),
     v_factor.description,
     'draft', 'pending',
     v_idempo, p_triggered_by)
  RETURNING id INTO v_voucher_id;

  -- ==========================================================================
  -- BRANCH A: simple product types
  -- ==========================================================================
  IF NOT v_is_mixed THEN
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
      DELETE FROM public.finance_vouchers WHERE id = v_voucher_id;
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
      DELETE FROM public.finance_vouchers WHERE id = v_voucher_id;
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
      -- party_id is stamped ONLY for AP/AR (counter-party) rows; inventory
      -- and revenue lines must stay NULL so the beneficiary statement does
      -- not double-count them and so Sepidar receives the line without a DL.
      INSERT INTO public.finance_voucher_items
        (voucher_id, row_number, account_type, debit, credit, description, party_id)
      VALUES
        (v_voucher_id, v_row_count, v_map_row.line_role::text,
         CASE WHEN v_map_row.side = 'DR' THEN v_amount ELSE 0 END,
         CASE WHEN v_map_row.side = 'CR' THEN v_amount ELSE 0 END,
         COALESCE(v_map_row.account_label, v_map_row.account_code),
         CASE WHEN v_map_row.line_role::text IN ('ap','ar')
              THEN v_party_uuid ELSE NULL END);

      IF v_map_row.side = 'DR' THEN v_total_debit := v_total_debit + v_amount;
      ELSE v_total_credit := v_total_credit + v_amount; END IF;
    END LOOP;
  ELSE
  -- ==========================================================================
  -- BRANCH B: MIXED
  -- ==========================================================================
    PERFORM 1 FROM public.factor_items fi
      WHERE fi.factor_id = p_factor_id
        AND (fi.product_type IS NULL
             OR NOT (fi.product_type = ANY (v_simple_products)));
    IF FOUND THEN
      DELETE FROM public.finance_vouchers WHERE id = v_voucher_id;
      PERFORM public._log_factor_posting_attempt(
        p_factor_id, v_attempt, 'resolve_map', false,
        'یکی از ردیف‌های فاکتور نوع محصول پشتیبانی‌نشده دارد.',
        NULL, NULL, v_idempo, '{}'::jsonb);
      UPDATE public.factors SET posting_attempt_count = v_attempt,
        last_posting_attempted_at = now(),
        last_posting_error = 'ردیف فاکتور با product_type نامعتبر.',
        lifecycle_state = 'voucher_failed' WHERE id = p_factor_id;
      RETURN jsonb_build_object('success', false, 'step', 'resolve_map',
        'attempt_number', v_attempt, 'voucher_id', NULL, 'posted_lines', 0,
        'message', 'یکی از ردیف‌های فاکتور نوع محصول پشتیبانی‌نشده دارد.');
    END IF;

    IF v_is_buy THEN
      v_party_side  := 'ap';
      v_party_code  := 'AP-DEFAULT';
      v_party_label := 'حساب پرداختنی';
    ELSE
      v_party_side  := 'ar';
      v_party_code  := 'AR-DEFAULT';
      v_party_label := 'حساب دریافتنی';
    END IF;

    FOR v_grp IN
      SELECT fi.product_type AS pt, SUM(COALESCE(fi.total_amount, 0)) AS amt
        FROM public.factor_items fi
       WHERE fi.factor_id = p_factor_id
       GROUP BY fi.product_type
       HAVING SUM(COALESCE(fi.total_amount, 0)) > 0
       ORDER BY fi.product_type
    LOOP
      SELECT * INTO v_map_row
        FROM public.factor_accounting_map
       WHERE factor_type = (CASE WHEN v_is_buy THEN 'buy_' ELSE 'sell_' END) || v_grp.pt
         AND product_type = v_grp.pt
         AND is_active = true
         AND side = (CASE WHEN v_is_buy THEN 'DR' ELSE 'CR' END)
         AND line_role::text = (CASE WHEN v_is_buy THEN 'inventory' ELSE 'revenue' END)
         AND (effective_from IS NULL OR effective_from <= now())
         AND (effective_to   IS NULL OR effective_to   >  now())
       ORDER BY priority ASC
       LIMIT 1;

      IF NOT FOUND OR v_map_row.account_code LIKE 'TBD-%' THEN
        DELETE FROM public.finance_voucher_items WHERE voucher_id = v_voucher_id;
        DELETE FROM public.finance_vouchers WHERE id = v_voucher_id;
        PERFORM public._log_factor_posting_attempt(
          p_factor_id, v_attempt, 'resolve_map', false,
          'نگاشت حسابداری برای یکی از ردیف‌های فاکتور ترکیبی موجود نیست.',
          NULL, NULL, v_idempo, jsonb_build_object('group_product_type', v_grp.pt));
        UPDATE public.factors SET posting_attempt_count = v_attempt,
          last_posting_attempted_at = now(),
          last_posting_error = 'نگاشت حسابداری برای ردیف فاکتور ترکیبی موجود نیست.',
          lifecycle_state = 'voucher_failed' WHERE id = p_factor_id;
        RETURN jsonb_build_object('success', false, 'step', 'resolve_map',
          'attempt_number', v_attempt, 'voucher_id', NULL, 'posted_lines', 0,
          'message', 'نگاشت حسابداری برای ردیف فاکتور ترکیبی موجود نیست.');
      END IF;

      v_row_count := v_row_count + 1;
      -- Inventory (buy) / Revenue (sell) line: NO party_id by design.
      INSERT INTO public.finance_voucher_items
        (voucher_id, row_number, account_type, debit, credit, description, party_id)
      VALUES
        (v_voucher_id, v_row_count, v_map_row.line_role::text,
         CASE WHEN v_is_buy THEN v_grp.amt ELSE 0 END,
         CASE WHEN v_is_buy THEN 0 ELSE v_grp.amt END,
         COALESCE(v_map_row.account_label, v_map_row.account_code),
         NULL);

      IF v_is_buy THEN v_total_debit := v_total_debit + v_grp.amt;
      ELSE             v_total_credit := v_total_credit + v_grp.amt; END IF;
    END LOOP;

    IF COALESCE(v_factor.payable_amount, 0) > 0 THEN
      v_row_count := v_row_count + 1;
      -- Consolidated AP/AR counter-party line: party_id IS stamped here.
      INSERT INTO public.finance_voucher_items
        (voucher_id, row_number, account_type, debit, credit, description, party_id)
      VALUES
        (v_voucher_id, v_row_count, v_party_side,
         CASE WHEN v_is_buy THEN 0 ELSE v_factor.payable_amount END,
         CASE WHEN v_is_buy THEN v_factor.payable_amount ELSE 0 END,
         v_party_label,
         v_party_uuid);
      IF v_is_buy THEN v_total_credit := v_total_credit + v_factor.payable_amount;
      ELSE             v_total_debit  := v_total_debit  + v_factor.payable_amount; END IF;
    END IF;
  END IF;

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
    jsonb_build_object('debit', v_total_debit, 'credit', v_total_credit, 'rows', v_row_count, 'mixed', v_is_mixed));

  RETURN jsonb_build_object('success', true, 'step', 'completed',
    'attempt_number', v_attempt, 'voucher_id', v_voucher_id,
    'posted_lines', v_row_count,
    'message', 'سند مالی با موفقیت ساخته شد.');
END;
$function$;
