-- Add feed_products snapshot columns to factor_item_feed_details.
-- Mirrors the medicine snapshot pattern (medicine_products → factor_item_medicine_details).
-- These columns preserve the catalog row at the moment the invoice line was
-- created, so historical invoices stay correct even if feed_products is
-- edited or deactivated later.
ALTER TABLE public.factor_item_feed_details
  ADD COLUMN IF NOT EXISTS feed_product_id bigint REFERENCES public.feed_products(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS feed_code text,
  ADD COLUMN IF NOT EXISTS name_fa text,
  ADD COLUMN IF NOT EXISTS name_en text,
  ADD COLUMN IF NOT EXISTS product_type text,
  ADD COLUMN IF NOT EXISTS category_fa text,
  ADD COLUMN IF NOT EXISTS category_en text,
  ADD COLUMN IF NOT EXISTS company_name_fa text,
  ADD COLUMN IF NOT EXISTS company_name_en text,
  ADD COLUMN IF NOT EXISTS company_country text,
  ADD COLUMN IF NOT EXISTS commercial_product_name_fa text,
  ADD COLUMN IF NOT EXISTS commercial_product_name_en text,
  ADD COLUMN IF NOT EXISTS feed_form text,
  ADD COLUMN IF NOT EXISTS target_group text,
  ADD COLUMN IF NOT EXISTS dry_matter numeric,
  ADD COLUMN IF NOT EXISTS crude_protein numeric,
  ADD COLUMN IF NOT EXISTS ndf numeric,
  ADD COLUMN IF NOT EXISTS adf numeric,
  ADD COLUMN IF NOT EXISTS starch numeric,
  ADD COLUMN IF NOT EXISTS fat numeric,
  ADD COLUMN IF NOT EXISTS nel_mcal_kg numeric,
  ADD COLUMN IF NOT EXISTS calcium numeric,
  ADD COLUMN IF NOT EXISTS phosphorus numeric,
  ADD COLUMN IF NOT EXISTS recommended_inclusion_min_percent numeric,
  ADD COLUMN IF NOT EXISTS recommended_inclusion_max_percent numeric,
  ADD COLUMN IF NOT EXISTS label_verification_status text;

-- Index the FK so future reports filtering by catalog product are fast.
CREATE INDEX IF NOT EXISTS idx_factor_item_feed_details_feed_product_id
  ON public.factor_item_feed_details(feed_product_id);

-- Trigram indexes on feed_products for the picker's multi-field ilike search.
-- pg_trgm is already enabled (used by medicine_products); we only create the
-- per-column GIN indexes if they don't exist yet.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_feed_products_name_fa_trgm
  ON public.feed_products USING gin (name_fa gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_feed_products_name_en_trgm
  ON public.feed_products USING gin (name_en gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_feed_products_commercial_fa_trgm
  ON public.feed_products USING gin (commercial_product_name_fa gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_feed_products_commercial_en_trgm
  ON public.feed_products USING gin (commercial_product_name_en gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_feed_products_company_fa_trgm
  ON public.feed_products USING gin (company_name_fa gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_feed_products_company_en_trgm
  ON public.feed_products USING gin (company_name_en gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_feed_products_category_fa_trgm
  ON public.feed_products USING gin (category_fa gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_feed_products_category_en_trgm
  ON public.feed_products USING gin (category_en gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_feed_products_feed_code_trgm
  ON public.feed_products USING gin (feed_code gin_trgm_ops);