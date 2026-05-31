-- Ensure Sepidar settings have the standard party ledger account configured.
-- 193 = "حسابهای پرداختنی تجاری" — the single ledger account used for ALL
-- customer/supplier voucher lines (invoices, receipts, payments, finance
-- vouchers, check vouchers). Without this set, party sync falls back to the
-- hardcoded 193 in the app — we make it explicit here.
INSERT INTO public.finance_sepidar_settings (sepidar_party_account_sl_ref)
SELECT 193
WHERE NOT EXISTS (SELECT 1 FROM public.finance_sepidar_settings);

UPDATE public.finance_sepidar_settings
   SET sepidar_party_account_sl_ref = 193,
       updated_at = now()
 WHERE sepidar_party_account_sl_ref IS NULL
    OR sepidar_party_account_sl_ref <= 0;

-- Backfill: every party with a non-standard sepidar_account_id is force-reset
-- to the standard party ledger account. The SP-returned per-party AccountSLRef
-- (e.g. 463) is incorrect for our accounting model and breaks Sepidar posting
-- with FK_VoucherItem_AccountSLRef. party_account_sl_ref (if explicitly set)
-- is left intact so manual per-party overrides still win.
UPDATE public.finance_parties fp
   SET sepidar_account_id = COALESCE(
         (SELECT s.sepidar_party_account_sl_ref
            FROM public.finance_sepidar_settings s
           LIMIT 1),
         193),
       updated_at = now()
 WHERE fp.sepidar_party_id IS NOT NULL
   AND (
     fp.sepidar_account_id IS NULL
     OR fp.sepidar_account_id <> COALESCE(
          (SELECT s.sepidar_party_account_sl_ref
             FROM public.finance_sepidar_settings s
            LIMIT 1),
          193)
   );