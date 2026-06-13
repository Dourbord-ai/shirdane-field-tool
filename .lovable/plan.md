# Performance Refactor — Settlement Requests (item-based list)

## 1) Audit — current bottlenecks in `PaymentRequestsTab.tsx`

Today `load()` performs these sequential network calls:

| # | Query | Problem |
|---|-------|---------|
| 1 | `finance_payment_requests select * .range(0,4999)` | Pulls up to 5000 rows, every column, every load |
| 2 | `finance_payment_request_items select(payment_request_id) .in(payment_request_id, ids) .not(voucher_id is null)` — **batched 25** | N round-trips for voucher chip |
| 3 | `factors select(id,invoice_number) .in(id, factorIds)` — **batched 25** | N round-trips for invoice badge |
| 4 | `finance_payment_request_items select(...slim...) .in(payment_request_id, ids)` — **batched 25** | N round-trips for item cards |
| 5 | `finance_parties select(...) .in(id, partyIds)` — **batched 25** | N round-trips for party names |
| 6 | PRDetail-side `finance_parties` balance lookup — batched 25 | unchanged, out of scope |

For a typical farm with ~1500 requests this means **240+ HTTP requests** per tab load, long URLs, occasional 502s from nginx, and ~5–10 s perceived latency.

Helpers that exist purely as workarounds for the long-IN problem:
- `SAFE_IN_BATCH_SIZE`, `chunkArray`
- `itemListIssue` + amber fallback banner + `filteredFallbackRequests` rendering
- `.range(0, 4999)` on the parent list

All of the above will be removed once the RPC lands.

## 2) Target architecture

**Server-side pagination + 1 RPC for the whole page.**

- `PAGE_SIZE = 50` item-rows per page
- Page state: `page` (0-indexed), `totalCount`
- Frontend sends one POST (`supabase.rpc(...)`) per page / filter change
- Previous / Next controls + "صفحه X از Y · مجموع N آیتم"

### RPC: `public.finance_list_settlement_items_v1`

Returns one row per **item** (the list is item-based), already joined to parent request + party + invoice + voucher-presence, plus `total_count` window for pagination.

```text
finance_list_settlement_items_v1(
  p_type_code        int        default null,   -- legacy_request_type_code
  p_status           text       default null,   -- requests.status
  p_payment_status   text       default null,   -- requests.payment_status
  p_requester        uuid       default null,
  p_date_from        timestamptz default null,  -- requests.created_at >=
  p_date_to          timestamptz default null,  -- requests.created_at <=
  p_search           text       default null,   -- ILIKE on title / party / invoice_number
  p_limit            int        default 50,
  p_offset           int        default 0
)
returns table (
  -- item columns
  item_id                       uuid,
  payment_request_id            uuid,
  party_id                      uuid,
  amount                        numeric,
  paid_amount                   numeric,
  remaining_amount              numeric,
  amount_type_code              int,
  settlement_subject_type       text,
  payment_method                text,
  execution_status              text,
  voucher_id                    uuid,
  description                   text,
  -- parent request columns (denormalised for list rendering)
  request_status                text,
  request_payment_status        text,
  request_title                 text,
  request_created_at            timestamptz,
  request_requested_by          uuid,
  request_legacy_type_code      int,
  request_source_factor_id      uuid,
  request_total_amount          numeric,
  -- joined lookups
  party_first_name              text,
  party_last_name               text,
  party_company_name            text,
  party_ownership_type          text,
  party_balance                 numeric,
  invoice_number                text,
  request_has_voucher           boolean,
  -- pagination
  total_count                   bigint  -- COUNT(*) OVER ()
)
```

SQL shape (security-definer, `stable`, search_path locked):

