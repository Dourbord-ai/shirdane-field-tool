
# Factor list filters + Feed Sales factor — Plan

Sequencing: per your call, this **starts only after Phase 1 M5 backfill + UI swap to `factors.finance_party_id` lands**. Filter UI will read `finance_party_id` from day one, so it must be populated first.

---

## 1. Current schema audit (read-only, no changes proposed here)

`public.factors` already supports everything we need — no new columns required for filters:

| concern | existing column |
|---|---|
| date range | `invoice_date timestamptz` |
| factor number | `invoice_number text` |
| counterparty | `finance_party_id uuid` (M5) + legacy `shopping_center_id`, `buyer_user_id` |
| direction | `factor_type_id smallint` (1=purchase, 2=sale) **and** `invoice_type text` (`buy`/`sell`/legacy) |
| category | `product_type text` (livestock, feed, medicine, sperm, milk, services, rental, other, legacy_product_*) |
| draft/approved/cancelled | `lifecycle_state text` (`approved`, `voucher_failed`, `sepidar_failed`, `posted`, `cancelled`, NULL=draft/legacy) |
| posted to Sepidar | `sepidar_voucher_id text` not null |
| failed | `last_posting_error text`, `lifecycle_state='sepidar_failed'` |

Distinct data today: ~2,449 legacy rows (`lifecycle_state` NULL, `product_type='legacy_product_*'`), 1 new `sperm` row. No `feed` rows yet via new pipeline. `NewInvoice.tsx` already writes `product_type='feed'` with `invoice_type='buy'` — only the **sale** direction is missing.

`Invoices.tsx` today: client-side filter only, single text search, paginated client-side. No server filter.

---

## 2. Server-side filtering — new RPC

New file: `supabase/migrations/<ts>_factors_list_filtered_rpc.sql`

```sql
CREATE OR REPLACE FUNCTION public.list_factors_filtered(
  p_from_date     timestamptz DEFAULT NULL,
  p_to_date       timestamptz DEFAULT NULL,
  p_invoice_number text       DEFAULT NULL,   -- ILIKE %x%
  p_finance_party_id uuid     DEFAULT NULL,
  p_direction     text        DEFAULT NULL,   -- 'purchase' | 'sale'
  p_product_types text[]      DEFAULT NULL,   -- ['feed','livestock',...]
  p_statuses      text[]      DEFAULT NULL,   -- see status mapping
  p_limit         int         DEFAULT 50,
  p_offset        int         DEFAULT 0
) RETURNS TABLE (
  id uuid, invoice_number text, invoice_date timestamptz,
  product_type text, factor_type_id smallint,
  finance_party_id uuid, party_name text,
  payable_amount numeric, lifecycle_state text,
  sepidar_voucher_id text, sepidar_voucher_number text,
  last_posting_error text, derived_status text,
  total_count bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  WITH base AS (
    SELECT f.*, fp.name AS party_name,
      CASE
        WHEN f.sepidar_voucher_id IS NOT NULL THEN 'posted'
        WHEN f.lifecycle_state = 'sepidar_failed' THEN 'sepidar_failed'
        WHEN f.lifecycle_state = 'voucher_failed' THEN 'voucher_failed'
        WHEN f.lifecycle_state = 'cancelled'      THEN 'cancelled'
        WHEN f.lifecycle_state = 'approved'       THEN 'approved'
        ELSE 'draft'
      END AS derived_status
    FROM public.factors f
    LEFT JOIN public.finance_parties fp ON fp.id = f.finance_party_id
  ),
  filtered AS (
    SELECT * FROM base
    WHERE (p_from_date IS NULL OR invoice_date >= p_from_date)
      AND (p_to_date   IS NULL OR invoice_date <  p_to_date)
      AND (p_invoice_number IS NULL OR invoice_number ILIKE '%'||p_invoice_number||'%')
      AND (p_finance_party_id IS NULL OR finance_party_id = p_finance_party_id)
      AND (p_direction IS NULL
           OR (p_direction='purchase' AND factor_type_id=1)
           OR (p_direction='sale'     AND factor_type_id=2))
      AND (p_product_types IS NULL OR product_type = ANY(p_product_types))
      AND (p_statuses     IS NULL OR derived_status = ANY(p_statuses))
  )
  SELECT id, invoice_number, invoice_date, product_type, factor_type_id,
         finance_party_id, party_name, payable_amount, lifecycle_state,
         sepidar_voucher_id, sepidar_voucher_number, last_posting_error,
         derived_status,
         COUNT(*) OVER() AS total_count
  FROM filtered
  ORDER BY invoice_date DESC NULLS LAST, created_at DESC
  LIMIT p_limit OFFSET p_offset;
$$;

REVOKE ALL ON FUNCTION public.list_factors_filtered(timestamptz,timestamptz,text,uuid,text,text[],text[],int,int) FROM public;
GRANT EXECUTE ON FUNCTION public.list_factors_filtered(timestamptz,timestamptz,text,uuid,text,text[],text[],int,int) TO authenticated, anon;
```

