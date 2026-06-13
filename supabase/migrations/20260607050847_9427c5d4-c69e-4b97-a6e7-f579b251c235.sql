-- Add rollback lifecycle metadata to finance_vouchers.
-- Per Phase 1/2 agreement we never null sepidar_voucher_id; instead we track
-- the rollback state through these dedicated fields.

ALTER TABLE public.finance_vouchers
    ADD COLUMN IF NOT EXISTS sepidar_status   TEXT,
    ADD COLUMN IF NOT EXISTS rollback_at      TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS rollback_by      UUID REFERENCES public.app_users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS rollback_reason  TEXT;

-- Constrain allowed values. Use a CHECK that tolerates NULL so legacy rows
-- (pre-Sepidar or not yet posted) are not invalidated.
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'finance_vouchers_sepidar_status_chk'
    ) THEN
        ALTER TABLE public.finance_vouchers
            ADD CONSTRAINT finance_vouchers_sepidar_status_chk
            CHECK (sepidar_status IS NULL OR sepidar_status IN ('posted','rolled_back','deleted','failed'));
    END IF;
END $$;

-- Backfill: every voucher that currently has a Sepidar reference is, by
-- definition, in the 'posted' state.
UPDATE public.finance_vouchers
   SET sepidar_status = 'posted'
 WHERE sepidar_voucher_id IS NOT NULL
   AND sepidar_status IS NULL;

-- Index to find rolled-back vouchers quickly in audit screens.
CREATE INDEX IF NOT EXISTS idx_finance_vouchers_sepidar_status
    ON public.finance_vouchers (sepidar_status)
    WHERE sepidar_status IS NOT NULL;