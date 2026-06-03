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
Add to `finance_payment_request_items` (nullable, backward compatible):
- `payment_method` text check in (`bank_transfer`,`cashbox`,`check`,`barter`,`deferred`)
- `settlement_subject_type` text (`main_invoice`,`freight`,`waybill`,`unloading`,`loading`,`weighing`,`storage`,`commission`,`service`,`misc`)
- `settlement_subject_title` text
- `settlement_group_key` text (UI grouping)
- `source_factor_id uuid` → `factors(id)`
- `source_related_cost_id uuid` → `factor_related_costs(id)` (added in Phase 6)
- `due_date date`, `execution_status text` (`pending`,`in_progress`,`executed`,`cancelled`)
- Indexes on `settlement_group_key`, `source_factor_id`.
Existing rows get `payment_method='bank_transfer'` defaults via backfill.

### Phase 4 — Item-specific forms (frontend)
- New polymorphic item editor; switches fields by `payment_method`.
- Bank transfer: card/account/IBAN + transfer_type + due_date + AccountVerifyButton.
- Cashbox: cashbox ref + recipient + payment_date + receipt slot.
- Check: amount/due_date/payee/reason/suggested bank+checkbook (no check_number yet).
- Deferred: amount/follow_up_date/reason.
- Barter: amount/counterparty/barter_type/reference.

Storage for transient fields uses a new nullable `details jsonb` on the item (single column, no sub-table).

### Phase 5 — Verify-account integration
- Add to `finance_parties`: `card_number`, `account_number`, `iban`, `declared_owner_name`, `verified_owner_name`, `verified_bank_name`, `verification_status` (verified/mismatch/pending/invalid/unknown), `verified_at`, `verified_by`, `verify_raw jsonb`, `mismatch_override_by`, `mismatch_override_reason`.
- Reuse `AccountVerifyButton` in: settlement item bank-transfer form, quick-party modal, freight/driver modal, party profile, factor related-cost form.
- Submit-guard: bank_transfer item requires `verification_status in ('verified')` OR manager-role override w/ reason.

### Phase 6 — Purchase invoice related costs (1 migration)
New table `factor_related_costs`:
- `id, factor_id (fk), cost_type (text: freight/waybill/unloading/loading/weighing/transport_insurance/storage/commission/misc), amount numeric, party_id (fk finance_parties), description, waybill_number, vehicle_plate, driver_name, attachment_path, account_identifier_type, account_identifier_value, declared_owner_name, verification_status, verified_at, created_by, created_at, updated_at`.
- RLS + GRANTs per house style.
- Add «هزینه‌های وابسته» section inside `MixedInvoiceForm` and Mixed factor detail view.

### Phase 7 — Quick party creation improvements
- Single shared `QuickPartyDialog` (extract from existing flow) accepting context: `{defaultPartyType, buttonLabel, defaultPartyStatus, prefill}`.
- Duplicate detection on name+mobile+national_id+card+account+IBAN with «استفاده از همین» / «ایجاد با وجود شباهت».
- Returns created/selected party to caller; never resets parent form.

### Phase 8 — Invoice → settlement shortcut
- After-create success screen with 6 actions (ثبت درخواست تسویه + related cost + view check/payments/list).
- "ثبت درخواست تسویه" creates ONE parent `finance_payment_requests` + N items (seller × payment_methods + each related cost × payment_method), all sharing distinct `settlement_group_key`s per (party_id + subject).

### Phase 9 — Check integration
- Item-stage: store check spec in item `details`.
- Issue-stage action on item → opens existing `NewPayableCheckDialog` prefilled; on save creates `finance_checks` + `finance_check_events(event_type='issued')` + `finance_check_links(link_type='settlement_item', link_id=item.id)`; flips item `execution_status='executed'`.
- No new check tables, no duplicated logic.

### Phase 10 — Execution rules (financial effect contract)
- Settlement request creation: **no triggers fire** on balance/voucher.
- Effects only on execution path:
  - bank_transfer: existing `finance_payment_allocations` flow + bank-transaction match.
  - cashbox: insert into cashbox ledger (existing).
  - check: existing finance_checks workflow (party/bank effected dates).
  - barter/deferred: state-only.
- Validate by reviewing existing triggers (audit step before coding).

### Phase 11 — UI/UX finalization
- Status cards, filters (status/party/date/source/payment_method), grouped item rendering by `settlement_group_key`, badges, dialog-in-place (no scroll-to-top), full RTL + mobile.

### Phase 12 — Testing plan
- Scripted scenarios per your list (simple bank, multi-check seller, invoice→seller+driver, two-stage driver, verify success/mismatch/override, dup party, check issuance writes events+links, legacy 3 records still load, no premature financial effect).
- Edge-fn integration tests for verify-account & factor-post-voucher remain green.

---

## Migration footprint summary

| Phase | New table | Altered table | Edge fn |
|---|---|---|---|
| 3 | — | finance_payment_request_items (+10 cols, +details jsonb, +indexes, backfill) | — |
| 5 | — | finance_parties (+12 cols) | — |
| 6 | factor_related_costs | finance_payment_request_items.source_related_cost_id FK | — |

No drops, no renames, no destructive backfills.

---

**Awaiting approval to proceed with Phase 2.** Reply با «تأیید فاز ۲» تا شروع کنم، یا تغییرات لازم را بفرمایید.