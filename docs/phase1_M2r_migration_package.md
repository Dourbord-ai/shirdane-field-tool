# Phase 1 — M2r Migration Package (REVISED v2)

**Status:** PREPARED — NOT EXECUTED
**Supersedes:** M2r v1
**Scope:** Create `public.line_role` enum (idempotent) + `public.factor_accounting_map` table + supporting CHECK constraints, indexes, RLS, and inactive placeholder seed rows.

**Out of scope (unchanged):** worker code, frontend, Sepidar posting activation, feature flags, lifecycle backfill, factor registration flow changes, modifications to `factors` / `finance_vouchers` / `finance_voucher_items` / `cow_factor_details` / `sync_queue` / any edge function.

---

## 0. Final decisions locked in this revision

| # | Decision | Rationale |
|---|---|---|
| D1 | `public.line_role` enum **created in M2r** with idempotent `DO $$ ... $$` guard | Verified absent in live DB. Idempotent guard → safe re-run. |
| D2 | `account_code` is **`text` permanently** | Sepidar codes are alphanumeric, hierarchical, may have leading zeros. Industry standard. |
| D3 | `sepidar_account_ref` and `sepidar_account_path` **removed** from M2r | Not needed in Phase 1 MVP; Sepidar posting is gated off; can be added later additively. |
| D4 | `factor_type` is **`text` + CHECK whitelist** (not enum, not FK) | Whitelist enforced; no free-form. Easier to evolve than enum; no canonical reference table exists today. |
| D5 | Canonical `factor_type` ↔ existing `factors.factor_type_id` mapping is **documented in §6** and stamped as comments in the seed rows | Bridge function lives in M3r; M2r only defines the vocabulary. |
| D6 | All seed rows use **exact `line_role` enum labels created in §3.1** | No drift between enum and seeds. |

---

## 1. BEFORE audit (run before migration)

```sql
-- A1: line_role enum must NOT exist yet (we expect 0 rows; if 1 row, migration will skip CREATE TYPE)
SELECT n.nspname, t.typname
FROM pg_type t
JOIN pg_namespace n ON n.oid = t.typnamespace
WHERE n.nspname = 'public' AND t.typname = 'line_role';

-- A2: factor_accounting_map table must NOT exist yet
SELECT to_regclass('public.factor_accounting_map') AS factor_accounting_map_exists;

-- A3: M1r objects still intact
SELECT to_regclass('public.factor_engine_config') AS cfg,
       to_regclass('public.factor_engine_config_versions') AS cfg_versions;

-- A4: factors table shape (read-only sanity — must show factor_type_id smallint, product_type text)
SELECT column_name, data_type, udt_name, is_nullable
FROM information_schema.columns
WHERE table_schema='public' AND table_name='factors'
  AND column_name IN ('factor_type_id','product_type','invoice_type')
ORDER BY column_name;

-- A5: pgcrypto present (for gen_random_uuid)
SELECT extname FROM pg_extension WHERE extname='pgcrypto';

-- A6: no existing policy name collisions
SELECT policyname FROM pg_policies
WHERE schemaname='public' AND tablename='factor_accounting_map';

-- A7: no untouched tables modified between M1r and now (timestamp sanity)
SELECT relname, n_tup_ins, n_tup_upd, n_tup_del
FROM pg_stat_user_tables
WHERE schemaname='public'
  AND relname IN ('factors','finance_vouchers','finance_voucher_items',
                  'cow_factor_details','sync_queue');
```

**Expected:** A1 → 0 rows; A2 → NULL; A3 → both non-NULL; A5 → 1 row; A6 → 0 rows.

---

## 2. Migration SQL (single transaction)

