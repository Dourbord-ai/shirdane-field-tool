# Factor Approval → Voucher → Sepidar Posting — Technical Design

Design specification only. No code changes proposed in this document.

---

## 1. Lifecycle States

### 1.1 Factor states (`factors.lifecycle_state`)

```text
draft ──submit──▶ pending_approval ──approve──▶ approved
   ▲                    │                         │
   │                    └──reject──▶ rejected     │
   │                                              ▼
   └────────cancel (only from draft/rejected)   voucher_created
                                                  │
                                          ┌───────┴───────┐
                                          ▼               ▼
                                       posting ──ok──▶ posted
                                          │
                                          └──fail──▶ sync_failed ──retry──▶ posting
                                                          │
                                                          └──manual_override──▶ posted
posted ──reverse──▶ reversed   (creates compensating voucher; original stays posted)
```

Notes:
- `draft` and `pending_approval` are pre-accounting: no GL impact.
- `voucher_created` means rows exist in `finance_vouchers` (status=`draft`) but not yet sent to Sepidar.
- `posting` is a short-lived in-flight state guarded by row lock + advisory lock to avoid double-send.
- `sync_failed` is terminal-until-retried; carries `last_error`, `retry_count`, `next_retry_at`.
- `cancelled` only allowed from `draft`/`pending_approval`/`rejected`. After `approved`, use `reversed`.

### 1.2 Allowed transitions matrix

| From              | To                | Trigger          | Actor                       |
|-------------------|-------------------|------------------|-----------------------------|
| draft             | pending_approval  | submit           | creator / finance_operator  |
| draft             | cancelled         | cancel           | creator / finance_manager   |
| pending_approval  | approved          | approve          | finance_manager             |
| pending_approval  | rejected          | reject           | finance_manager             |
| pending_approval  | draft             | recall           | creator (before approval)   |
| rejected          | draft             | revise           | creator                     |
| approved          | voucher_created   | auto (trigger)   | system                      |
| voucher_created   | posting           | post             | finance_operator (or auto)  |
| posting           | posted            | sepidar OK       | system                      |
| posting           | sync_failed       | sepidar ERR      | system                      |
| sync_failed       | posting           | retry            | finance_operator            |
| sync_failed       | posted            | manual_override  | finance_manager (audited)   |
| posted            | reversed          | reverse          | finance_manager             |

### 1.3 Rollback rules
- Pre-`approved`: hard delete allowed (soft delete preferred for audit).
- `approved`+: never delete. Only `reversed` via compensating voucher pair.
- `voucher_created` → `approved` rollback: allowed only if voucher has no Sepidar attempt log row.

---

## 2. Database Design

### 2.1 New columns on `factors`

| Column                       | Type          | Purpose                                        |
|------------------------------|---------------|------------------------------------------------|
| lifecycle_state              | text          | enum above (replaces ad-hoc `sync_status`)     |
| approved_by                  | uuid          | app_users.id                                   |
| approved_at                  | timestamptz   |                                                |
| rejected_by / rejected_at    | uuid / tstz   |                                                |
| rejection_reason             | text          |                                                |
| voucher_id                   | uuid FK       | → `finance_vouchers.id` (primary GL voucher)   |
| reversal_voucher_id          | uuid FK       | compensating voucher                           |
| sepidar_voucher_id           | bigint        | Sepidar PK                                     |
| sepidar_voucher_number       | text          | Sepidar human number                           |
| posting_attempt_count        | int default 0 |                                                |
| last_posting_error           | text          |                                                |
| last_posting_attempted_at    | timestamptz   |                                                |
| next_retry_at                | timestamptz   | backoff schedule                               |
| idempotency_key              | uuid unique   | generated at approval; reused on retries       |
| posting_locked_at            | timestamptz   | held during `posting`                          |
| posting_locked_by            | uuid          | actor holding lock                             |

### 2.2 New tables

**`factor_state_transitions`** — append-only audit
```
id, factor_id, from_state, to_state, actor_user_id, reason, metadata jsonb,
created_at
```
Index: `(factor_id, created_at desc)`.

**`factor_posting_attempts`** — every Sepidar call
```
id, factor_id, voucher_id, idempotency_key, request_payload jsonb,
response_payload jsonb, success bool, error_code text, error_message text,
duration_ms int, created_at
```
Index: `(factor_id, created_at desc)`, `(success, created_at)`.

**`finance_account_mappings`** — see §4.

### 2.3 Relationship to `finance_vouchers`
- 1 factor → 1 primary voucher (`factors.voucher_id`).
- 1 factor → 0..1 reversal voucher (`factors.reversal_voucher_id`).
- `finance_vouchers` gains: `source_type text`, `source_id uuid`, `idempotency_key uuid unique`, `sepidar_voucher_id bigint`, `sepidar_voucher_number text`, `posted_at timestamptz`.
- Partial unique index: `unique (source_type, source_id) where source_type='factor' and reversal_of is null` → prevents double voucher per factor.

