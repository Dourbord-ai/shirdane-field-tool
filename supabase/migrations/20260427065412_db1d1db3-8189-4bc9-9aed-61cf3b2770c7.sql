-- Fix: existence_status (نوع فروش/تلفات/کشتار) should ONLY be required for SELL invoices.
-- For BUY invoices the cow is being added to the herd, so the field is irrelevant
-- and must not block submission. NULLs are coerced to 1 (sale/in-herd) on insert.

CREATE OR REPLACE FUNCTION public.submit_cow_factor(
  p_factor jsonb,
  p_details jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_factor_id uuid;
  v_cow_ids bigint[];
  v_weights numeric[];
  v_unit_prices numeric[];
  v_row_prices numeric[];
  v_existence_statuses smallint[];
  v_descriptions text[];
  v_n int;
  v_i int;
  v_total numeric := 0;
  v_off_percent numeric := 0;
  v_delivery_percent numeric := 0;
  v_vat_percent numeric := 0;
  v_off_price numeric := 0;
  v_delivery_cost numeric := 0;
  v_vat_amount numeric := 0;
  v_payable numeric := 0;
  v_factor_type_id smallint;
  v_payload jsonb;
BEGIN
  v_cow_ids            := ARRAY(SELECT jsonb_array_elements_text(p_details->'CowIds')::bigint);
  v_weights            := ARRAY(SELECT jsonb_array_elements_text(p_details->'Weights')::numeric);
  v_unit_prices        := ARRAY(SELECT jsonb_array_elements_text(p_details->'UnitPrices')::numeric);
  v_row_prices         := ARRAY(SELECT jsonb_array_elements_text(p_details->'RowPrices')::numeric);
  v_existence_statuses := ARRAY(SELECT jsonb_array_elements_text(p_details->'ExistenceStatuses')::smallint);
  v_descriptions       := ARRAY(SELECT jsonb_array_elements_text(p_details->'Descriptions'));

  v_n := COALESCE(array_length(v_cow_ids, 1), 0);

  v_factor_type_id := COALESCE((p_factor->>'FactorTypeId')::smallint, 0);

  IF v_n = 0 THEN
    RETURN jsonb_build_object('id', NULL, 'success', false, 'message', 'حداقل یک ردیف دام باید وارد شود.');
  END IF;

  IF array_length(v_weights,1) <> v_n
    OR array_length(v_unit_prices,1) <> v_n
    OR array_length(v_row_prices,1) <> v_n
    OR array_length(v_existence_statuses,1) <> v_n
    OR array_length(v_descriptions,1) <> v_n THEN
    RETURN jsonb_build_object('id', NULL, 'success', false, 'message', 'طول آرایه‌های ردیف‌ها برابر نیست.');
  END IF;

  IF (SELECT count(DISTINCT x) FROM unnest(v_cow_ids) x) <> v_n THEN
    RETURN jsonb_build_object('id', NULL, 'success', false, 'message', 'شماره دام تکراری در ردیف‌ها یافت شد.');
  END IF;

  FOR v_i IN 1..v_n LOOP
    IF v_cow_ids[v_i] IS NULL OR v_cow_ids[v_i] <= 0 THEN
      RETURN jsonb_build_object('id', NULL, 'success', false, 'message', format('ردیف %s: شماره دام نامعتبر است.', v_i));
    END IF;
    IF v_weights[v_i] IS NULL OR v_weights[v_i] <= 0 THEN
      RETURN jsonb_build_object('id', NULL, 'success', false, 'message', format('ردیف %s: وزن باید بزرگ‌تر از صفر باشد.', v_i));
    END IF;
    IF v_unit_prices[v_i] IS NULL OR v_unit_prices[v_i] <= 0 THEN
      RETURN jsonb_build_object('id', NULL, 'success', false, 'message', format('ردیف %s: قیمت واحد باید بزرگ‌تر از صفر باشد.', v_i));
    END IF;
    -- existence_status only required for SELL invoices (FactorTypeId = 2).
    -- For BUY invoices (FactorTypeId = 1) we accept NULL and default to 1 below.
    IF v_factor_type_id = 2 AND v_existence_statuses[v_i] IS NULL THEN
      RETURN jsonb_build_object('id', NULL, 'success', false, 'message', format('ردیف %s: نوع (فروش/تلفات/کشتار) انتخاب نشده است.', v_i));
    END IF;
  END LOOP;

  IF v_factor_type_id = 1 THEN
    IF EXISTS (
      SELECT 1 FROM public.cows
      WHERE id = ANY(v_cow_ids) AND COALESCE(existancestatus, 0) = 1
    ) THEN
      RETURN jsonb_build_object('id', NULL, 'success', false,
        'message', 'برخی از دام‌ها در حال حاضر در گله موجود هستند و قابل ثبت به عنوان خرید نیستند.');
    END IF;
  ELSIF v_factor_type_id = 2 THEN
    IF (SELECT count(*) FROM public.cows WHERE id = ANY(v_cow_ids) AND COALESCE(existancestatus, 0) = 1) <> v_n THEN
      RETURN jsonb_build_object('id', NULL, 'success', false,
        'message', 'برخی از دام‌ها در گله موجود نیستند و قابل فروش/خروج نیستند.');
    END IF;
  END IF;

  v_total          := COALESCE((p_factor->>'TotalPrice')::numeric, 0);
  v_off_price      := COALESCE((p_factor->>'OffPrice')::numeric, 0);
  v_delivery_cost  := COALESCE((p_factor->>'DeliveryCost')::numeric, 0);
  v_vat_amount     := COALESCE((p_factor->>'Vat')::numeric, 0);
  v_vat_percent    := COALESCE((p_factor->>'VatPercent')::numeric, 0);
  v_payable        := COALESCE((p_factor->>'PayablePrice')::numeric, 0);

  IF v_total > 0 THEN
    v_off_percent      := round((v_off_price / v_total) * 100, 4);
    v_delivery_percent := round((v_delivery_cost / v_total) * 100, 4);
  END IF;

  INSERT INTO public.factors (
    product_type, invoice_type, invoice_date, invoice_number,
    total_amount, payable_amount, tax_amount, discount, shipping,
    settlement_type, image, sync_status,
    factor_type_id, product_type_id, off_percent, delivery_percent,
    vat_percent, checkout_type_id, seller_buyer_type,
    shopping_center_id, buyer_user_id,
    other_center_name, other_center_phone, other_center_address, other_center_description
  ) VALUES (
    'livestock',
    CASE WHEN v_factor_type_id = 1 THEN 'buy' WHEN v_factor_type_id = 2 THEN 'sell' ELSE 'buy' END,
    p_factor->>'FactorDate',
    p_factor->>'FactorNumber',
    v_total, v_payable, v_vat_amount, v_off_price, v_delivery_cost,
    p_factor->>'CheckoutTypeName',
    p_factor->>'Image',
    'pending',
    v_factor_type_id,
    NULLIF((p_factor->>'ProductTypeId'),'')::smallint,
    v_off_percent, v_delivery_percent, v_vat_percent,
    NULLIF((p_factor->>'CkeckoutTypeId'),'')::smallint,
    NULLIF((p_factor->>'SellerBuyerTypes'),'')::smallint,
    NULLIF((p_factor->>'ShoppingCenterId'),'')::bigint,
    NULLIF((p_factor->>'BuyerUserId'),'')::bigint,
    p_factor->>'OtherCenterName',
    p_factor->>'OtherCenterPhoneNumber',
    p_factor->>'OtherCenterAddress',
    p_factor->>'OtherCenterDescription'
  )
  RETURNING id INTO v_factor_id;

  FOR v_i IN 1..v_n LOOP
    INSERT INTO public.cow_factor_details (
      factor_id, cow_id, weight, unit_price, row_price,
      existence_status, description,
      off_unit_price, delivery_cost, vat, payable_unit_price
    ) VALUES (
      v_factor_id,
      v_cow_ids[v_i],
      v_weights[v_i],
      v_unit_prices[v_i],
      v_row_prices[v_i],
      -- For BUY invoices, default missing existence_status to 1 (in-herd / sale).
      COALESCE(v_existence_statuses[v_i], 1),
      v_descriptions[v_i],
      round(v_unit_prices[v_i] * v_off_percent / 100, 2),
      round(v_row_prices[v_i] * v_delivery_percent / 100, 2),
      round(v_row_prices[v_i] * v_vat_percent / 100, 2),
      round(
        v_unit_prices[v_i]
        - (v_unit_prices[v_i] * v_off_percent / 100)
        + (v_unit_prices[v_i] * v_vat_percent / 100)
        + CASE WHEN v_weights[v_i] > 0 THEN (v_row_prices[v_i] * v_delivery_percent / 100) / v_weights[v_i] ELSE 0 END
      , 2)
    );
  END LOOP;

  v_payload := jsonb_build_object(
    'Factor', p_factor || jsonb_build_object('SupabaseFactorId', v_factor_id),
    'CowFactorDetail', p_details
  );

  INSERT INTO public.sync_queue (entity_type, entity_id, payload, status)
  VALUES ('cow_factor', v_factor_id, v_payload, 'pending');

  RETURN jsonb_build_object(
    'id', v_factor_id,
    'success', true,
    'message', 'فاکتور با موفقیت ثبت شد.'
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'id', NULL,
    'success', false,
    'message', 'خطای پایگاه داده: ' || SQLERRM
  );
END;
$$;