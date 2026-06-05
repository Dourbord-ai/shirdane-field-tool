CREATE OR REPLACE FUNCTION public.sync_factor_settlement_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.lifecycle_state IS DISTINCT FROM OLD.lifecycle_state THEN
    -- Cascade cancellation/rejection (unchanged behavior).
    IF NEW.lifecycle_state IN ('cancelled', 'rejected') THEN
      UPDATE public.finance_payment_requests
         SET status = NEW.lifecycle_state,
             updated_at = now()
       WHERE source_factor_id = NEW.id
         AND is_deleted = false
         AND status NOT IN ('cancelled', 'rejected', 'executed', 'paid', 'partially_paid');

    -- NEW: Cascade approval. Invoice is source of truth — when it becomes
    -- approved, auto-approve its invoice-owned pre-approval request(s).
    -- Skips requests already approved/executed/terminal so we never undo
    -- progress. The approval guard trigger still applies but allows this
    -- because the invoice IS now approved.
    ELSIF NEW.lifecycle_state = 'approved' THEN
      UPDATE public.finance_payment_requests
         SET status = 'approved',
             updated_at = now()
       WHERE source_factor_id = NEW.id
         AND is_deleted = false
         AND status IN ('draft', 'pending_approval');
    END IF;
  END IF;
  RETURN NEW;
END;
$$;