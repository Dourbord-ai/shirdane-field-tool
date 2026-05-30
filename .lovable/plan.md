# Plan — Check Auto-Posting + Guarantee/Cancelled Categories

Two related changes to the Check Management module. Task 1 makes received/payable checks immediately affect the General Ledger; Task 2 adds two new tracking-only categories that share the UI shell but never touch accounting.

---

## Part 1 — Schema additions (single migration)

### 1.1 Extend `finance_checks`
- Add `category` text NOT NULL DEFAULT `'operational'`, CHECK in (`'operational'`,`'guarantee'`,`'cancelled'`). Backfill existing rows to `'operational'`.
- Add `voucher_id uuid NULL` (FK → `finance_vouchers(id)`) — primary "registration" voucher, for fast joins.
- Add for guarantee/cancelled metadata:
  - `expiry_date date NULL` — guarantee
  - `guarantee_subject text NULL`
  - `related_contract text NULL`
  - `related_project text NULL`
  - `cancelled_date date NULL`
  - `cancel_reason text NULL` (CHECK in the 7 reasons listed in the spec)
- New CHECK: when `category='operational'` `party_id` must be NOT NULL (current implicit rule).

### 1.2 Extend enums
- `check_status`: add value `'cancelled'`. Add allowed transitions in `fn_finance_check_status_guard` for the new category (cancelled checks are born `cancelled`; guarantee checks support `active → returned/claimed/expired/voided`). Reuse existing values where possible: map "active"→ for guarantees we'll use status = `'issued'` semantically and rely on category to distinguish. Decision: add `'active'`, `'returned'`, `'claimed'`, `'expired'` to `check_status` enum to match the spec exactly.
- `check_event_type`: add `'voucher_posted'`, `'voucher_reversed'`, `'guarantee_claimed'`, `'guarantee_returned'`, `'cancelled'`.

### 1.3 Voucher posting helper (plpgsql, SECURITY DEFINER)
Function `public.fn_finance_check_post_voucher(p_check_id uuid, p_event text)` where `p_event ∈ ('register','clear','bounce')`:

