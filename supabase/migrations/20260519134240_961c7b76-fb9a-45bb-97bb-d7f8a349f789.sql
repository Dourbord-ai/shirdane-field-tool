-- Add imported_file_path column to finance_bank_transactions
ALTER TABLE public.finance_bank_transactions
  ADD COLUMN IF NOT EXISTS imported_file_path text;

-- Create finance-imports storage bucket (private)
INSERT INTO storage.buckets (id, name, public)
VALUES ('finance-imports', 'finance-imports', false)
ON CONFLICT (id) DO NOTHING;

-- RLS policies on storage.objects for finance-imports bucket
DROP POLICY IF EXISTS "finance_imports_authenticated_read" ON storage.objects;
CREATE POLICY "finance_imports_authenticated_read"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'finance-imports');

DROP POLICY IF EXISTS "finance_imports_authenticated_insert" ON storage.objects;
CREATE POLICY "finance_imports_authenticated_insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'finance-imports');

DROP POLICY IF EXISTS "finance_imports_anon_read" ON storage.objects;
CREATE POLICY "finance_imports_anon_read"
  ON storage.objects FOR SELECT
  TO anon
  USING (bucket_id = 'finance-imports');

DROP POLICY IF EXISTS "finance_imports_anon_insert" ON storage.objects;
CREATE POLICY "finance_imports_anon_insert"
  ON storage.objects FOR INSERT
  TO anon
  WITH CHECK (bucket_id = 'finance-imports');