```sql
BEGIN;

-- =========================================================================
-- 2.1  Idempotent enum: public.line_role
-- =========================================================================
-- Verified absent in live DB at design time, but guarded for safe re-run.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'line_role'
  ) THEN
    CREATE TYPE public.line_role AS ENUM (
      'inventory',   -- DR/CR against the livestock (or generic stock) asset account
      'ap',          -- accounts payable (vendor side of a buy)
      'ar',          -- accounts receivable (customer side of a sell)
      'revenue',     -- sales revenue
      'cogs',        -- cost of goods sold (sell side)
      'freight',     -- shipping / delivery cost (capitalizable or expensed per config)
      'discount',    -- contra-revenue / purchase discount
      'tax',         -- VAT / sales tax
      'rounding',    -- balancing rounding line
      'other'        -- escape hatch; map row MUST set scenario_key explicitly
    );
    COMMENT ON TYPE public.line_role IS
      'Phase 1: canonical line-role for finance_voucher_items and factor_accounting_map. Additive only — extend with ALTER TYPE ... ADD VALUE.';
  END IF;
END
$$;

-- =========================================================================
-- 2.2  Table: public.factor_accounting_map
-- =========================================================================
CREATE TABLE public.factor_accounting_map (
  -- Identity --------------------------------------------------------------
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Business key (resolution input) --------------------------------------
  -- factor_type: canonical accounting-engine factor type. TEXT + CHECK
  -- (see §6 for the canonical vocabulary and bridge from factors.factor_type_id).
  factor_type         text NOT NULL,
  -- product_type: matches public.factors.product_type values (e.g. 'livestock').
  product_type        text NOT NULL,
  -- line_role: which leg of the composite voucher this row describes.
  line_role           public.line_role NOT NULL,
  -- scenario_key: optional sub-discriminator for branching within one
  -- (factor_type, product_type, line_role). Examples: 'default',
  -- 'freight_capitalized', 'freight_expensed', 'tax_exempt'.
  scenario_key        text NOT NULL DEFAULT 'default',
  -- side: 'DR' (debit) or 'CR' (credit). One map row = one voucher line.
  side                char(2) NOT NULL,

  -- Resolution output (what gets posted) ---------------------------------
  -- account_code: canonical Sepidar chart-of-accounts code (TEXT permanent
  -- — supports leading zeros, hierarchical segments, alphanumerics).
  account_code        text NOT NULL,
  account_label       text NULL,

  -- DL (تفصیلی) / TF (شناور) source descriptors -------------------------
  -- These tell the engine WHERE to fetch the DL/TF id at posting time
  -- (e.g. from the party, the cow, a warehouse mapping, or a static value).
  -- They are intentionally text and not enums in Phase 1 — vocabulary will
  -- harden in M5r once the worker is implemented.
  dl_source           text NULL,     -- 'party' | 'cow' | 'warehouse' | 'static' | NULL
  static_dl_ref       bigint NULL,   -- used only when dl_source = 'static'
  tf_source           text NULL,     -- 'party' | 'cow' | 'project' | 'static' | NULL
  static_tf_ref       bigint NULL,   -- used only when tf_source = 'static'

  -- Selection strategy ---------------------------------------------------
  priority            integer NOT NULL DEFAULT 100,  -- lower wins on tie
  is_active           boolean NOT NULL DEFAULT false,

  -- Versioning (half-open interval; both nullable = always-valid) --------
  effective_from      timestamptz NULL,
  effective_to        timestamptz NULL,

  -- Free-form ------------------------------------------------------------
  notes               text NULL,

  -- Audit ----------------------------------------------------------------
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid NULL,
  updated_by          uuid NULL,

  -- CHECK constraints ----------------------------------------------------
  CONSTRAINT factor_accounting_map_side_chk
    CHECK (side IN ('DR','CR')),

  -- D4: canonical factor_type whitelist. Extend by ALTER TABLE … DROP/ADD
  -- this constraint in a future additive migration (cheap, reversible).
  CONSTRAINT factor_accounting_map_factor_type_chk
    CHECK (factor_type IN (
      'buy_livestock',
      'sell_livestock'
    )),

  -- product_type guardrail — keep aligned with factors.product_type.
  CONSTRAINT factor_accounting_map_product_type_chk
    CHECK (product_type IN (
      'livestock'
    )),

  -- dl_source / tf_source whitelists
  CONSTRAINT factor_accounting_map_dl_source_chk
    CHECK (dl_source IS NULL OR dl_source IN ('party','cow','warehouse','static')),
  CONSTRAINT factor_accounting_map_tf_source_chk
    CHECK (tf_source IS NULL OR tf_source IN ('party','cow','project','static')),

  -- static_* refs are only meaningful when their *_source = 'static'
  CONSTRAINT factor_accounting_map_static_dl_chk
    CHECK ((dl_source = 'static') = (static_dl_ref IS NOT NULL)
           OR dl_source IS NULL AND static_dl_ref IS NULL),
  CONSTRAINT factor_accounting_map_static_tf_chk
    CHECK ((tf_source = 'static') = (static_tf_ref IS NOT NULL)
           OR tf_source IS NULL AND static_tf_ref IS NULL),

  -- half-open versioning sanity
  CONSTRAINT factor_accounting_map_effective_range_chk
    CHECK (effective_from IS NULL OR effective_to IS NULL OR effective_from < effective_to),

  -- priority sanity
  CONSTRAINT factor_accounting_map_priority_chk
    CHECK (priority >= 0)
);

COMMENT ON TABLE public.factor_accounting_map IS
  'Phase 1 M2r: data-driven accounting mapping for the factor posting engine. One row = one voucher line template (one side). Vocabulary in CHECK constraints; bridge from factors.factor_type_id documented in docs/phase1_M2r_migration_package.md §6.';

-- =========================================================================
-- 2.3  Indexes
-- =========================================================================
-- Primary lookup path used by the engine
CREATE INDEX idx_factor_accounting_map_lookup
  ON public.factor_accounting_map
  (factor_type, product_type, line_role, side, priority)
  WHERE is_active = true;

-- Partial unique to prevent duplicate active rows for the same (key, scenario, side)
CREATE UNIQUE INDEX uq_factor_accounting_map_active_scenario
  ON public.factor_accounting_map
  (factor_type, product_type, line_role, scenario_key, side)
  WHERE is_active = true AND effective_to IS NULL;

-- Effective range scan (for time-travel resolution)
CREATE INDEX idx_factor_accounting_map_effective
  ON public.factor_accounting_map (effective_from, effective_to);

-- =========================================================================
-- 2.4  updated_at trigger (reuse existing helper)
-- =========================================================================
CREATE TRIGGER trg_factor_accounting_map_touch
  BEFORE UPDATE ON public.factor_accounting_map
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================================================
-- 2.5  RLS
-- =========================================================================
ALTER TABLE public.factor_accounting_map ENABLE ROW LEVEL SECURITY;

-- Authenticated app users may READ; mutations only via service_role
-- (worker / admin edge function in later milestones).
CREATE POLICY "factor_accounting_map_select_authenticated"
  ON public.factor_accounting_map
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "factor_accounting_map_select_anon"
  ON public.factor_accounting_map
  FOR SELECT
  TO anon
  USING (false);  -- explicit deny for clarity

-- =========================================================================
-- 2.6  Seed rows (ALL inactive placeholders — no real account codes)
-- =========================================================================
-- See §6 for the canonical factor_type → factors.factor_type_id bridge.
-- Every seed row is is_active=false so resolution returns no row until an
-- operator confirms real account codes (see §5).
INSERT INTO public.factor_accounting_map
  (factor_type, product_type, line_role, scenario_key, side,
   account_code, account_label, dl_source, tf_source,
   priority, is_active, notes)
VALUES
  -- ---- buy_livestock (factors.factor_type_id = 1, product_type='livestock') ----
  ('buy_livestock', 'livestock', 'inventory', 'default', 'DR',
   'TBD-INV-LIVESTOCK', 'موجودی دام (TBD)', 'cow', NULL,
   100, false, 'Phase 1 placeholder — confirm livestock inventory account code'),

  ('buy_livestock', 'livestock', 'ap',        'default', 'CR',
   'TBD-AP-DEFAULT',   'حساب‌های پرداختنی (TBD)', 'party', NULL,
   100, false, 'Phase 1 placeholder — confirm AP account code per party class'),

  ('buy_livestock', 'livestock', 'freight',   'freight_capitalized', 'DR',
   'TBD-INV-LIVESTOCK', 'حمل سرمایه‌ای دام (TBD)', 'cow', NULL,
   110, false, 'Capitalize freight into inventory; flag freight_capitalize=true in config'),

  -- ---- sell_livestock (factors.factor_type_id = 2, product_type='livestock') ---
  ('sell_livestock', 'livestock', 'ar',       'default', 'DR',
   'TBD-AR-DEFAULT',   'حساب‌های دریافتنی (TBD)', 'party', NULL,
   100, false, 'Phase 1 placeholder — confirm AR account code per party class'),

  ('sell_livestock', 'livestock', 'revenue',  'default', 'CR',
   'TBD-REV-LIVESTOCK','درآمد فروش دام (TBD)',   NULL, 'project',
   100, false, 'Phase 1 placeholder — confirm livestock revenue account'),

  ('sell_livestock', 'livestock', 'cogs',     'default', 'DR',
   'TBD-COGS-LIVESTOCK','بهای تمام‌شده دام فروخته شده (TBD)', 'cow', NULL,
   100, false, 'Phase 1 placeholder — confirm COGS account; engine computes amount from cow cost basis');

COMMIT;
```

