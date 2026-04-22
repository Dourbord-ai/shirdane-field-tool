-- ============================================================
-- 1) Extend factors with legacy/business columns
-- ============================================================
ALTER TABLE public.factors
  ADD COLUMN IF NOT EXISTS sync_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS image text,
  ADD COLUMN IF NOT EXISTS factor_type_id smallint,
  ADD COLUMN IF NOT EXISTS product_type_id smallint,
  ADD COLUMN IF NOT EXISTS off_percent numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delivery_percent numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vat_percent numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS checkout_type_id smallint,
  ADD COLUMN IF NOT EXISTS seller_buyer_type smallint,
  ADD COLUMN IF NOT EXISTS shopping_center_id bigint,
  ADD COLUMN IF NOT EXISTS buyer_user_id bigint,
  ADD COLUMN IF NOT EXISTS other_center_name text,
  ADD COLUMN IF NOT EXISTS other_center_phone text,
  ADD COLUMN IF NOT EXISTS other_center_address text,
  ADD COLUMN IF NOT EXISTS other_center_description text;

-- Constrain sync_status to known states.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'factors_sync_status_check'
  ) THEN
    ALTER TABLE public.factors
      ADD CONSTRAINT factors_sync_status_check
      CHECK (sync_status IN ('pending', 'synced', 'failed'));
  END IF;
END $$;

-- ============================================================
-- 2) cow_factor_details — one row per cow, child of factors
-- ============================================================
CREATE TABLE IF NOT EXISTS public.cow_factor_details (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factor_id uuid NOT NULL REFERENCES public.factors(id) ON DELETE CASCADE,
  cow_id bigint NOT NULL,
  weight numeric NOT NULL CHECK (weight > 0),
  unit_price numeric NOT NULL CHECK (unit_price > 0),
  row_price numeric NOT NULL DEFAULT 0,
  existence_status smallint NOT NULL,
  description text,
  -- Per-cow derived/financial fields (computed by the RPC)
  off_unit_price numeric DEFAULT 0,
  delivery_cost numeric DEFAULT 0,
  vat numeric DEFAULT 0,
  payable_unit_price numeric DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cow_factor_details_factor_id
  ON public.cow_factor_details(factor_id);

ALTER TABLE public.cow_factor_details ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read cow_factor_details"
  ON public.cow_factor_details FOR SELECT USING (true);
CREATE POLICY "Allow public insert cow_factor_details"
  ON public.cow_factor_details FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update cow_factor_details"
  ON public.cow_factor_details FOR UPDATE USING (true);
CREATE POLICY "Allow public delete cow_factor_details"
  ON public.cow_factor_details FOR DELETE USING (true);

-- ============================================================
-- 3) sync_queue — outbox for the local SQL Server worker
-- ============================================================
CREATE TABLE IF NOT EXISTS public.sync_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL,             -- e.g. 'cow_factor'
  entity_id uuid NOT NULL,               -- factors.id
  payload jsonb NOT NULL,                -- full factor + cow details snapshot
  status text NOT NULL DEFAULT 'pending' -- pending | processing | synced | failed
    CHECK (status IN ('pending', 'processing', 'synced', 'failed')),
  retry_count int NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  synced_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_sync_queue_status_created
  ON public.sync_queue(status, created_at);

ALTER TABLE public.sync_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read sync_queue"
  ON public.sync_queue FOR SELECT USING (true);
CREATE POLICY "Allow public insert sync_queue"
  ON public.sync_queue FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update sync_queue"
  ON public.sync_queue FOR UPDATE USING (true);
CREATE POLICY "Allow public delete sync_queue"
  ON public.sync_queue FOR DELETE USING (true);

-- updated_at trigger reuses existing helper
DROP TRIGGER IF EXISTS sync_queue_set_updated_at ON public.sync_queue;
CREATE TRIGGER sync_queue_set_updated_at
  BEFORE UPDATE ON public.sync_queue
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- 4) Storage bucket for cow factor images
-- ============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('cow-factor-images', 'cow-factor-images', true)
ON CONFLICT (id) DO NOTHING;

-- Public read; permissive write since project has no auth yet.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='storage' AND tablename='objects'
      AND policyname='cow-factor-images public read'
  ) THEN
    CREATE POLICY "cow-factor-images public read"
      ON storage.objects FOR SELECT
      USING (bucket_id = 'cow-factor-images');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='storage' AND tablename='objects'
      AND policyname='cow-factor-images public insert'
  ) THEN
    CREATE POLICY "cow-factor-images public insert"
      ON storage.objects FOR INSERT
      WITH CHECK (bucket_id = 'cow-factor-images');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='storage' AND tablename='objects'
      AND policyname='cow-factor-images public update'
  ) THEN
    CREATE POLICY "cow-factor-images public update"
      ON storage.objects FOR UPDATE
      USING (bucket_id = 'cow-factor-images');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='storage' AND tablename='objects'
      AND policyname='cow-factor-images public delete'
  ) THEN
    CREATE POLICY "cow-factor-images public delete"
      ON storage.objects FOR DELETE
      USING (bucket_id = 'cow-factor-images');
  END IF;
END $$;

-- ============================================================
-- 5) submit_cow_factor RPC
-- All-or-nothing: validates, inserts factor + details, enqueues sync event.
-- Returns: { id uuid, message text, success boolean }
-- ============================================================
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
  -- ---- Extract arrays ----
  v_cow_ids            := ARRAY(SELECT jsonb_array_elements_text(p_details->'CowIds')::bigint);
  v_weights            := ARRAY(SELECT jsonb_array_elements_text(p_details->'Weights')::numeric);
  v_unit_prices        := ARRAY(SELECT jsonb_array_elements_text(p_details->'UnitPrices')::numeric);
  v_row_prices         := ARRAY(SELECT jsonb_array_elements_text(p_details->'RowPrices')::numeric);
  v_existence_statuses := ARRAY(SELECT jsonb_array_elements_text(p_details->'ExistenceStatuses')::smallint);
  v_descriptions       := ARRAY(SELECT jsonb_array_elements_text(p_details->'Descriptions'));

  v_n := COALESCE(array_length(v_cow_ids, 1), 0);

  -- ---- Validation ----
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

  -- Duplicate cow id check
  IF (SELECT count(DISTINCT x) FROM unnest(v_cow_ids) x) <> v_n THEN
    RETURN jsonb_build_object('id', NULL, 'success', false, 'message', 'شماره دام تکراری در ردیف‌ها یافت شد.');
  END IF;

  -- Per-row required field check
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
    IF v_existence_statuses[v_i] IS NULL THEN
      RETURN jsonb_build_object('id', NULL, 'success', false, 'message', format('ردیف %s: نوع (فروش/تلفات/کشتار) انتخاب نشده است.', v_i));
    END IF;
  END LOOP;

  -- Business rule: entry (FactorTypeId=1) cows must NOT already exist;
  --                exit  (FactorTypeId=2) cows MUST exist in herd.
  v_factor_type_id := COALESCE((p_factor->>'FactorTypeId')::smallint, 0);

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

  -- ---- Financial calculations ----
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

  -- ---- Insert factor header ----
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

  -- ---- Insert cow detail rows with derived values ----
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
      v_existence_statuses[v_i],
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

  -- ---- Build sync payload (snapshot) ----
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
  -- Any unexpected error rolls back the whole transaction (RPC is atomic).
  RETURN jsonb_build_object(
    'id', NULL,
    'success', false,
    'message', 'خطای پایگاه داده: ' || SQLERRM
  );
END;
$$;