### 2.4 Duplicate-prevention constraints
- `factors.idempotency_key` unique.
- `finance_vouchers.idempotency_key` unique.
- Partial unique on `(source_type, source_id)` above.
- Sepidar side: `sepidar_voucher_id` unique on `factors` and `finance_vouchers`.

### 2.5 Indexes
- `factors(lifecycle_state, next_retry_at)` — retry worker scan.
- `factors(lifecycle_state, approved_at desc)` — operator queues.
- `finance_voucher_items(voucher_id)`, `(account_id)`, `(dl_ref, tf_ref)`.

---

## 3. Voucher Architecture

### 3.1 Trigger
- On `factors.lifecycle_state` transition `approved → voucher_created`: a `SECURITY DEFINER` function `fn_factor_create_voucher(factor_id)` runs **synchronously inside the same transaction as approval** for atomicity. It:
  1. Locks factor row (`FOR UPDATE`).
  2. Checks `voucher_id IS NULL` (idempotent re-entry returns existing voucher).
  3. Resolves account mapping rows (§4).
  4. Inserts `finance_vouchers` (status=`draft`, `idempotency_key`).
  5. Inserts `finance_voucher_items` (debit/credit pairs).
  6. Validates `sum(debit) = sum(credit)` (trigger raises otherwise).
  7. Updates `factors.voucher_id`, state → `voucher_created`.

### 3.2 Voucher items generation (buy factor example)
| Leg | Account (from mapping)            | Debit          | Credit         | DL/TF                    |
|-----|-----------------------------------|----------------|----------------|--------------------------|
| 1   | Inventory / Livestock asset       | net amount     | —              | TF=cow_type or factor    |
| 2   | VAT receivable                    | vat_amount     | —              | —                        |
| 3   | Freight expense                   | delivery_cost  | —              | —                        |
| 4   | Discount received                 | —              | off_price      | —                        |
| 5   | A/P — counterparty                | —              | payable_amount | DL=party (shopping_center)|

Sell factor mirrors with COGS + revenue + A/R.

### 3.3 Sync vs async
- **Voucher creation: synchronous** (must be atomic with approval to avoid orphan approvals).
- **Sepidar posting: asynchronous** via a worker / edge function pulling rows where `lifecycle_state IN ('voucher_created','sync_failed') AND next_retry_at <= now()`.

### 3.4 Idempotency
- `idempotency_key` generated at `approved`. Reused on every Sepidar call. Sepidar bridge SP must accept and de-duplicate by this key (or the worker checks `factor_posting_attempts` for prior success).
- Advisory lock `pg_try_advisory_xact_lock(hashtext('factor:'||id))` around posting attempt → prevents two workers posting same factor.

---

## 4. Accounting Mapping System

Data-driven, **no hardcoded accounts in code**.

**`finance_account_mappings`**
```
id, scope text,            -- 'factor'
factor_type_id smallint,   -- 1=buy, 2=sell, ...
product_type text,         -- 'livestock', 'milk', ...
leg_code text,             -- 'inventory','vat','freight','discount','ap','ar','cogs','revenue'
account_id uuid,           -- → finance_accounts
dl_source text,            -- 'party' | 'static' | 'none'
dl_static_ref bigint,
tf_source text,            -- 'cow_type' | 'factor' | 'static' | 'none'
tf_static_ref bigint,
sign smallint,             -- +1 debit / -1 credit
amount_source text,        -- 'net','vat','freight','discount','payable','row_price'
priority int,
is_active bool,
unique(scope, factor_type_id, product_type, leg_code, priority)
```

Voucher generator selects all active rows matching `(factor_type_id, product_type)`, ordered by `priority`, and emits one voucher item per row by:
1. Reading `amount_source` from factor (e.g. `vat_amount`).
2. Resolving DL/TF refs from the configured source.
3. Applying `sign`.

Adding a new product type or VAT rule = INSERT into mapping table, no deploy.

Optional **`finance_account_mapping_overrides`** keyed on counterparty for special parties.

---

## 5. Sepidar Integration Flow

```text
approve()  ── tx ──▶ fn_factor_create_voucher() ──▶ state=voucher_created
                                                          │
                            (cron/edge function poll)     │
                                                          ▼
                                               try_post_factor(id)
                                                  │
                              pg_try_advisory_xact_lock + FOR UPDATE
                                                  │
                                       state ← posting
                                                  │
                              edge: sepidar-post-voucher(payload, idem_key)
                                                  │
                          ┌───────────────────────┴────────────────────────┐
                          ▼                                                ▼
                  success: sepidar_id returned                  failure: error captured
                  → insert posting_attempt(success=true)        → insert posting_attempt(success=false)
                  → factors.sepidar_voucher_id = ...            → retry_count++
                  → state=posted, posted_at=now()               → next_retry_at = now()+backoff
                                                                → state=sync_failed
```

Backoff: `min(2^retry_count minutes, 60m)`, cap 10 retries → requires manual.

