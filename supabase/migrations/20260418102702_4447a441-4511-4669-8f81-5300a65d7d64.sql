CREATE TABLE IF NOT EXISTS public.rental_items (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  factor_id uuid NOT NULL,
  purpose text,
  driver_name text,
  iban_or_card text,
  amount numeric DEFAULT 0,
  row_total numeric DEFAULT 0,
  description text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.rental_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read rental_items" ON public.rental_items FOR SELECT USING (true);
CREATE POLICY "Allow public insert rental_items" ON public.rental_items FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update rental_items" ON public.rental_items FOR UPDATE USING (true);
CREATE POLICY "Allow public delete rental_items" ON public.rental_items FOR DELETE USING (true);