1. Lock the check row. Bail early (no-op, no error) if `category <> 'operational'`.
2. Guard idempotency via `finance_check_links` unique index on `(check_id, link_type='voucher', metadata->>'event')` — if a link with this `event` already exists, return its `voucher_id` and exit.
3. Insert a `finance_vouchers` row using existing sequence-based numbering (`voucher_number` auto via `DEFAULT nextval`), with:
   - `voucher_type` = `'check'`
   - `source_operation_type` = `'finance_check'`
   - `source_operation_id` = `p_check_id`
   - `voucher_date` = `now()` (or check's relevant date)
   - `title`/`description` = Persian sentence describing the event
   - `status` = `'posted'`
4. Insert two `finance_voucher_items` rows per the matrix below.
5. Insert one `finance_check_links` row (`link_type='voucher'`, metadata `{event}`).
6. Insert one `finance_check_events` row (`event_type='voucher_posted'` or `'voucher_reversed'`).
7. For the `register` event only, set `finance_checks.voucher_id = new_voucher.id`.

Account-type strings used in `finance_voucher_items.account_type` (the only existing identification column; Sepidar IDs left NULL for now and will be filled later by mapping):

| Event | Direction | Debit row | Credit row |
|---|---|---|---|
| register | received | `notes_receivable`, party_id=NULL | `party_receivable`, party_id=check.party_id |
| register | payable  | `party_payable`, party_id=check.party_id | `notes_payable`, party_id=NULL |
| clear    | received | `bank`, bank_id=check.bank_id | `notes_receivable` |
| clear    | payable  | `notes_payable` | `bank`, bank_id=check.bank_id |
| bounce   | received | `party_receivable`, party_id=check.party_id | `notes_receivable` |
| bounce   | payable  | `notes_payable` | `party_payable`, party_id=check.party_id |

Party balance auto-recomputes via the existing `tg_recompute_party_balance_items` trigger on `finance_voucher_items`.

### 1.4 Trigger wiring
- Replace/extend `fn_finance_check_after_insert`: after its existing work, if `NEW.category='operational'`, call `fn_finance_check_post_voucher(NEW.id, 'register')`.
- New `fn_finance_check_after_status_change` (AFTER UPDATE OF status): if `category='operational'` and `OLD.status <> NEW.status` and `NEW.status IN ('cleared','bounced')`, call `fn_finance_check_post_voucher(NEW.id, NEW.status::text)`.
- Update `fn_finance_check_status_guard` to allow guarantee/cancelled lifecycle transitions and to forbid `cleared`/`bounced` for `category <> 'operational'`.

### 1.5 GRANTs / RLS
- All new columns inherit existing table grants. No new tables → no new GRANT statements required.

---

## Part 2 — Frontend

### 2.1 Tab structure (`ChecksTab.tsx`)
Update `SUBTABS` to the spec ordering:
```
چک‌های دریافتنی | چک‌های پرداختنی | چک‌های ضمانتی | چک‌های ابطالی | دسته‌چک‌ها | سررسیدها | برگشتی‌ها
```
List queries for the existing received/payable tabs are filtered by `category='operational'` so guarantee/cancelled checks never leak into them.

### 2.2 New components
- `NewGuaranteeCheckDialog.tsx` — fields: ذینفع، مبلغ، شماره چک، شماره صیاد، بانک، حساب بانکی، تاریخ چک، تاریخ انقضا، موضوع ضمانت، قرارداد، پروژه، توضیحات. Inserts with `direction='received'|'payable'` (user picks), `category='guarantee'`, `status='active'`. No voucher created.
- `NewCancelledCheckDialog.tsx` — fields: ذینفع، مبلغ، شماره چک، شماره صیاد، بانک، حساب بانکی، تاریخ چک، تاریخ ابطال، علت ابطال (Select from the 7 reasons), توضیحات. Inserts `category='cancelled'`, `status='cancelled'`.
- `GuaranteeChecksTab.tsx`, `CancelledChecksTab.tsx` — list + KPI cards as specified.
- Reuse existing `CheckDetailDialog` (passes through `category` to switch labels; voucher-related sections shown only for `operational`).
- Update `StatusBadge` to label the new statuses (`active` → "فعال" green, `returned` → "بازگشتی" muted, `claimed` → "ضبط شده" red, `expired` → "منقضی" amber, `cancelled` → "ابطال" destructive).

### 2.3 KPI cards
- Guarantee tab: تعداد فعال، جمع مبلغ، تعداد منقضی.
- Cancelled tab: تعداد، جمع مبلغ، breakdown بر اساس علت (small bar/list).

### 2.4 Hooks / lib
- Extend `useChecks` with `category` filter; add `useGuaranteeChecks`, `useCancelledChecks` (thin wrappers).
- `src/lib/checks.ts`: extend `CheckStatus`, add `CheckCategory`, `CANCEL_REASONS`, label/tone maps.
- Existing `NewReceivedCheckDialog` and `NewPayableCheckDialog` keep working — they'll send `category` implicitly via DB default (`'operational'`).

### 2.5 Detail dialog additions
Show the linked voucher number + click-through (using `finance_check_links` rows of `link_type='voucher'`) for operational checks. Guarantee/cancelled show a neutral "این چک سند حسابداری ندارد" note.

---

## Technical details

- **Idempotency** lives in DB only — no client-side dedup. A unique partial index on `finance_check_links` over `(check_id, (metadata->>'event'))` where `link_type='voucher'` prevents double-posting from any path (trigger re-fire, manual UI retry).
- **Status guard interaction with auto-posting**: the existing guard runs BEFORE UPDATE and validates transitions; the new posting trigger runs AFTER UPDATE so its work is rolled back on guard failure.
- **Reversal for bounce**: implemented as a new voucher with the reversal entries (not by negating the original). Original `register` voucher stays intact for auditability.
- **No edge function** — all work happens in plpgsql, consistent with `post_approved_factor`.
- **No new account-codes table** — strings on `account_type` for now; a future mapping table can populate Sepidar IDs.
- **Existing data**: backfill `category='operational'` for all existing rows. The `voucher_id` column stays NULL for historical checks (no retroactive posting).

## What this plan deliberately does NOT do

- Does **not** retroactively post vouchers for pre-existing checks.
- Does **not** add a chart-of-accounts table or check_accounting_map (kept as follow-up — `account_type` strings are stable hooks for a later mapping layer).
- Does **not** auto-create a reversal when a `cleared` check is later marked `bounced` more than once — DB guards already prevent that transition.
- Does **not** touch Sepidar sync — generated vouchers land with `sync_status='pending'` (default) like every other voucher.

---

## File-change summary

**Migration (1 file):**
- `supabase/migrations/<ts>_check_auto_post_and_categories.sql`

**Frontend (new):**
- `src/components/finance/checks/NewGuaranteeCheckDialog.tsx`
- `src/components/finance/checks/NewCancelledCheckDialog.tsx`
- `src/components/finance/checks/GuaranteeChecksTab.tsx`
- `src/components/finance/checks/CancelledChecksTab.tsx`

**Frontend (edited):**
- `src/components/finance/checks/ChecksTab.tsx` — tab list + routing
- `src/components/finance/checks/CheckDetailDialog.tsx` — show voucher link / category badge
- `src/components/finance/checks/StatusBadge.tsx` — new statuses
- `src/lib/checks.ts` — types, labels, reasons
- `src/hooks/useChecks.ts` — category filter
