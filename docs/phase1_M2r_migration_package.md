# Phase 1 — M2r Migration Package

**Status:** PREPARED — NOT EXECUTED
**Scope:** Create `factor_accounting_map` (data-driven accounting mapping table) + supporting enum/indexes.
**Out of scope:** worker code, frontend, Sepidar posting, feature flags, lifecycle backfill, factor registration flow changes.

---

## 0. Design summary

`factor_accounting_map` is the single source of truth that the (future) accounting engine reads to decide:

> "Given a factor of type X, product type Y, and a line_role Z, which account / DL / TF should the debit or credit side of the voucher use, and which side (DR/CR) does this line belong to?"

Key design decisions:

1. **Data-driven only.** No mapping ever lives in TypeScript. Engine resolves rows from this table at posting time using the **frozen config snapshot version** (M1r) + this map row's `effective_from/effective_to`.
2. **Per-line resolution.** One map row = one voucher line template (one side: DR or CR). Composite vouchers (e.g. buy livestock = DR inventory + CR payable + DR/CR freight) are expressed as multiple rows sharing the same `(factor_type, product_type, scenario_key)` and distinguished by `line_role` + `side`.
3. **Versioning.** Soft versioning via `effective_from` / `effective_to` (both nullable, half-open interval). No row is ever UPDATEd in place once referenced — operators close the old row (`effective_to = now()`) and insert a new row. Enforced by convention + helper view in a later milestone; M2r only provides the columns + a partial unique index that prevents overlapping active rows for the same logical key.
4. **Priority / fallback.** Integer `priority` (lower wins). Engine selects the active row with the lowest priority for a given key. Allows e.g. a default `product_type = NULL` (wildcard) row to act as fallback behind a specific override.
5. **Sepidar coupling kept loose.** We store `account_code` (text) as the canonical mapping target, plus optional `sepidar_account_ref` (bigint) when the Sepidar internal id is known. DL/TF references are stored as **source descriptors** (where to fetch them from at posting time), not as hardcoded ids, because DL/TF differ per cow / per party / per warehouse.
6. **No seed rows with real account codes.** Phase 0 inventory of Sepidar account codes has not been confirmed yet. M2r seeds **placeholder rows only** (clearly flagged `is_active=false`, `notes='PLACEHOLDER — confirm before activation'`). See §6.
7. **Additive only.** No changes to `factors`, `finance_vouchers`, `finance_voucher_items`, `cow_factor_details`, `sync_queue`, `submit_cow_factor`, or any edge function.

---

## 1. BEFORE audit (must all pass before applying M2r)

```sql
-- A1: table must not exist yet
select count(*) as a1_table_exists
from information_schema.tables
where table_schema='public' and table_name='factor_accounting_map';
-- expect: 0

-- A2: enum types must not exist yet
select count(*) as a2_enums_exist
from pg_type
where typname in ('factor_map_side','factor_map_dl_source','factor_map_tf_source');
-- expect: 0

-- A3: M1r objects must still be intact (we depend on them conceptually, not via FK)
select count(*) as a3_m1r_tables
from information_schema.tables
where table_schema='public'
  and table_name in ('factor_engine_config','factor_engine_config_versions');
-- expect: 2

-- A4: line_role enum (Phase 0) must exist — we reference its values in CHECK
select count(*) as a4_line_role_enum
from pg_type where typname='line_role';
-- expect: 1   (if 0 → STOP; line_role was supposed to land in Phase 0)

-- A5: no existing policy name collisions
select count(*) as a5_policy_collisions
from pg_policies
where schemaname='public'
  and policyname in (
    'factor_accounting_map_select_auth',
    'factor_accounting_map_no_write_auth'
  );
-- expect: 0

-- A6: pgcrypto available (for gen_random_uuid)
select count(*) as a6_pgcrypto
from pg_extension where extname='pgcrypto';
-- expect: 1
```

**Gate:** all 6 conditions must hold. If A4 = 0, abort and reconcile Phase 0 first.

---

## 2. Migration SQL

