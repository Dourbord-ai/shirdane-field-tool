-- Create table for milk receipts
CREATE TABLE public.milk_receipts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  year SMALLINT NOT NULL,
  month SMALLINT NOT NULL CHECK (month BETWEEN 1 AND 12),
  file_path TEXT NOT NULL,
  file_name TEXT,
  file_type TEXT,
  file_size BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.milk_receipts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read milk_receipts" ON public.milk_receipts FOR SELECT USING (true);
CREATE POLICY "Allow public insert milk_receipts" ON public.milk_receipts FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update milk_receipts" ON public.milk_receipts FOR UPDATE USING (true);
CREATE POLICY "Allow public delete milk_receipts" ON public.milk_receipts FOR DELETE USING (true);

CREATE TRIGGER trg_milk_receipts_updated_at
BEFORE UPDATE ON public.milk_receipts
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_milk_receipts_year_month ON public.milk_receipts(year DESC, month DESC);

-- Create storage bucket for milk receipts
INSERT INTO storage.buckets (id, name, public) VALUES ('milk-receipts', 'milk-receipts', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Public read milk-receipts" ON storage.objects FOR SELECT USING (bucket_id = 'milk-receipts');
CREATE POLICY "Public upload milk-receipts" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'milk-receipts');
CREATE POLICY "Public update milk-receipts" ON storage.objects FOR UPDATE USING (bucket_id = 'milk-receipts');
CREATE POLICY "Public delete milk-receipts" ON storage.objects FOR DELETE USING (bucket_id = 'milk-receipts');