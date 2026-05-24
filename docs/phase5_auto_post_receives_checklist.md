# Phase 5 — Auto-post Receives to Sepidar: Pre-Enable Test Checklist

**Feature flag:** `finance_feature_flags.key = 'auto_post_receives_to_sepidar'` (column: `enabled`, currently `false`).
**Do NOT enable until every section below passes.**

---

## 0. Preconditions

- [ ] Pick a test bank account whose `finance_banks.sepidar_dl_id` AND `sepidar_account_id` are both set.
- [ ] Pick a test beneficiary (`finance_parties`) that is already synced to Sepidar (`assertPartiesReadyForPosting` will pass).
- [ ] Ensure `bankpartyaccountinfos` already has at least one cached row for that party's card / IBAN / account (so the first run hits the cache, not `verify-account`).
- [ ] Confirm there is at least one historical APPROVED `finance_receive_identifications` row linking that identifier to that party, OR that `bankpartyaccountinfos.finance_party_id` is already set for that cache row.

```sql
-- Sanity check current flag state
SELECT key, enabled FROM finance_feature_flags
 WHERE key = 'auto_post_receives_to_sepidar';
```

---

## 1. Auto-identification (flag = OFF)

- [ ] Import one Excel row whose description contains the cached card/IBAN/account.
- [ ] Row shows badge **شناسایی خودکار** (auto_identified) in `BankTransactionsTab`.
- [ ] A new row exists in `finance_receive_identifications` with:
  - `auto_identified = true`
  - `identification_source = 'excel_import_auto'`
  - `status = 'approved'`
  - `party_id` = expected party
  - `voucher_id IS NULL` (flag is off → no posting)
- [ ] `finance_auto_identification_log` contains a row with `step = 'auto_identified_only'`, `success = true`.

```sql
SELECT id, status, voucher_id, auto_identified, matched_by, matched_identifier
  FROM finance_receive_identifications
 WHERE bank_transaction_id = '<TX_ID>';

SELECT step, success, message, created_at
  FROM finance_auto_identification_log
 WHERE bank_transaction_id = '<TX_ID>'
 ORDER BY created_at;
```

---

## 2. Idempotency on re-import (flag = OFF)

- [ ] Re-run the same Excel import (or trigger `autoIdentifyTransaction` again on the same `bank_transaction_id`).
- [ ] The trigger `fn_finance_receive_identifications_guard` MUST refuse: "این تراکنش قبلاً استفاده شده است."
- [ ] No new row in `finance_receive_identifications` for this tx.
- [ ] `voucher_id` is still NULL and unchanged.
- [ ] `finance_auto_identification_log` shows a `create_receive` step with `success = false`.

---

## 3. Enable flag for posting tests

```sql
UPDATE finance_feature_flags
   SET enabled = true
 WHERE key = 'auto_post_receives_to_sepidar';
```

---

## 4. Auto-post success path (flag = ON)

Use a NEW bank transaction (the previous one is already consumed).

- [ ] Import → row shows badge **ثبت‌شده در سپیدار** (sepidar_posted).
- [ ] `finance_receive_identifications` row has:
  - `voucher_id IS NOT NULL` (created exactly once)
  - `sepidar_sync_status = 'synced'`
  - `sepidar_error_message IS NULL`
  - `sepidar_sync_attempts = 1`
- [ ] `finance_bank_transactions.assignment_status = 'assigned'`.
- [ ] `finance_auto_identification_log` has `step = 'auto_identified_and_posted'`, `success = true`.

```sql
SELECT id, voucher_id, sepidar_sync_status, sepidar_sync_attempts, sepidar_error_message
  FROM finance_receive_identifications
 WHERE bank_transaction_id = '<TX_ID_2>';
```

---

## 5. Re-run with flag ON — no duplicate voucher

- [ ] Re-trigger import for the same `<TX_ID_2>`.
- [ ] Trigger refuses re-creation of the receive identification (duplicate).
- [ ] No new `finance_vouchers` row is created; `voucher_id` on the receive row is unchanged.
- [ ] `sepidar-post-voucher` is NOT called a second time (check edge function logs — no new invocation for the same `voucher_id`).

---

## 6. Forced Sepidar failure (flag = ON)

Pick a third test transaction. Temporarily break posting (e.g. set the test party's Sepidar mapping to invalid, or use a beneficiary whose Sepidar sync is missing).

- [ ] Import the row.
- [ ] `finance_receive_identifications` row IS created and PRESERVED with:
  - `auto_identified = true`
  - `status = 'sync_failed'`
  - `sepidar_sync_status = 'failed'`
  - `sepidar_error_message` is populated and human-readable
  - `voucher_id IS NOT NULL` (voucher was created, only Sepidar push failed → idempotency anchor for retry)
- [ ] UI shows red **خطای سپیدار** badge with the error message.
- [ ] `finance_auto_identification_log` has `step = 'auto_identified_posting_failed'`, `success = false`, `message` = the error.
- [ ] **Manual retry** via the existing approve/retry button in `ReceiveIdentificationTab`:
  - Calls `approveReceiveIdentification` on the same row.
  - Re-uses the existing `voucher_id` (no new voucher created).
  - On success: `sepidar_sync_status = 'synced'`, `sepidar_sync_attempts` incremented.

```sql
SELECT id, status, voucher_id, sepidar_sync_status, sepidar_sync_attempts, sepidar_error_message
  FROM finance_receive_identifications
 WHERE bank_transaction_id = '<TX_ID_3>';
```

---

## 7. Audit log coverage summary

After all tests, this query must return all three step values at least once:

```sql
SELECT step, COUNT(*) AS n
  FROM finance_auto_identification_log
 WHERE step IN ('auto_identified_only',
                'auto_identified_and_posted',
                'auto_identified_posting_failed')
 GROUP BY step;
```

- [ ] `auto_identified_only` ≥ 1
- [ ] `auto_identified_and_posted` ≥ 1
- [ ] `auto_identified_posting_failed` ≥ 1

---

## 8. Reset / production enable

After tests pass and you are ready to ship to production:

```sql
-- Already enabled during tests; keep enabled for production.
UPDATE finance_feature_flags
   SET enabled = true
 WHERE key = 'auto_post_receives_to_sepidar';

-- To DISABLE again (rollback):
UPDATE finance_feature_flags
   SET enabled = false
 WHERE key = 'auto_post_receives_to_sepidar';
```

> **Note on the column name:** the flag table uses `key` (not `flag_key`) and `enabled` (boolean). The SQL the user proposed (`SET enabled = true WHERE flag_key = 'auto_post_receives_to_sepidar'`) must be adjusted to `WHERE key = 'auto_post_receives_to_sepidar'`.
