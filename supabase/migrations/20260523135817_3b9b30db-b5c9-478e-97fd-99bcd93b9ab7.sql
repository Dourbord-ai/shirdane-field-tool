
-- 2.1 Mutable runtime config
CREATE TABLE public.factor_engine_config (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key          text NOT NULL UNIQUE,
  value        jsonb NOT NULL,
  description  text NULL,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   uuid NULL
);
COMMENT ON TABLE public.factor_engine_config IS
  'Mutable engine config keys. Engine reads frozen snapshots from factor_engine_config_versions; this table feeds new snapshots.';

-- 2.2 Immutable append-only snapshots
CREATE TABLE public.factor_engine_config_versions (
  version       integer PRIMARY KEY,
  payload       jsonb   NOT NULL,
  published_at  timestamptz NOT NULL DEFAULT now(),
  published_by  uuid    NULL,
  notes         text    NULL
);
COMMENT ON TABLE public.factor_engine_config_versions IS
  'Append-only frozen snapshots of factor_engine_config. Never UPDATE/DELETE.';

-- 2.3 updated_at touch trigger
CREATE OR REPLACE FUNCTION public.tg_factor_engine_config_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_factor_engine_config_touch
  BEFORE UPDATE ON public.factor_engine_config
  FOR EACH ROW EXECUTE FUNCTION public.tg_factor_engine_config_touch();

-- 2.4 Append-only enforcement on versions
CREATE OR REPLACE FUNCTION public.tg_factor_engine_config_versions_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'factor_engine_config_versions is append-only (version=%, op=%)',
    COALESCE(OLD.version, NEW.version), TG_OP;
END;
$$;

CREATE TRIGGER trg_factor_engine_config_versions_no_update
  BEFORE UPDATE ON public.factor_engine_config_versions
  FOR EACH ROW EXECUTE FUNCTION public.tg_factor_engine_config_versions_immutable();

CREATE TRIGGER trg_factor_engine_config_versions_no_delete
  BEFORE DELETE ON public.factor_engine_config_versions
  FOR EACH ROW EXECUTE FUNCTION public.tg_factor_engine_config_versions_immutable();

-- 2.5 Seed Phase 1 defaults
INSERT INTO public.factor_engine_config (key, value, description) VALUES
  ('freight_capitalize',          'true'::jsonb,       'Capitalize freight into inventory on buy factors'),
  ('allocate_costs_to_inventory', 'true'::jsonb,       'Allocate per-row costs to inventory lines on buy'),
  ('post_cogs_on_sell',           'false'::jsonb,      'Phase 1: do not post COGS on sell factors'),
  ('inventory_granularity',       '"per_item"'::jsonb, 'Livestock inventory granularity: per_item | aggregate'),
  ('rounding_tolerance_rials',    '5'::jsonb,          'Max absolute imbalance tolerated before engine fails'),
  ('rounding_account_code',       '"7901"'::jsonb,     'Account that absorbs rounding residuals'),
  ('max_lines_per_voucher',       '500'::jsonb,        'Factors above this go to dead_letter in Phase 1'),
  ('engine_version_pin',          '"1.0.0"'::jsonb,    'Engine semver stamped on each generated voucher');

-- 2.6 Freeze v1 snapshot
INSERT INTO public.factor_engine_config_versions (version, payload, notes)
SELECT 1, jsonb_object_agg(key, value), 'Initial Phase 1 seed.'
FROM public.factor_engine_config
WHERE is_active = true;

-- 2.7 Operator convenience view
CREATE OR REPLACE VIEW public.v_factor_engine_config_active AS
SELECT jsonb_object_agg(key, value) AS payload
FROM public.factor_engine_config
WHERE is_active = true;

-- 2.8 RLS
ALTER TABLE public.factor_engine_config           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.factor_engine_config_versions  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "engine_config_read_authenticated"
  ON public.factor_engine_config
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "engine_config_versions_read_authenticated"
  ON public.factor_engine_config_versions
  FOR SELECT TO authenticated USING (true);