---

## 3. AFTER audit (run after migration)

```sql
-- B1: line_role enum exists with the exact 10 labels in order
SELECT e.enumlabel, e.enumsortorder
FROM pg_type t
JOIN pg_enum e ON e.enumtypid = t.oid
JOIN pg_namespace n ON n.oid = t.typnamespace
WHERE n.nspname='public' AND t.typname='line_role'
ORDER BY e.enumsortorder;
-- Expect 10 rows: inventory, ap, ar, revenue, cogs, freight, discount, tax, rounding, other

-- B2: factor_accounting_map shape (22 columns)
SELECT column_name, data_type, udt_name, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema='public' AND table_name='factor_accounting_map'
ORDER BY ordinal_position;

-- B3: indexes (3 expected + 1 PK)
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname='public' AND tablename='factor_accounting_map'
ORDER BY indexname;

-- B4: trigger present
SELECT tgname FROM pg_trigger
WHERE tgrelid = 'public.factor_accounting_map'::regclass
  AND NOT tgisinternal;

-- B5: RLS enabled + exactly 2 policies (SELECT/authenticated, SELECT/anon)
SELECT relrowsecurity FROM pg_class WHERE oid='public.factor_accounting_map'::regclass;
SELECT policyname, cmd, roles FROM pg_policies
WHERE schemaname='public' AND tablename='factor_accounting_map'
ORDER BY policyname;

-- B6: 6 seed rows, all inactive, all with 'TBD-' prefix in account_code
SELECT COUNT(*) AS total,
       COUNT(*) FILTER (WHERE is_active = false) AS inactive,
       COUNT(*) FILTER (WHERE account_code LIKE 'TBD-%') AS tbd_codes
FROM public.factor_accounting_map;
-- Expect: total=6, inactive=6, tbd_codes=6

-- B7: CHECK constraint smoke (must RAISE)
DO $$
BEGIN
  BEGIN
    INSERT INTO public.factor_accounting_map (factor_type, product_type, line_role, side, account_code)
    VALUES ('garbage_type', 'livestock', 'inventory', 'DR', 'X');
    RAISE EXCEPTION 'CHECK constraint factor_type whitelist did not fire';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'OK: factor_type whitelist enforced';
  END;
END$$;

-- B8: untouched objects intact (must all return non-NULL / unchanged)
SELECT to_regclass('public.factors'),
       to_regclass('public.finance_vouchers'),
       to_regclass('public.finance_voucher_items'),
       to_regclass('public.cow_factor_details'),
       to_regclass('public.sync_queue'),
       to_regclass('public.factor_engine_config'),
       to_regclass('public.factor_engine_config_versions');

-- B9: no real account codes leaked into seed
SELECT COUNT(*) AS non_tbd_codes
FROM public.factor_accounting_map
WHERE account_code NOT LIKE 'TBD-%';
-- Expect: 0
```

