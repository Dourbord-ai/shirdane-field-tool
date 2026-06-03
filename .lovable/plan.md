# درخواست تسویه — Audit & Phased Plan

> Phase 1 only: this is an audit + plan. No code/DB changes yet. Each later phase waits for your approval before execution.

---

## Phase 1 — Current System Audit

### 1.1 Payment Request module (current)

**DB tables** (already present, will be reused, not replaced):

- `finance_payment_requests`
  - Key cols: `id, legacy_id, title, description, request_type, legacy_request_type_code, status, payment_status, total_amount, confirmed_amount, total_paid_amount, remaining_amount, requested_by, approved_by, approved_at, is_deleted`
  - `status`: draft / pending_approval / approved / rejected / cancelled
  - `payment_status`: unpaid / partial_payment / full_payment (driven by trigger)
- `finance_payment_request_items`
  - Key cols: `id, payment_request_id, party_id, amount, confirmed_amount, amount_type, amount_type_code (1=creditor,2=prepayment,3=on_account), description, status, paid_transaction_id, voucher_id, paid_amount, remaining_amount, beneficiary_id, dl_ref, dl_code, beneficiary_name, beneficiary_balance_snapshot, beneficiary_type, beneficiary_snapshot_at`
- `finance_payment_allocations`
  - Links a request/item to one `bank_transaction_id` with `amount, status, voucher_id, sepidar_sync_status`

**UI**: `src/components/finance/tabs/PaymentRequestsTab.tsx` (1189 lines). Single-tab Finance page entry registered in `src/pages/Finance.tsx` as `payment-requests`.

**Supporting libs**: `src/lib/finance.ts`, `src/lib/paymentRequestTypes.ts` (7 legacy types: misc/purchase/refund/insurance_tax/petty_cash/payroll/bank_fees), `src/lib/paymentAmountTypes.ts`.

**Existing records**: 3 requests in production — must not break.

### 1.2 Factor / Purchase invoice module

- `factors` (50+ columns): `invoice_type, product_type, invoice_number, payable_amount, settlement_type, settlement_date, settlement_number, lifecycle_state, voucher_id, finance_party_id, shipping (numeric), ...`. Already has a single `shipping` numeric and an `image` attachment but **no structured related-cost table**.
- `factor_items` + per-product detail tables (`factor_item_livestock_details`, `_feed_details`, `_medicine_details`, `_milk_details`, `_sperm_details`, `_rental_details`, `_service_details`, `_manure_details`, `_other_details`).
- `factor_attachments` (file-level only; no party/amount fields).
- Forms: `src/components/invoices/MixedInvoiceForm.tsx`, `src/pages/NewInvoice.tsx`, `src/pages/Invoices.tsx`.

### 1.3 Parties

- `finance_parties` — full party profile (ownership_type, first/last name, company_name, national_code, identification_code, economic_code, mobile, balance, request_balance, sepidar_party_id, approval_status, sepidar_dl_*).
- No card/account/IBAN columns yet on parties (verification today is on bank transactions, not parties).
- Quick-create UI: `PartiesTab.tsx` + `LocalPartyBeneficiarySelector.tsx`.

### 1.4 Check module (complete & reusable)

- `finance_checks` — direction, party_id, amount, check_number, sayad_number, bank_id, bank_account_id, checkbook_leaf_id, issue_date, receive_date, due_date, status, party_effected_at, bank_effected_at, category (guarantee/cancelled/normal), voucher_id, expiry_date, guarantee_subject, related_contract, related_project, cancelled_date, cancel_reason.
- `finance_check_events` — event_type, event_date, description, metadata.
- `finance_check_links` — `link_type + link_id` polymorphic link (perfect for linking a check to a settlement item).
- `finance_checkbooks`, `finance_checkbook_leaves` (status, issued_check_id).
- UI: `src/components/finance/checks/*`, hooks in `src/hooks/useChecks.ts`, `useCheckbooks.ts`.

### 1.5 CardInfo / Verify Account (already production)

- Edge function `supabase/functions/verify-account/index.ts` — type 1/2/3 (card/sheba/deposit), cached in `bankpartyaccountinfos`.
- UI component `src/components/AccountVerifyButton.tsx` — number, declared name, live similarity match (match/partial/mismatch), inline override.
- Already used in `NewInvoiceLegacy.tsx`. Auto-pipeline use in `processDepositAI.ts`, `autoIdentify.ts`, `bankImport.ts`.

### 1.6 RLS / constraints

Standard pattern: all finance tables RLS-enabled, GRANTs to authenticated/service_role. The new fields/tables will follow the same pattern.

### 1.7 What can be reused vs migrated vs untouched

| Concern | Decision |
|---|---|
| Payment request tables/IDs/legacy data | **Reuse**, do not drop/rename. Only extend with columns. |
| `finance_payment_request_items` | **Extend** with grouping + execution fields. No sub-item table. |
| Check tables | **Reuse as-is**, link via `finance_check_links(link_type='settlement_item')`. |
| Verify-account edge function + AccountVerifyButton | **Reuse as-is**. |
| `factor_attachments` only freight model | **Replace** (additively) with new `factor_related_costs` table. |
| Parties | Add card/account/IBAN columns + verification snapshot. |
| Accounting/Sepidar posting | **Do not touch**. Settlement request remains zero-effect. |

