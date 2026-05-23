-- ============================================================
-- Phase 0 (B1) — Additive schema only, transactional
-- No behavior change. No indexes (run B2 separately with CONCURRENTLY).
-- No data backfill. No trigger/function changes.
-- ============================================================

-- ---------- factors: 17 new nullable columns (no defaults) ----------
ALTER TABLE public.factors
  ADD COLUMN IF NOT EXISTS lifecycle_state            text,
  ADD COLUMN IF NOT EXISTS approved_by                uuid,
  ADD COLUMN IF NOT EXISTS approved_at                timestamptz,
  ADD COLUMN IF NOT EXISTS rejected_by                uuid,
  ADD COLUMN IF NOT EXISTS rejected_at                timestamptz,
  ADD COLUMN IF NOT EXISTS rejection_reason           text,
  ADD COLUMN IF NOT EXISTS voucher_id                 uuid,
  ADD COLUMN IF NOT EXISTS reversal_voucher_id        uuid,
  ADD COLUMN IF NOT EXISTS sepidar_voucher_id         text,
  ADD COLUMN IF NOT EXISTS sepidar_voucher_number     text,
  ADD COLUMN IF NOT EXISTS posting_attempt_count      integer,
  ADD COLUMN IF NOT EXISTS last_posting_error         text,
  ADD COLUMN IF NOT EXISTS last_posting_attempted_at  timestamptz,
  ADD COLUMN IF NOT EXISTS next_retry_at              timestamptz,
  ADD COLUMN IF NOT EXISTS idempotency_key            text,
  ADD COLUMN IF NOT EXISTS posting_locked_at          timestamptz,
  ADD COLUMN IF NOT EXISTS posting_locked_by          uuid;

-- ---------- finance_vouchers: 2 new nullable columns ----------
ALTER TABLE public.finance_vouchers
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS reversal_of     uuid;

-- ---------- FKs (NOT VALID = no scan of existing rows) ----------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_factors_voucher_id') THEN
    ALTER TABLE public.factors
      ADD CONSTRAINT fk_factors_voucher_id
      FOREIGN KEY (voucher_id) REFERENCES public.finance_vouchers(id) ON DELETE SET NULL
      NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_factors_reversal_voucher_id') THEN
    ALTER TABLE public.factors
      ADD CONSTRAINT fk_factors_reversal_voucher_id
      FOREIGN KEY (reversal_voucher_id) REFERENCES public.finance_vouchers(id) ON DELETE SET NULL
      NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_finance_vouchers_reversal_of') THEN
    ALTER TABLE public.finance_vouchers
      ADD CONSTRAINT fk_finance_vouchers_reversal_of
      FOREIGN KEY (reversal_of) REFERENCES public.finance_vouchers(id) ON DELETE SET NULL
      NOT VALID;
  END IF;
END $$;

-- ---------- New tables (RLS enabled, no policies = locked down) ----------
CREATE TABLE IF NOT EXISTS public.factor_state_transitions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factor_id      uuid NOT NULL,
  from_state     text,
  to_state       text NOT NULL,
  actor_user_id  uuid,
  reason         text,
  metadata       jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.factor_state_transitions ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.factor_posting_attempts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factor_id         uuid NOT NULL,
  voucher_id        uuid,
  idempotency_key   text,
  request_payload   jsonb,
  response_payload  jsonb,
  success           boolean,
  error_code        text,
  duration_ms       integer,
  created_at        timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.factor_posting_attempts ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.finance_account_mappings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope           text NOT NULL,
  factor_type_id  uuid,
  product_type    text,
  leg_code        text NOT NULL,
  account_id      uuid,
  dl_source       text,
  dl_static_ref   text,
  tf_source       text,
  tf_static_ref   text,
  sign            text,
  amount_source   text,
  priority        integer NOT NULL DEFAULT 100,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.finance_account_mappings ENABLE ROW LEVEL SECURITY;