```sql
begin;

-- ---------- 2.1 supporting enums ----------

-- which side of the voucher this map row produces
create type public.factor_map_side as enum ('debit','credit');

-- where to fetch the Detail-Level (DL) reference from at posting time
create type public.factor_map_dl_source as enum (
  'none',              -- this account has no DL
  'party',             -- finance_parties.dl_ref of the counterparty
  'cow',               -- per-cow DL (livestock inventory granularity)
  'warehouse',         -- warehouse DL (future)
  'bank_account',      -- bank-side DL (future)
  'static'             -- use the literal value in static_dl_ref
);

-- where to fetch the Tafsili (TF) reference from at posting time
create type public.factor_map_tf_source as enum (
  'none',
  'party',
  'cow',
  'warehouse',
  'bank_account',
  'cost_center',
  'static'
);

-- ---------- 2.2 table ----------

create table public.factor_accounting_map (
  id uuid primary key default gen_random_uuid(),

  -- logical key (what this row maps)
  factor_type      text        not null,   -- e.g. 'buy_livestock','sell_livestock' (free text, validated by app)
  product_type     text        null,       -- e.g. 'livestock','feed','service'. NULL = wildcard/fallback.
  line_role        public.line_role not null,
  scenario_key     text        null,       -- optional sub-discriminator (e.g. 'with_freight','prepaid')

  -- which side this row produces
  side             public.factor_map_side not null,

  -- canonical accounting target
  account_code     text        not null,   -- chart-of-accounts code (string, leading zeros preserved)
  account_label    text        null,       -- human label for operator UI; not used by engine

  -- optional Sepidar-side hints (loose coupling)
  sepidar_account_ref bigint   null,       -- Sepidar internal account id, when known
  sepidar_account_path text    null,       -- optional Sepidar hierarchical path, when known

  -- DL/TF source descriptors (engine resolves the actual values at posting time)
  dl_source        public.factor_map_dl_source not null default 'none',
  static_dl_ref    text        null,       -- only used when dl_source='static'
  tf_source        public.factor_map_tf_source not null default 'none',
  static_tf_ref    text        null,       -- only used when tf_source='static'

  -- selection strategy
  priority         integer     not null default 100,   -- lower wins
  is_active        boolean     not null default false, -- M2r ships everything inactive; operators flip when confirmed

  -- versioning (half-open interval [effective_from, effective_to))
  effective_from   timestamptz not null default now(),
  effective_to     timestamptz null,

  -- forensic / operator metadata
  notes            text        null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid        null,
  updated_by       uuid        null,

  -- structural sanity
  constraint factor_accounting_map_static_dl_chk
    check ( (dl_source = 'static') = (static_dl_ref is not null) ),
  constraint factor_accounting_map_static_tf_chk
    check ( (tf_source = 'static') = (static_tf_ref is not null) ),
  constraint factor_accounting_map_effective_chk
    check ( effective_to is null or effective_to > effective_from ),
  constraint factor_accounting_map_priority_chk
    check ( priority >= 0 )
);

comment on table public.factor_accounting_map is
  'Data-driven accounting mapping consumed by the (future) accounting engine. '
  'One row = one voucher line template. No mappings live in TypeScript.';

-- ---------- 2.3 indexes ----------

-- engine lookup path
create index factor_accounting_map_lookup_idx
  on public.factor_accounting_map
  (factor_type, product_type, line_role, side, priority)
  where is_active = true;

-- prevent two active rows from overlapping for the exact same logical key + side.
-- We do NOT enforce time-overlap here (that requires btree_gist); we enforce
-- "only one active row per logical key + priority + side". Operators must close
-- the previous row (is_active=false OR set effective_to) before inserting a new one.
create unique index factor_accounting_map_active_unique
  on public.factor_accounting_map
  (factor_type, coalesce(product_type,''), line_role, side, coalesce(scenario_key,''), priority)
  where is_active = true and effective_to is null;

-- versioning scans
create index factor_accounting_map_effective_idx
  on public.factor_accounting_map (effective_from, effective_to);

-- ---------- 2.4 updated_at touch trigger ----------

create or replace function public.tg_factor_accounting_map_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger trg_factor_accounting_map_touch
before update on public.factor_accounting_map
for each row execute function public.tg_factor_accounting_map_touch();

-- ---------- 2.5 RLS ----------

alter table public.factor_accounting_map enable row level security;

-- authenticated users may READ (so the operator UI can render)
create policy factor_accounting_map_select_auth
on public.factor_accounting_map
for select
to authenticated
using (true);

-- explicit deny for any write by authenticated; only service_role (bypass RLS)
-- may write. Operators will edit via an admin edge function in a later milestone.
create policy factor_accounting_map_no_write_auth
on public.factor_accounting_map
for all
to authenticated
using (false)
with check (false);

-- ---------- 2.6 placeholder seed rows (ALL INACTIVE) ----------
-- These rows exist so the schema shape is self-documenting. They MUST NOT be
-- activated until the corresponding account_code / DL / TF values in §6 are
-- confirmed by accounting. is_active=false guarantees the engine ignores them.

insert into public.factor_accounting_map
  (factor_type, product_type, line_role, scenario_key, side,
   account_code, account_label,
   dl_source, tf_source,
   priority, is_active, notes)
values
  -- BUY LIVESTOCK
  ('buy_livestock','livestock','inventory_in',     null, 'debit',
   'TBD-INV-LIVESTOCK',  'موجودی دام (placeholder)',
   'cow','none', 100, false,
   'PLACEHOLDER — confirm livestock inventory account code before activation'),

  ('buy_livestock','livestock','payable_party',    null, 'credit',
   'TBD-AP-PARTY',       'حساب پرداختنی به فروشنده (placeholder)',
   'party','none', 100, false,
   'PLACEHOLDER — confirm AP account code per party class before activation'),

  ('buy_livestock','livestock','freight_capitalized', 'with_freight','debit',
   'TBD-INV-LIVESTOCK',  'سرباری حمل سرمایه‌ای‌شده روی موجودی (placeholder)',
   'cow','none', 110, false,
   'PLACEHOLDER — confirm whether freight capitalizes into same inventory account or a sub-account'),

  ('buy_livestock','livestock','freight_payable',   'with_freight','credit',
   'TBD-AP-FREIGHT',     'حساب پرداختنی حمل (placeholder)',
   'party','none', 110, false,
   'PLACEHOLDER — confirm freight payable account / DL source'),

  -- SELL LIVESTOCK (Phase 1: post_cogs_on_sell = false → no COGS/inventory_out rows seeded)
  ('sell_livestock','livestock','receivable_party', null, 'debit',
   'TBD-AR-PARTY',       'حساب دریافتنی از خریدار (placeholder)',
   'party','none', 100, false,
   'PLACEHOLDER — confirm AR account code per party class before activation'),

  ('sell_livestock','livestock','revenue_sale',     null, 'credit',
   'TBD-REV-LIVESTOCK',  'درآمد فروش دام (placeholder)',
   'none','cost_center', 100, false,
   'PLACEHOLDER — confirm revenue account + whether TF is cost_center or none');

commit;
```

