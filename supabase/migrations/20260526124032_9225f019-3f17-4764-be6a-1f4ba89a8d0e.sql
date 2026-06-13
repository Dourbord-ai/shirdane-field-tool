-- Synchronize amount_type ↔ amount_type_code on finance_payment_request_items.
--
-- Allowed combinations (single source of truth — also encoded in
-- src/lib/paymentAmountTypes.ts and the new buildPaymentRequestItemAmountType
-- helper):
--   creditor    ↔ 1   (بستانکار)
--   advance     ↔ 2   (پیش پرداخت)        ← canonical
--   prepayment  ↔ 2   (پیش پرداخت)        ← legacy alias, kept for compat
--   on_account  ↔ 3   (علی الحساب)
--
-- NOTE: per task instructions we do NOT backfill historical rows here. They
-- will be cleaned up manually on local Supabase. To avoid blocking the
-- migration on legacy data we add the constraint as NOT VALID — it only
-- enforces NEW inserts and updates. A later VALIDATE step (after the manual
-- backfill) can promote it to fully validated.

ALTER TABLE public.finance_payment_request_items
  DROP CONSTRAINT IF EXISTS finance_payment_request_items_amount_type_code_sync;

ALTER TABLE public.finance_payment_request_items
  ADD CONSTRAINT finance_payment_request_items_amount_type_code_sync
  CHECK (
    -- NULLs are tolerated (legacy rows). The pair check only fires when
    -- BOTH fields are present, which is always true for new rows written
    -- through the helper.
    amount_type IS NULL
    OR amount_type_code IS NULL
    OR (amount_type = 'creditor'   AND amount_type_code = 1)
    OR (amount_type = 'advance'    AND amount_type_code = 2)
    OR (amount_type = 'prepayment' AND amount_type_code = 2)
    OR (amount_type = 'on_account' AND amount_type_code = 3)
  ) NOT VALID;