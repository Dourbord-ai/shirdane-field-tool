-- ============================================================
-- Flip finance_parties.balance convention to: credit - debit
-- Positive  => بستانکار (party owed money)
-- Negative  => بدهکار  (party owes money)
-- Matches the convention already used by:
--   - src/lib/beneficiaryStatement.ts  (Sepidar reconciliation)
--   - src/components/finance/tabs/FinanceReportsTab.tsx (sign filters)
-- ============================================================

-- 1) Redefine the single source-of-truth function. Same signature, same
--    trigger wiring — only the SUM expression flips sign.
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
           SELECT SUM(COALESCE(vi.credit,0) - COALESCE(vi.debit,0))
             FROM public.finance_voucher_items vi
             JOIN public.finance_vouchers v ON v.id = vi.voucher_id
            WHERE vi.party_id = p_party_id
              AND COALESCE(v.is_deleted,false) = false
         ), 0)
   WHERE fp.id = p_party_id;
END;
$$;

-- 2) Full backfill — recompute every party from voucher_items truth instead
--    of multiplying old (possibly stale) balances by -1.
UPDATE public.finance_parties fp
   SET balance = COALESCE(s.bal, 0)
  FROM (
        SELECT vi.party_id,
               SUM(COALESCE(vi.credit,0) - COALESCE(vi.debit,0)) AS bal
          FROM public.finance_voucher_items vi
          JOIN public.finance_vouchers v ON v.id = vi.voucher_id
         WHERE COALESCE(v.is_deleted,false) = false
           AND vi.party_id IS NOT NULL
         GROUP BY vi.party_id
       ) s
 WHERE fp.id = s.party_id;

-- 3) Parties with no remaining voucher items → balance must be zero.
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