```sql
select
  i.id, i.payment_request_id, i.party_id, i.amount, i.paid_amount, i.remaining_amount,
  i.amount_type_code, i.settlement_subject_type, i.payment_method, i.execution_status,
  i.voucher_id, i.description,
  r.status, r.payment_status, r.title, r.created_at, r.requested_by,
  r.legacy_request_type_code, r.source_factor_id, r.total_amount,
  p.first_name, p.last_name, p.company_name, p.ownership_type, p.balance,
  f.invoice_number,
  exists(select 1 from finance_payment_request_items v
           where v.payment_request_id = r.id and v.voucher_id is not null) as request_has_voucher,
  count(*) over () as total_count
from finance_payment_request_items i
join finance_payment_requests r on r.id = i.payment_request_id
left join finance_parties p on p.id = i.party_id
left join factors        f on f.id = r.source_factor_id
where r.is_deleted = false
  and i.is_deleted is not true
  and (p_type_code      is null or r.legacy_request_type_code = p_type_code)
  and (p_status         is null or r.status         = p_status)
  and (p_payment_status is null or r.payment_status = p_payment_status)
  and (p_requester      is null or r.requested_by   = p_requester)
  and (p_date_from      is null or r.created_at    >= p_date_from)
  and (p_date_to        is null or r.created_at    <= p_date_to)
  and (p_search is null or
       r.title ilike '%'||p_search||'%' or
       coalesce(p.company_name, p.first_name||' '||p.last_name, '') ilike '%'||p_search||'%' or
       coalesce(f.invoice_number,'') ilike '%'||p_search||'%')
order by r.created_at desc, i.id asc
limit  p_limit
offset p_offset;
```

`grant execute on function ... to authenticated, service_role;`

No schema changes, no new tables, no RLS changes — RPC is read-only over existing tables. Security-definer uses the same visibility rules as the existing per-table policies (operator role already reads these tables today).

## 3) Frontend changes — `PaymentRequestsTab.tsx`

- Replace `load()` body with a single `supabase.rpc('finance_list_settlement_items_v1', { p_*..., p_limit: 50, p_offset: page*50 })`
- Derive `itemRows`, `requests` (unique by `payment_request_id`), `requestsWithVoucher` (Set of ids where `request_has_voucher`), `invoiceLinks` (Map) from the single result set
- Add `page`, `totalCount`, `pageSize=50` state
- Add pagination footer (Previous / Next, page indicator, total)
- Reset `page` to 0 whenever any server-side filter changes
- Keep search filter client-side over the current page (fast) **and** pass to RPC as `p_search` so cross-page search works

### Removed
- `SAFE_IN_BATCH_SIZE`, `chunkArray` (file-local copy)
- All `chunkArray(...)` loops and the 4 batched queries listed in §1
- `itemListIssue` state, amber fallback banner, `filteredFallbackRequests` rendering branch
- `.range(0, 4999)` on parent list
- Voucher-presence query and the separate factor lookup (now part of RPC)

### Untouched
- `PRDetail` and everything it loads (its own `select("*")` + party balance lookup stay as-is)
- Filter UI, card UI, focused-item summary, parent-summary card
- Routing / deep-link behaviour
- All other tabs

## 4) Files affected

- **NEW migration** `supabase/migrations/<ts>_finance_list_settlement_items_v1.sql` — creates the RPC + grant
- **EDIT** `src/components/finance/tabs/PaymentRequestsTab.tsx` — rewrite `load()`, add pagination, drop workarounds (~150 lines removed, ~80 lines added)

No edge functions, no other components, no type file edits (types regenerate after migration approval).

## 5) Rollout order

1. Submit migration (creates `finance_list_settlement_items_v1`). Wait for user approval.
2. After approval + types regen, refactor `PaymentRequestsTab.tsx` to call the RPC + pagination.
3. Verify in preview: one POST per page, no long IN URLs, no 502s, cards render, voucher chip + invoice badge still work, focused-item flow unchanged.
4. Build pass.

## 6) Risks & mitigations

- **`count(*) over ()` cost on large item table** — acceptable at current volume (~few thousand items); if profiling later shows >300 ms, switch to a separate `count` query gated behind page==0.
- **RLS** — RPC is `security definer` with `set search_path = public`; same data is already reachable via the existing per-table policies for the operator role, so no new exposure.
- **Search ILIKE** — case-insensitive contains on three columns; fine at current size, can add `pg_trgm` indexes later if needed.

Awaiting approval to proceed with the migration.
