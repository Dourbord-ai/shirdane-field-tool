ALTER TABLE public.factors
  ADD COLUMN finance_party_id uuid NULL;

ALTER TABLE public.factors
  ADD CONSTRAINT factors_finance_party_id_fkey
  FOREIGN KEY (finance_party_id)
  REFERENCES public.finance_parties(id)
  ON DELETE RESTRICT
  NOT VALID;

CREATE INDEX IF NOT EXISTS idx_factors_finance_party_id
  ON public.factors(finance_party_id);

COMMENT ON COLUMN public.factors.finance_party_id IS
  'Canonical counterparty for factor (seller for purchase, buyer for sale). Source of truth for Sepidar PartyId / PartyAccountSLRef. shopping_center_id and buyer_user_id are legacy fallback only.';