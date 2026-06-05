-- ---------------------------------------------------------------------------
-- Bug 3 fix — invoice approval fails with:
--   record "old" has no field "is_deleted"
--
-- Root cause: `tg_block_factor_delete_if_in_active_trip` references
-- OLD.is_deleted, but public.factors has NO `is_deleted` column. The
-- function was attached BOTH as BEFORE DELETE and BEFORE UPDATE on factors;
-- the UPDATE attachment was intended to catch soft-delete flips, but since
-- factors has no soft-delete column, the UPDATE path is dead and every
-- UPDATE on factors (including lifecycle_state → 'approved') errored out
-- in Postgres before reaching the function body.
--
-- Fix:
--   1. Rewrite the function so it only references columns that exist on
--      factors. The freight-trip protection applies to hard DELETE only.
--   2. Drop the BEFORE UPDATE trigger — it has no work to do on factors.
--   3. Keep the BEFORE DELETE trigger intact; the freight-link guard
--      semantics are unchanged for hard deletes.
--
-- Not touched: invoice ↔ settlement sync trigger, Sepidar, vouchers,
-- bank allocation, freight-trip flow, amount_type_code.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.tg_block_factor_delete_if_in_active_trip()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_count   integer;
  v_factor_id uuid;
BEGIN
  -- factors has no `is_deleted` column. The only safe enforcement context
  -- is a hard DELETE; any UPDATE path is a no-op here.
  IF TG_OP <> 'DELETE' THEN
    RETURN NEW;
  END IF;

  v_factor_id := OLD.id;

  SELECT count(*) INTO v_count
  FROM public.freight_trip_invoices fti
  JOIN public.freight_trips ft ON ft.id = fti.trip_id
  WHERE fti.factor_id = v_factor_id
    AND fti.is_deleted = false
    AND ft.is_deleted = false
    AND ft.status <> 'cancelled';

  IF v_count > 0 THEN
    RAISE EXCEPTION
      'این فاکتور به % سرویس حمل فعال متصل است. ابتدا اتصال را قطع کنید.', v_count
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN OLD;
END;
$function$;

-- Drop the redundant BEFORE UPDATE trigger that caused the OLD.is_deleted
-- reference to be evaluated on every factor update (including approval).
DROP TRIGGER IF EXISTS trg_factors_block_delete_if_in_active_trip_upd
  ON public.factors;
