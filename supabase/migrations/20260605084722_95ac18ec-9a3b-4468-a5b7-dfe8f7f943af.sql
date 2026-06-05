CREATE OR REPLACE FUNCTION public.sync_factor_settlement_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.lifecycle_state IS DISTINCT FROM OLD.lifecycle_state THEN
    -- Cascade cancellation/rejection (unchanged).
    IF NEW.lifecycle_state IN ('cancelled', 'rejected') THEN
      UPDATE public.finance_payment_requests
         SET status = NEW.lifecycle_state,
             updated_at = now()
       WHERE source_factor_id = NEW.id
         AND is_deleted = false
         AND status NOT IN ('cancelled', 'rejected', 'executed', 'paid', 'partially_paid');

    ELSIF NEW.lifecycle_state = 'approved' THEN
      -- Approve invoice-owned request headers in pre-approval states.
      UPDATE public.finance_payment_requests
         SET status = 'approved',
             updated_at = now()
       WHERE source_factor_id = NEW.id
         AND is_deleted = false
         AND status IN ('draft', 'pending_approval');

      -- Also approve their items. Skip items already terminal/post-approval,
      -- deleted, or already linked to a voucher / bank transaction.
      UPDATE public.finance_payment_request_items
         SET status = 'approved',
             updated_at = now()
       WHERE payment_request_id IN (
               SELECT id FROM public.finance_payment_requests
                WHERE source_factor_id = NEW.id AND is_deleted = false
             )
         AND is_deleted = false
         AND status IN ('draft', 'pending_approval')
         AND voucher_id IS NULL
         AND paid_transaction_id IS NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;