**Locking footprint:** all `create` statements; no existing table is touched. Wall time expected < 100 ms. Single transaction.

---

## 3. AFTER audit (must all pass after applying M2r)

```sql
-- B1: table shape
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema='public' and table_name='factor_accounting_map'
order by ordinal_position;
-- expect: 22 columns matching §2.2

-- B2: enums created
select typname from pg_type
where typname in ('factor_map_side','factor_map_dl_source','factor_map_tf_source')
order by typname;
-- expect: 3 rows

-- B3: indexes
select indexname from pg_indexes
where schemaname='public' and tablename='factor_accounting_map'
order by indexname;
-- expect: factor_accounting_map_active_unique, factor_accounting_map_effective_idx,
--         factor_accounting_map_lookup_idx, factor_accounting_map_pkey

-- B4: trigger
select tgname from pg_trigger
where tgrelid='public.factor_accounting_map'::regclass and not tgisinternal;
-- expect: trg_factor_accounting_map_touch

-- B5: RLS on + exactly the two policies
select relrowsecurity from pg_class where oid='public.factor_accounting_map'::regclass;
-- expect: t
select policyname, cmd from pg_policies
where schemaname='public' and tablename='factor_accounting_map'
order by policyname;
-- expect: factor_accounting_map_no_write_auth (ALL),
--         factor_accounting_map_select_auth (SELECT)

-- B6: seed rows present, ALL inactive
select count(*) as total, count(*) filter (where is_active) as active_count
from public.factor_accounting_map;
-- expect: total=6, active_count=0

-- B7: all seed rows have placeholder account_codes (sanity: nothing real leaked in)
select count(*) as non_placeholder
from public.factor_accounting_map
where account_code not like 'TBD-%';
-- expect: 0

-- B8: CHECK constraints behave (smoke test — must RAISE)
do $$
begin
  begin
    insert into public.factor_accounting_map
      (factor_type, line_role, side, account_code, dl_source, static_dl_ref)
    values ('test','inventory_in','debit','X','party','should-not-be-allowed');
    raise exception 'CHECK factor_accounting_map_static_dl_chk did not fire';
  exception when check_violation then null;
  end;
end$$;

-- B9: untouched objects
select count(*) from information_schema.tables
where table_schema='public'
  and table_name in ('factors','finance_vouchers','finance_voucher_items',
                     'cow_factor_details','sync_queue',
                     'factor_engine_config','factor_engine_config_versions');
-- expect: 7
```

