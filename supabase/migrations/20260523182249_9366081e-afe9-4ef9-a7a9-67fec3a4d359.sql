
-- M2r: factor_accounting_map + line_role enum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typname='line_role') THEN
    CREATE TYPE public.line_role AS ENUM (
      'inventory','ap','ar','revenue','cogs','freight','discount','tax','rounding','other'
    );
    COMMENT ON TYPE public.line_role IS 'Phase 1: canonical line-role for finance_voucher_items and factor_accounting_map. Additive only.';
  END IF;
END$$;

CREATE TABLE public.factor_accounting_map (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factor_type text NOT NULL,
  product_type text NOT NULL,
  line_role public.line_role NOT NULL,
  scenario_key text NOT NULL DEFAULT 'default',
  side char(2) NOT NULL,
  account_code text NOT NULL,
  account_label text NULL,
  dl_source text NULL,
  static_dl_ref bigint NULL,
  tf_source text NULL,
  static_tf_ref bigint NULL,
  priority integer NOT NULL DEFAULT 100,
  is_active boolean NOT NULL DEFAULT false,
  effective_from timestamptz NULL,
  effective_to timestamptz NULL,
  notes text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL,
  updated_by uuid NULL,
  CONSTRAINT factor_accounting_map_side_chk CHECK (side IN ('DR','CR')),
  CONSTRAINT factor_accounting_map_factor_type_chk CHECK (factor_type IN ('buy_livestock','sell_livestock')),
  CONSTRAINT factor_accounting_map_product_type_chk CHECK (product_type IN ('livestock')),
  CONSTRAINT factor_accounting_map_dl_source_chk CHECK (dl_source IS NULL OR dl_source IN ('party','cow','warehouse','static')),
  CONSTRAINT factor_accounting_map_tf_source_chk CHECK (tf_source IS NULL OR tf_source IN ('party','cow','project','static')),
  CONSTRAINT factor_accounting_map_static_dl_chk CHECK (((dl_source = 'static') = (static_dl_ref IS NOT NULL)) OR (dl_source IS NULL AND static_dl_ref IS NULL)),
  CONSTRAINT factor_accounting_map_static_tf_chk CHECK (((tf_source = 'static') = (static_tf_ref IS NOT NULL)) OR (tf_source IS NULL AND static_tf_ref IS NULL)),
  CONSTRAINT factor_accounting_map_effective_range_chk CHECK (effective_from IS NULL OR effective_to IS NULL OR effective_from < effective_to),
  CONSTRAINT factor_accounting_map_priority_chk CHECK (priority >= 0)
);

COMMENT ON TABLE public.factor_accounting_map IS
  'Phase 1 M2r: data-driven accounting mapping. One row = one voucher line template (one side). See docs/phase1_M2r_migration_package.md.';

CREATE INDEX idx_factor_accounting_map_lookup
  ON public.factor_accounting_map (factor_type, product_type, line_role, side, priority)
  WHERE is_active = true;

CREATE UNIQUE INDEX uq_factor_accounting_map_active_scenario
  ON public.factor_accounting_map (factor_type, product_type, line_role, scenario_key, side)
  WHERE is_active = true AND effective_to IS NULL;

CREATE INDEX idx_factor_accounting_map_effective
  ON public.factor_accounting_map (effective_from, effective_to);

CREATE TRIGGER trg_factor_accounting_map_touch
  BEFORE UPDATE ON public.factor_accounting_map
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.factor_accounting_map ENABLE ROW LEVEL SECURITY;

CREATE POLICY "factor_accounting_map_select_authenticated"
  ON public.factor_accounting_map FOR SELECT TO authenticated USING (true);

CREATE POLICY "factor_accounting_map_select_anon"
  ON public.factor_accounting_map FOR SELECT TO anon USING (false);

INSERT INTO public.factor_accounting_map
  (factor_type, product_type, line_role, scenario_key, side, account_code, account_label, dl_source, tf_source, priority, is_active, notes)
VALUES
  ('buy_livestock','livestock','inventory','default','DR','TBD-INV-LIVESTOCK','موجودی دام (TBD)','cow',NULL,100,false,'Phase 1 placeholder — confirm livestock inventory account code'),
  ('buy_livestock','livestock','ap','default','CR','TBD-AP-DEFAULT','حساب‌های پرداختنی (TBD)','party',NULL,100,false,'Phase 1 placeholder — confirm AP account code per party class'),
  ('buy_livestock','livestock','freight','freight_capitalized','DR','TBD-INV-LIVESTOCK','حمل سرمایه‌ای دام (TBD)','cow',NULL,110,false,'Capitalize freight into inventory; flag freight_capitalize=true in config'),
  ('sell_livestock','livestock','ar','default','DR','TBD-AR-DEFAULT','حساب‌های دریافتنی (TBD)','party',NULL,100,false,'Phase 1 placeholder — confirm AR account code per party class'),
  ('sell_livestock','livestock','revenue','default','CR','TBD-REV-LIVESTOCK','درآمد فروش دام (TBD)',NULL,'project',100,false,'Phase 1 placeholder — confirm livestock revenue account'),
  ('sell_livestock','livestock','cogs','default','DR','TBD-COGS-LIVESTOCK','بهای تمام‌شده دام فروخته شده (TBD)','cow',NULL,100,false,'Phase 1 placeholder — confirm COGS account; engine computes amount from cow cost basis');