---

## 4. Rollback SQL (safe pre-M3r)

```sql
BEGIN;
DROP TRIGGER IF EXISTS trg_factor_accounting_map_touch ON public.factor_accounting_map;
DROP TABLE  IF EXISTS public.factor_accounting_map;

-- Drop line_role only if it is unused elsewhere. Guarded so rollback is safe
-- even if a later milestone has already started referencing it.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_depend d
    JOIN pg_type t ON t.oid = d.refobjid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname='public' AND t.typname='line_role'
      AND d.deptype = 'n'
  ) THEN
    DROP TYPE IF EXISTS public.line_role;
  END IF;
END$$;
COMMIT;
```

---

## 5. Required values to confirm BEFORE activating posting

(Operator confirms in a later data-only UPDATE; no migration required.)

1. **Livestock inventory account_code** (replaces `TBD-INV-LIVESTOCK`)
2. **AP account_code(s)** — single, or per party class (`legacy_party_type_*`)
3. **AR account_code(s)** — single, or per party class
4. **Livestock sales revenue account_code**
5. **COGS account_code** for livestock sells
6. **Freight policy decision** — capitalize into inventory (current seed) vs expense
7. **Revenue TF source** — `project` (current seed) vs another descriptor
8. **DL source for AP/AR** — confirm `party` is correct vs Sepidar-resolved
9. **Rounding account_code** — already pinned in M1r config snapshot (`7901`); confirm matches Sepidar
10. **Cow-level vs warehouse-level DL** for inventory — current seed uses `cow`

