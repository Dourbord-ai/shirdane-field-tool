CREATE TABLE public.medicine_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  factor_id UUID NOT NULL REFERENCES public.factors(id) ON DELETE CASCADE,
  medicine_name TEXT,
  medicine_type TEXT,
  quantity NUMERIC DEFAULT 0,
  unit_price NUMERIC DEFAULT 0,
  row_total NUMERIC DEFAULT 0,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.medicine_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read medicine_items" ON public.medicine_items FOR SELECT USING (true);
CREATE POLICY "Allow public insert medicine_items" ON public.medicine_items FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update medicine_items" ON public.medicine_items FOR UPDATE USING (true);
CREATE POLICY "Allow public delete medicine_items" ON public.medicine_items FOR DELETE USING (true);