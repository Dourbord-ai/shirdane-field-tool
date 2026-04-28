-- Create lab_results table
CREATE TABLE public.lab_results (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  year SMALLINT NOT NULL,
  month SMALLINT NOT NULL CHECK (month BETWEEN 1 AND 12),
  file_path TEXT NOT NULL,
  file_name TEXT,
  file_type TEXT,
  file_size BIGINT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_lab_results_year_month ON public.lab_results (year DESC, month DESC);

ALTER TABLE public.lab_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read lab_results" ON public.lab_results FOR SELECT USING (true);
CREATE POLICY "Allow public insert lab_results" ON public.lab_results FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update lab_results" ON public.lab_results FOR UPDATE USING (true);
CREATE POLICY "Allow public delete lab_results" ON public.lab_results FOR DELETE USING (true);

CREATE TRIGGER update_lab_results_updated_at
BEFORE UPDATE ON public.lab_results
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Create storage bucket
INSERT INTO storage.buckets (id, name, public) VALUES ('lab-results', 'lab-results', true);

CREATE POLICY "Public read lab-results" ON storage.objects FOR SELECT USING (bucket_id = 'lab-results');
CREATE POLICY "Public insert lab-results" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'lab-results');
CREATE POLICY "Public update lab-results" ON storage.objects FOR UPDATE USING (bucket_id = 'lab-results');
CREATE POLICY "Public delete lab-results" ON storage.objects FOR DELETE USING (bucket_id = 'lab-results');