# Phase 1 / M5 — Migration Package: `factors.finance_party_id`

Status: **DRAFT — not executed.** Awaiting explicit approval before running.

Scope: additive only. Adds a canonical counterparty link from `public.factors`
to `public.finance_parties`. No drops, no backfill, no UI change, no edge
function change in this step.

---

## 0. BEFORE audit (run first, read-only)

Purpose: snapshot current state so we can compare AFTER the migration and
confirm nothing else changed.

```sql
-- 0.1 Confirm finance_parties exists and has uuid PK (target of FK)
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'finance_parties'
  AND column_name = 'id';

-- 0.2 Confirm finance_party_id does NOT already exist on factors
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'factors'
  AND column_name = 'finance_party_id';
-- Expected: 0 rows

-- 0.3 Snapshot row counts and legacy counterparty fill rates
SELECT
  count(*)                                                       AS total_factors,
  count(*) FILTER (WHERE factor_type_id = 1)                     AS purchase_count,
  count(*) FILTER (WHERE factor_type_id = 2)                     AS sale_count,
  count(*) FILTER (WHERE shopping_center_id IS NOT NULL)         AS has_shopping_center_id,
  count(*) FILTER (WHERE buyer_user_id IS NOT NULL)              AS has_buyer_user_id
FROM public.factors;

-- 0.4 Existing indexes on factors (to confirm new index is additive)
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'factors'
ORDER BY indexname;

-- 0.5 Existing FKs on factors (to confirm new FK is additive)
SELECT conname, pg_get_constraintdef(c.oid) AS definition
FROM pg_constraint c
JOIN pg_class t ON t.oid = c.conrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
WHERE n.nspname = 'public'
  AND t.relname = 'factors'
  AND c.contype = 'f'
ORDER BY conname;
```

Save the output of 0.3 / 0.4 / 0.5 — these are the BEFORE baseline.

---

## 1. Migration SQL (additive, reversible)

```sql
-- =====================================================================
-- M5: add canonical counterparty link factors.finance_party_id
-- Additive only. Nullable. No backfill. Legacy fields untouched.
-- =====================================================================

BEGIN;

-- 1.1 Add the column.
--     - uuid to match finance_parties.id
--     - NULL allowed because existing rows have no value yet
--     - no DEFAULT (we do not want to backfill at this step)
ALTER TABLE public.factors
  ADD COLUMN finance_party_id uuid NULL;

-- 1.2 Add the foreign key as NOT VALID.
--     - NOT VALID skips the full-table check for existing rows
--     - new INSERT/UPDATE rows are still validated
--     - we can VALIDATE CONSTRAINT later, after backfill, without
--       holding a long lock now
ALTER TABLE public.factors
  ADD CONSTRAINT factors_finance_party_id_fkey
  FOREIGN KEY (finance_party_id)
  REFERENCES public.finance_parties(id)
  ON DELETE RESTRICT
  NOT VALID;

-- 1.3 Add a btree index for join/lookup performance from the edge
--     function (factor-post-voucher) and admin queries.
CREATE INDEX IF NOT EXISTS idx_factors_finance_party_id
  ON public.factors(finance_party_id);

-- 1.4 Document intent so future readers know this is the canonical
--     counterparty and that shopping_center_id / buyer_user_id are
--     legacy fallback only.
COMMENT ON COLUMN public.factors.finance_party_id IS
  'Canonical counterparty for factor (seller for purchase, buyer for sale). '
  'Source of truth for Sepidar PartyId / PartyAccountSLRef. '
  'shopping_center_id and buyer_user_id are legacy fallback only.';

COMMIT;
```

Notes:
- No RLS change. `factors` keeps its existing policies.
- No trigger change.
- No change to `shopping_center_id` or `buyer_user_id`.
- Safe to run on a live table: only a metadata lock for ADD COLUMN NULL +
  NOT VALID FK + CREATE INDEX (non-CONCURRENT is fine on Supabase for
  small/medium tables; switch to `CREATE INDEX CONCURRENTLY` outside the
  transaction if `factors` is very large — note that CONCURRENTLY cannot
  run inside `BEGIN`).

---

## 2. AFTER audit (run immediately after migration)

```sql
-- 2.1 Column exists, nullable, correct type
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'factors'
  AND column_name = 'finance_party_id';
-- Expected: uuid, YES, NULL

-- 2.2 FK exists and references finance_parties(id), NOT VALID
SELECT conname,
       pg_get_constraintdef(c.oid) AS definition,
       c.convalidated
FROM pg_constraint c
JOIN pg_class t ON t.oid = c.conrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
WHERE n.nspname = 'public'
  AND t.relname = 'factors'
  AND c.conname = 'factors_finance_party_id_fkey';
-- Expected: definition references finance_parties(id) ON DELETE RESTRICT,
-- convalidated = false (because of NOT VALID).

-- 2.3 Index exists
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'factors'
  AND indexname = 'idx_factors_finance_party_id';

-- 2.4 No existing row was mutated (sanity)
SELECT count(*) AS factors_total,
       count(finance_party_id) AS factors_with_finance_party_id
FROM public.factors;
-- Expected: factors_with_finance_party_id = 0

-- 2.5 Legacy fields untouched (compare against BEFORE 0.3)
SELECT
  count(*) FILTER (WHERE shopping_center_id IS NOT NULL) AS has_shopping_center_id,
  count(*) FILTER (WHERE buyer_user_id IS NOT NULL)      AS has_buyer_user_id
FROM public.factors;
```

Pass criteria:
- 2.1 returns exactly one row, `data_type = uuid`, `is_nullable = YES`.
- 2.2 returns the FK with `convalidated = false`.
- 2.3 returns the index row.
- 2.4 `factors_with_finance_party_id = 0`.
- 2.5 matches BEFORE numbers exactly.

If any check fails → run rollback (§3) and report.

---

## 3. Rollback SQL

Fully reversible. Run if AFTER audit fails or if we decide to abort.

```sql
BEGIN;

-- 3.1 Drop the index first (depends on the column)
DROP INDEX IF EXISTS public.idx_factors_finance_party_id;

-- 3.2 Drop the FK constraint
ALTER TABLE public.factors
  DROP CONSTRAINT IF EXISTS factors_finance_party_id_fkey;

-- 3.3 Drop the column. Safe because nothing else references it yet
--     (no UI write, no edge function read in this step).
ALTER TABLE public.factors
  DROP COLUMN IF EXISTS finance_party_id;

COMMIT;
```

Post-rollback sanity:
```sql
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'factors'
  AND column_name = 'finance_party_id';
-- Expected: 0 rows
```

---

## 4. Sequencing reminder

1. Run §0 BEFORE audit, save output.
2. Wait for approval.
3. Run §1 migration.
4. Run §2 AFTER audit, compare with §0 baseline.
5. If anything fails → run §3 rollback.
6. Only after approval of audit results do we proceed to step 2 of the
   parent plan (audit & dry-run backfill report). UI and edge function
   changes remain gated.

**Nothing in this document has been executed.**
