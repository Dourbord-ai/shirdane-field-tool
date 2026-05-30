-- Step 1 of 2 — Extend the existing enums BEFORE we can use the new values
-- in CHECK constraints / triggers added in step 2.
--
-- Postgres allows ALTER TYPE … ADD VALUE inside a transaction (PG12+),
-- but the new value cannot be referenced in the same transaction. So we
-- split the migration: enum extensions first, the rest in a second call.

ALTER TYPE public.check_status ADD VALUE IF NOT EXISTS 'active';
ALTER TYPE public.check_status ADD VALUE IF NOT EXISTS 'returned';
ALTER TYPE public.check_status ADD VALUE IF NOT EXISTS 'claimed';
ALTER TYPE public.check_status ADD VALUE IF NOT EXISTS 'expired';
ALTER TYPE public.check_status ADD VALUE IF NOT EXISTS 'cancelled';

ALTER TYPE public.check_event_type ADD VALUE IF NOT EXISTS 'voucher_posted';
ALTER TYPE public.check_event_type ADD VALUE IF NOT EXISTS 'voucher_reversed';
ALTER TYPE public.check_event_type ADD VALUE IF NOT EXISTS 'guarantee_claimed';
ALTER TYPE public.check_event_type ADD VALUE IF NOT EXISTS 'guarantee_returned';
ALTER TYPE public.check_event_type ADD VALUE IF NOT EXISTS 'cancelled';