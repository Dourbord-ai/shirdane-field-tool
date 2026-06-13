# Phase 4 — Verification Matrix (Implemented vs. Actually Verified)

Date: 2026-06-07
Author: agent (Lovable build assistant)
Purpose: Be explicit about what was *built* vs. what was *actually exercised*
inside the Lovable sandbox. Nothing in this document claims that Sepidar
rollback works end-to-end against a real Sepidar database — that test
cannot be run from here.

---

## 1. Environment limits (what Lovable CANNOT do)

The Lovable build environment has:

- ✅ Access to the Supabase project (Postgres + Edge Runtime + logs).
- ✅ Ability to invoke the `sepidar-rollback-voucher` edge function over HTTPS.
- ❌ **No** network route to the on-prem Sepidar SQL Server (`172.17.8.38`,
  private LAN). The edge function call from cloud times out at the TCP layer.
- ❌ **No** access to ShirdaneBridge (the `bridge.RollbackSepidarVoucher`
  stored procedure lives on the SQL Server we cannot reach).
- ❌ **No** real Sepidar vouchers to delete (and we would not delete real
  production vouchers without operator approval anyway).

Therefore, anything that depends on the SP actually executing, or on a
real Sepidar voucher disappearing, is **NOT verified** here.

---

## 2. What was actually executed end-to-end

| Test | Where | Result |
|---|---|---|
| Schema present (`sepidar_status`, `rollback_at/by/reason`, audit table) | Supabase Postgres | PASS |
| Phase 1 backfill set `sepidar_status='posted'` on 5318 existing vouchers | Supabase Postgres | PASS |
| `sepidar-rollback-voucher` edge function reachable, parses payload, validates inputs | Supabase Edge Runtime | PASS |
| Failure path — bogus `sepidarVoucherId=999999999`, SP unreachable → `success=false, result_code=-1` | Supabase Edge Runtime | PASS (returns clean error JSON, CORS headers intact) |
| Orchestrator (`rollbackFinanceOperation`) aborts on `success=false` and does NOT mutate Supabase | Code review + audit-table row-count = 0 before & after | PASS |
| UI dialog gating (admin / super_admin only) | Code review of `canRollbackFinanceOps()` | PASS (static) |
| UI dialog reason-required, busy-state, success/failure toasts | Code review only | NOT click-tested |

That's the full extent of what was actually run.

---

## 3. Per-entity status

Legend: ✅ done · ⚠️ partial · ❌ not possible in Lovable

| Entity | Implemented | UI built | Supabase write path verified (dry) | Real Sepidar E2E |
|---|---|---|---|---|
| **Factor** | ✅ handler in `rollback.ts`, button in `PostingPanel` | ✅ | ⚠️ code path reviewed; not invoked because Sepidar SP would fail first | ❌ requires SQL Server + real voucher |
| **Receive Identification** | ✅ handler + row action in `ReceiveIdentificationTab` | ✅ | ⚠️ same as above | ❌ requires SQL Server + real voucher |
| **Payment Request** | ✅ handler (cancels allocations + recalc) + button in `PRDetail` | ✅ | ⚠️ same as above | ❌ requires SQL Server + real voucher |
| **Payment Allocation** | ✅ handler + per-row button in `PaymentRequestsTab` | ✅ | ⚠️ same as above | ❌ requires SQL Server + real voucher |
| **Bank Transfer** | ✅ handler + action column in `BankTransferTab` | ✅ | ⚠️ same as above | ❌ requires SQL Server + real voucher |
| **Party Transfer** | ✅ handler + action column in `PartyTransferTab` | ✅ | ⚠️ same as above | ❌ requires SQL Server + real voucher |
| **Check (V1: registered / delivered)** | ✅ handler (state-gated) + button in `CheckDetailDialog`, timeline event append | ✅ | ⚠️ same as above | ❌ requires SQL Server + real voucher |

### What "UI built" specifically means

For every entity in the table:

- The shared `RollbackConfirmDialog` is wired with the entity-specific
  metadata (amount, party, bank, sepidar_voucher_id).
