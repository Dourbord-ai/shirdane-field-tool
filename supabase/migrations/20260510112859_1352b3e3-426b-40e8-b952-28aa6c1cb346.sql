
-- Add paid/remaining tracking to payment requests
ALTER TABLE public.finance_payment_requests
  ADD COLUMN IF NOT EXISTS total_paid_amount numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS remaining_amount numeric(18,2);

ALTER TABLE public.finance_payment_request_items
  ADD COLUMN IF NOT EXISTS paid_amount numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS remaining_amount numeric(18,2);

-- Backfill remaining
UPDATE public.finance_payment_requests
  SET remaining_amount = COALESCE(total_amount,0) - COALESCE(total_paid_amount,0)
  WHERE remaining_amount IS NULL;

UPDATE public.finance_payment_request_items
  SET remaining_amount = COALESCE(amount,0) - COALESCE(paid_amount,0)
  WHERE remaining_amount IS NULL;

-- Allocations table
CREATE TABLE IF NOT EXISTS public.finance_payment_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_request_id uuid NOT NULL REFERENCES public.finance_payment_requests(id) ON DELETE CASCADE,
  payment_request_item_id uuid NOT NULL REFERENCES public.finance_payment_request_items(id) ON DELETE CASCADE,
  bank_transaction_id uuid NOT NULL REFERENCES public.finance_bank_transactions(id),
  bank_id uuid REFERENCES public.finance_banks(id),
  party_id uuid REFERENCES public.finance_parties(id),
  amount numeric(18,2) NOT NULL,
  allocation_datetime timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending_sync',
  voucher_id uuid REFERENCES public.finance_vouchers(id),
  sepidar_sync_status text NOT NULL DEFAULT 'not_synced',
  sepidar_error_message text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  is_deleted boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_fpa_request ON public.finance_payment_allocations(payment_request_id);
CREATE INDEX IF NOT EXISTS idx_fpa_item ON public.finance_payment_allocations(payment_request_item_id);
CREATE INDEX IF NOT EXISTS idx_fpa_tx ON public.finance_payment_allocations(bank_transaction_id);
CREATE INDEX IF NOT EXISTS idx_fpa_status ON public.finance_payment_allocations(status);

ALTER TABLE public.finance_payment_allocations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allocations: read for authenticated"
  ON public.finance_payment_allocations FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Allocations: insert for authenticated"
  ON public.finance_payment_allocations FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY "Allocations: update for authenticated"
  ON public.finance_payment_allocations FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Allocations: delete for authenticated"
  ON public.finance_payment_allocations FOR DELETE
  TO authenticated USING (true);

CREATE TRIGGER trg_fpa_updated
  BEFORE UPDATE ON public.finance_payment_allocations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
