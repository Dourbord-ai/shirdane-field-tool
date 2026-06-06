-- RPC که جمع بدهکار/بستانکار/مانده هر ذینفع را از روی finance_voucher_items
-- محاسبه می‌کند. ذینفعان بدون سند هم با مقادیر صفر برمی‌گردند (LEFT JOIN).
-- اسناد و ذینفعان حذف‌شده محاسبه نمی‌شوند.
CREATE OR REPLACE FUNCTION public.get_beneficiary_balances()
RETURNS TABLE (
  party_id uuid,
  debtor_total numeric,
  creditor_total numeric,
  balance numeric,
  balance_status text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    fp.id AS party_id,
    COALESCE(SUM(COALESCE(vi.debit, 0)), 0) AS debtor_total,
    COALESCE(SUM(COALESCE(vi.credit, 0)), 0) AS creditor_total,
    COALESCE(SUM(COALESCE(vi.credit, 0) - COALESCE(vi.debit, 0)), 0) AS balance,
    CASE
      WHEN COALESCE(SUM(COALESCE(vi.credit, 0) - COALESCE(vi.debit, 0)), 0) < 0 THEN 'debtor'
      WHEN COALESCE(SUM(COALESCE(vi.credit, 0) - COALESCE(vi.debit, 0)), 0) > 0 THEN 'creditor'
      ELSE 'settled'
    END AS balance_status
  FROM public.finance_parties fp
  LEFT JOIN public.finance_voucher_items vi
    ON vi.party_id = fp.id
  LEFT JOIN public.finance_vouchers v
    ON v.id = vi.voucher_id
   AND COALESCE(v.is_deleted, false) = false
  -- شرط حذف voucher را داخل JOIN گذاشتیم تا ذینفعان بدون سند با LEFT JOIN حذف نشوند.
  -- اگر voucher_item به سند حذف‌شده اشاره داشت، چون v.id نال می‌شود ولی vi همچنان
  -- ردیف دارد، باید آن ردیف را نادیده بگیریم:
  WHERE COALESCE(fp.is_deleted, false) = false
    AND (vi.id IS NULL OR v.id IS NOT NULL)
  GROUP BY fp.id;
$$;

GRANT EXECUTE ON FUNCTION public.get_beneficiary_balances() TO anon, authenticated, service_role;