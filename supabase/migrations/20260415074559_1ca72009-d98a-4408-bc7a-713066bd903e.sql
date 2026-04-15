
CREATE TABLE public.feed_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  factor_id UUID NOT NULL REFERENCES public.factors(id) ON DELETE CASCADE,
  feed_name TEXT,
  weight_kg NUMERIC DEFAULT 0,
  moisture_loss NUMERIC DEFAULT 0,
  price_per_kg NUMERIC DEFAULT 0,
  row_total NUMERIC DEFAULT 0,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.feed_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read feed_items" ON public.feed_items FOR SELECT USING (true);
CREATE POLICY "Allow public insert feed_items" ON public.feed_items FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update feed_items" ON public.feed_items FOR UPDATE USING (true);
CREATE POLICY "Allow public delete feed_items" ON public.feed_items FOR DELETE USING (true);
