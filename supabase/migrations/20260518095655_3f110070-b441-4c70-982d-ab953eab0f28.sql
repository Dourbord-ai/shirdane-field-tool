-- Enforce single active allocation per bank transaction at the DB level.
-- The existing column `finance_bank_transactions.assignment_status` already
-- implements the lifecycle (unassigned = تخصیص نشده, assigning = در حال تخصیص,
-- assigned = تخصیص شده). We add unique partial indexes on the request/operation
-- side so a transaction cannot be claimed by two active requests simultaneously.

-- 1) Payment allocations: only one active (non-deleted, non-cancelled/rejected)
--    row per bank_transaction_id.
DROP INDEX IF EXISTS public.uq_finance_payment_alloc_active_bank_tx;
CREATE UNIQUE INDEX uq_finance_payment_alloc_active_bank_tx
  ON public.finance_payment_allocations (bank_transaction_id)
  WHERE bank_transaction_id IS NOT NULL
    AND COALESCE(is_deleted, false) = false
    AND status IS DISTINCT FROM 'cancelled'
    AND status IS DISTINCT FROM 'rejected';

-- 2) Bank transfers: each side (from/to) transaction can be claimed by only
--    one active (non-deleted, non-cancelled) transfer.
DROP INDEX IF EXISTS public.uq_finance_bank_transfer_active_from_tx;
CREATE UNIQUE INDEX uq_finance_bank_transfer_active_from_tx
  ON public.finance_bank_transfers (from_transaction_id)
  WHERE from_transaction_id IS NOT NULL
    AND COALESCE(is_deleted, false) = false
    AND status IS DISTINCT FROM 'cancelled'
    AND status IS DISTINCT FROM 'rejected';

DROP INDEX IF EXISTS public.uq_finance_bank_transfer_active_to_tx;
CREATE UNIQUE INDEX uq_finance_bank_transfer_active_to_tx
  ON public.finance_bank_transfers (to_transaction_id)
  WHERE to_transaction_id IS NOT NULL
    AND COALESCE(is_deleted, false) = false
    AND status IS DISTINCT FROM 'cancelled'
    AND status IS DISTINCT FROM 'rejected';

-- 3) Receive identification: at most one active (non-deleted, non-cancelled/rejected)
--    receive_identification per bank_transaction_id.
DROP INDEX IF EXISTS public.uq_finance_receive_id_active_bank_tx;
CREATE UNIQUE INDEX uq_finance_receive_id_active_bank_tx
  ON public.finance_receive_identifications (bank_transaction_id)
  WHERE bank_transaction_id IS NOT NULL
    AND COALESCE(is_deleted, false) = false
    AND status IS DISTINCT FROM 'cancelled'
    AND status IS DISTINCT FROM 'rejected';