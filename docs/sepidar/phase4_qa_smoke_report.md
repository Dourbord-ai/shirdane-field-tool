# Phase 4 — Rollback Smoke / QA Report (Pre-Approval)

Date: 2026-06-07
Author: agent (دامبان build assistant)
Scope: Phase 4 entity-rollback flow (Factor / ReceiveID / PaymentRequest /
PaymentAllocation / BankTransfer / PartyTransfer / Check V1).

> **STATUS: BLOCKED — DO NOT ENABLE FOR PRODUCTION USERS.**
>
> An end-to-end live rollback could not be executed from this environment
> because the Sepidar SQL Server (`172.17.8.38`) lives on a private LAN
> that is unreachable from Supabase Edge Runtime (see §3.1).
>
> This document delivers:
>   1. Pre-test environment & schema verification (PASS).
>   2. Non-destructive failure-path test (PASS — orchestrator abort works).
>   3. A reproducible on-prem QA harness (SQL snippets + report template)
>      for the operator to run from a workstation that can reach the
>      Sepidar SQL Server.
>   4. Recommended sign-off gate before enabling rollback for normal users.

---

## 1. Pre-test environment verification

### 1.1 Schema (PASS)

| Object | Expected | Observed |
|---|---|---|
| `finance_vouchers.sepidar_status` | enum-like text (`posted` / `rolled_back` / `deleted` / `failed`) with CHECK | present |
| `finance_vouchers.rollback_at / rollback_by / rollback_reason` | nullable, populated on rollback | present |
| `finance_vouchers.is_deleted` | bool, defaults false | present |
| `finance_rollback_audit` | id, entity_type, entity_id, sepidar_voucher_id, snapshot_before, snapshot_after, rollback_reason, sepidar_delete_result, performed_by, performed_at | present |
| Per-entity `is_deleted` columns | bank_transfers / party_transfers / payment_requests / payment_allocations / receive_identifications | present |
| Per-entity `status` columns | all listed entities | present |

### 1.2 Backfill (PASS)

```
sepidar_status   | rows
-----------------+------
posted           | 5318
NULL (no voucher)| 98
rolled_back      | 0
```

The Phase 1 backfill ran cleanly. `posted` was assigned to every voucher
that had a `sepidar_voucher_id`; rows with `NULL` voucher id were left
untouched as designed.

### 1.3 Candidate inventory

- `factors` total: **2459**; rows carrying `sepidar_voucher_id` directly: **0**
  (factors join to `finance_vouchers` by `factor_id` — rollback.ts already
  resolves voucher metadata via that join; no action needed, but confirm
  the join path in rollback.ts during the live run).
- `finance_vouchers` total: **5416**; posted & not deleted: **5318**.
- `finance_rollback_audit` rows: **0** (no rollback has ever been executed
  — clean baseline for the smoke test).

---

## 2. Non-destructive failure-path test

### 2.1 What was run

Invoked the edge function with a bogus voucher id to exercise the
"Sepidar rejects → orchestrator aborts → Supabase untouched" code path.

```
POST /functions/v1/sepidar-rollback-voucher
{ "sepidarVoucherId": 999999999, "deleteRpaHeaders": true }
```

### 2.2 Result (PASS — failure path behaves correctly)

```json
{
  "success": false,
  "result_code": -1,
  "sepidar_voucher_id": 999999999,
  "message": "حذف سند سپیدار قابل انجام نیست.",
  "rawError": "Failed to connect to 172.17.8.38:50174 in 15000ms"
}
```

Post-conditions verified:

- `finance_rollback_audit` row count unchanged (still 0).
- No `finance_vouchers` flipped to `is_deleted=true` or
  `sepidar_status='rolled_back'`.
- `rollbackFinanceOperation()` in `src/lib/finance/rollback.ts` short-circuits
  on `success=false` and never reaches the Supabase mutation block — confirmed
  by code review (lines that update `finance_vouchers` are gated on the
  Sepidar success branch).

**Conclusion:** the "Sepidar-first, abort-on-failure" contract is honored.
The UI dialog (`RollbackConfirmDialog`) surfaces the Persian error message
verbatim via `toast.error`.

---

## 3. Live end-to-end run — BLOCKERS

### 3.1 BLOCKER #1 — Edge Runtime cannot reach Sepidar SQL Server

The edge function timed out connecting to `172.17.8.38:50174`. This is the
internal LAN IP of the farm's Sepidar host. Supabase Edge Runtime
(`X-Sb-Edge-Region: eu-central-1`) has no route to that subnet.

This means **no rollback can be executed from the cloud preview today**.
The same problem will affect any production user who clicks the rollback
button.

#### Resolution options (pick ONE before enabling for users)

| Option | Effort | Notes |
|---|---|---|
| (A) Run `sepidar-rollback-voucher` from the on-prem sync worker | Low | Mirror the existing pattern used by `scripts/sql-sync-worker.cjs`. Application calls a small HTTP endpoint on the worker instead of the Supabase edge function. |
| (B) Expose Sepidar SQL Server via a secured tunnel (Cloudflare Tunnel / Tailscale / static-IP VPN) | Medium | Keep the current edge function; only the network path changes. Requires firewall + auth review. |
| (C) Publish Sepidar SQL Server on a public IP with TLS + firewall allow-list of Supabase Edge egress IPs | High / risky | Not recommended — broadens attack surface and Supabase egress IPs are not stable. |