### 1.8 What must NOT be broken

- Existing 3 payment requests + items + allocations.
- Factor posting flow (`factor-post-voucher` edge fn).
- Check workflow, party balance triggers, bank transaction allocation flow.
- Sepidar sync columns/edge functions.

---

## Phased Implementation Plan (await approval per phase)

### Phase 2 — Rename & reframe (UI-only, zero DB)
- Tab label & route key stay `payment-requests` internally (no breakage) but display as «درخواست تسویه».
- Update titles, buttons, empty states, breadcrumbs, dashboard widgets.
- Add concept note: parent request can contain multiple executable items.

### Phase 3 — Settlement item enhancement (1 migration)
Add to `finance_payment_request_items` (all nullable, backward compatible):
- `payment_method` text check in (`bank_transfer`,`cashbox`,`check`,`barter`,`deferred`,`legacy`)
- `settlement_subject_type` text (`main_invoice`,`freight`,`waybill`,`unloading`,`loading`,`weighing`,`storage`,`commission`,`service`,`misc`)
- `settlement_subject_title` text
- `settlement_group_key` text (UI grouping)
- `source_factor_id uuid` → `factors(id)`
- `source_related_cost_id uuid` → `factor_related_costs(id)` (Phase 6)
- `due_date date`
- `execution_status text` (`pending`,`in_progress`,`executed`,`cancelled`)
- `execution_priority smallint` (1=urgent, 2=high, 3=normal, 4=low; default 3) — **[Rev 6]** for liquidity planning.
- `details jsonb` (transient per-method fields)
- Indexes on `settlement_group_key`, `source_factor_id`, `execution_priority`, `due_date`.

**[Rev 1] Legacy backfill rule:** existing rows are set to `payment_method = 'legacy'` (NOT `bank_transfer`). Historical method is unknown — UI renders these as «روش قدیمی/نامشخص» and skips method-specific validators. New code paths always require an explicit method.

### Phase 4 — Item-specific forms (frontend)
- Polymorphic item editor switches by `payment_method`.
- Bank transfer: pick a `finance_party_accounts` row (or add a new one inline) + transfer_type + due_date + AccountVerifyButton.
- Cashbox: cashbox ref + recipient + payment_date + receipt slot.
- Check: amount/due_date/payee/reason/suggested bank+checkbook (no check_number yet).
- Deferred: amount/follow_up_date/reason.
- Barter: amount/counterparty/barter_type/reference.
- `legacy` items are read-only in the new editor (display only).
- All forms expose the `execution_priority` selector.

Transient per-method fields stored in the item `details jsonb`.

### Phase 5 — Verify-account integration (revised — separate accounts table)

**[Rev 2]** Do NOT add card/account/IBAN columns to `finance_parties`. Instead create:

```
finance_party_accounts
  id uuid pk
  party_id uuid fk → finance_parties(id) on delete cascade
  account_type text check in ('card','account','sheba')
  account_value text not null            -- normalized (digits-only, IR upper)
  declared_owner_name text
  verified_owner_name text
  verified_bank_name text
  verification_status text check in ('verified','mismatch','pending','invalid','unknown') default 'unknown'
  verified_at timestamptz
  verified_by uuid
  raw_response jsonb
  mismatch_override_by uuid
  mismatch_override_reason text
  is_default boolean default false
  is_active boolean default true
  created_at timestamptz default now()
  updated_at timestamptz default now()
  unique (party_id, account_type, account_value) where is_active
  partial unique (party_id, account_type) where is_default and is_active
```

- RLS + GRANTs per house style; no anon access.
- A party may have many cards, accounts and IBANs; `is_default` marks the preferred per-type.
- Settlement item `details.party_account_id` points to the chosen row.
- Reuse `AccountVerifyButton` in: party accounts manager, settlement bank-transfer item, quick-party modal, freight/driver modal, factor related-cost form.
- Submit-guard: bank_transfer item requires the selected `finance_party_accounts.verification_status = 'verified'` OR manager/CEO role override w/ recorded reason.

### Phase 6 — Purchase invoice related costs (1 migration)
New table `factor_related_costs`:
- `id, factor_id (fk), cost_type` (text: freight/waybill/unloading/loading/weighing/transport_insurance/storage/commission/misc)
- `amount numeric, party_id` (fk finance_parties, nullable)
- `description`
- `source_document_number text` — **[Rev 3]** waybill no. / weighing receipt no. / transport reference, etc.
- `vehicle_plate, driver_name`
- `attachment_path`
- `payment_required boolean not null default true` — **[Rev 4]** when false, cost is for cost-price only and **does NOT** generate any settlement item.
- `party_account_id` (fk finance_party_accounts, nullable) — preferred destination account for payment
- `created_by, created_at, updated_at`
- RLS + GRANTs.
- Add «هزینه‌های وابسته» section inside `MixedInvoiceForm` and the Mixed factor detail view.

