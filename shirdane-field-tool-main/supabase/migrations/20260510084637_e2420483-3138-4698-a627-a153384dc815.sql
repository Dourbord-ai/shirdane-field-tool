CREATE TABLE public.finance_bank_import_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  bank_name_code integer,
  file_type text NOT NULL CHECK (file_type IN ('xls','xlsx','csv')),
  has_header boolean NOT NULL DEFAULT true,
  row_validation_column_index integer,
  creditor_amount_column_index integer,
  debtor_amount_column_index integer,
  date_column_index integer,
  time_column_index integer,
  doc_number_column_index integer,
  description_column_indexes integer[] NOT NULL DEFAULT '{}',
  needs_rtl_cleanup boolean NOT NULL DEFAULT false,
  time_24_fix boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.finance_bank_import_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read finance_bank_import_templates" ON public.finance_bank_import_templates FOR SELECT USING (true);
CREATE POLICY "insert finance_bank_import_templates" ON public.finance_bank_import_templates FOR INSERT WITH CHECK (true);
CREATE POLICY "update finance_bank_import_templates" ON public.finance_bank_import_templates FOR UPDATE USING (true);
CREATE POLICY "delete finance_bank_import_templates" ON public.finance_bank_import_templates FOR DELETE USING (true);

CREATE TRIGGER update_finance_bank_import_templates_updated_at
  BEFORE UPDATE ON public.finance_bank_import_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.finance_banks
  ADD COLUMN IF NOT EXISTS import_template_id uuid REFERENCES public.finance_bank_import_templates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS legacy_bank_name_code integer;

INSERT INTO public.finance_bank_import_templates
  (title, bank_name_code, file_type, has_header, row_validation_column_index, creditor_amount_column_index, debtor_amount_column_index, date_column_index, time_column_index, doc_number_column_index, description_column_indexes, needs_rtl_cleanup, time_24_fix)
VALUES
  ('فرمت بانک نوع ۲', 2, 'xlsx', true, 12, 6, 7, 11, 10, 9, ARRAY[1,4], false, false),
  ('فرمت بانک نوع ۳', 3, 'xlsx', true, 0, 7, 8, 1, 2, 5, ARRAY[4,6], false, true),
  ('فرمت بانک نوع ۴', 4, 'xlsx', true, 13, 10, 9, 12, 11, 8, ARRAY[3], true, false),
  ('فرمت CSV نوع ۵', 5, 'csv', true, 11, 1, 2, 10, 9, 5, ARRAY[3,4], false, false);