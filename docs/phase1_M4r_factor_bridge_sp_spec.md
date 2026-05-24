# Phase 1 — M4r: Factor Voucher Bridge Contract (Supabase Side Only)

> **Scope correction.** Lovable does **NOT** design, write, or deploy the
> Sepidar SQL Server stored procedure. The Sepidar/ShirdaneBridge SP will be
> provided externally, following the same pattern as the existing
> finance receive/payment bridge (`bridge.CreateBankVoucher`,
> `bridge.CreatePaymentRequestVoucher`) and legacy
> `SpAddSepidarBankVoucher3` flow.
>
> This document only defines the **Supabase Edge Function contract** —
> the parameters we will send into the (to-be-provided) SP, the response
> shape we expect back, and how that response maps onto `factors` and
> `finance_vouchers`. Final SP name and exact parameter names will be
> filled in once the Sepidar team delivers the procedure signature.

---

## 1. Integration style (must mirror receive/payment)

The new factor branch will live inside the existing
`supabase/functions/sepidar-post-voucher/index.ts` file, alongside the
current branches:

| voucher_type                                | Existing bridge SP                              |
|---------------------------------------------|-------------------------------------------------|
| `receive_identification`                    | `bridge.CreateBankVoucher`                      |
| `payment_allocation` / `payment_request`    | `bridge.CreatePaymentRequestVoucher`            |
| `bank_transfer`                             | `bridge.CreateSimpleInterBankTransferVoucher`   |
| `party_transfer`                            | `bridge.CreatePartyTransferVoucher`             |
| **`buy_livestock` / `sell_livestock`**      | **`<TBD — provided by Sepidar team>`**          |

Same conventions:

- Connection via shared `_shared/sepidarSqlClient.ts` (`mssql` driver,
  SQL Server 2008-compatible settings).
- Typed `sql.Request().input(name, sql.<Type>, value)` bindings — no
  string interpolation.
- One SP call per voucher. Idempotency enforced by passing our
  `finance_vouchers.id` (or `idempotency_key`) as the unique
  `AppVoucherId` key — the SP is responsible for returning the existing
  Sepidar voucher if the same key was already posted.
- Persian error translation via the existing `persianizeError(raw)`
  helper.
- `SEPIDAR_CREATOR_ID` env var (default `1`) reused as `RegisteredUserId`
  fallback when the triggering user has no `sepidar_user_id` mapping.

No new env vars. No new shared modules. No new Sepidar SQL Server logic
authored by Lovable.

---

## 2. Request parameters we will send

All parameters bound as typed `mssql` inputs. Names below are the
**proposed** ones — the Sepidar team may rename them in the final SP;
the Edge Function will be adjusted to match once the contract lands.

| Param (proposed)            | mssql type           | Source (Supabase)                                              | Notes |
|-----------------------------|----------------------|----------------------------------------------------------------|-------|
| `AppFactorId`               | `NVarChar(64)`       | `factors.id` (uuid → text)                                     | Audit only |
| `AppVoucherId`              | `NVarChar(64)`       | `finance_vouchers.id` (uuid → text)                            | **Idempotency key** |
| `IdempotencyKey`            | `NVarChar(128)`      | `finance_vouchers.idempotency_key` (`factor:<uuid>`)           | Secondary dedupe |
| `RequestType`               | `TinyInt`            | `0` = buy_livestock, `1` = sell_livestock                      | Mirrors legacy `FactorTypeId` semantic |
| `ProductTypeId`             | `SmallInt`           | `factors.product_type_id` (livestock = legacy code)            | |
| `FactorName`                | `NVarChar(200)`      | Built: `'خرید دام'` / `'فروش دام'`                              | |
| `FactorNumber`              | `NVarChar(50)`       | `factors.invoice_number`                                       | |
| `FactorDate`                | `DateTime`           | `factors.invoice_date` (timestamptz → UTC datetime)            | SQL2008-safe |
| `PersianFactorDate`         | `NVarChar(10)`       | Jalali `YYYY/MM/DD` derived from `invoice_date`                | |
| `Amount`                    | `Decimal(18,2)`      | `finance_vouchers.total_debit` (== total_credit, validated)    | |
| `PayableAmount`             | `Decimal(18,2)`      | `factors.payable_amount`                                       | |
| `TaxAmount`                 | `Decimal(18,2)`      | `factors.tax_amount`                                           | |
| `DiscountAmount`            | `Decimal(18,2)`      | `factors.discount`                                             | |
| `ShippingAmount`            | `Decimal(18,2)`      | `factors.shipping`                                             | |
| `SepidarPartyId`            | `Int` (nullable)     | counterparty `parties.sepidar_party_id`                        | Buyer for sell, Seller for buy |
| `LegacyPartyId`             | `Int` (nullable)     | counterparty `parties.legacy_party_id`                         | Fallback when sepidar id missing |
| `PartyName`                 | `NVarChar(200)`      | counterparty `parties.name` snapshot                           | |
| `Description`               | `NVarChar(MAX)`      | `'فاکتور ' + code + ' — ' + persian_date`                       | |
| `Description2`              | `NVarChar(MAX)`      | counterparty name (Sepidar second description slot)            | |
| `JsonStatus`                | `NVarChar(MAX)`      | Raw JSON of `{factor, voucher, items, map_snapshot}`           | SP must NOT parse — audit only |
| `RegisteredUserId`          | `Int`                | triggering `app_users.sepidar_user_id` ?? `SEPIDAR_CREATOR_ID` | |
| `RegisteredUserFullName`    | `NVarChar(200)`      | triggering `app_users.full_name`                               | |
| `SourceSystem`              | `NVarChar(50)`       | constant `'Damban'`                                            | |
| `SourceType`                | `NVarChar(50)`       | constant `'factor'`                                            | |

