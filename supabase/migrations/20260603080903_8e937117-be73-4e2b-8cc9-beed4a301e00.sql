-- =============================================================================
-- Phase 3 (retry) — Settlement item enhancement
-- -----------------------------------------------------------------------------
-- The previous attempt failed because the pre-existing `*_amount_type_code_sync`
-- CHECK constraint (NOT VALID) is re-evaluated whenever a row is touched, and
-- one legacy row violates it (amount_type='creditor', amount_type_code=2).
--
-- Fix: instead of running an `UPDATE ... SET payment_method='legacy'` (which
-- would touch every row and re-trigger that pre-existing constraint), we
-- exploit Postgres' "instant default" optimization. Since PG 11, ADD COLUMN
-- with a constant DEFAULT does NOT rewrite the table — the default is stored
-- as metadata and surfaced by SELECT, with no row touched and no constraint
-- re-checked. We then drop the default so new inserts must specify a method
-- explicitly.
-- =============================================================================

-- 1) Add new columns. payment_method ships with DEFAULT 'legacy' so the
-- existing 3 rows immediately read as 'legacy' without a row-rewriting
-- UPDATE.
ALTER TABLE public.finance_payment_request_items
  ADD COLUMN IF NOT EXISTS payment_method           text NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS settlement_subject_type  text,
  ADD COLUMN IF NOT EXISTS settlement_subject_title text,
  ADD COLUMN IF NOT EXISTS settlement_group_key     text,
  ADD COLUMN IF NOT EXISTS source_factor_id         uuid,
  ADD COLUMN IF NOT EXISTS source_related_cost_id   uuid,
  ADD COLUMN IF NOT EXISTS due_date                 date,
  ADD COLUMN IF NOT EXISTS execution_status         text,
  ADD COLUMN IF NOT EXISTS execution_priority       smallint,
  ADD COLUMN IF NOT EXISTS details                  jsonb;

-- 2) Drop the default so application code must specify payment_method
-- explicitly going forward. (Existing rows keep the materialized 'legacy'
-- value because dropping a default only affects future inserts.)
ALTER TABLE public.finance_payment_request_items
  ALTER COLUMN payment_method DROP DEFAULT;

-- 3) Foreign key: source_factor_id → factors(id). ON DELETE SET NULL so
-- deleting an invoice never wipes settlement history.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_fpri_source_factor') THEN
    ALTER TABLE public.finance_payment_request_items
      ADD CONSTRAINT fk_fpri_source_factor
      FOREIGN KEY (source_factor_id) REFERENCES public.factors(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 4) Whitelist CHECK constraints — added as NOT VALID so they only apply to
-- new/changed rows and never retroactively reject a legacy row. New code
-- paths still get full validation because all our INSERT/UPDATE go through
-- these whitelists.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_fpri_payment_method') THEN
    ALTER TABLE public.finance_payment_request_items
      ADD CONSTRAINT chk_fpri_payment_method
      CHECK (payment_method IS NULL OR payment_method IN
        ('legacy','bank_transfer','cashbox','check','barter','deferred'))
      NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_fpri_subject_type') THEN
    ALTER TABLE public.finance_payment_request_items
      ADD CONSTRAINT chk_fpri_subject_type
      CHECK (settlement_subject_type IS NULL OR settlement_subject_type IN
        ('main_invoice','freight','waybill','unloading','loading',
         'weighing','storage','commission','service','misc'))
      NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_fpri_exec_status') THEN
    ALTER TABLE public.finance_payment_request_items
      ADD CONSTRAINT chk_fpri_exec_status
      CHECK (execution_status IS NULL OR execution_status IN
        ('pending','in_progress','executed','cancelled'))
      NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_fpri_exec_priority') THEN
    ALTER TABLE public.finance_payment_request_items
      ADD CONSTRAINT chk_fpri_exec_priority
      CHECK (execution_priority IS NULL OR execution_priority BETWEEN 1 AND 4)
      NOT VALID;
  END IF;
END $$;

-- 5) Indexes — only for rows where the column is set. Filter expressions
-- (WHERE col IS NOT NULL) keep indexes small.
CREATE INDEX IF NOT EXISTS idx_fpri_settlement_group_key
  ON public.finance_payment_request_items (settlement_group_key)
  WHERE settlement_group_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fpri_source_factor_id
  ON public.finance_payment_request_items (source_factor_id)
  WHERE source_factor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fpri_source_related_cost_id
  ON public.finance_payment_request_items (source_related_cost_id)
  WHERE source_related_cost_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fpri_payment_method
  ON public.finance_payment_request_items (payment_method);
CREATE INDEX IF NOT EXISTS idx_fpri_execution_status
  ON public.finance_payment_request_items (execution_status)
  WHERE execution_status IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fpri_execution_priority
  ON public.finance_payment_request_items (execution_priority)
  WHERE execution_priority IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fpri_due_date
  ON public.finance_payment_request_items (due_date)
  WHERE due_date IS NOT NULL;

-- 6) Column documentation for future maintainers.
COMMENT ON COLUMN public.finance_payment_request_items.payment_method IS
  'Settlement payment method: legacy / bank_transfer / cashbox / check / barter / deferred. ''legacy'' = pre-Phase-3 row whose historical method is unknown.';
COMMENT ON COLUMN public.finance_payment_request_items.settlement_subject_type IS
  'What this settlement item pays for: main_invoice / freight / waybill / unloading / loading / weighing / storage / commission / service / misc.';
COMMENT ON COLUMN public.finance_payment_request_items.settlement_subject_title IS
  'Free-text title shown in UI for the subject (e.g. «کرایه حمل ذرت»).';
COMMENT ON COLUMN public.finance_payment_request_items.settlement_group_key IS
  'Stable key used in UI to visually group items sharing party+subject inside a parent settlement request.';
COMMENT ON COLUMN public.finance_payment_request_items.source_factor_id IS
  'When generated from a purchase invoice, points to factors(id).';
COMMENT ON COLUMN public.finance_payment_request_items.source_related_cost_id IS
  'When generated from a factor_related_costs row (added in Phase 6), points to it.';
COMMENT ON COLUMN public.finance_payment_request_items.due_date IS
  'Target execution / payment date for this item (independent of approval date).';
COMMENT ON COLUMN public.finance_payment_request_items.execution_status IS
  'Independent execution lifecycle: pending / in_progress / executed / cancelled.';
COMMENT ON COLUMN public.finance_payment_request_items.execution_priority IS
  'Liquidity-planning priority: 1=urgent, 2=high, 3=normal, 4=low.';
COMMENT ON COLUMN public.finance_payment_request_items.details IS
  'Per-payment-method transient fields (card/account/IBAN for bank_transfer, payee/reason for check, …). No financial fields here.';
