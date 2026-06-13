-- Create storage bucket for invoice attachments
INSERT INTO storage.buckets (id, name, public)
VALUES ('factor-attachments', 'factor-attachments', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies (public read, public upload/update/delete since app has no auth yet)
CREATE POLICY "Public read factor attachments"
ON storage.objects FOR SELECT
USING (bucket_id = 'factor-attachments');

CREATE POLICY "Public upload factor attachments"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'factor-attachments');

CREATE POLICY "Public update factor attachments"
ON storage.objects FOR UPDATE
USING (bucket_id = 'factor-attachments');

CREATE POLICY "Public delete factor attachments"
ON storage.objects FOR DELETE
USING (bucket_id = 'factor-attachments');

-- Table to track attachments per factor
CREATE TABLE IF NOT EXISTS public.factor_attachments (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  factor_id uuid NOT NULL,
  file_path text NOT NULL,
  file_name text,
  file_type text,
  file_size bigint,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.factor_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read factor_attachments" ON public.factor_attachments FOR SELECT USING (true);
CREATE POLICY "Allow public insert factor_attachments" ON public.factor_attachments FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update factor_attachments" ON public.factor_attachments FOR UPDATE USING (true);
CREATE POLICY "Allow public delete factor_attachments" ON public.factor_attachments FOR DELETE USING (true);

CREATE INDEX IF NOT EXISTS idx_factor_attachments_factor_id ON public.factor_attachments(factor_id);