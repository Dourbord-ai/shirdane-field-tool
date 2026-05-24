# Phase 1 — Operator Activation Checklist (MVP Factor Posting)

Practical, operational checklist for activating the approved-factor → Sepidar voucher pipeline shipped in M3r-MVP.

No new code. No new migrations. No new UI.

---

## 1. Required inputs from accounting (replace TBD- codes)

For each active `factor_accounting_map` row currently seeded with `TBD-…` values, accounting must deliver the real Sepidar values **before activation**:

| Map row (factor_type, line_role) | Needs | Notes |
|---|---|---|
| `buy_livestock` / `inventory` (debit) | Real `account_code` | Livestock inventory GL account |
| `buy_livestock` / `ap` (credit) | Real `account_code` + DL (party) ref strategy | AP control account; DL = supplier party |
| `buy_livestock` / `tax` (debit) | Real `account_code` | VAT receivable, only if tax_amount > 0 |
| `buy_livestock` / `discount` (credit) | Real `account_code` | Only if discount > 0 |
| `buy_livestock` / `freight` (debit) | Real `account_code` | Only if shipping > 0 |
| `sell_livestock` / `ar` (debit) | Real `account_code` + DL ref | AR control account; DL = customer party |
| `sell_livestock` / `revenue` (credit) | Real `account_code` | Livestock sales revenue |
| `sell_livestock` / `tax` (credit) | Real `account_code` | VAT payable |
| `sell_livestock` / `cogs` (debit) | Real `account_code` | Currently amount = 0 in MVP; safe to leave inactive |
| `sell_livestock` / `inventory` (credit) | Real `account_code` | Currently amount = 0 in MVP; safe to leave inactive |

### DL / TF prerequisites (Tafsili / detail levels)
For every AP/AR row, confirm with accounting:
- Which **Sepidar party (Tarafhesab)** is used per supplier/customer.
- Whether the GL account requires **DL1** (party), **DL2** (project/cost-center), or **DL3** (currency/branch).
- That the party already exists in Sepidar and is reachable by `sepidar-beneficiaries`.
- That the **fiscal year is open** in Sepidar and the voucher date falls within it.

> Activation rule: do **not** flip `factor_accounting_map.is_active = true` for any row whose `account_code` still starts with `TBD-`. The RPC will refuse and lifecycle will move to `voucher_failed` with a Persian error.

---

## 2. End-to-end dry-run test scenario (single happy path)

Goal: prove the full pipeline once on a real but disposable factor.

1. Pick (or create) one small **buy_livestock** factor with: one cow, low amount, no discount, no shipping, tax = 0.
2. In a **staging** environment, seed real account codes for the 2 minimum rows: `inventory` (debit) and `ap` (credit). Activate only those two rows.
3. Approve the factor in the UI as normal (no change to factor registration).
4. Open the factor detail → click **"ثبت سند مالی"** (PostingPanel).
5. Expect:
   - `factors.lifecycle_state` → `voucher_created` then `posted`
   - `finance_vouchers` row created, status advances per existing Sepidar flow
   - `factors.sepidar_voucher_number` populated
   - one success row in `factor_posting_attempts` per step
6. Verify in Sepidar UI that the voucher exists, is balanced, and lines hit the expected GL/DL.

Sign-off: accounting confirms the dry-run voucher in Sepidar matches expectation. Then repeat once for `sell_livestock`.

---

## 3. Rollback scenario

If the dry-run voucher is wrong (bad mapping, wrong DL, wrong amount):

1. **In Sepidar**: have accounting delete or reverse the voucher manually (existing Sepidar procedure — no app support needed in MVP).
2. **In the app DB** (operator/admin via SQL, not UI):
   - `UPDATE factors SET lifecycle_state='approved', voucher_id=NULL, sepidar_voucher_id=NULL, sepidar_voucher_number=NULL, last_posting_error=NULL WHERE id = <factor_id>;`
   - `DELETE FROM finance_voucher_items WHERE voucher_id = <voucher_id>;`
   - `DELETE FROM finance_vouchers WHERE id = <voucher_id>;`
3. Fix the offending `factor_accounting_map` row (`account_code`, `sign`, or `is_active`).
4. Re-run the dry-run.

Audit trail in `factor_posting_attempts` is **never deleted** — it documents the rollback.

---

## 4. Retry scenario (transient failure)

Trigger examples: Sepidar SQL unreachable, timeout, network blip.

1. Factor ends in `lifecycle_state = 'sepidar_failed'` with `last_posting_error` populated.
2. The voucher row in `finance_vouchers` is preserved.
3. Operator opens factor → PostingPanel shows "خطای سپیدار — تلاش مجدد".
4. Click the retry button → re-invokes `factor-post-voucher`.
5. The RPC detects an existing `voucher_id` and skips re-creation; only the Sepidar post step retries.
6. On success: `lifecycle_state = 'posted'`, Sepidar fields populated, new attempt row logged.

Retries are safe and idempotent. No new voucher is created on retry.

---

## 5. Failed-mapping scenario (configuration error)

Trigger: an active mapping still has `TBD-` code, or no active row matches the factor's `factor_type`.

1. Operator clicks **"ثبت سند مالی"**.
2. RPC stops at step `resolve_map`.
3. `factors.lifecycle_state` → `voucher_failed`, `last_posting_error` populated with Persian text (e.g. `"کد حساب موقت (TBD) برای نقش inventory فعال است."`).
4. No `finance_vouchers` row is created. No Sepidar call is made.
5. Operator action: notify accounting → fix `factor_accounting_map` → click retry.
6. PostingPanel button label switches back to "ثبت سند مالی" once mappings are valid.

This is the **default state at activation time** until real codes are seeded — by design.

---

## 6. Failed-Sepidar scenario (Sepidar rejects the post)

Trigger examples: closed fiscal period, unknown DL/party, unbalanced from Sepidar's side, permission denied.

1. RPC succeeds → `voucher_created`, voucher + items exist.
2. `factor-post-voucher` calls `sepidar-post-voucher`, Sepidar SP returns an error.
3. `factors.lifecycle_state` → `sepidar_failed`, `last_posting_error` = Sepidar's Persian error.
4. `factor_posting_attempts` records the raw Sepidar response (`response_payload.raw_error`).
5. Operator actions:
   - If fixable in Sepidar (e.g. add party, open period): fix, then click retry.
   - If mapping is wrong (e.g. wrong AP account): follow **rollback scenario**, fix mapping, then re-post.
6. Voucher is **not auto-deleted** — preserved for audit and retry.

---

## Activation gate (single checkbox before flipping `is_active = true`)

- [ ] All TBD- codes replaced with real Sepidar account codes (section 1).
- [ ] DL/TF requirements confirmed per account (section 1).
- [ ] Dry-run buy + sell completed and verified in Sepidar (section 2).
- [ ] Rollback procedure rehearsed once (section 3).
- [ ] Operator trained on retry button and failure states (sections 4–6).
- [ ] Backup of `factor_accounting_map` taken (`pg_dump` of the table) before flipping `is_active`.

Once all six are checked, accounting may activate the mapping rows in production. The UI requires no further changes.
