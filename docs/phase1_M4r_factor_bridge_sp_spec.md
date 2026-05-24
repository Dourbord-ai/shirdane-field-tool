# Phase 1 — M4r: Factor Voucher Bridge Contract (REVISED)

> **No new SP.** Factor posting MVP reuses the existing, already-deployed
> ShirdaneBridge procedure used by the payment-request flow:
>
>     bridge.CreatePaymentRequestVoucher
>
> Lovable does NOT write, modify, or deploy any SQL Server code. The
> Supabase-side Edge Function is the only thing we change.

---

## 1. Why CreatePaymentRequestVoucher fits

A livestock factor produces a simple **two-line** accounting voucher,
identical in shape to a payment-request voucher:

| Factor type | Line 1 (DR) | Line 2 (CR) |
|-------------|-------------|-------------|
| Purchase (factor_type_id = 1, RequestType = 0) | Counter account | Party (supplier) |
| Sale     (factor_type_id = 2, RequestType = 1) | Party (customer) | Counter account |

The counter-account selection and party-side posting are already implemented
inside `bridge.CreatePaymentRequestVoucher` — exactly what factor MVP needs.

---

## 2. SP name + integration style

- **SP:** `bridge.CreatePaymentRequestVoucher` (existing, unchanged)
- **Caller:** `supabase/functions/factor-post-voucher/index.ts`
- **Style:** Mirror `supabase/functions/sepidar-create-payment-voucher/index.ts`
  — same `_shared/sepidarSqlClient.ts`, same typed `mssql` inputs, same
  Persian error translation, same `SEPIDAR_CREATOR_ID` fallback.

We call the SP **directly** from `factor-post-voucher` (no detour through
`sepidar-post-voucher`). The existing `sepidar-post-voucher` branch for
`buy_livestock` / `sell_livestock` is removed.

---

## 3. Parameter mapping (factor → CreatePaymentRequestVoucher)

| SP input | Source | Notes |
|----------|--------|-------|
| `PartyId` (Int) | `finance_parties.sepidar_party_id` | resolved via `factors.party_id` |
| `PartyAccountSLRef` (Int) | `finance_parties.party_account_sl_ref` | required by SP |
| `PartyName` (NVarChar) | `finance_parties.name` | for Description2 |
| `RequestType` (TinyInt) | `factors.factor_type_id` | `1 → 0` (purchase), `2 → 1` (sale) |
| `Amount` (Decimal(18,2)) | `factors.payable_amount` | gross payable, not `total_amount` |
| `VoucherDate` (DateTime) | `factors.invoice_date` | sent as SQL `DATETIME` |
| `Description` (NVarChar) | see §4 | base description |
| `Description1` (NVarChar) | same as `Description` | per existing convention |
| `Description2` (NVarChar) | base + party suffix (see §4) | |
| `Creator` (Int) | `app_users.sepidar_user_id` or `SEPIDAR_CREATOR_ID` env fallback | |

No new params, no JSON payload, no `AppVoucherId` — SP signature stays
exactly as deployed.

---

## 4. Description construction

```
factorname = (factor_type_id = 1) ? 'خرید دام' : 'فروش دام'
persianDate = jalali(factors.invoice_date)         // YYYY/MM/DD

base = "بابت فاکتور کد " + factors.id
     + " تاریخ " + persianDate
     + " نوع "  + factorname

Description  = base
Description1 = base
Description2 = base + (RequestType == 1 ? " به " : " از ") + finance_parties.name
```

---

## 5. Idempotency — enforced on Supabase side

`bridge.CreatePaymentRequestVoucher` is **not** idempotent on any app-side
key. Lovable guards duplicate posting before the call:

1. Re-read `factors` row (FOR the just-built voucher).
2. If `factors.sepidar_voucher_id IS NOT NULL` → **skip Sepidar**, return
   the existing `{sepidar_voucher_id, sepidar_voucher_number}`. Response
   `success=true`, `step='already_posted'`.
3. Else read `finance_vouchers.sepidar_voucher_id` for the linked voucher.
   If non-null → mirror it back onto `factors` and return as
   `already_posted` (do not call Sepidar).