Supporting indexes (additive, IF NOT EXISTS):

```sql
CREATE INDEX IF NOT EXISTS idx_factors_invoice_date     ON public.factors(invoice_date DESC);
CREATE INDEX IF NOT EXISTS idx_factors_invoice_number   ON public.factors(invoice_number);
CREATE INDEX IF NOT EXISTS idx_factors_product_type     ON public.factors(product_type);
CREATE INDEX IF NOT EXISTS idx_factors_lifecycle_state  ON public.factors(lifecycle_state);
```

No new tables, no enum changes, no RLS change — RPC is SECURITY DEFINER and inherits the same access surface the page already uses against `factors`.

---

## 3. List UI — `src/pages/Invoices.tsx`

- Replace the current `supabase.from('factors').select(...)` with `supabase.rpc('list_factors_filtered', {...})`.
- New `<FactorFilters/>` component (collapsed on mobile behind a "فیلترهای پیشرفته" button; inline on `lg+`):
  - تاریخ از / تا (`ShamsiDatePicker`)
  - شماره فاکتور (`Input`)
  - طرف حساب (`SearchableSelect` from `finance_parties`)
  - جهت: همه / خرید / فروش (segmented)
  - دسته: multi-select chips (دام، خوراک، دارو، اسپرم، شیر، خدمات، سایر)
  - وضعیت: multi-select chips (پیش‌نویس، تأیید شده، لغو شده، ثبت شده در سپیدار، خطای ثبت سپیدار، خطای ساخت سند)
  - "اعمال فیلتر" + "حذف فیلترها" buttons
- Active filter **chips row** above the table (each chip clickable to remove that one filter).
- Filter state **persisted in URL query params** (`useSearchParams`) — shareable + survives reload.
- Status column shows badge based on `derived_status`; `last_posting_error` revealed in a popover for failed rows; existing "ثبت سند" retry button stays.

---

## 4. Feed Sales factor — create / approve / cancel only (no Sepidar yet)

Per your call ("plan only, no posting yet"): add the flow end-to-end **except** wiring it into `factor-post-voucher`. That activation comes later under the same gate as livestock factors.

### 4a. `src/pages/NewInvoice.tsx`

```ts
// Currently:
feed: [{ label: "خرید", value: "buy" }],
// Change to:
feed: [
  { label: "خرید", value: "buy" },
  { label: "فروش", value: "sell" },
],
```

When `productType='feed'` and `invoiceType='sell'`:
- `factor_type_id = 2`, `invoice_type = 'sell'`, `product_type = 'feed'`
- Reuse the **existing** feed-purchase form (rows of feed/weight/price) — no new table.
- Reuse `feed_items` table for line items (same shape as buy).
- Counterparty selector switches label to "خریدار" (uses `finance_parties` like other sales).
- Same `factors` insert path as feed-buy; only direction differs.

### 4b. `src/pages/Invoices.tsx` detail dialog

- Existing `feed_items` rendering already works for both buy and sell (it only reads, doesn't care about direction). Add a small "خرید / فروش" badge driven by `factor_type_id`.

### 4c. Approval / cancellation

- Already generic in `lifecycle_state` machine — works for feed sales unchanged.

### 4d. Sepidar posting — explicitly deferred

- `factor-post-voucher` currently only classifies `product_type='livestock'`. Document in `docs/phase1_M4r_factor_bridge_sp_spec.md` that feed sales will reuse `bridge.CreatePaymentRequestVoucher` with `RequestType=1` once feed posting is activated; no edge-function edits this phase.
- Feed-sale factors will sit at `lifecycle_state='approved'` until the feed-posting activation milestone — same as feed purchase today.

---

## 5. Out of scope (explicit)

- No new tables, enums, or RLS.
- No edge function changes.
- No backfill of `finance_party_id` (M5's job — must land first).
- No Sepidar activation for feed in either direction.
- No changes to legacy `legacy_product_*` rows — they show up in the list with `derived_status='draft'`.

---

## 6. Sequencing

```
[M5 backfill] → [M5 UI swap to finance_party_id] →
  ├ step A: migration (RPC + 4 indexes), audit pass
  ├ step B: Invoices.tsx → RPC + FactorFilters + URL params + chips
  └ step C: NewInvoice.tsx feed-sell option + detail badge
```

Each step is independently revertable. No destructive changes at any point.

---

## 7. Risks / open items

- `derived_status` mapping above treats NULL `lifecycle_state` as `draft` — this groups all 2,449 legacy rows under "پیش‌نویس". Confirm acceptable, or add a separate `legacy` bucket.
- Per-row RLS on `factors`: currently the page reads the table directly with the anon key — RPC keeps the same effective access. If you later harden `factors` RLS, the SECURITY DEFINER RPC must be reviewed.

Awaiting M5 completion before executing step A.
