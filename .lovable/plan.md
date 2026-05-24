# Plan — Unify Factor Counterparty with `finance_parties`

Goal: factor purchase/sale counterparty becomes a `finance_parties` row, matching the receive/payment flow. Sepidar posting resolves `PartyId` / `PartyAccountSLRef` from that record. Legacy `shopping_center_id` / `buyer_user_id` are preserved but demoted to fallback.

No code, no migration, no Sepidar activation in this step — review and approval gate first.

---

## 1. Schema change (migration package, not executed yet)

Single additive migration, fully reversible, no destructive operations.

```sql
ALTER TABLE public.factors
  ADD COLUMN finance_party_id uuid NULL
    REFERENCES public.finance_parties(id)
    ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_factors_finance_party_id
  ON public.factors(finance_party_id);

COMMENT ON COLUMN public.factors.finance_party_id IS
  'Canonical counterparty for factor (seller for purchase, buyer for sale). Source of truth for Sepidar PartyId / PartyAccountSLRef. shopping_center_id and buyer_user_id are legacy fallback only.';
```

Rules:
- Nullable. No NOT NULL until backfill + UI rollout are complete.
- `shopping_center_id` and `buyer_user_id` stay untouched.
- No RLS changes (inherits existing factors RLS).
- No trigger changes.

---

## 2. UI changes (factor create / edit)

Single new field replacing the current counterparty inputs in form UX, but writes only to `finance_party_id`.

- Purchase factor (`factor_type_id = 1`)
  - Label: `فروشنده / ذینفع`
  - Required.
- Sale factor (`factor_type_id = 2`)
  - Label: `مشتری / ذینفع`
  - Required.
- Selector: reuse existing finance party selector pattern from receive/payment (same query against `finance_parties`, same search UX, same RTL styling).
- On submit: write `factors.finance_party_id`. Do not write `shopping_center_id` / `buyer_user_id` for new factors.
- On edit of legacy factor with no `finance_party_id`:
  - Show legacy values read-only as "مرجع قدیمی".
  - Force user to pick a `finance_party` before save can succeed.
- Validation: blocking Persian error if not selected:
  `"طرف حساب فاکتور انتخاب نشده است."`

No change to line-items, pricing, or lifecycle.

---

## 3. `factor-post-voucher` Edge Function changes

Resolution order for `PartyId` / `PartyAccountSLRef`:

1. `factors.finance_party_id` → `finance_parties` row → use `sepidar_party_id` + `party_account_sl_ref`.
2. Legacy fallback (only if `finance_party_id IS NULL`):
   - Purchase: `factors.shopping_center_id → finance_parties.legacy_id`.
   - Sale: `factors.buyer_user_id → finance_parties.legacy_id`.
3. If neither resolves → block with Persian error:
   - No party: `"طرف حساب فاکتور یافت نشد. لطفاً طرف حساب را در فاکتور انتخاب کنید."`
   - Missing `sepidar_party_id`: `"شناسه سپیدار طرف حساب تنظیم نشده است."`
   - Missing `party_account_sl_ref`: existing message `"حساب معین طرف حساب برای ثبت سند سپیدار تنظیم نشده است."` (unchanged)

Idempotency, retry, lifecycle, and `bridge.CreatePaymentRequestVoucher` call shape stay exactly as approved previously. Only the party resolution step changes.

---

## 4. Audit & backfill plan (script, not executed yet)

Deliver as a read-only SQL audit report first. No writes until reviewed.

Step A — Inventory:
```sql
-- total + null-rate
SELECT
  count(*)                                                AS total,
  count(*) FILTER (WHERE finance_party_id IS NULL)        AS missing_party,
  count(*) FILTER (WHERE factor_type_id = 1 AND finance_party_id IS NULL) AS missing_purchase,
  count(*) FILTER (WHERE factor_type_id = 2 AND finance_party_id IS NULL) AS missing_sale
FROM public.factors;
```

Step B — Candidate matches (dry-run):
```sql
-- purchase candidates
SELECT f.id, f.invoice_number, f.shopping_center_id,
       fp.id AS candidate_finance_party_id, fp.legacy_id, fp.sepidar_party_id
FROM public.factors f
LEFT JOIN public.finance_parties fp
  ON fp.legacy_id = f.shopping_center_id
WHERE f.factor_type_id = 1
  AND f.finance_party_id IS NULL;

-- sale candidates
SELECT f.id, f.invoice_number, f.buyer_user_id,
       fp.id AS candidate_finance_party_id, fp.legacy_id, fp.sepidar_party_id
FROM public.factors f
LEFT JOIN public.finance_parties fp
  ON fp.legacy_id = f.buyer_user_id
WHERE f.factor_type_id = 2
  AND f.finance_party_id IS NULL;
```

Step C — Reports to deliver before any UPDATE:
- matched count (safe to backfill)
- ambiguous count (multiple `finance_parties.legacy_id` matches)
- unmatched count (manual mapping needed)

Step D — Backfill (only after review approves the report):
```sql
-- safe update, single-match only
UPDATE public.factors f
SET finance_party_id = fp.id
FROM public.finance_parties fp
WHERE f.finance_party_id IS NULL
  AND (
    (f.factor_type_id = 1 AND fp.legacy_id = f.shopping_center_id) OR
    (f.factor_type_id = 2 AND fp.legacy_id = f.buyer_user_id)
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.finance_parties fp2
    WHERE fp2.legacy_id = fp.legacy_id AND fp2.id <> fp.id
  );
```

Step E — Never:
- never drop `shopping_center_id` / `buyer_user_id`
- never auto-create `finance_parties` rows for unmatched factors
- never NOT NULL the new column in the same migration

---

## 5. Sequencing & gates

1. Approve this plan.
2. Apply additive migration (`finance_party_id` column + index).
3. Run audit (Step A + B + C), share counts.
4. Ship UI change (new selector writes `finance_party_id`, legacy fields hidden but preserved).
5. Run reviewed backfill (Step D).
6. Update `factor-post-voucher` to prefer `finance_party_id` with legacy fallback.
7. Manual mapping pass for unmatched rows.
8. (Future, separate gate) Make `finance_party_id` NOT NULL once unmatched = 0.
9. Sepidar posting activation stays gated as previously agreed — not in this step.

---

## 6. Out of scope

- Sepidar posting activation
- Dropping or renaming legacy columns
- Changes to `finance_parties` schema
- Per-cow splits, accounting map changes
- Approval workflow changes

---

## 7. Deliverables of this step

- This plan
- `docs/phase1_M4r_factor_bridge_sp_spec.md` updated with the new party resolution order (text only, no code change yet)
- Migration SQL file drafted but not executed
- Audit SQL drafted but not executed

Waiting for explicit approval before any DB or code change.
