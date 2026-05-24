
-- M5 step 2b: backfill factors.finance_party_id from legacy pointers,
-- then validate the previously-NOT-VALID foreign key.

-- 1) Purchase factors: shopping_center_id → finance_parties.legacy_id
UPDATE public.factors f
SET finance_party_id = fp.id,
    updated_at = now()
FROM public.finance_parties fp
WHERE f.finance_party_id IS NULL
  AND f.factor_type_id = 1
  AND f.shopping_center_id IS NOT NULL
  AND fp.legacy_id = f.shopping_center_id
  AND COALESCE(fp.is_deleted, false) = false;

-- 2) Sale factors: buyer_user_id → finance_parties.legacy_id
UPDATE public.factors f
SET finance_party_id = fp.id,
    updated_at = now()
FROM public.finance_parties fp
WHERE f.finance_party_id IS NULL
  AND f.factor_type_id = 2
  AND f.buyer_user_id IS NOT NULL
  AND fp.legacy_id = f.buyer_user_id
  AND COALESCE(fp.is_deleted, false) = false;

-- 3) Validate the FK now that all linked rows resolve.
ALTER TABLE public.factors VALIDATE CONSTRAINT factors_finance_party_id_fkey;
