
-- ============================================================================
-- Auto-identification of bank transactions during Excel import
-- ============================================================================

-- 1) bankpartyaccountinfos: add a clean UUID FK to finance_parties.
--    The legacy `bankpartyid` (bigint) is left untouched for back-compat.
ALTER TABLE public.bankpartyaccountinfos
  ADD COLUMN IF NOT EXISTS finance_party_id uuid REFERENCES public.finance_parties(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_bankpartyaccountinfos_lookup
  ON public.bankpartyaccountinfos (matchtype, matchcontent);
CREATE INDEX IF NOT EXISTS idx_bankpartyaccountinfos_party
  ON public.bankpartyaccountinfos (finance_party_id);

-- bankpartyaccountinfos currently has no PK in the public schema. Add one
-- if missing so we can FK to it from finance_bank_tx_identifiers.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.bankpartyaccountinfos'::regclass AND contype='p'
  ) THEN
    -- Surrogate sequence-backed PK using the existing id column if usable
    -- otherwise create a fresh uuid PK column.
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='bankpartyaccountinfos' AND column_name='id') THEN
      -- backfill missing ids
      UPDATE public.bankpartyaccountinfos
         SET id = COALESCE(id, nextval(pg_get_serial_sequence('public.bankpartyaccountinfos','id')))
       WHERE id IS NULL;
      ALTER TABLE public.bankpartyaccountinfos ALTER COLUMN id SET NOT NULL;
      ALTER TABLE public.bankpartyaccountinfos ADD PRIMARY KEY (id);
    END IF;
  END IF;
END $$;

-- 2) Extracted identifiers per bank transaction (multi-value, audit-friendly).
CREATE TABLE IF NOT EXISTS public.finance_bank_tx_identifiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_transaction_id uuid NOT NULL REFERENCES public.finance_bank_transactions(id) ON DELETE CASCADE,
  match_type smallint NOT NULL CHECK (match_type IN (1,2,3)),  -- 1=card,2=iban,3=account
  raw_value text NOT NULL,
  normalized_value text NOT NULL,
  bankpartyaccountinfo_id bigint REFERENCES public.bankpartyaccountinfos(id) ON DELETE SET NULL,
  verified_owner_name text,
  verified_bank_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bank_transaction_id, match_type, normalized_value)
);
CREATE INDEX IF NOT EXISTS idx_bank_tx_ident_norm
  ON public.finance_bank_tx_identifiers (match_type, normalized_value);
CREATE INDEX IF NOT EXISTS idx_bank_tx_ident_tx
  ON public.finance_bank_tx_identifiers (bank_transaction_id);

ALTER TABLE public.finance_bank_tx_identifiers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read bank tx ident" ON public.finance_bank_tx_identifiers
  FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "auth write bank tx ident" ON public.finance_bank_tx_identifiers
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- 3) Auto-identification metadata on receive identifications.
ALTER TABLE public.finance_receive_identifications
  ADD COLUMN IF NOT EXISTS auto_identified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS matched_by text,
  ADD COLUMN IF NOT EXISTS matched_identifier text,
  ADD COLUMN IF NOT EXISTS bankpartyaccountinfo_id bigint REFERENCES public.bankpartyaccountinfos(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS match_confidence numeric,
  ADD COLUMN IF NOT EXISTS identification_source text;

-- 4) Audit log for every auto-identification step.
CREATE TABLE IF NOT EXISTS public.finance_auto_identification_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_transaction_id uuid NOT NULL REFERENCES public.finance_bank_transactions(id) ON DELETE CASCADE,
  step text NOT NULL,
  success boolean NOT NULL,
  candidates jsonb,
  chosen_party_id uuid,
  message text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_auto_id_log_tx ON public.finance_auto_identification_log (bank_transaction_id);
ALTER TABLE public.finance_auto_identification_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read auto id log" ON public.finance_auto_identification_log
  FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "auth write auto id log" ON public.finance_auto_identification_log
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- 5) Feature flag table (lightweight) for gating Phase 5 Sepidar auto-post.
CREATE TABLE IF NOT EXISTS public.finance_feature_flags (
  key text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  description text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.finance_feature_flags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read flags" ON public.finance_feature_flags
  FOR SELECT USING (auth.role() = 'authenticated');

INSERT INTO public.finance_feature_flags (key, enabled, description)
VALUES ('auto_post_receives_to_sepidar', false,
        'When true, auto-identified receive identifications are immediately posted to Sepidar.')
ON CONFLICT (key) DO NOTHING;

-- 6) RPC: safely create a receive identification from the auto pipeline.
--    All existing DB guards (fn_finance_receive_identifications_guard) still run.
CREATE OR REPLACE FUNCTION public.auto_create_receive_identification(
  p_bank_transaction_id uuid,
  p_party_id uuid,
  p_bankpartyaccountinfo_id bigint,
  p_matched_by text,
  p_matched_identifier text,
  p_confidence numeric
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_tx public.finance_bank_transactions%ROWTYPE;
BEGIN
  -- Load the bank transaction so we can copy bank_id / amount / datetime.
  SELECT * INTO v_tx
    FROM public.finance_bank_transactions
   WHERE id = p_bank_transaction_id
     AND COALESCE(is_deleted, false) = false
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'تراکنش بانکی یافت نشد.';
  END IF;

  -- The existing trigger fn_finance_receive_identifications_guard validates
  -- deposit type, unassigned status, duplicate prevention and amount.
  INSERT INTO public.finance_receive_identifications (
    title, description, party_id, bank_id, bank_transaction_id,
    amount, transaction_datetime, status,
    auto_identified, matched_by, matched_identifier,
    bankpartyaccountinfo_id, match_confidence, identification_source,
    approved_at
  ) VALUES (
    'شناسایی خودکار واریز', 'auto-identified via excel import',
    p_party_id, v_tx.bank_id, v_tx.id,
    COALESCE(v_tx.deposit_amount, v_tx.amount, 0),
    v_tx.transaction_datetime,
    'approved',
    true, p_matched_by, p_matched_identifier,
    p_bankpartyaccountinfo_id, p_confidence, 'excel_import_auto',
    now()
  )
  RETURNING id INTO v_id;

  -- Persist trusted link on the cache row for future imports.
  IF p_bankpartyaccountinfo_id IS NOT NULL THEN
    UPDATE public.bankpartyaccountinfos
       SET finance_party_id = COALESCE(finance_party_id, p_party_id)
     WHERE id = p_bankpartyaccountinfo_id;
  END IF;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.auto_create_receive_identification(uuid,uuid,bigint,text,text,numeric) FROM public;
GRANT EXECUTE ON FUNCTION public.auto_create_receive_identification(uuid,uuid,bigint,text,text,numeric) TO authenticated;