4. Else call `bridge.CreatePaymentRequestVoucher` exactly once.
5. On SP success → write `sepidar_voucher_id` + `sepidar_voucher_number`
   to **both** `finance_vouchers` and `factors` in the same Supabase
   transaction (or two sequential updates with the voucher update first).

Operator-visible retry is safe: a second click after a successful post
short-circuits at step 2 and never re-hits Sepidar.

---

## 6. Expected SP output (unchanged from payment-request flow)

Per the existing `sepidar-create-payment-voucher` integration:

- `SepidarVoucherId` (Int) — internal Sepidar PK
- `SepidarVoucherNumber` (NVarChar) — human-readable voucher number
- Plus the standard error result-set / RAISERROR pattern already handled
  by `_shared/sepidarSqlClient.ts`

No new OUTPUT params required.

---

## 7. Success / failure mapping

**Success (SP returned voucher id):**
- `finance_vouchers`: `sepidar_voucher_id`, `sepidar_voucher_number`,
  `sepidar_sync_status='synced'`, `sepidar_synced_at=now()`.
- `factors`: same two ids mirrored, `lifecycle_state='posted'`,
  `last_posting_error=NULL`, `last_posting_attempted_at=now()`.
- `factor_posting_attempts`: row with `success=true`,
  `error_code='sepidar_posted'`.

**Failure (SP raised or returned no id):**
- `finance_vouchers.sepidar_sync_status='failed'`.
- `factors.lifecycle_state='sepidar_failed'`,
  `last_posting_error=<translated Persian message>`.
- `factor_posting_attempts`: row with `success=false`,
  `error_code='sepidar_post'`, `response_payload` carries the raw SP
  error for diagnostics.
- Voucher row is **preserved** so the operator can retry from the UI.

**Already posted (idempotency hit):**
- No writes to `finance_vouchers` / `factors` beyond ensuring both rows
  carry the same `sepidar_voucher_id` / `sepidar_voucher_number`.
- `factor_posting_attempts`: row with `success=true`,
  `error_code='already_posted'`.

---

## 8. Out of scope (MVP)

- Per-cow / per-line accounting splits (SP posts the two-line summary
  only).
- New `factor_accounting_map` rows for SP-side roles (counter account is
  picked inside the SP, same as payment requests).
- Approval workflow, multi-currency, FX.
- A separate `bridge.CreateFactorVoucher` procedure — explicitly NOT
  needed.

---

## 9. Activation gate (Supabase-side only)

Before flipping `factor-post-voucher` to actually call the SP:

1. Confirm `finance_parties.sepidar_party_id` and `party_account_sl_ref`
   are populated for every party that can appear on a factor.
2. Confirm `app_users.sepidar_user_id` resolution path (or
   `SEPIDAR_CREATOR_ID` env fallback) for the operators who will click
   "ثبت سند".
3. Dry-run one purchase factor and one sale factor in Sepidar test DB
   via the existing payment-request edge function path, confirm the
   posted voucher matches expectation.
4. Confirm idempotency: clicking "ثبت سند" twice on the same factor
   produces exactly one Sepidar voucher.

No Sepidar-side work required. No new env vars. No new migrations.

---

## 10. What Lovable will change once activation is approved

In `supabase/functions/factor-post-voucher/index.ts`:

- After `post_approved_factor` RPC returns a `voucher_id`:
  - Re-read `factors` row; if `sepidar_voucher_id` already present →
    return `already_posted`.
  - Else load party (`sepidar_party_id`, `party_account_sl_ref`, `name`)
    and creator id.
  - Build Description / Description1 / Description2 per §4.
  - Open SQL connection via `_shared/sepidarSqlClient.ts` and execute
    `bridge.CreatePaymentRequestVoucher` with the params in §3.
  - Apply success/failure mapping per §7.
- Remove the current `sb.functions.invoke('sepidar-post-voucher', …)`
  call for factor vouchers.

No schema changes. No new shared helpers. No SP code.