### Output parameters we will read

| OUTPUT param                | mssql type           | Maps to                                                        |
|-----------------------------|----------------------|----------------------------------------------------------------|
| `SepidarVoucherId`          | `Int` (OUTPUT)       | `finance_vouchers.sepidar_voucher_id`, `factors.sepidar_voucher_id` |
| `SepidarVoucherNumber`      | `NVarChar(50)` OUT   | `finance_vouchers.sepidar_voucher_number`, `factors.sepidar_voucher_number` |
| `ResultCode`                | `Int` (OUTPUT)       | `0` = success, non-zero = error code                           |
| `ResultMessage`             | `NVarChar(MAX)` OUT  | Raw Sepidar message (used for `sepidar_error_message`)         |

The SP **must** return both via OUTPUT params **and** via a single result
set row `SELECT @SepidarVoucherId AS SepidarVoucherId, ... , @ResultCode AS ResultCode, @ResultMessage AS ResultMessage` so the Edge Function can read whichever the
`mssql` driver surfaces (matching how the existing receive/payment
branches consume results).

---

## 3. Success / failure mapping

### Success (`ResultCode = 0` AND `SepidarVoucherId IS NOT NULL`)

```ts
// finance_vouchers
sepidar_sync_status      = 'synced'
sepidar_voucher_id       = <SepidarVoucherId>
sepidar_voucher_number   = <SepidarVoucherNumber>
sepidar_error_message    = NULL
sepidar_synced_at        = now()
status                   = 'posted'

// factors  (done by factor-post-voucher orchestrator)
lifecycle_state          = 'posted'
sepidar_voucher_id       = <SepidarVoucherId>::text
sepidar_voucher_number   = <SepidarVoucherNumber>::text
last_posting_error       = NULL
last_posting_attempted_at = now()

// factor_posting_attempts  (one row)
success       = true
error_code    = 'sepidar_posted'
request_payload  = { step: 'sepidar_post', params: <bound params, secrets stripped> }
response_payload = { sepidar_voucher_id, sepidar_voucher_number, message }
```

### Failure (`ResultCode <> 0` OR SP raised an error)

```ts
// finance_vouchers
sepidar_sync_status      = 'failed'
sepidar_error_message    = persianizeError(ResultMessage ?? raw_error)
sepidar_synced_at        = now()
// status stays 'draft' — voucher row preserved for retry

// factors
lifecycle_state          = 'sepidar_failed'
last_posting_error       = persianizeError(...)
last_posting_attempted_at = now()
// voucher_id stays set — retry will reuse the same finance_vouchers row,
// which guarantees idempotency on the Sepidar side via AppVoucherId.

// factor_posting_attempts  (one row)
success       = false
error_code    = 'sepidar_post'
request_payload  = { step: 'sepidar_post', params: <…> }
response_payload = { result_code, result_message, raw_error }
```

### Idempotent retry

Retry button calls `factor-post-voucher` again. The DB RPC
`post_approved_factor` already short-circuits with the existing
`voucher_id` (no new voucher created). The Edge Function then re-invokes
`sepidar-post-voucher` with the **same** `finance_vouchers.id`, so the
SP receives the same `AppVoucherId` and must return the previously
issued `SepidarVoucherId` instead of creating a duplicate.

---

## 4. What Lovable will deliver once Sepidar SP is provided

1. Add a `buy_livestock` / `sell_livestock` branch inside the existing
   `sepidar-post-voucher/index.ts` next to the receive/payment branches.
2. Bind exactly the parameters listed in §2 (renamed if needed to match
   the final SP signature).
3. Read OUTPUTs + result-set row and apply the mapping in §3.
4. No migrations, no new env vars, no new shared helpers, no SP code.

---

## 5. What we are waiting on (from Sepidar team)

- [ ] Final SP fully-qualified name (e.g. `bridge.CreateFactorVoucher`)
- [ ] Final ordered parameter list with mssql types
- [ ] Confirmation of OUTPUT param names + result-set shape
- [ ] Confirmation that the SP enforces idempotency on `AppVoucherId`
- [ ] Sample success + failure result rows for fixture-based testing

Until all five are received, the activation gate from
`docs/phase1_operator_activation_checklist.md` stays closed and
`factor_accounting_map.is_active` remains `false` for every row.
