
-- factors table: invoice header data
CREATE TABLE public.factors (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  product_type TEXT NOT NULL,
  invoice_type TEXT NOT NULL,
  invoice_date TEXT,
  invoice_number TEXT,
  delivery_date TEXT,
  tax TEXT DEFAULT 'ندارد',
  buyer_type TEXT,
  company TEXT,
  discount NUMERIC DEFAULT 0,
  shipping NUMERIC DEFAULT 0,
  tax_amount NUMERIC DEFAULT 0,
  total_amount NUMERIC DEFAULT 0,
  payable_amount NUMERIC DEFAULT 0,
  settlement_type TEXT,
  settlement_date TEXT,
  settlement_number TEXT,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.factors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read factors" ON public.factors FOR SELECT USING (true);
CREATE POLICY "Allow public insert factors" ON public.factors FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update factors" ON public.factors FOR UPDATE USING (true);
CREATE POLICY "Allow public delete factors" ON public.factors FOR DELETE USING (true);

-- spermbuy table: line items for sperm purchases
CREATE TABLE public.spermbuy (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  factor_id UUID NOT NULL REFERENCES public.factors(id) ON DELETE CASCADE,
  sperm_code TEXT,
  sperm_name TEXT,
  quantity NUMERIC DEFAULT 0,
  unit_price NUMERIC DEFAULT 0,
  row_total NUMERIC DEFAULT 0,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.spermbuy ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read spermbuy" ON public.spermbuy FOR SELECT USING (true);
CREATE POLICY "Allow public insert spermbuy" ON public.spermbuy FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update spermbuy" ON public.spermbuy FOR UPDATE USING (true);
CREATE POLICY "Allow public delete spermbuy" ON public.spermbuy FOR DELETE USING (true);

-- timestamp trigger
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_factors_updated_at
  BEFORE UPDATE ON public.factors
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
