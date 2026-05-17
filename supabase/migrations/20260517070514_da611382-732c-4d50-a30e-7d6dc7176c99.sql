ALTER TABLE public.finance_payment_request_items
  ADD COLUMN IF NOT EXISTS beneficiary_id text,
  ADD COLUMN IF NOT EXISTS dl_ref text,
  ADD COLUMN IF NOT EXISTS dl_code text,
  ADD COLUMN IF NOT EXISTS beneficiary_name text,
  ADD COLUMN IF NOT EXISTS beneficiary_balance_snapshot numeric,
  ADD COLUMN IF NOT EXISTS beneficiary_type text,
  ADD COLUMN IF NOT EXISTS beneficiary_snapshot_at timestamptz;

ALTER TABLE public.finance_payment_request_items
  ALTER COLUMN party_id DROP NOT NULL;