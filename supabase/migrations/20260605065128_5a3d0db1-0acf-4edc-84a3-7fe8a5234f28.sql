-- ---------------------------------------------------------------------------
-- Invoice ↔ Settlement dependency model
--
-- Adds an authoritative link from a payment request to its source invoice,
-- prevents duplicate active invoice-owned requests, blocks approval of an
-- invoice-owned request until the invoice itself is approved, and cascades
-- invoice cancellation/rejection onto the linked request unless it has
-- already reached a terminal/executed state.
--
-- No changes to factors, settlement execution, Sepidar, vouchers, bank
-- allocation, routing API, amount_type_code, or the freight-trip flow.
-- ---------------------------------------------------------------------------

-- 1. Authoritative link column on the request header.
--    ON DELETE SET NULL keeps historical requests around even if a factor
--    is hard-deleted (factors are soft-deleted in practice, but the FK
--    must still be safe).
ALTER TABLE public.finance_payment_requests
  ADD COLUMN IF NOT EXISTS source_factor_id uuid NULL
    REFERENCES public.factors(id) ON DELETE SET NULL;

-- 2. Hard duplicate guard: at most ONE active (non-deleted) invoice-owned
--    request per factor. Partial index so legacy NULL rows are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS ux_finance_payment_requests_source_factor_active
  ON public.finance_payment_requests (source_factor_id)
  WHERE source_factor_id IS NOT NULL AND is_deleted = false;

-- 3. Lookup index for the summary-card / badge queries.
CREATE INDEX IF NOT EXISTS ix_finance_payment_requests_source_factor
  ON public.finance_payment_requests (source_factor_id)
  WHERE source_factor_id IS NOT NULL;

-- 4. Server-side approval guard. Fires BEFORE any UPDATE that flips the
--    request header's status to 'approved'. If the request is invoice-owned
--    (source_factor_id NOT NULL), we look up the linked factor's
--    lifecycle_state and reject the update unless it is 'approved'.
--    This makes the rule unbypassable from the client.
CREATE OR REPLACE FUNCTION public.guard_invoice_owned_settlement_approval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inv_state text;
BEGIN
  -- Only act on transitions INTO 'approved' so re-saving an already-approved
  -- request is a no-op (and so the cascade trigger below — which writes
  -- 'cancelled' — never trips this guard).
  IF NEW.status = 'approved'
     AND COALESCE(OLD.status, '') IS DISTINCT FROM 'approved'
     AND NEW.source_factor_id IS NOT NULL THEN
    SELECT lifecycle_state INTO inv_state
      FROM public.factors
     WHERE id = NEW.source_factor_id;

    -- Legacy/never-approved factors leave lifecycle_state NULL → treated as
    -- "not approved" for the purposes of this guard, by design.
    IF inv_state IS DISTINCT FROM 'approved' THEN
      RAISE EXCEPTION
        'INVOICE_NOT_APPROVED: linked invoice (lifecycle_state=%) must be approved before its settlement request can be approved',
        COALESCE(inv_state, 'null')
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_invoice_owned_settlement_approval
  ON public.finance_payment_requests;
CREATE TRIGGER trg_guard_invoice_owned_settlement_approval
  BEFORE UPDATE OF status ON public.finance_payment_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_invoice_owned_settlement_approval();

-- 5. Cascade invoice cancellation/rejection onto its linked request.
--    Skips rows that are already terminal or have any execution footprint
--    (paid/partially_paid/executed) so settled money is never undone here.
CREATE OR REPLACE FUNCTION public.sync_factor_settlement_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.lifecycle_state IS DISTINCT FROM OLD.lifecycle_state
     AND NEW.lifecycle_state IN ('cancelled', 'rejected') THEN
    UPDATE public.finance_payment_requests
       SET status = NEW.lifecycle_state,
           updated_at = now()
     WHERE source_factor_id = NEW.id
       AND is_deleted = false
       AND status NOT IN ('cancelled', 'rejected', 'executed', 'paid', 'partially_paid');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_factor_settlement_status ON public.factors;
CREATE TRIGGER trg_sync_factor_settlement_status
  AFTER UPDATE OF lifecycle_state ON public.factors
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_factor_settlement_status();