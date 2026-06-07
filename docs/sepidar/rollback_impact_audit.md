# Rollback Impact Audit — finance_vouchers ecosystem

Status: **read-only audit, no code changes**. Produced before Phase 3 entity handlers. All findings reference live DB objects pulled from the project on 2026-06-07.

---

## 0. Executive summary

The codebase **already uses `finance_vouchers.is_deleted = false`** as the universal filter for every balance, ledger and report path that aggregates voucher items. That is the only invariant we need to preserve.

> **Single rule for safe rollback**: any rollback handler that wants to "remove" a voucher from balances/reports must end up with `finance_vouchers.is_deleted = true` (soft delete). Doing that — and only that — will correctly propagate through every read path audited below, because the triggers `tg_recompute_party_balance_voucher` and the read filters all key off `is_deleted`.

What is **not safe yet**:

1. The new `sepidar_status = 'rolled_back'` field we agreed to add is **not read anywhere** — so flipping only `sepidar_status` without also setting `is_deleted = true` will leave the voucher counted in every balance and report. Phase 3 handlers must do both.
2. `finance_payment_allocations` uses `status <> 'cancelled'` (not `is_deleted`) for the "is this allocation alive?" check. Rollback of a payment-request voucher must therefore set the allocation's `status = 'cancelled'` (or `is_deleted = true`, which the trigger also tolerates only if we update the recalc functions — see §3).
3. Sepidar comparison (`BeneficiaryStatementCompareDialog`) joins on `sepidar_voucher_id`. Because we agreed **not to null `sepidar_voucher_id` after rollback**, a rolled-back voucher that is also soft-deleted will *disappear* from the program side of the comparison while the Sepidar side will *also* be gone (the SP deleted it). Net effect: clean reconciliation. Confirmed — see §4.

---

## 1. `recompute_party_balance(p_party_id uuid)`

**Exists**: yes (`public.recompute_party_balance`, SECURITY DEFINER).

**Reads from**:
- `finance_voucher_items vi`
- `finance_vouchers v` (INNER JOIN on `vi.voucher_id = v.id`)
- updates `finance_parties.balance`

**Excludes deleted vouchers?** ✅ **Yes** — `WHERE … AND COALESCE(v.is_deleted,false) = false`. Voucher *items* have no `is_deleted` column; the filter is exclusively on the parent voucher.

**Trigger wiring**:
- `tg_recompute_party_balance_voucher` fires AFTER UPDATE on `finance_vouchers` **only when `is_deleted` flips** — it loops over all distinct `party_id`s on that voucher's items and recomputes each. ✅ Means: flipping `is_deleted = true` on the voucher header is enough; balances rebase automatically without any application code.
- `tg_recompute_party_balance_items` fires on `finance_voucher_items` INSERT/UPDATE/DELETE.

**Changes required for rollback**: **none**. Already rollback-safe.

> ⚠ One caveat for Phase 3: if a handler wants to keep the voucher row visible in audits but suppress it from balances, soft-delete the **header** (`is_deleted = true`). Do **not** delete voucher_items rows, do **not** zero their amounts. Soft-deleting the header is both sufficient and exactly what the trigger expects.

---

## 2. `fn_finance_recalc_payment_request(p_request_id uuid)` and friends

**Exists**: yes, plus `fn_finance_recalc_payment_request_item`, `fn_finance_payment_allocations_recalc` (trigger), `fn_finance_payment_items_recalc` (trigger).

**How "alive" allocations are counted**:
```sql
WHERE payment_request_id = p_request_id
  AND COALESCE(is_deleted,false) = false
  AND COALESCE(status,'') <> 'cancelled'
```
Both predicates are checked — so a rollback handler may choose either:
- `is_deleted = true` (recommended — matches every other table), **or**
- `status = 'cancelled'` (no schema change required), **or**
- both.

**Trigger wiring**: `trg_finance_payment_allocations_recalc` (AFTER INSERT/UPDATE/DELETE) automatically calls `fn_finance_recalc_payment_request` and (when item-scoped) `fn_finance_recalc_payment_request_item`. So updating allocations via plain SQL is enough — no manual recalc call needed unless we want to be defensive.

**Recomputes `paid_amount` / `payment_status` correctly after rollback?** ✅ Yes:
- per-item `paid_amount` → `SUM(amount)` of live allocations
- per-request `total_paid_amount`, `remaining_amount`, `payment_status` (`unpaid` / `partial_payment` / `full_payment`)
- Only progresses items in `approved/partially_paid/paid/sync_failed`; never overwrites `rejected/cancelled`. ✅ Good for rollback.

**Changes required**: **none**. Phase 3 payment-request handler must:
1. Mark each allocation `status = 'cancelled'` (or `is_deleted = true`), and
2. Soft-delete the matched voucher (`is_deleted = true`).

