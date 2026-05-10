
-- 1. finance_banks: unassigned summary balances
ALTER TABLE public.finance_banks
  ADD COLUMN IF NOT EXISTS unassigned_creditor_balance numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unassigned_debtor_balance   numeric(18,2) NOT NULL DEFAULT 0;

-- 2. finance_receive_identifications: approval lifecycle + sepidar tracking
ALTER TABLE public.finance_receive_identifications
  ADD COLUMN IF NOT EXISTS rejected_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejected_by uuid,
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid,
  ADD COLUMN IF NOT EXISTS sepidar_sync_status text DEFAULT 'not_synced',
  ADD COLUMN IF NOT EXISTS sepidar_error_message text,
  ADD COLUMN IF NOT EXISTS sepidar_sync_attempts integer NOT NULL DEFAULT 0;

-- 3. finance_bank_transactions assignment_status check
ALTER TABLE public.finance_bank_transactions
  DROP CONSTRAINT IF EXISTS finance_bank_transactions_assignment_status_check;

UPDATE public.finance_bank_transactions
  SET assignment_status = 'unassigned'
  WHERE assignment_status IS NULL
     OR assignment_status NOT IN ('unassigned','assigning','assigned','rejected','cancelled','partially_assigned');

ALTER TABLE public.finance_bank_transactions
  ADD CONSTRAINT finance_bank_transactions_assignment_status_check
  CHECK (assignment_status IN ('unassigned','assigning','assigned','rejected','cancelled','partially_assigned'));

-- 4. Backfill bank unassigned balances
UPDATE public.finance_banks b
SET
  unassigned_creditor_balance = COALESCE(s.cred, 0),
  unassigned_debtor_balance   = COALESCE(s.deb, 0)
FROM (
  SELECT
    bank_id,
    SUM(CASE WHEN transaction_type='deposit'  THEN COALESCE(deposit_amount,0)  ELSE 0 END) AS cred,
    SUM(CASE WHEN transaction_type='withdraw' THEN COALESCE(withdraw_amount,0) ELSE 0 END) AS deb
  FROM public.finance_bank_transactions
  WHERE COALESCE(is_deleted,false) = false
    AND assignment_status IN ('unassigned','assigning')
  GROUP BY bank_id
) s
WHERE b.id = s.bank_id;