### Phase 7 — Quick party creation improvements
- Single shared `QuickPartyDialog` (context-aware: default party type/status, button label, prefill).
- Inside the dialog, an optional «حساب/کارت/شبا» row that writes to `finance_party_accounts` with verify button.
- Duplicate detection on name+mobile+national_id and across `finance_party_accounts.account_value`. Shows «استفاده از همین ذینفع» / «ایجاد با وجود شباهت».
- Returns created/selected party (and optional account) to caller; never resets parent form.

### Phase 8 — Invoice → settlement shortcut (optional, opt-in)

**[Rev 5]** After invoice creation success screen shows a confirm prompt: «آیا درخواست تسویه ایجاد شود؟ — بله / خیر». Settlement requests are **never** created automatically.

If user picks «بله»:
- Open the Settlement Request builder pre-filled with one parent request and proposed items derived from:
  - the seller (main_invoice), and
  - every `factor_related_costs` row where `payment_required = true` (Rev 4).
- Costs with `payment_required = false` are excluded.
- User can adjust payment_method, split into multiple items, set priority, then save.
- Each (party + subject) group shares a `settlement_group_key`.

Also keep the after-create panel with shortcuts: افزودن هزینه وابسته / مشاهده وضعیت تسویه / چک‌های مرتبط / پرداخت‌های مرتبط / بازگشت.

### Phase 9 — Check integration
- Item-stage stores check spec in item `details`.
- Issue-stage action opens existing `NewPayableCheckDialog` prefilled; on save creates `finance_checks` + `finance_check_events(event_type='issued')` + `finance_check_links(link_type='settlement_item', link_id=item.id)`; flips item `execution_status='executed'`.
- No new check tables, no duplicated logic.

### Phase 10 — Execution rules (financial effect contract)
- Settlement request creation: **no balance/voucher effect**.
- Effects only on execution:
  - bank_transfer: existing `finance_payment_allocations` flow + bank-transaction match.
  - cashbox: existing cashbox ledger.
  - check: existing finance_checks workflow.
  - barter/deferred: state-only.

### Phase 11 — UI/UX finalization
- Filters: status / party / date / source / payment_method / **execution_priority**.
- Grouped item rendering by `settlement_group_key`; priority badge per item.
- Dialog-in-place (no scroll-to-top), full RTL + mobile.

### Phase 12 — Settlement Dashboard (NEW — **[Rev 7]**)
New tab «داشبورد تسویه» (or a dedicated section under existing finance dashboard). KPIs computed live from `finance_payment_request_items` joined with checks/allocations:

- تعهدات باز (open commitments) — sum of remaining_amount where execution_status ∈ pending/in_progress
- چک‌های سررسید نزدیک — 7 روز / 30 روز آینده (from `finance_checks` joined via `finance_check_links`)
- انتقالات بانکی در انتظار اجرا — bank_transfer items, pending
- تعهدات حمل (freight) — subject_type ∈ freight/waybill, open
- تعهدات تأمین‌کنندگان خوراک — items whose source_factor.product_type = 'feed', open
- تعهدات خدمات — subject_type='service', open
- مجموع تسویه‌های معوقه (overdue) — due_date < today AND not executed
- مجموع تسویه‌های آتی/معوق (deferred) — payment_method='deferred'

Cards link through to a pre-filtered Settlement Requests list.

### Phase 13 — Testing plan
- All scenarios from the original Phase 12 list, plus:
  - legacy items render with `payment_method='legacy'` and don't break validators.
  - party with multiple cards/accounts/IBANs in `finance_party_accounts`.
  - `payment_required=false` cost does NOT generate a settlement item.
  - Invoice-created flow only runs when user confirms «بله».
  - Priority filtering and dashboard KPIs match underlying queries.

---

## Migration footprint summary (revised)

| Phase | New table | Altered table | Notes |
|---|---|---|---|
| 3 | — | `finance_payment_request_items` (+11 cols incl. `execution_priority`, +`details jsonb`, +indexes) | Backfill `payment_method='legacy'` |
| 5 | `finance_party_accounts` | — | Replaces inline columns on `finance_parties` |
| 6 | `factor_related_costs` (incl. `source_document_number`, `payment_required`, `party_account_id`) | `finance_payment_request_items.source_related_cost_id` FK | — |
| 12 | — | — | Pure read-only views/queries for dashboard |

No drops, no renames, no destructive backfills. `finance_parties` untouched structurally.

---

## Revisions applied

1. ✅ Legacy items backfilled to `payment_method='legacy'`, never `bank_transfer`.
2. ✅ `finance_party_accounts` table replaces inline card/account/IBAN on parties.
3. ✅ `source_document_number` on `factor_related_costs`.
4. ✅ `payment_required` on `factor_related_costs` (excluded from settlement when false).
5. ✅ Invoice → settlement is opt-in via prompt, never automatic.
6. ✅ `execution_priority` (1–4) on settlement items.
7. ✅ New Phase 12 «داشبورد تسویه» with KPIs.

---

**Awaiting approval to proceed with Phase 2.** برای شروع پاسخ دهید: «تأیید فاز ۲».