The trigger then recalcs the request automatically; `recompute_party_balance` recalcs the party balance automatically. Belt-and-suspenders: explicitly call both at the end of the handler.

---

## 3. Party balance ecosystem — every read path

| Path | Source | Filters voided? | Required changes |
|---|---|---|---|
| `finance_parties.balance` column | maintained by `recompute_party_balance()` | ✅ `is_deleted=false` on voucher | none |
| `FinanceDashboardTab` — KPI "بدهکار/بستانکار ذینفعان" | reads cached `finance_parties.balance` | ✅ transitive | none |
| `FinanceDashboardTab` — KPI "اسناد ثبت‌نشده در سپیدار" / "خطاهای ثبت سپیدار" | `finance_vouchers` count filtered by `is_deleted=false` | ✅ | none |
| `BeneficiariesStatusReport` / `FinanceReportsTab` party section | calls `get_beneficiary_balances()` RPC | ✅ — RPC joins with `COALESCE(v.is_deleted,false)=false` and explicit guard `(vi.id IS NULL OR v.id IS NOT NULL)` | none |
| `BeneficiaryVouchersDialog` (per-party docs) | `finance_voucher_items` + `finance_vouchers!inner` with `.eq("finance_vouchers.is_deleted", false)` | ✅ | none |
| `beneficiaryStatement.ts` (Persian ledger / aging / "kardex") | same embed `finance_vouchers!inner(...is_deleted...)` + `.eq("finance_vouchers.is_deleted", false)` | ✅ | none |
| `VouchersTab` (master list) | `.eq("is_deleted", false)` | ✅ | none — note: rollback'd voucher will *not appear* in this list. If we want operators to see voided vouchers for audit, add a "نمایش اسناد ابطال‌شده" toggle (UI-only, future) |
| `finance.ts` helpers (`getPartyBalance`, etc.) | `.eq("is_deleted", false)` on vouchers | ✅ | none |

