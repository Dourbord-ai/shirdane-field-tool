# Phase 1 — M5 Step 2: Backfill Dry-Run (read-only audit)

> **Status:** dry-run only. **Nothing has been written.** Awaiting approval
> before executing the backfill UPDATE in step 2b.

---

## Audit results — 2026-05-24

### Baseline

| metric | value |
|---|---|
| total factors | 2,450 |
| already linked (`finance_party_id IS NOT NULL`) | 0 |
| null `finance_party_id` (backfill candidates) | 2,450 |
| missing `factor_type_id` | 1 |
| purchase (type=1) with `shopping_center_id` | 2,241 |
| purchase (type=1) without `shopping_center_id` | 135 |
| sale (type=2) with `buyer_user_id` | 5 |
| sale (type=2) without `buyer_user_id` | 68 |

### Match rate into `finance_parties.legacy_id` (active rows only)

| source | candidates | matched | unmatched |
|---|---:|---:|---:|
| purchase: `factors.shopping_center_id` → `finance_parties.legacy_id` | 2,241 | **2,241 (100%)** | 0 |
| sale: `factors.buyer_user_id` → `finance_parties.legacy_id` | 5 | **5 (100%)** | 0 |

### Ambiguity check

- Active `finance_parties.legacy_id` values that map to **more than one** active party: **0**.
- Backfill is deterministic — no row can be linked to two different parties.

---

## Population summary if step 2b runs

| bucket | rows | action |
|---|---:|---|
| purchase, matched | 2,241 | `finance_party_id` set |
| sale, matched | 5 | `finance_party_id` set |
| purchase, no `shopping_center_id` | 135 | left NULL (legacy without counterparty hint) |
| sale, no `buyer_user_id` | 68 | left NULL |
| missing `factor_type_id` | 1 | left NULL |
| **total writes** | **2,246** | **204 rows remain NULL** |

The 204 remaining-NULL rows are all legacy factors with no usable legacy
pointer. They will surface in the future filter UI under "بدون طرف حساب"
and can be tagged manually later — they do **not** block the M5 milestone.

---

## Proposed backfill SQL (NOT EXECUTED YET)

```sql
-- Purchase: shopping_center_id → finance_parties.legacy_id
UPDATE public.factors f
SET finance_party_id = fp.id,
    updated_at = now()
FROM public.finance_parties fp
WHERE f.finance_party_id IS NULL
  AND f.factor_type_id = 1
  AND f.shopping_center_id IS NOT NULL
  AND fp.legacy_id = f.shopping_center_id
  AND COALESCE(fp.is_deleted, false) = false;

-- Sale: buyer_user_id → finance_parties.legacy_id
UPDATE public.factors f
SET finance_party_id = fp.id,
    updated_at = now()
FROM public.finance_parties fp
WHERE f.finance_party_id IS NULL
  AND f.factor_type_id = 2
  AND f.buyer_user_id IS NOT NULL
  AND fp.legacy_id = f.buyer_user_id
  AND COALESCE(fp.is_deleted, false) = false;

-- After backfill: validate the NOT VALID FK that was added in step 1
ALTER TABLE public.factors VALIDATE CONSTRAINT factors_finance_party_id_fkey;
```

### Post-backfill verification (will be re-run as step 2c)

```sql
-- Expected: 2,246 (matches population summary above)
SELECT COUNT(*) AS linked FROM public.factors WHERE finance_party_id IS NOT NULL;

-- Expected: 204 (135 + 68 + 1)
SELECT COUNT(*) AS still_null FROM public.factors WHERE finance_party_id IS NULL;

-- Expected: empty (zero rows where the FK target row no longer exists)
SELECT f.id, f.finance_party_id
FROM public.factors f
LEFT JOIN public.finance_parties fp ON fp.id = f.finance_party_id
WHERE f.finance_party_id IS NOT NULL AND fp.id IS NULL;

-- Expected: convalidated=true
SELECT conname, convalidated
FROM pg_constraint WHERE conname = 'factors_finance_party_id_fkey';
```

---

## Rollback for step 2b (if needed)

```sql
-- Only reverts what step 2b wrote (rows whose finance_party_id was NULL
-- before this migration). Safe to run; will not touch any future
-- user-set finance_party_id values created after step 2b.
UPDATE public.factors
SET finance_party_id = NULL,
    updated_at = now()
WHERE finance_party_id IS NOT NULL
  AND updated_at >= '<step_2b_timestamp>'::timestamptz;

-- And mark the FK back to NOT VALID if needed (rarely required):
-- (no SQL — VALIDATE is one-way; rollback simply leaves the FK valid,
-- which is harmless because all linked rows still satisfy it.)
```

---

## Decision gate

If approved, step 2b is a **single migration** that runs the two UPDATEs
and the `VALIDATE CONSTRAINT`. No UI, no edge function, no legacy field
removal. Step 3 (UI swap to read/write `finance_party_id`) follows
separately.
