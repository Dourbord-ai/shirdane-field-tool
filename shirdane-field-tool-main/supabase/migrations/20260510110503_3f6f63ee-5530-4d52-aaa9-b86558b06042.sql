
ALTER TABLE public.finance_payment_request_items
  ADD COLUMN IF NOT EXISTS amount_type_code integer;

UPDATE public.finance_payment_request_items
  SET amount_type_code = CASE
    WHEN amount_type = 'creditor' THEN 1
    WHEN amount_type = 'prepayment' THEN 2
    WHEN amount_type = 'on_account' THEN 3
    ELSE 1
  END
  WHERE amount_type_code IS NULL;

ALTER TABLE public.finance_sepidar_settings
  ADD COLUMN IF NOT EXISTS default_creditor_payment_account_id integer,
  ADD COLUMN IF NOT EXISTS default_prepayment_account_id integer,
  ADD COLUMN IF NOT EXISTS default_on_account_payment_account_id integer;
