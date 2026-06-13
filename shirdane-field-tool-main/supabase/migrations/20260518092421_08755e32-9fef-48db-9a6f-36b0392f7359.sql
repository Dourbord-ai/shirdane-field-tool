-- Add party-specific Sepidar AccountSLRef on finance_parties.
-- Legacy column SepidarAccountId mapped to finance_parties.sepidar_account_id,
-- but the explicit voucher-side reference is party_account_sl_ref.
-- Backfill from existing sepidar_account_id where present so historical
-- parties keep working without manual edits.

ALTER TABLE public.finance_parties
  ADD COLUMN IF NOT EXISTS party_account_sl_ref integer;

UPDATE public.finance_parties
   SET party_account_sl_ref = sepidar_account_id
 WHERE party_account_sl_ref IS NULL
   AND sepidar_account_id IS NOT NULL;

COMMENT ON COLUMN public.finance_parties.party_account_sl_ref
  IS 'Sepidar AccountSLRef used as the party side of voucher rows (PartyAccountSLRef). Falls back to settings/193 only when null.';