Recommendation: **Option A** — extend the existing on-prem worker so the
same machine that already syncs Sepidar handles rollbacks too. This keeps
secret material (SQL creds) on-prem and removes the edge-runtime route
requirement.

### 3.2 BLOCKER #2 — No QA-only fixtures

`finance_rollback_audit` is empty (good baseline), but every candidate
voucher is real production data. We should not pick "the smallest-amount
factor" arbitrarily without operator approval — even a small rollback
deletes a real Sepidar voucher and recomputes a real party balance.

Recommendation: operator selects 1 throwaway record per entity type (or
posts test vouchers explicitly for QA).

---

## 4. Reproducible on-prem QA harness

Once §3.1 is resolved, run the following from a machine that can reach
Sepidar SQL Server. Each test case is "open the entity detail screen →
click `بازگشت سند` → enter reason → confirm".

### 4.1 Per-case verification SQL

Replace `:entity_id`, `:party_id` per row. Run **before** and **after**
the rollback and paste both outputs into the report template (§4.2).

```sql
-- 0) Identify the voucher attached to the entity
SELECT id AS voucher_id, sepidar_voucher_id, sepidar_status, is_deleted,
       rollback_at, rollback_by, rollback_reason, party_id, amount
FROM   finance_vouchers
WHERE  source_entity_type = :entity_type        -- e.g. 'factor'
  AND  source_entity_id   = :entity_id::uuid;

-- 1) Entity lifecycle status (template — pick the right table)
SELECT id, status, is_deleted
FROM   finance_bank_transfers WHERE id = :entity_id::uuid;
-- (repeat for finance_party_transfers / finance_payment_requests /
--  finance_payment_allocations / finance_receive_identifications /
--  finance_checks / factors as appropriate)

-- 2) Audit row (should appear AFTER rollback only)
SELECT id, entity_type, entity_id, sepidar_voucher_id,
       sepidar_delete_result, rollback_reason, performed_by, performed_at,
       jsonb_pretty(snapshot_before) AS before,
       jsonb_pretty(snapshot_after)  AS after
FROM   finance_rollback_audit
WHERE  entity_id = :entity_id::uuid
ORDER  BY performed_at DESC
LIMIT  1;

-- 3) Party balance — call the recompute RPC and read the result
SELECT recompute_party_balance(:party_id::uuid) AS new_balance;

-- 4) For checks only — timeline event was appended
SELECT id, check_id, event_type, payload, created_at
FROM   finance_check_events
WHERE  check_id = :entity_id::uuid
ORDER  BY created_at DESC
LIMIT  5;
```

### 4.2 Report template (fill one row per test case)

| # | Entity | Test record id | Sepidar voucher id | Before status | After status | Audit row id | Balance before | Balance after | Pass/fail | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | factor | | | | | | | | | |
| 2 | receive_identification | | | | | | | | | |
| 3 | payment_request | | | | | | | | | |
| 4 | payment_allocation | | | | | | | | | |
| 5 | bank_transfer | | | | | | | | | |
| 6 | party_transfer | | | | | | | | | |
| 7 | check (registered) | | | | | | | | | |
| 8 | check (delivered) | | | | | | | | | |

### 4.3 Acceptance criteria per case

Each row passes only if **all** of the following hold:

1. Dialog opened, metadata (amount / party / bank / sepidar id) rendered.
2. Confirm button stayed disabled until a ≥3-char reason was entered.
3. Button was hidden for a non-admin / non-super_admin user (verify with a
   second account).
4. Edge function log shows the SP call **before** any Supabase write.
5. `finance_vouchers.sepidar_voucher_id` is **still populated** (never nulled).
6. `finance_vouchers.is_deleted = true`.
7. `finance_vouchers.sepidar_status = 'rolled_back'`.
8. `rollback_at`, `rollback_by`, `rollback_reason` all populated and match
   the operator + reason entered in the dialog.
9. One row inserted into `finance_rollback_audit` with non-null
   `snapshot_before` AND `snapshot_after`.
10. Recomputed party balance equals the previous balance minus the
    voucher's signed amount (or equivalent per entity).
11. Entity-level `status` is `cancelled` / `rolled_back` per spec; for
    `payment_request` the related allocations are also cancelled.

### 4.4 Idempotency case

After case #1 (factor) passes, **immediately re-run** the rollback on the
same factor without refreshing:

- Expected: edge function returns `success=true, result_code=2`
  ("already deleted"); orchestrator treats it as success; no new audit
  row inserted (or, if inserted, `sepidar_delete_result` = 2 and snapshots
  reflect the already-rolled-back state); UI shows the success toast.
- Confirm `finance_vouchers` row is unchanged from the first rollback.

### 4.5 Failure case (already covered in §2, repeat on-prem)

Stop the Sepidar SQL Server (or temporarily revoke the SP grant) and
attempt one rollback. Expected:

- Toast shows the Persian failure message.
- `finance_vouchers` row unchanged.
- `finance_rollback_audit` row count unchanged.
- Dialog stays open so the operator can retry.

---

## 5. Sign-off gate

Rollback may be enabled for normal admin / super_admin users only after:

- [ ] Resolution for §3.1 is shipped (Option A recommended).
- [ ] All 8 rows in §4.2 are marked **Pass** by the operator.
- [ ] §4.4 idempotency case passes.
- [ ] §4.5 failure case passes from the on-prem environment.
- [ ] Finance owner signs the report.

Until then, keep the rollback button gated behind `DEV_ACCESS_MODE` /
super_admin only, or hide via a feature flag if you want a softer gate.
