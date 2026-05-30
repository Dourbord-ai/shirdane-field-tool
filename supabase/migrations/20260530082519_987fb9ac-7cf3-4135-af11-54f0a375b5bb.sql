
-- 1) Expose medicine_products to the app (currently no grants → 401 from PostgREST).
GRANT SELECT ON public.medicine_products TO anon, authenticated;
GRANT ALL ON public.medicine_products TO service_role;

ALTER TABLE public.medicine_products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "medicine_products_read_all" ON public.medicine_products;
CREATE POLICY "medicine_products_read_all" ON public.medicine_products
  FOR SELECT TO anon, authenticated USING (true);

-- 2) Trigram fuzzy-search indexes across ALL 7 user-searchable columns
--    (Persian + English commercial / active ingredient / company, plus category).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS medicine_products_commercial_fa_trgm
  ON public.medicine_products USING gin (commercial_product_name_fa gin_trgm_ops);
CREATE INDEX IF NOT EXISTS medicine_products_commercial_en_trgm
  ON public.medicine_products USING gin (commercial_product_name_en gin_trgm_ops);
CREATE INDEX IF NOT EXISTS medicine_products_name_fa_trgm
  ON public.medicine_products USING gin (name_fa gin_trgm_ops);
CREATE INDEX IF NOT EXISTS medicine_products_name_en_trgm
  ON public.medicine_products USING gin (name_en gin_trgm_ops);
CREATE INDEX IF NOT EXISTS medicine_products_company_fa_trgm
  ON public.medicine_products USING gin (company_name_fa gin_trgm_ops);
CREATE INDEX IF NOT EXISTS medicine_products_company_en_trgm
  ON public.medicine_products USING gin (company_name_en gin_trgm_ops);
CREATE INDEX IF NOT EXISTS medicine_products_category_fa_trgm
  ON public.medicine_products USING gin (category_fa gin_trgm_ops);

-- 3) Extend medicine line items with FK + snapshot columns (idempotent).
ALTER TABLE public.factor_item_medicine_details
  ADD COLUMN IF NOT EXISTS medicine_product_id        bigint REFERENCES public.medicine_products(id),
  ADD COLUMN IF NOT EXISTS commercial_product_name_fa text,
  ADD COLUMN IF NOT EXISTS commercial_product_name_en text,
  ADD COLUMN IF NOT EXISTS active_ingredient_fa       text,
  ADD COLUMN IF NOT EXISTS active_ingredient_en       text,
  ADD COLUMN IF NOT EXISTS company_name_fa            text,
  ADD COLUMN IF NOT EXISTS company_name_en            text,
  ADD COLUMN IF NOT EXISTS company_country            text,
  ADD COLUMN IF NOT EXISTS dosage_form                text,
  ADD COLUMN IF NOT EXISTS route_fa                   text,
  ADD COLUMN IF NOT EXISTS category_fa                text,
  ADD COLUMN IF NOT EXISTS milk_withdrawal_days       numeric,
  ADD COLUMN IF NOT EXISTS meat_withdrawal_days       numeric,
  ADD COLUMN IF NOT EXISTS label_verification_status  text;

CREATE INDEX IF NOT EXISTS factor_item_medicine_details_product_id_idx
  ON public.factor_item_medicine_details (medicine_product_id);