**RPC inventory** in `public` that touches voucher math:
- `recompute_party_balance` — filters ✅
- `get_beneficiary_balances` — filters ✅
- `recalc_finance_voucher_totals` — header total_debit/total_credit (recomputed from items; orthogonal to rollback)
- `fn_finance_check_post_voucher` — *creates* check vouchers; ignores `is_deleted` only when looking up existing posted voucher with `is_deleted = false` for idempotency ✅ (rollback'd check can be re-posted because lookup will skip the soft-deleted row)
- `fn_finance_recalc_payment_request*` — filters ✅

**Verdict**: every balance/aging/dashboard path is rollback-safe **as long as the handler sets `is_deleted = true` on the voucher header**.

---

## 4. Sepidar comparison subsystem

**Screens / code paths**:
- `BeneficiaryStatementCompareDialog.tsx` — side-by-side program ↔ Sepidar table.
- `sepidar-financial-documents` edge function (Sepidar side).
- `sepidar-financial-document-details` edge function.
- `BeneficiaryVouchersDialog.tsx` — single-side, internal only.
- `VouchersTab.tsx` — list of program vouchers w/ sepidar sync state.

**Program side** of the comparison reads `finance_vouchers` filtered by `is_deleted = false` (verified above). After rollback the voucher is soft-deleted → it disappears from the program side.

**Sepidar side** is fetched live from Sepidar. After `bridge.RollbackSepidarVoucher` succeeds (`result_code` 0 or 2) the row no longer exists in Sepidar either → it disappears from the Sepidar side.

**Net reconciliation effect**: clean — both sides remove the row symmetrically. No phantom mismatches.

**`sepidar_voucher_id` is preserved** on the soft-deleted `finance_vouchers` row (per the policy we set in Phase 2). That preserves the audit trail (`finance_rollback_audit` joins back to it) **without** polluting the comparison view, because the comparison only queries non-deleted vouchers.

**Edge case**: if the Sepidar SP succeeds but the subsequent Supabase soft-delete fails, the program side still shows the row → operator sees a "missing in Sepidar" mismatch. This is by design (loud failure beats silent drift). Phase 3 handlers should:
- run Sepidar delete first (already mandated),
- on Supabase failure, mark `sepidar_status = 'rolled_back'` *and* keep retrying soft-delete (idempotent SP guarantees re-running rollback returns `result_code = 2` = success).

**Changes required**: **none in the comparison subsystem**. Phase 4 may add a small badge "ابطال شده" in `VouchersTab` when a toggle reveals soft-deleted vouchers; not required for correctness.

---

## 5. `finance_vouchers` dependency map

### 5.1 Tables holding `voucher_id` FKs / soft references

From `information_schema`:

| Referencing table | Column | Purpose | Rollback action |
|---|---|---|---|
| `finance_voucher_items` | `voucher_id` | line items (1:N) | keep — soft-delete cascades semantically via header `is_deleted` |
| `finance_bank_transfers` | `voucher_id` | inter-bank voucher | clear/keep; mark transfer voided |
| `finance_party_transfers` | `voucher_id` | party-transfer voucher | clear/keep; mark transfer voided |
| `finance_payment_allocations` | `voucher_id` | payment voucher per allocation | mark allocation cancelled |
| `finance_payment_request_items` | `voucher_id` | denorm pointer | reset on rollback |
| `finance_receive_identifications` | `voucher_id` | receive voucher | mark RI voided |
| `finance_checks` | `voucher_id` | registration voucher | revert check status (see fn_finance_check_post_voucher) |
| `finance_sepidar_sync_logs` | `voucher_id` | sync log | leave; historical |
| `factors` | `voucher_id`, `sepidar_voucher_id`, `sepidar_voucher_number` | factor → its accounting voucher | reset factor lifecycle |
| `factor_posting_attempts` | `voucher_id` | post-attempt log | leave; historical |

### 5.2 RPCs referencing `finance_vouchers`

`recompute_party_balance`, `get_beneficiary_balances`, `fn_finance_check_post_voucher`, `recalc_finance_voucher_totals`. All filter `is_deleted = false` correctly (§1, §3).

### 5.3 Triggers on `finance_vouchers` / `finance_voucher_items`

| Trigger | When | What | Rollback impact |
|---|---|---|---|
| `tg_recompute_party_balance_voucher` | AFTER UPDATE on `finance_vouchers` | If `is_deleted` flipped, recompute every party touched by the voucher's items | ✅ this is the mechanism that makes soft-delete = balance removal |
| `tg_recompute_party_balance_items` | AFTER INSERT/UPDATE/DELETE on `finance_voucher_items` | recompute affected party | not invoked on soft-delete (we don't touch items); not a problem because the header trigger covers it |
| (header total recalc) `recalc_finance_voucher_totals` | on `finance_voucher_items` | maintains `total_debit/total_credit` | irrelevant to rollback |

### 5.4 Reports referencing `finance_vouchers`

All reports listed in §3 plus the Sepidar comparison dialog and `BeneficiaryVouchersDialog`. **Every read path already filters `is_deleted = false`** — confirmed by grep:

```
src/lib/beneficiaryStatement.ts        .eq("finance_vouchers.is_deleted", false)
src/components/finance/BeneficiaryVouchersDialog.tsx  .eq("finance_vouchers.is_deleted", false)
src/components/finance/tabs/VouchersTab.tsx           .eq("is_deleted", false)
src/lib/finance.ts                                    .eq("is_deleted", false)  ×2
```

No path joins on `voucher_items` without also joining the header — so there is no risk of "orphan items" being summed after a header soft-delete.

---

## 6. Recommendations for Phase 3

1. **Adopt header soft-delete as the single rollback primitive.**
   On successful Sepidar SP (result_code 0 or 2), set on the linked `finance_vouchers` row:
   ```sql
   is_deleted    = true
   sepidar_status= 'rolled_back'   -- new column (Phase 1)
   rollback_at   = now()
   rollback_by   = :user
   rollback_reason = :reason
   -- KEEP sepidar_voucher_id intact for audit (per user instruction)
   ```
   The `tg_recompute_party_balance_voucher` trigger will automatically rebase every affected party's balance — handler should still call `recompute_party_balance()` explicitly as belt-and-suspenders.

2. **Payment-request handler**:
   For each related allocation, set `status = 'cancelled'` (and optionally `is_deleted = true`). The `trg_finance_payment_allocations_recalc` trigger will rerun `fn_finance_recalc_payment_request` automatically. Handler should still call it explicitly as a safety net.

3. **Checks handler**:
   Use lifecycle-aware reversal — soft-delete the voucher (`is_deleted=true`) and revert `finance_checks.status` to the prior state; `fn_finance_check_post_voucher` is idempotent on `is_deleted=false`, so re-posting after a rollback works without dedupe collisions.

4. **No schema change strictly required**.
   The audit found *zero* read paths that ignore `is_deleted`. The only new fields needed are the audit-trail fields agreed in Phase 1 (`sepidar_status`, `rollback_at`, `rollback_by`, `rollback_reason`) — already covered by your Phase 1 migration plan.

5. **Optional UI improvement** (Phase 4, not required for correctness):
   Add a "نمایش اسناد ابطال‌شده" toggle in `VouchersTab` so operators can audit soft-deleted vouchers with their `sepidar_status` / `rollback_reason` visible.

---

## 7. Verdict

`finance_vouchers` **can safely support a rollback/void lifecycle** by reusing the existing `is_deleted` flag and stamping the new `sepidar_status` / `rollback_*` columns. No business-logic refactor is required in any existing function or report; Phase 3 handlers can proceed under the rules above.