---

## 6. Canonical `factor_type` ↔ `factors.factor_type_id` bridge

This is the **authoritative mapping** the M3r classifier will implement. Documented here so seeds, audits, and the future worker all agree.

| Engine `factor_type` | `factors.product_type` | `factors.factor_type_id` | Notes |
|---|---|---|---|
| `buy_livestock`  | `livestock` | `1` | Confirmed by `public.submit_cow_factor` (sets `invoice_type='buy'` when `FactorTypeId=1`) |
| `sell_livestock` | `livestock` | `2` | Confirmed by `public.submit_cow_factor` (sets `invoice_type='sell'` when `FactorTypeId=2`) |

**Live-DB evidence (read at M2r design time):**
- `factors.factor_type_id = 1` → 2,376 rows
- `factors.factor_type_id = 2` → 73 rows
- `factors.factor_type_id IS NULL` → 1 row (will not match any map row; safe inert)
- `factors.product_type = 'livestock'` → **0 rows today** (current data uses `legacy_product_1..6` + `sperm`). Livestock factors enter the system through `submit_cow_factor`, which **explicitly writes `product_type='livestock'`** — so all future cow factors will match. Existing legacy rows remain unmatched and inert.

**Rows that will NOT match any active map row (intended):**
- All `legacy_factor_1` / `legacy_factor_2` rows (`product_type='legacy_product_*'`)
- The single `product_type='sperm'` row
- The single `factor_type_id IS NULL` row

This is the intended Phase-1-MVP gating behavior: until M3r adds the classifier and operators flip seeds to `is_active=true` with real account codes, **no row will ever resolve to a map entry**, so the engine remains inert even if accidentally invoked.

---

## 7. Production execution notes

- **Single transaction.** Entire migration wrapped in `BEGIN; ... COMMIT;`.
- **Locking:** only `ACCESS EXCLUSIVE` on the new table (which doesn't exist yet) and on the new enum type. Zero locks on `factors`, `finance_vouchers`, or any production table.
- **Duration:** sub-second (table creation + 6 seed inserts).
- **Idempotency:** `line_role` enum creation is guarded; re-running the full migration WILL fail on the second `CREATE TABLE` (intentional — re-run requires rollback first). If you need true full idempotency, prepend `DROP TABLE IF EXISTS public.factor_accounting_map CASCADE;` — **not recommended** once seeds are confirmed by operators.
- **Re-run safety:** if migration aborts mid-transaction, Postgres rolls back automatically. The enum guard ensures the next attempt won't fail on type recreation.
- **No behavior change:** zero triggers, functions, edge functions, frontend files, or worker code touched. `submit_cow_factor`, `sql-sync-worker.cjs`, all `sepidar-*` edge functions remain byte-for-byte identical.

---

## 8. Out of scope for M2r (explicit)

- `factors.lifecycle_state` CHECK/index → **M3r**
- `factor_type` classifier function (reads `factors.factor_type_id` + `product_type` → engine `factor_type`) → **M3r**
- `finance_vouchers` forensic columns → **M4r**
- `finance_voucher_items` additive columns (`line_role`, `sepidar_tf_id`, `factor_detail_id`, `cow_id`) → **M5r**
- Operator admin edge function for editing the map → **post-Phase-1**
- Worker reading the map → **W0+**
- `FEATURE_FACTOR_POSTING` activation → **F1+**
- `sepidar_account_ref` / `sepidar_account_path` (additive later, if Sepidar numeric IDs ever become authoritative)
- Backfill of any kind

---

Awaiting your approval (or further change requests) before execution.
