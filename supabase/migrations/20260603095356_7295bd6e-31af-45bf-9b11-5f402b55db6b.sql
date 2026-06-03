-- Phase 6A: Party Bank Accounts foundation
-- Reusable per-party account registry (cards / IBANs / account numbers) with
-- verification status. Phase 6B will let settlement items pick from these.

-- 1) Main table
CREATE TABLE public.finance_party_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Owner party. CASCADE so deleting a party purges its accounts.
  party_id uuid NOT NULL REFERENCES public.finance_parties(id) ON DELETE CASCADE,
  -- card | account | sheba — aligned with existing settlementItemDetails enum.
  account_type text NOT NULL CHECK (account_type IN ('card','account','sheba')),
  -- Raw normalized digits (no spaces/dashes). UI masks for display.
  account_value text NOT NULL,
  -- Human nickname/title for the account (e.g. "حساب جاری ملت").
  account_title text,
  -- Name the user typed at registration time.
  declared_owner_name text NOT NULL,
  -- Name & bank returned by verify-account.
  verified_owner_name text,
  verified_bank_name text,
  -- Verification lifecycle.
  verification_status text NOT NULL DEFAULT 'pending'
    CHECK (verification_status IN ('pending','verified','mismatch','invalid','unknown')),
  verified_at timestamptz,
  verified_by uuid,
  -- Full verify-account payload for audit / re-render.
  raw_response jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Default account for the party (max one — enforced by partial unique index).
  is_default boolean NOT NULL DEFAULT false,
  -- Soft-disable (kept for history) vs soft-delete.
  is_active boolean NOT NULL DEFAULT true,
  is_deleted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2) GRANTs — match the open pattern used by every other finance_* table here.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.finance_party_accounts TO anon, authenticated;
GRANT ALL ON public.finance_party_accounts TO service_role;

-- 3) RLS — same permissive policy as finance_parties (single-tenant app).
ALTER TABLE public.finance_party_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dev_open_access_policy"
  ON public.finance_party_accounts
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);

-- 4) Indexes
CREATE INDEX idx_fpa_party_id ON public.finance_party_accounts(party_id);
CREATE INDEX idx_fpa_party_active ON public.finance_party_accounts(party_id) WHERE is_active AND NOT is_deleted;
CREATE INDEX idx_fpa_party_type ON public.finance_party_accounts(party_id, account_type);
CREATE INDEX idx_fpa_verification_status ON public.finance_party_accounts(verification_status);
-- Searchable index on account_value for cross-party duplicate detection &
-- quick lookup (e.g. "which party owns this card?").
CREATE INDEX idx_fpa_account_value ON public.finance_party_accounts(account_value) WHERE NOT is_deleted;
CREATE INDEX idx_fpa_type_value ON public.finance_party_accounts(account_type, account_value) WHERE NOT is_deleted;

-- 5) Per-party uniqueness — no duplicate value within the same party.
CREATE UNIQUE INDEX uniq_fpa_party_value
  ON public.finance_party_accounts(party_id, account_type, account_value)
  WHERE NOT is_deleted;

-- 6) At most one default per party (among active, non-deleted rows).
CREATE UNIQUE INDEX uniq_fpa_party_default
  ON public.finance_party_accounts(party_id)
  WHERE is_default AND is_active AND NOT is_deleted;

-- 7) updated_at touch trigger (reuse existing helper).
CREATE TRIGGER tg_fpa_touch_updated_at
  BEFORE UPDATE ON public.finance_party_accounts
  FOR EACH ROW EXECUTE FUNCTION public.fn_finance_checks_touch();

-- 8) Invariant: a default account must be active & not deleted.
CREATE OR REPLACE FUNCTION public.fn_fpa_default_invariant()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.is_default AND (NOT NEW.is_active OR NEW.is_deleted) THEN
    RAISE EXCEPTION 'حساب پیش‌فرض باید فعال و حذف‌نشده باشد.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tg_fpa_default_invariant
  BEFORE INSERT OR UPDATE ON public.finance_party_accounts
  FOR EACH ROW EXECUTE FUNCTION public.fn_fpa_default_invariant();

-- 9) Cross-party duplicate detection helper.
-- Returns every OTHER party that owns the same account value, for warning UX.
CREATE OR REPLACE FUNCTION public.fn_fpa_find_duplicates(
  _account_type text,
  _account_value text,
  _exclude_party_id uuid DEFAULT NULL
)
RETURNS TABLE (
  account_id uuid,
  party_id uuid,
  party_full_name text,
  declared_owner_name text,
  verified_owner_name text,
  verification_status text
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.id, a.party_id,
         COALESCE(NULLIF(TRIM(COALESCE(p.first_name,'') || ' ' || COALESCE(p.last_name,'')), ''),
                  p.company_name, '') AS party_full_name,
         a.declared_owner_name,
         a.verified_owner_name,
         a.verification_status
  FROM public.finance_party_accounts a
  JOIN public.finance_parties p ON p.id = a.party_id
  WHERE a.account_type = _account_type
    AND a.account_value = _account_value
    AND NOT a.is_deleted
    AND (_exclude_party_id IS NULL OR a.party_id <> _exclude_party_id);
$$;

GRANT EXECUTE ON FUNCTION public.fn_fpa_find_duplicates(text, text, uuid) TO anon, authenticated, service_role;