- The trigger button is rendered behind `canRollbackFinanceOps()`.
- On confirm, it calls the matching branch of `rollbackFinanceOperation()`
  in `src/lib/finance/rollback.ts`.

These were verified by static code review only. **No click-through QA was
performed in a real browser session inside Lovable** — the dialog cannot
complete its happy path here because the Sepidar SP cannot run.

### What "Supabase write path verified (dry)" means

The post-SP-success branch of each handler (soft-delete voucher, set
`sepidar_status='rolled_back'`, populate `rollback_at/by/reason`, insert
`finance_rollback_audit` row with snapshots, recompute party balance,
update entity status) was reviewed in code and matches the Phase 3 audit
document. It has **NOT** been executed against the database, because doing
so would either require:

- A successful Sepidar SP call (impossible here), or
- Bypassing the Sepidar-first contract (forbidden by spec).

---

## 4. What still needs to be validated in YOUR environment

These items can only be confirmed on the farm's network, against the real
ShirdaneBridge + Sepidar database, by an operator with admin access:

1. **SP execution** — `bridge.RollbackSepidarVoucher` actually deletes
   ACC.Voucher / RPA / FMK.ExtraData rows for a real voucher id, and
   returns `result_code=0` (deleted) or `result_code=2` (already gone).
2. **Edge function → SQL Server connectivity** — the edge function can
   reach `SEPIDAR_SQL_SERVER` from wherever it runs in production
   (cloud edge or on-prem worker — currently the cloud edge path is
   network-blocked from Lovable; production may differ if a tunnel
   exists).
3. **Per-entity happy path** — for each of the 7 entity types, a real
   rollback from the UI results in:
   - Sepidar voucher gone from ACC.Voucher.
   - `finance_vouchers` soft-deleted with metadata populated, voucher id
     preserved.
   - `finance_rollback_audit` row inserted with both snapshots.
   - Party balance recomputed to the expected value.
   - Entity `status` flipped to `cancelled` / `rolled_back`.
4. **Idempotency** — re-running a rollback on a voucher Sepidar has
   already deleted returns `result_code=2` and the orchestrator completes
   Supabase cleanup without raising.
5. **Failure rollback** — when the SP fails mid-way (kill SQL connection),
   the orchestrator aborts and Supabase state is unchanged.
6. **Permission gate against real users** — a non-admin account cannot
   see the rollback button or invoke the edge function.

The verification SQL + report template for these 6 items live in
`docs/sepidar/phase4_qa_smoke_report.md` (§4).

---

## 5. Honest summary

- **Code-complete:** Factor, Receive Identification, Payment Request,
  Payment Allocation, Bank Transfer, Party Transfer, Check (V1).
- **Verified end-to-end in Lovable:** none of the above — only the
  failure path of the edge function and the schema/backfill have been
  exercised here.
- **Sepidar rollback functionality is NOT tested.** The SP has never
  been executed from this environment. Any claim of "tested" must come
  from a run on your network.

---

## 6. Recommended next step

Two paths — your call:

- **Path A — Operator-led production validation.** Run the QA harness
  in `phase4_qa_smoke_report.md` on the farm network, fill in the 8-row
  report template, sign off. No further build work needed unless a
  failure is found. Phase 5 is optional / on-demand.

- **Path B — Phase 5 (pre-production hardening).** Before exposing the
  feature to operators, add:
  1. On-prem rollback relay (so the cloud UI doesn't depend on a tunnel
     to the SQL Server). Mirrors the existing `scripts/sql-sync-worker.cjs`
     pattern.
  2. Feature flag in `finance_feature_flags` (e.g. `rollback_enabled`)
     gating button visibility — lets you ship the code dark and enable
     per-environment.
  3. Server-side role re-check inside the edge function (defense in depth
     — currently the role gate is client-side only).
  4. Automated Vitest coverage for `rollbackFinanceOperation()` branches
     (idempotency, failure, allocation cascade, check state guard).

Tell me which path and I'll execute it.
