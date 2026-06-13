CREATE TABLE public.livestock_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  factor_id UUID NOT NULL,
  animal_number TEXT,
  weight_kg NUMERIC DEFAULT 0,
  price_per_kg NUMERIC DEFAULT 0,
  row_total NUMERIC DEFAULT 0,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.livestock_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read livestock_items" ON public.livestock_items FOR SELECT USING (true);
CREATE POLICY "Allow public insert livestock_items" ON public.livestock_items FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update livestock_items" ON public.livestock_items FOR UPDATE USING (true);
CREATE POLICY "Allow public delete livestock_items" ON public.livestock_items FOR DELETE USING (true);

ALTER TABLE public.livestock_items
  ADD CONSTRAINT livestock_items_factor_id_fkey
  FOREIGN KEY (factor_id) REFERENCES public.factors(id) ON DELETE CASCADE;