-- =====================================================================
-- Normalized invoice item architecture
-- ---------------------------------------------------------------------
-- factors           = invoice header (already exists)
-- factor_items      = shared invoice row fields (new)
-- factor_item_*_details = per-product detail tables (new, 1:1 with item)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) factor_items — shared/common invoice row
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.factor_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factor_id       uuid NOT NULL REFERENCES public.factors(id) ON DELETE CASCADE,
  row_number      integer,
  product_type    text NOT NULL CHECK (product_type IN
                    ('livestock','feed','medicine','sperm','manure','services')),
  quantity        numeric(18,4) NOT NULL DEFAULT 0,
  unit            text,
  unit_price      numeric(18,2) NOT NULL DEFAULT 0,
  discount_amount numeric(18,2) NOT NULL DEFAULT 0,
  tax_amount      numeric(18,2) NOT NULL DEFAULT 0,
  total_amount    numeric(18,2) NOT NULL DEFAULT 0,
  description     text,
  -- Optional accounting hints (used by the posting engine if present)
  account_code    text,
  cost_center     text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_factor_items_factor_id    ON public.factor_items(factor_id);
CREATE INDEX IF NOT EXISTS idx_factor_items_product_type ON public.factor_items(product_type);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.factor_items TO authenticated;
GRANT ALL ON public.factor_items TO service_role;

ALTER TABLE public.factor_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "factor_items read for authenticated"
  ON public.factor_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "factor_items insert for authenticated"
  ON public.factor_items FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "factor_items update for authenticated"
  ON public.factor_items FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "factor_items delete for authenticated"
  ON public.factor_items FOR DELETE TO authenticated USING (true);

-- updated_at trigger (reuse existing util function)
DROP TRIGGER IF EXISTS trg_factor_items_touch ON public.factor_items;
CREATE TRIGGER trg_factor_items_touch
  BEFORE UPDATE ON public.factor_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------
-- 2) Per-product detail tables (1:1 with factor_items)
--    `factor_item_id` is BOTH PK and FK — guarantees one detail row.
-- ---------------------------------------------------------------------

