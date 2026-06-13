
CREATE TABLE public.milk (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  factor_id UUID NOT NULL REFERENCES public.factors(id) ON DELETE CASCADE,
  quantity_kg NUMERIC DEFAULT 0,
  quantity_liter NUMERIC DEFAULT 0,
  milk_sample NUMERIC DEFAULT 0.97,
  fat NUMERIC DEFAULT 0,
  protein NUMERIC DEFAULT 0,
  total NUMERIC DEFAULT 0,
  somatic NUMERIC DEFAULT 0,
  price_per_kg NUMERIC DEFAULT 0,
  row_total NUMERIC DEFAULT 0,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.milk ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read milk" ON public.milk FOR SELECT USING (true);
CREATE POLICY "Allow public insert milk" ON public.milk FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update milk" ON public.milk FOR UPDATE USING (true);
CREATE POLICY "Allow public delete milk" ON public.milk FOR DELETE USING (true);
