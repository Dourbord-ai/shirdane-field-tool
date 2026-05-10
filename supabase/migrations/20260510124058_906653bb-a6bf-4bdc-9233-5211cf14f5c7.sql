-- ============================================================
-- TEMP: dev_open_access_policy
-- WARNING: These policies grant full read/write access to all
-- finance tables for both anon and authenticated roles.
-- This is ONLY for development while role/permission checks
-- are bypassed (DEV_ACCESS_MODE in src/lib/devAccess.ts).
-- DROP THESE POLICIES BEFORE GOING TO PRODUCTION.
-- ============================================================

DO $$
DECLARE
  t text;
  finance_tables text[] := ARRAY[
    'finance_banks',
    'finance_bank_transactions',
    'finance_bank_transfers',
    'finance_bank_import_templates',
    'finance_parties',
    'finance_party_transfers',
    'finance_payment_requests',
    'finance_payment_request_items',
    'finance_payment_allocations',
    'finance_receive_identifications',
    'finance_sepidar_settings',
    'finance_sepidar_sync_logs',
    'finance_sepidar_bank_accounts_cache',
    'finance_vouchers',
    'finance_voucher_items'
  ];
BEGIN
  FOREACH t IN ARRAY finance_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS dev_open_access_policy ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY dev_open_access_policy ON public.%I FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)',
      t
    );
  END LOOP;
END $$;

COMMENT ON POLICY dev_open_access_policy ON public.finance_payment_requests IS
  'TEMP dev-only open access. Remove before production. See src/lib/devAccess.ts';