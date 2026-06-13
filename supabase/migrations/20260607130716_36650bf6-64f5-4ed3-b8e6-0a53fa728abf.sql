-- ============================================================================
-- Temporary RLS relaxation for finance_rollback_audit
-- ============================================================================
-- TODO: Rollback audit RLS is temporarily relaxed for validation.
--       Final access model must be implemented during global role/access-control phase.
--
-- Current priority: complete and validate the rollback workflow end-to-end.
-- We will redesign and apply the full system-wide role/access model later
-- for all modules together.
--
-- Changes:
--   1. Drop the admin-only SELECT and INSERT policies.
--   2. Replace with permissive policies that allow ALL authenticated users
--      to INSERT and SELECT.
--   3. UPDATE and DELETE remain unprivileged → blocked by default.
-- ============================================================================

-- Remove the old restrictive policies.
DROP POLICY IF EXISTS "Admins can view rollback audit" ON public.finance_rollback_audit;
DROP POLICY IF EXISTS "Admins can insert rollback audit" ON public.finance_rollback_audit;

-- Allow every authenticated user to read the audit log (temporary).
CREATE POLICY "Authenticated users can view rollback audit"
    ON public.finance_rollback_audit
    FOR SELECT
    TO authenticated
    USING (true);

-- Allow every authenticated user to insert audit rows (temporary).
CREATE POLICY "Authenticated users can insert rollback audit"
    ON public.finance_rollback_audit
    FOR INSERT
    TO authenticated
    WITH CHECK (true);