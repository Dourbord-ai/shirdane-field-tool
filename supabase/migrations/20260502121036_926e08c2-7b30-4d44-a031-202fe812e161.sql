CREATE TABLE IF NOT EXISTS public.fertility_heat_types (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.fertility_heat_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read fertility_heat_types"
ON public.fertility_heat_types FOR SELECT USING (true);

CREATE POLICY "Allow public insert fertility_heat_types"
ON public.fertility_heat_types FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow public update fertility_heat_types"
ON public.fertility_heat_types FOR UPDATE USING (true);

CREATE POLICY "Allow public delete fertility_heat_types"
ON public.fertility_heat_types FOR DELETE USING (true);

INSERT INTO public.fertility_heat_types (name, is_active) VALUES
  ('فحلی طبیعی', true),
  ('فحلی القایی', true),
  ('فحلی خاموش', true),
  ('فحلی مشکوک', true);