---

## 4. Rollback SQL

Safe at any point before another object references `factor_accounting_map` (no FK exists in M2r).

```sql
begin;

drop trigger if exists trg_factor_accounting_map_touch on public.factor_accounting_map;
drop function if exists public.tg_factor_accounting_map_touch();

drop table if exists public.factor_accounting_map;

drop type if exists public.factor_map_tf_source;
drop type if exists public.factor_map_dl_source;
drop type if exists public.factor_map_side;

commit;
```

Becomes lossy only once operators have inserted real (non-placeholder) rows. After that point, export the table first.

---

## 5. Production execution notes

- Single transaction. No locks on existing tables. No worker, edge function, RPC, or frontend change is paired with M2r.
- No feature flag is flipped. The engine is not wired to this table yet.
- All seed rows ship with `is_active=false`. The engine (when it exists) will return zero rows for any lookup until accounting confirms §6 and operators flip rows on.
- **Not idempotent by design.** Re-runs fail loudly on the enum `create type`. Recovery: rollback (§4) → re-audit (§1) → re-apply (§2).
- No changes to `submit_cow_factor`, `factor_claim_next`, `sync_queue`, or any Sepidar edge function.

---

## 6. Required values to confirm BEFORE activating posting

Accounting must provide the following before any row in `factor_accounting_map` is flipped to `is_active=true`. Until then, the engine returns "unmapped" and refuses to post.

| # | What we need | Used by row(s) | Format |
|---|---|---|---|
| 1 | Livestock inventory account code | `buy_livestock / livestock / inventory_in` (and capitalized freight) | account_code (string) |
| 2 | Decision: does freight capitalize into the same inventory account or a dedicated sub-account? | `buy_livestock / freight_capitalized` | policy + account_code |
| 3 | Accounts payable account code(s) — single account or per-party-class? | `buy_livestock / payable_party`, `buy_livestock / freight_payable` | account_code (+ rule) |
| 4 | Accounts receivable account code(s) — single account or per-party-class? | `sell_livestock / receivable_party` | account_code (+ rule) |
| 5 | Livestock sales revenue account code | `sell_livestock / revenue_sale` | account_code |
| 6 | Whether revenue line carries a TF (cost center / project) and which source | `sell_livestock / revenue_sale` | tf_source enum + (if static) value |
| 7 | Whether AP/AR DL must come from `finance_parties.dl_ref` or from a Sepidar-side party id (we currently assume `finance_parties.dl_ref`) | all party-side rows | confirm `dl_source='party'` semantics |
| 8 | Sepidar internal account refs (`sepidar_account_ref`) for each confirmed `account_code`, if available | all rows | bigint (optional but recommended) |
| 9 | Rounding account code already pinned in M1r (`7901`) — confirm this is the correct production account | engine config snapshot | account_code |
| 10 | Whether per-cow DL (`dl_source='cow'`) is correct for livestock inventory, or whether a single warehouse DL should be used | `inventory_in`, `freight_capitalized` | enum choice |

Once §6 is signed off, activation is a **data-only** change (UPDATE rows to set real `account_code` + flip `is_active=true`); no further migration is required for the mapping table itself.

---

## 7. Out of scope for M2r (explicit)

- `factors.lifecycle_state` CHECK/index → M3r
- `finance_vouchers` forensic columns → M4r
- `finance_voucher_items` additive columns (`line_role`, `sepidar_tf_id`, `factor_detail_id`, `cow_id`) → M5r
- Operator admin edge function for editing the map → post-Phase-1
- Worker reading the map → W0+
- `FEATURE_FACTOR_POSTING` activation → F1+
- Backfill of any kind
