-- ============================================================================
-- finance_rollback_audit
-- ----------------------------------------------------------------------------
-- Immutable log of every Sepidar voucher rollback / cancellation initiated
-- from the application. This table is the single source of truth for
-- "who reversed what, when, and why".
--
-- Architecture rule:
--   Rows are inserted by the application orchestrator (src/lib/finance/
--   rollback.ts) ONLY AFTER bridge.RollbackSepidarVoucher returns success
--   (or result_code = 2 / already deleted). Never insert speculatively.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.finance_rollback_audit (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Which entity was rolled back. Kept as text (not enum) so adding new
    -- entity types in the future does not require a migration.
    entity_type             TEXT NOT NULL
        CHECK (entity_type IN (
            'factor',
            'payment_request',
            'receive_identification',
            'payment_allocation',
            'bank_transfer',
            'party_transfer',
            'check'
        )),
    entity_id               UUID NOT NULL,

    -- 'rollback' = full reversal, 'cancel' = soft cancel (entity-specific).
    action                  TEXT NOT NULL DEFAULT 'rollback'
        CHECK (action IN ('rollback', 'cancel')),

    -- Operator-provided justification. Required by UI.
    rollback_reason         TEXT NOT NULL,

    -- Lifecycle snapshots — keep both for quick diffing in the audit UI.
    old_status              TEXT,
    new_status              TEXT,

    -- The Sepidar voucher targeted by the rollback. Preserved forever for
    -- traceability — do NOT null this out even if the underlying voucher row
    -- is removed from Sepidar.
    sepidar_voucher_id      BIGINT,

    -- Raw result returned by bridge.RollbackSepidarVoucher
    -- (success / result_code / message / data).
    sepidar_delete_result   JSONB,

    -- Optional full-row snapshots taken by the orchestrator before / after
    -- it mutated the affected entity. snapshot_after is best-effort.
    snapshot_before         JSONB,
    snapshot_after          JSONB,

    -- Operator identity. References app_users (not auth.users) to match the
    -- project's API-based auth model.
    performed_by            UUID REFERENCES public.app_users(id) ON DELETE SET NULL,
    performed_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Free-form extensibility bucket (related ids, recomputed balances, etc.).
    metadata                JSONB NOT NULL DEFAULT '{}'::jsonb,

    created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Frequent lookup paths: by entity, by voucher, by operator timeline.
CREATE INDEX IF NOT EXISTS idx_finance_rollback_audit_entity
    ON public.finance_rollback_audit (entity_type, entity_id, performed_at DESC);
CREATE INDEX IF NOT EXISTS idx_finance_rollback_audit_voucher
    ON public.finance_rollback_audit (sepidar_voucher_id);
CREATE INDEX IF NOT EXISTS idx_finance_rollback_audit_performed_at
    ON public.finance_rollback_audit (performed_at DESC);

-- ---------------------------------------------------------------------------
-- GRANTs — required: PostgREST does not grant default privileges on public.
-- authenticated users need INSERT + SELECT (gated by RLS below).
-- service_role needs full access for edge functions.
-- anon is NOT granted: this is an internal audit log.
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT ON public.finance_rollback_audit TO authenticated;
GRANT ALL ON public.finance_rollback_audit TO service_role;

ALTER TABLE public.finance_rollback_audit ENABLE ROW LEVEL SECURITY;

-- Helper: returns TRUE when the calling app_users row has a role that is
-- allowed to perform rollbacks. Centralised so adding a future
-- 'finance_manager' role is a one-line change here, not 6 policies.
--
-- SECURITY DEFINER lets us read app_users / app_roles without granting the
-- caller direct access. search_path is pinned to prevent hijack.
CREATE OR REPLACE FUNCTION public.fn_can_rollback_finance(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.app_users u
        JOIN public.app_roles r ON r.id = u.role_id
        WHERE u.id = _user_id
          AND u.is_active = true
          -- Extensible whitelist. Add 'finance_manager' here when the role
          -- is introduced; no other change needed.
          AND r.name IN ('admin', 'super_admin')
    );
$$;

-- View policy: admins + super_admins can see the full log.
-- (We do not expose audit rows to regular users in V1.)
CREATE POLICY "Admins can view rollback audit"
    ON public.finance_rollback_audit
    FOR SELECT
    TO authenticated
    USING (public.fn_can_rollback_finance(auth.uid()));

-- Insert policy: same role gate. The orchestrator passes performed_by
-- explicitly; we additionally require it to match the caller for traceability
-- (NULL is allowed so edge functions running as service_role aren't blocked
-- — service_role bypasses RLS entirely anyway).
CREATE POLICY "Admins can insert rollback audit"
    ON public.finance_rollback_audit
    FOR INSERT
    TO authenticated
    WITH CHECK (public.fn_can_rollback_finance(auth.uid()));

-- No UPDATE / DELETE policies → audit rows are immutable from the client.