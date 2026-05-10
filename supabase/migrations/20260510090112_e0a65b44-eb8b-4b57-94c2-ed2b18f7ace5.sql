-- Add description column to bank import templates
ALTER TABLE public.finance_bank_import_templates
  ADD COLUMN IF NOT EXISTS description text;

-- Update titles for existing templates by legacy bank_name_code
UPDATE public.finance_bank_import_templates SET title = 'قالب اکسل بانک کشاورزی' WHERE bank_name_code = 2;
UPDATE public.finance_bank_import_templates SET title = 'قالب اکسل بانک صادرات'  WHERE bank_name_code = 3;
UPDATE public.finance_bank_import_templates SET title = 'قالب اکسل بانک رفاه'    WHERE bank_name_code = 4;
UPDATE public.finance_bank_import_templates SET title = 'قالب CSV بانک ملت'      WHERE bank_name_code = 5;

-- Insert placeholder template for bank_name_code = 1 (گردشگری) only if missing
INSERT INTO public.finance_bank_import_templates
  (title, bank_name_code, file_type, has_header, is_active, description,
   row_validation_column_index, creditor_amount_column_index, debtor_amount_column_index,
   date_column_index, time_column_index, doc_number_column_index,
   description_column_indexes, needs_rtl_cleanup, time_24_fix)
SELECT 'قالب بانک گردشگری', 1, 'xlsx', true, false,
       'قالب ورود تراکنش برای بانک گردشگری هنوز تعریف نشده است',
       0, 0, 0, 0, 0, 0, '{}'::integer[], false, false
WHERE NOT EXISTS (
  SELECT 1 FROM public.finance_bank_import_templates WHERE bank_name_code = 1
);