
-- Extend factor_items.product_type CHECK to support milk, other, rental
ALTER TABLE public.factor_items DROP CONSTRAINT IF EXISTS factor_items_product_type_check;
ALTER TABLE public.factor_items ADD CONSTRAINT factor_items_product_type_check
  CHECK (product_type IN ('livestock','feed','medicine','sperm','manure','services','milk','other','rental'));

-- Detail table: milk
CREATE TABLE IF NOT EXISTS public.factor_item_milk_details (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factor_item_id uuid NOT NULL UNIQUE REFERENCES public.factor_items(id) ON DELETE CASCADE,
  weight_kg numeric,
  milk_sample numeric,
  liters numeric,
  price_per_kg numeric,
  buyer_company text,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.factor_item_milk_details TO authenticated;
GRANT ALL ON public.factor_item_milk_details TO service_role;
ALTER TABLE public.factor_item_milk_details ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fimkd select" ON public.factor_item_milk_details FOR SELECT TO authenticated USING (true);
CREATE POLICY "fimkd insert" ON public.factor_item_milk_details FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "fimkd update" ON public.factor_item_milk_details FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "fimkd delete" ON public.factor_item_milk_details FOR DELETE TO authenticated USING (true);

-- Detail table: other (free-form catch-all)
CREATE TABLE IF NOT EXISTS public.factor_item_other_details (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factor_item_id uuid NOT NULL UNIQUE REFERENCES public.factor_items(id) ON DELETE CASCADE,
  item_name text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.factor_item_other_details TO authenticated;
GRANT ALL ON public.factor_item_other_details TO service_role;
ALTER TABLE public.factor_item_other_details ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fiod select" ON public.factor_item_other_details FOR SELECT TO authenticated USING (true);
CREATE POLICY "fiod insert" ON public.factor_item_other_details FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "fiod update" ON public.factor_item_other_details FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "fiod delete" ON public.factor_item_other_details FOR DELETE TO authenticated USING (true);

-- Detail table: rental
CREATE TABLE IF NOT EXISTS public.factor_item_rental_details (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factor_item_id uuid NOT NULL UNIQUE REFERENCES public.factor_items(id) ON DELETE CASCADE,
  purpose text,
  driver_name text,
  vehicle_plate text,
  start_date date,
  end_date date,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.factor_item_rental_details TO authenticated;
GRANT ALL ON public.factor_item_rental_details TO service_role;
ALTER TABLE public.factor_item_rental_details ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fird select" ON public.factor_item_rental_details FOR SELECT TO authenticated USING (true);
CREATE POLICY "fird insert" ON public.factor_item_rental_details FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "fird update" ON public.factor_item_rental_details FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "fird delete" ON public.factor_item_rental_details FOR DELETE TO authenticated USING (true);

-- Extend the validation trigger function for the three new product types.
CREATE OR REPLACE FUNCTION public.fn_factor_items_check_detail()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  CASE NEW.product_type
    WHEN 'livestock' THEN SELECT count(*) INTO v_count FROM public.factor_item_livestock_details WHERE factor_item_id = NEW.id;
    WHEN 'feed'      THEN SELECT count(*) INTO v_count FROM public.factor_item_feed_details      WHERE factor_item_id = NEW.id;
    WHEN 'medicine'  THEN SELECT count(*) INTO v_count FROM public.factor_item_medicine_details  WHERE factor_item_id = NEW.id;
    WHEN 'sperm'     THEN SELECT count(*) INTO v_count FROM public.factor_item_sperm_details     WHERE factor_item_id = NEW.id;
    WHEN 'manure'    THEN SELECT count(*) INTO v_count FROM public.factor_item_manure_details    WHERE factor_item_id = NEW.id;
    WHEN 'services'  THEN SELECT count(*) INTO v_count FROM public.factor_item_service_details   WHERE factor_item_id = NEW.id;
    WHEN 'milk'      THEN SELECT count(*) INTO v_count FROM public.factor_item_milk_details      WHERE factor_item_id = NEW.id;
    WHEN 'other'     THEN SELECT count(*) INTO v_count FROM public.factor_item_other_details     WHERE factor_item_id = NEW.id;
    WHEN 'rental'    THEN SELECT count(*) INTO v_count FROM public.factor_item_rental_details    WHERE factor_item_id = NEW.id;
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
