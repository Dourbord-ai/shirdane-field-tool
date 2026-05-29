
-- ============================================================
-- Single source of truth for finance_parties.balance
-- Mirrors the logic used by BeneficiaryStatementCompare (sum of
-- debit-credit over finance_voucher_items whose parent voucher
-- is not soft-deleted).
-- ============================================================

CREATE OR REPLACE FUNCTION public.recompute_party_balance(p_party_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_party_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.finance_parties fp
     SET balance = COALESCE((
           SELECT SUM(COALESCE(vi.debit,0) - COALESCE(vi.credit,0))
             FROM public.finance_voucher_items vi
             JOIN public.finance_vouchers v ON v.id = vi.voucher_id
            WHERE vi.party_id = p_party_id
              AND COALESCE(v.is_deleted,false) = false
         ), 0)
   WHERE fp.id = p_party_id;
END;
$$;

-- Trigger fn: items
CREATE OR REPLACE FUNCTION public.tg_recompute_party_balance_items()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.recompute_party_balance(OLD.party_id);
    RETURN OLD;
  ELSIF TG_OP = 'INSERT' THEN
    PERFORM public.recompute_party_balance(NEW.party_id);
    RETURN NEW;
  ELSE -- UPDATE
    IF NEW.party_id IS DISTINCT FROM OLD.party_id THEN
      PERFORM public.recompute_party_balance(OLD.party_id);
    END IF;
    PERFORM public.recompute_party_balance(NEW.party_id);
    RETURN NEW;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_recompute_party_balance_items ON public.finance_voucher_items;
CREATE TRIGGER trg_recompute_party_balance_items
AFTER INSERT OR UPDATE OR DELETE ON public.finance_voucher_items
FOR EACH ROW EXECUTE FUNCTION public.tg_recompute_party_balance_items();

-- Trigger fn: voucher is_deleted toggle → recompute every distinct party in its items
CREATE OR REPLACE FUNCTION public.tg_recompute_party_balance_voucher()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
BEGIN
  IF COALESCE(NEW.is_deleted,false) IS DISTINCT FROM COALESCE(OLD.is_deleted,false) THEN
    FOR r IN SELECT DISTINCT party_id FROM public.finance_voucher_items WHERE voucher_id = NEW.id AND party_id IS NOT NULL LOOP
      PERFORM public.recompute_party_balance(r.party_id);
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_recompute_party_balance_voucher ON public.finance_vouchers;
CREATE TRIGGER trg_recompute_party_balance_voucher
AFTER UPDATE OF is_deleted ON public.finance_vouchers
FOR EACH ROW EXECUTE FUNCTION public.tg_recompute_party_balance_voucher();

-- One-time backfill: rebuild every party balance from the voucher items truth.
UPDATE public.finance_parties fp
   SET balance = COALESCE(s.bal, 0)
  FROM (
        SELECT vi.party_id, SUM(COALESCE(vi.debit,0) - COALESCE(vi.credit,0)) AS bal
          FROM public.finance_voucher_items vi
          JOIN public.finance_vouchers v ON v.id = vi.voucher_id
         WHERE COALESCE(v.is_deleted,false) = false
           AND vi.party_id IS NOT NULL
         GROUP BY vi.party_id
       ) s
 WHERE fp.id = s.party_id;

-- Parties with zero items → zero balance
UPDATE public.finance_parties fp
   SET balance = 0
 WHERE NOT EXISTS (
   SELECT 1
     FROM public.finance_voucher_items vi
     JOIN public.finance_vouchers v ON v.id = vi.voucher_id
    WHERE vi.party_id = fp.id
      AND COALESCE(v.is_deleted,false) = false
 )
 AND COALESCE(fp.balance,0) <> 0;

GRANT EXECUTE ON FUNCTION public.recompute_party_balance(uuid) TO authenticated, service_role;