-- ---- livestock ----
CREATE TABLE IF NOT EXISTS public.factor_item_livestock_details (
  factor_item_id     uuid PRIMARY KEY REFERENCES public.factor_items(id) ON DELETE CASCADE,
  cow_id             bigint,
  weight             numeric(10,2),
  existence_status   smallint,  -- 1=sale,2=loss,3=slaughter,4=other
  off_unit_price     numeric(18,2),
  delivery_cost      numeric(18,2),
  vat                numeric(18,2),
  payable_unit_price numeric(18,2),
  created_at         timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.factor_item_livestock_details TO authenticated;
GRANT ALL ON public.factor_item_livestock_details TO service_role;
ALTER TABLE public.factor_item_livestock_details ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fild read"   ON public.factor_item_livestock_details FOR SELECT TO authenticated USING (true);
CREATE POLICY "fild insert" ON public.factor_item_livestock_details FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "fild update" ON public.factor_item_livestock_details FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "fild delete" ON public.factor_item_livestock_details FOR DELETE TO authenticated USING (true);

-- ---- feed ----
CREATE TABLE IF NOT EXISTS public.factor_item_feed_details (
  factor_item_id  uuid PRIMARY KEY REFERENCES public.factor_items(id) ON DELETE CASCADE,
  feed_id         bigint,
  feed_name       text,
  batch_number    text,
  expire_date     date,
  dry_matter_pct  numeric(6,2),
  warehouse_id    bigint,
  created_at      timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.factor_item_feed_details TO authenticated;
GRANT ALL ON public.factor_item_feed_details TO service_role;
ALTER TABLE public.factor_item_feed_details ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fifd read"   ON public.factor_item_feed_details FOR SELECT TO authenticated USING (true);
CREATE POLICY "fifd insert" ON public.factor_item_feed_details FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "fifd update" ON public.factor_item_feed_details FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "fifd delete" ON public.factor_item_feed_details FOR DELETE TO authenticated USING (true);

-- ---- medicine ----
CREATE TABLE IF NOT EXISTS public.factor_item_medicine_details (
  factor_item_id   uuid PRIMARY KEY REFERENCES public.factor_items(id) ON DELETE CASCADE,
  medicine_id      bigint,
  medicine_name    text,
  batch_number     text,
  expire_date      date,
  manufacturer     text,
  withdrawal_days  integer,
  warehouse_id     bigint,
  created_at       timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.factor_item_medicine_details TO authenticated;
GRANT ALL ON public.factor_item_medicine_details TO service_role;
ALTER TABLE public.factor_item_medicine_details ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fimd read"   ON public.factor_item_medicine_details FOR SELECT TO authenticated USING (true);
CREATE POLICY "fimd insert" ON public.factor_item_medicine_details FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "fimd update" ON public.factor_item_medicine_details FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "fimd delete" ON public.factor_item_medicine_details FOR DELETE TO authenticated USING (true);

-- ---- sperm ----
CREATE TABLE IF NOT EXISTS public.factor_item_sperm_details (
  factor_item_id  uuid PRIMARY KEY REFERENCES public.factor_items(id) ON DELETE CASCADE,
  sperm_id        bigint,
  bull_code       text,
  bull_name       text,
  breed           text,
  batch_number    text,
  production_date date,
  tank_id         bigint,
  created_at      timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.factor_item_sperm_details TO authenticated;
GRANT ALL ON public.factor_item_sperm_details TO service_role;
ALTER TABLE public.factor_item_sperm_details ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fisd read"   ON public.factor_item_sperm_details FOR SELECT TO authenticated USING (true);
CREATE POLICY "fisd insert" ON public.factor_item_sperm_details FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "fisd update" ON public.factor_item_sperm_details FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "fisd delete" ON public.factor_item_sperm_details FOR DELETE TO authenticated USING (true);

-- ---- manure ----
CREATE TABLE IF NOT EXISTS public.factor_item_manure_details (
  factor_item_id  uuid PRIMARY KEY REFERENCES public.factor_items(id) ON DELETE CASCADE,
  manure_type     text,
  moisture_pct    numeric(6,2),
  source_location text,
  destination     text,
  vehicle_plate   text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.factor_item_manure_details TO authenticated;
GRANT ALL ON public.factor_item_manure_details TO service_role;
ALTER TABLE public.factor_item_manure_details ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fimad read"   ON public.factor_item_manure_details FOR SELECT TO authenticated USING (true);
CREATE POLICY "fimad insert" ON public.factor_item_manure_details FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "fimad update" ON public.factor_item_manure_details FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "fimad delete" ON public.factor_item_manure_details FOR DELETE TO authenticated USING (true);

-- ---- services ----
CREATE TABLE IF NOT EXISTS public.factor_item_service_details (
  factor_item_id  uuid PRIMARY KEY REFERENCES public.factor_items(id) ON DELETE CASCADE,
  service_code    text,
  service_name    text,
  provider_name   text,
  service_date    date,
  hours           numeric(8,2),
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.factor_item_service_details TO authenticated;
GRANT ALL ON public.factor_item_service_details TO service_role;
ALTER TABLE public.factor_item_service_details ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fisvd read"   ON public.factor_item_service_details FOR SELECT TO authenticated USING (true);
CREATE POLICY "fisvd insert" ON public.factor_item_service_details FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "fisvd update" ON public.factor_item_service_details FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "fisvd delete" ON public.factor_item_service_details FOR DELETE TO authenticated USING (true);

-- ---------------------------------------------------------------------
-- 3) Enforcement: every factor_items row MUST have exactly one matching
--    detail record corresponding to its product_type.
--    Enforced via a CONSTRAINT TRIGGER (deferred to end of transaction)
--    so that inserts ordered "item first, detail second" still succeed.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_factor_items_check_detail()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  -- On DELETE we have nothing to check (cascade handles details).
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;

  -- Match exactly one detail row in the table for NEW.product_type.
  CASE NEW.product_type
    WHEN 'livestock' THEN
      SELECT count(*) INTO v_count FROM public.factor_item_livestock_details WHERE factor_item_id = NEW.id;
    WHEN 'feed' THEN
      SELECT count(*) INTO v_count FROM public.factor_item_feed_details WHERE factor_item_id = NEW.id;
    WHEN 'medicine' THEN
      SELECT count(*) INTO v_count FROM public.factor_item_medicine_details WHERE factor_item_id = NEW.id;
    WHEN 'sperm' THEN
      SELECT count(*) INTO v_count FROM public.factor_item_sperm_details WHERE factor_item_id = NEW.id;
    WHEN 'manure' THEN
      SELECT count(*) INTO v_count FROM public.factor_item_manure_details WHERE factor_item_id = NEW.id;
    WHEN 'services' THEN
      SELECT count(*) INTO v_count FROM public.factor_item_service_details WHERE factor_item_id = NEW.id;
    ELSE
      RAISE EXCEPTION 'Unknown product_type: %', NEW.product_type;
  END CASE;

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'factor_items(%) must have exactly one matching % detail row (found %).',
      NEW.id, NEW.product_type, v_count;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_factor_items_check_detail ON public.factor_items;
CREATE CONSTRAINT TRIGGER trg_factor_items_check_detail
  AFTER INSERT OR UPDATE ON public.factor_items
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.fn_factor_items_check_detail();

-- ---------------------------------------------------------------------
-- 4) Backfill: existing cow_factor_details → factor_items + livestock details
--    Only runs for factors with product_type='livestock' that don't already
--    have factor_items rows (idempotent / re-runnable).
-- ---------------------------------------------------------------------
DO $$
DECLARE
  r record;
  v_item_id uuid;
  v_row int;
BEGIN
  FOR r IN
    SELECT f.id AS factor_id, f.product_type
    FROM public.factors f
    WHERE f.product_type = 'livestock'
      AND NOT EXISTS (SELECT 1 FROM public.factor_items fi WHERE fi.factor_id = f.id)
  LOOP
    v_row := 0;
    -- For each existing detail row, create one factor_items + one livestock detail.
    -- We must defer the constraint trigger so we can insert the parent before child.
    SET CONSTRAINTS ALL DEFERRED;
    FOR v_item_id IN
      SELECT gen_random_uuid()
      FROM public.cow_factor_details d
      WHERE d.factor_id = r.factor_id
    LOOP
      NULL; -- placeholder; loop body replaced below
    END LOOP;
  END LOOP;
END $$;

-- Proper backfill (separate, simpler form):
DO $$
DECLARE
  d record;
  v_item_id uuid;
  v_row_no int;
  v_prev_factor uuid := NULL;
BEGIN
  SET CONSTRAINTS ALL DEFERRED;
  FOR d IN
    SELECT cfd.*, f.product_type AS factor_product_type
    FROM public.cow_factor_details cfd
    JOIN public.factors f ON f.id = cfd.factor_id
    WHERE f.product_type = 'livestock'
      AND NOT EXISTS (
        SELECT 1 FROM public.factor_items fi
        JOIN public.factor_item_livestock_details fild ON fild.factor_item_id = fi.id
        WHERE fi.factor_id = cfd.factor_id AND fild.cow_id = cfd.cow_id
      )
    ORDER BY cfd.factor_id, cfd.id
  LOOP
    IF v_prev_factor IS DISTINCT FROM d.factor_id THEN
      v_row_no := 0;
      v_prev_factor := d.factor_id;
    END IF;
    v_row_no := v_row_no + 1;
    v_item_id := gen_random_uuid();

    INSERT INTO public.factor_items
      (id, factor_id, row_number, product_type,
       quantity, unit, unit_price, discount_amount, tax_amount, total_amount, description)
    VALUES
      (v_item_id, d.factor_id, v_row_no, 'livestock',
       COALESCE(d.weight, 0), 'kg', COALESCE(d.unit_price, 0),
       COALESCE(d.off_unit_price, 0) * COALESCE(d.weight, 0),
       COALESCE(d.vat, 0),
       COALESCE(d.row_price, 0),
       d.description);

    INSERT INTO public.factor_item_livestock_details
      (factor_item_id, cow_id, weight, existence_status,
       off_unit_price, delivery_cost, vat, payable_unit_price)
    VALUES
      (v_item_id, d.cow_id, d.weight, d.existence_status,
       d.off_unit_price, d.delivery_cost, d.vat, d.payable_unit_price);
  END LOOP;
END $$;

-- Note: factors.product_type is kept as-is for backward compatibility.
-- New code should derive product_type from factor_items rows.
COMMENT ON COLUMN public.factors.product_type IS
  'DEPRECATED: use factor_items.product_type per row. Kept for backward compatibility.';