**Reconciliation job** (hourly): for factors in `posted` with `sepidar_voucher_id`, call `sepidar-voucher-status`; if Sepidar reports voided/missing → flag `reconciliation_mismatch=true`, alert finance_manager.

---

## 6. UI / UX

### 6.1 Status chips (color + Persian label)
| State            | Label            | Color    |
|------------------|------------------|----------|
| draft            | پیش‌نویس          | muted    |
| pending_approval | در انتظار تأیید   | amber    |
| approved         | تأیید شده         | sky      |
| voucher_created  | سند ایجاد شد      | indigo   |
| posting          | در حال ارسال      | indigo pulse |
| posted           | ارسال شد          | green    |
| sync_failed      | خطای ارسال        | red      |
| rejected         | رد شده            | rose     |
| cancelled        | لغو شده           | gray     |
| reversed         | برگشت خورده       | gray-strike|

### 6.2 Action buttons (visibility by state + role)
- Submit (draft → pending_approval): creator
- Approve / Reject: finance_manager only, shown on pending_approval
- Recall: creator, on pending_approval
- Retry posting: finance_operator, on sync_failed (shows attempt count + last error)
- Manual mark posted: finance_manager, on sync_failed, with required reason
- Reverse: finance_manager, on posted, opens confirm dialog

### 6.3 Posting progress
- Live polling on factor detail when state ∈ {posting, sync_failed}.
- Banner shows: attempt N/10, last error (collapsible), next retry countdown.

### 6.4 References panel
- Voucher number (internal), Sepidar voucher number + ID, posted_at, reversal voucher link if any.

### 6.5 Audit timeline
- Rendered from `factor_state_transitions` + `factor_posting_attempts`, newest first, with actor name, timestamp, reason/error.

### 6.6 Error messages
- All Persian, via existing `mapFinanceError`. Sepidar raw error stored in attempt log but UI shows mapped friendly text + "نمایش جزئیات فنی" expand.

---

## 7. Permission Model

Roles (existing `app_roles`):
- **finance_readonly** — view factors, vouchers, attempts. No mutations.
- **finance_operator** — create/edit drafts, submit, retry posting.
- **finance_manager** — approve/reject, manual override, reverse, edit mappings.
- **super_admin** — everything + edit `finance_account_mappings`.

Enforced both in RLS policies and in `has_app_role(...)` checks inside the state-transition SP. UI hides buttons the role cannot perform but DB is the source of truth.

---

## 8. Failure & Recovery

| Scenario                       | Handling                                                                 |
|--------------------------------|--------------------------------------------------------------------------|
| Sepidar timeout                | Attempt logged, state → sync_failed, retry per backoff                  |
| Sepidar returns success twice  | Idempotency key + unique sepidar_voucher_id prevents double row         |
| Worker crash mid-post          | `posting_locked_at` older than 5m → sweeper resets to sync_failed       |
| Two workers race               | Advisory lock + row lock; loser exits silently                          |
| Voucher imbalance              | DB trigger on finance_voucher_items rejects insert; state stays approved|
| Wrong mapping after posting    | Reverse (compensating voucher) + create new factor; never edit posted   |
| Manual override                | Requires reason, logged in transitions + audit; no Sepidar ID set       |
| Partial Sepidar leg failure    | Bridge SP must be transactional; partial never persisted on our side    |

---

## 9. Migration Strategy

Phased, backwards-compatible:

**Phase 0 — additive schema only (no behavior change)**
- Add new columns to `factors` (`lifecycle_state` nullable, defaults derived).
- Create `factor_state_transitions`, `factor_posting_attempts`, `finance_account_mappings`.
- Backfill `lifecycle_state` from existing `sync_status`:
  - `pending` → `pending_approval`
  - `synced`  → `posted`
  - `failed`  → `sync_failed`
  - others    → `draft`
- Seed `finance_account_mappings` from current hardcoded logic, verified by finance team.

**Phase 1 — dual-write**
- New `fn_factor_create_voucher` runs on approval but **behind a feature flag** `factors.use_new_voucher_flow`.
- Old `sync_queue` path remains active. Compare outputs in staging.

**Phase 2 — cutover for new factors**
- Flip flag to true. New approvals use new flow.
- Old `pending` rows continue on legacy worker until drained.

**Phase 3 — retire legacy**
- Remove `sync_queue` entries for `cow_factor` type.
- Drop `factors.sync_status` after one full reporting cycle.
- Old code paths removed.

**Rollback plan**
- Flag flip back to false instantly restores legacy path.
- New tables are additive; no destructive changes in phases 0–2.

---

## 10. Open Questions for Confirmation

1. Should `voucher_created → posting` be auto (background worker) or operator-triggered? Spec assumes auto with manual retry on failure.
2. Reversal: single compensating voucher (current spec) or full reverse-and-reissue pair?
3. Mapping editor: in-app UI for finance_manager, or DB-only via migrations?
4. Retry cap (currently 10) and backoff curve — confirm with finance ops.
5. Required approval levels — single approver, or dual approval over a threshold amount?

Awaiting approval to proceed with Phase 0 implementation.
