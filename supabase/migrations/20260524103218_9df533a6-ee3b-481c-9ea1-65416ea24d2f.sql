
-- Feature flags (idempotent inserts)
INSERT INTO public.finance_feature_flags (key, enabled, description)
VALUES
  ('auto_create_bank_transfers', false,
   'When true, the bank-import pipeline auto-pairs deposits with matching withdrawals and creates inter-bank transfers.'),
  ('auto_post_bank_transfers_to_sepidar', false,
   'When true, auto-created inter-bank transfers are immediately posted to Sepidar via the existing voucher path.')
ON CONFLICT (key) DO NOTHING;

-- Audit / provenance columns on the transfer row
ALTER TABLE public.finance_bank_transfers
  ADD COLUMN IF NOT EXISTS auto_matched boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_match_source text;

-- Idempotency: each bank transaction can appear in at most one active transfer
-- on each side. Partial indexes so soft-deleted rows don't block legitimate
-- re-pairing after a delete.
CREATE UNIQUE INDEX IF NOT EXISTS finance_bank_transfers_from_tx_uq
  ON public.finance_bank_transfers (from_transaction_id)
  WHERE is_deleted = false AND from_transaction_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS finance_bank_transfers_to_tx_uq
  ON public.finance_bank_transfers (to_transaction_id)
  WHERE is_deleted = false AND to_transaction_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- auto_create_bank_transfer
-- Atomically creates an inter-bank transfer pairing a deposit with a
-- withdrawal. Returns the new transfer id, OR the existing id if the same
-- pairing already exists (idempotent on re-runs).
-- The trigger guard on finance_bank_transfers is reused — we don't duplicate
-- safety checks here, we just rely on the partial unique indexes above.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.auto_create_bank_transfer(
  p_deposit_tx_id uuid,
  p_withdraw_tx_id uuid,
  p_match_source text DEFAULT 'excel_import_auto'
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dep record;
  v_wd  record;
  v_existing uuid;
  v_transfer_id uuid;
BEGIN
  -- Idempotency short-circuit: if either leg is already part of a transfer,
  -- return that existing transfer id without modifying anything.
  SELECT id INTO v_existing
    FROM public.finance_bank_transfers
   WHERE is_deleted = false
     AND (from_transaction_id = p_withdraw_tx_id
          OR to_transaction_id = p_deposit_tx_id)
   LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  -- Lock both rows so concurrent imports can't both pair the same tx.
  SELECT id, bank_id, deposit_amount, withdraw_amount, transaction_type,
         transaction_datetime, assignment_status
    INTO v_dep
    FROM public.finance_bank_transactions
   WHERE id = p_deposit_tx_id AND is_deleted = false
   FOR UPDATE;

  SELECT id, bank_id, deposit_amount, withdraw_amount, transaction_type,
         transaction_datetime, assignment_status
    INTO v_wd
    FROM public.finance_bank_transactions
   WHERE id = p_withdraw_tx_id AND is_deleted = false
   FOR UPDATE;

  IF v_dep.id IS NULL OR v_wd.id IS NULL THEN
    RAISE EXCEPTION 'transaction not found';
  END IF;
  IF v_dep.transaction_type <> 'deposit' OR v_wd.transaction_type <> 'withdraw' THEN
    RAISE EXCEPTION 'invalid transaction types for inter-bank transfer';
  END IF;
  IF v_dep.bank_id IS NULL OR v_wd.bank_id IS NULL OR v_dep.bank_id = v_wd.bank_id THEN
    RAISE EXCEPTION 'bank ids must differ and be set';
  END IF;
  IF COALESCE(v_dep.deposit_amount, 0) <> COALESCE(v_wd.withdraw_amount, 0) THEN
    RAISE EXCEPTION 'amount mismatch';
  END IF;
  IF v_dep.assignment_status <> 'unassigned' OR v_wd.assignment_status <> 'unassigned' THEN
    RAISE EXCEPTION 'one of the transactions is already assigned';
  END IF;

  INSERT INTO public.finance_bank_transfers (
    from_bank_id, to_bank_id,
    from_transaction_id, to_transaction_id,
    from_amount, to_amount,
    transfer_datetime,
    has_fee, fee_amount,
    description,
    status, approved_at,
    auto_matched, auto_match_source
  ) VALUES (
    v_wd.bank_id, v_dep.bank_id,
    v_wd.id, v_dep.id,
    v_wd.withdraw_amount, v_dep.deposit_amount,
    v_dep.transaction_datetime,
    false, 0,
    'انتقال بین بانکی - تشخیص خودکار از ایمپورت',
    'approved', now(),
    true, p_match_source
  )
  RETURNING id INTO v_transfer_id;

  UPDATE public.finance_bank_transactions
     SET assignment_status      = 'assigned',
         assigned_operation_type = 'bank_transfer',
         assigned_operation_id   = v_transfer_id
   WHERE id IN (v_dep.id, v_wd.id);

  RETURN v_transfer_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.auto_create_bank_transfer(uuid, uuid, text) TO authenticated;
