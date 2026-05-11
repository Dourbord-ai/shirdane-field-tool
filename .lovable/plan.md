## Sepidar Integration — Complete Finance Payment Flow

### Goal
Extend the working `sepidar-beneficiary-statement` pattern to all payment-request operations. Frontend → Edge Function → `bridge.*` stored procedures only. No direct Sepidar table access. No SQL credentials in frontend.

---

### 1. Discovery (read-only first)
Inspect to align with existing structure:
- `src/components/finance/tabs/PaymentRequestsTab.tsx` — current request flow, fields, statuses
- `src/lib/finance.ts`, `src/lib/paymentAmountTypes.ts`, `src/lib/paymentRequestTypes.ts`
- `src/lib/beneficiaryStatement.ts` — reference pattern for new helpers
- `src/components/finance/tabs/PartiesTab.tsx` — `sepidar_party_id` mapping
- DB tables: `beneficiaries`, `payment_requests`, `payment_request_items`, `payment_transactions`, `payment_transaction_allocations`, `accounting_documents`, `sepidar_sync_logs` (check existence/columns)
- `supabase/functions/sepidar-beneficiary-statement/index.ts` — copy structure

No code changes in this step.

---

### 2. New Edge Functions (mirror existing pattern)
Each function: `npm:mssql@10.0.2`, reads `SEPIDAR_SQL_*` env, executes ONLY the named bridge SP, returns `{success, ...}` with Persian errors + `rawError`. CORS + `verify_jwt = false` in `supabase/config.toml`.

| Function | Bridge SP | Inputs | Output |
|---|---|---|---|
| `sepidar-beneficiary-balance` | `bridge.GetBeneficiaryBalance` | `@PartyId int` | `{success, balance:number, data}` |
| `sepidar-create-payment-voucher` | `bridge.CreatePaymentRequestVoucher` | `@PaymentRequestId`, `@PartyId`, `@Amount`, `@PaymentType nvarchar`, `@Description nvarchar`, `@VoucherDate nvarchar` | `{success, voucherId, voucherNumber, data}` |
| `sepidar-allocate-payment-transaction` | `bridge.AllocatePaymentTransaction` | `@PaymentRequestItemId`, `@TransactionId`, `@Amount`, `@VoucherId` | `{success, allocationId, data}` |
| `sepidar-voucher-status` | `bridge.GetVoucherStatus` | `@VoucherId int` | `{success, status, data}` |

Existing `sepidar-beneficiary-statement` left untouched.

---

### 3. Frontend service `src/lib/sepidar.ts`
Single source of truth for Sepidar calls. All wrap `supabase.functions.invoke`, route errors through `getReadableFinanceError`, and call the logger:
- `getSepidarBeneficiaryStatement(partyId, fromDate?, toDate?)` — re-export of existing logic
- `getSepidarBeneficiaryBalance(partyId)`
- `createSepidarPaymentVoucher(payload)`
- `allocateSepidarPaymentTransaction(payload)`
- `getSepidarVoucherStatus(voucherId)`

Each helper:
1. Validates `partyId > 0` client-side.
2. Invokes function.
3. On `success === false`, throws Error with Persian `message`.
4. Inserts a row into `finance_sepidar_logs` (best-effort, never blocks).

---

### 4. DB migration — `finance_sepidar_logs`
Create table only if not present:
```
id uuid pk default gen_random_uuid()
operation text not null
request_payload jsonb
response_payload jsonb
success boolean not null default false
raw_error text
created_by uuid
created_at timestamptz default now()
```
RLS enabled. Insert: any authenticated. Select: any authenticated (DEV_ACCESS_MODE; tighten later).

---

### 5. Payment Request UI updates (`PaymentRequestsTab.tsx`)
Keep current structure; add Sepidar awareness per row:

**A. Beneficiary balance (creditor only)**
- When user picks beneficiary + selects type `بستانکار` (code 1), call `getSepidarBeneficiaryBalance` and show card:
  > «مانده قابل پرداخت طبق سپیدار: X ریال»
- Disable submit + inline error if `amount > balance`:
  > «مبلغ درخواست از مانده بستانکاری ذینفع در سپیدار بیشتر است.»
- For `پیش پرداخت` / `علی الحساب`, show muted note:
  > «برای این نوع پرداخت، کنترل مانده سپیدار الزامی نیست.»

**B. Manager approval → finance payment → allocation → Sepidar voucher**
- After finance pays a row + transaction allocation is recorded in DB, expose action **«ثبت سند در سپیدار»** → `createSepidarPaymentVoucher`. Persist returned `voucherId`/`voucherNumber` on the item row (use existing `sepidar_voucher_id` / `external_reference_id` if present, else add via migration).
- Action **«اتصال تراکنش به ردیف»** → `allocateSepidarPaymentTransaction`.
- Action **«بررسی وضعیت سند سپیدار»** → `getSepidarVoucherStatus` (read-only badge).
- Success toast: «عملیات سپیدار با موفقیت انجام شد». Failure: Persian message via `toastFinanceError`.

**C. UX polish**
- Mobile-first cards; status badges (Draft / Approved / Paid / Allocated / Sepidar-Posted / Failed) using semantic tokens.
- Strong empty/loading/error states.
- No layout regression on existing flows.

---

### 6. Permissions
Stay under `DEV_ACCESS_MODE` (no checks). Leave `// TODO permission: finance.sepidar.*` comments at every Sepidar call site for later activation.

---

### 7. Out of scope / safety
- Do NOT change `sepidar-beneficiary-statement` logic or its UI.
- Do NOT rename or drop existing tables/columns.
- Do NOT add direct Sepidar SQL.
- Do NOT touch production secrets (already configured).

---

### 8. Acceptance
- 4 new edge functions deployed with `verify_jwt=false` entries in `config.toml`.
- `src/lib/sepidar.ts` exports the 5 helpers; all log to `finance_sepidar_logs`.
- Payment request form blocks creditor submit when amount > Sepidar balance; allows other types.
- Existing beneficiary statement compare dialog still works unchanged.
- All errors surface non-empty Persian messages via `toastFinanceError`.

### Risks / open items
- We don't yet know exact bridge SP signatures for the 4 new procedures. Functions will pass the documented params; if SQL Server complains, the Persian "پروسیژر یافت نشد / پارامتر نامعتبر" path surfaces a clear error and `rawError` is logged for debugging — schema can then be tuned in one pass.
- If `payment_request_items` lacks `sepidar_voucher_id` / `sepidar_allocation_id` columns, a small additive migration will add them (nullable, no data loss).
