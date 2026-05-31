-- Make product-specific factor item detail rows OPTIONAL.
-- The trigger trg_factor_items_check_detail was raising:
--   "factor_items(...) must have exactly one matching <type> detail row (found 0)"
-- which blocked factor saves when the optional snapshot row was missing.
-- We relax the rule: factors + factor_items are the source of truth; detail
-- snapshots are best-effort and must never block the save.

DROP TRIGGER IF EXISTS trg_factor_items_check_detail ON public.factor_items;

CREATE OR REPLACE FUNCTION public.fn_factor_items_check_detail()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Intentionally a no-op. Detail snapshots are optional now.
  -- Kept for backward compatibility in case any code references the function.
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;