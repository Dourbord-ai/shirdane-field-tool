
CREATE TABLE IF NOT EXISTS public.fertility_erotic_types (
  id BIGSERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  code TEXT,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.fertility_erotic_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read fertility_erotic_types" ON public.fertility_erotic_types FOR SELECT USING (true);
CREATE POLICY "Allow public insert fertility_erotic_types" ON public.fertility_erotic_types FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update fertility_erotic_types" ON public.fertility_erotic_types FOR UPDATE USING (true);

CREATE TRIGGER update_fertility_erotic_types_updated_at
BEFORE UPDATE ON public.fertility_erotic_types
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.fertility_erotic_types (title, code, sort_order) VALUES
  ('فحلی طبیعی',         'NATURAL',         1),
  ('برگشت فحلی',         'RETURN',          2),
  ('PG',                  'PG',              3),
  ('PG + S',              'PG_S',            4),
  ('اجباری',              'FORCED',          5),
  ('اجباری G6G',          'FORCED_G6G',      6),
  ('اجباری Double Ovsinc','FORCED_DOUBLE',   7);

ALTER TABLE public.livestock_fertility_events
  ADD COLUMN IF NOT EXISTS erotic_type_id BIGINT REFERENCES public.fertility_erotic_types(id);

CREATE OR REPLACE FUNCTION public.validate_fertility_event_erotic_type()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.fertility_operation_id = 1 AND NEW.erotic_type_id IS NULL THEN
    RAISE EXCEPTION 'erotic_type_id is required when fertility_operation_id = 1 (نوع فحلی الزامی است)';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_fertility_event_erotic_type ON public.livestock_fertility_events;
CREATE TRIGGER trg_validate_fertility_event_erotic_type
BEFORE INSERT OR UPDATE ON public.livestock_fertility_events
FOR EACH ROW EXECUTE FUNCTION public.validate_fertility_event_erotic_type();
