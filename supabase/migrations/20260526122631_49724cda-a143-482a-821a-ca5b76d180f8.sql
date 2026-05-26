-- Fix finance_payment_request_items.amount_type allowed values.
-- Business meaning: amount_type represents the payment-request amount basis:
--   creditor   = بستانکار (validate beneficiary credit balance)
--   advance    = پیش پرداخت (no balance validation)
--   on_account = علی الحساب (no balance validation)
-- It is NOT a debit/credit accounting direction.
--
-- Existing data audit (pre-migration):
--   creditor (code 2): 4214 rows
--   debtor   (code 1): 1 row   ← legacy; migrate to 'creditor' to drop 'debtor' from the domain.
--
-- We keep amount_type_code untouched (handled by code mapping in src/lib/paymentAmountTypes.ts).

-- 1) Migrate stray legacy 'debtor' row to 'creditor' (single row, code 1).
UPDATE public.finance_payment_request_items
   SET amount_type = 'creditor'
 WHERE amount_type = 'debtor';

-- 2) Drop the old, narrow constraint.
ALTER TABLE public.finance_payment_request_items
  DROP CONSTRAINT IF EXISTS finance_payment_request_items_amount_type_check;

-- 3) Add the corrected constraint. 'prepayment' is kept temporarily as an
--    accepted legacy alias so any in-flight clients are not broken; new
--    inserts from the frontend will use 'advance'.
ALTER TABLE public.finance_payment_request_items
  ADD CONSTRAINT finance_payment_request_items_amount_type_check
  CHECK (amount_type IN ('creditor', 'advance', 'on_account', 'prepayment'));