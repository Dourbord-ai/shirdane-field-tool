# Phase 9 — Settlement Dashboard & Liquidity View (Final)

Read-only management dashboard. No schema changes. No Sepidar / voucher / allocation / amount_type_code touches. No new workflows.

## Architecture
- **Multiple focused React Query hooks** instead of one monolithic RPC. Each KPI / table fetches its own slim aggregate (PostgREST `select` + filters; client-side sum only when row count is small after filtering). RPC reserved for cases profiling shows >300ms.
- Shared status sets imported from `settlementExecution.ts` (open / remaining / executed / linked).
- All hooks live in `src/lib/finance/settlementDashboard.ts`.

## KPIs (final list)
1. Total open settlement amount
2. Executed amount
3. Remaining amount
4. **Due today**
5. Due in next 7 days
6. Due in next 30 days
7. Overdue amount
8. Check-linked amount
9. Bank-transfer pending amount
10. **Executed but not financially closed** = items with `execution_status='executed'` AND `voucher_id IS NULL`

## Obligation breakdown (by business category)
Derived from `factor_related_costs.cost_category` joined via `finance_payment_request_items.source_related_cost_id`:
- Feed (`feed`, `feed_supplier`)
- Medicine (`medicine`, `vet`)
- Freight (`freight`, `transport`, `driver`)
- Services (`service`, `services`)
- Miscellaneous (everything else / null)
Mapping centralised in one helper so future categories are a one-line change.

## Views (top-down order)
1. Filters bar (date range Jalali, party multi, method multi, category multi, reset)
2. KPI strip — 10 tiles, 4 cols lg / 2 md / 1 sm
3. Two-column row: Settlement Status by Method + Status by Category
4. **Top Liabilities** (top 10 parties by remaining amount)
5. **Next Due Parties** (top 10 parties by nearest unpaid due_date)
6. Freight/Driver Obligations table
7. **Upcoming Obligations table** (next 30 days, grouped by due_date)
8. Due Calendar (month grid)
9. Feed Supplier Obligations table

## Filters
- Jalali date range → applied to `due_date` for windowed KPIs + calendar + upcoming table
- Party (multi)
- Method (multi: bank_transfer / check / cashbox / barter / deferred)
- Business category (multi)
- Reset

## Indexes
Not added in this phase. Profile after launch; add partial indexes (`due_date`, `execution_status`, `party_id`) only if needed.

## Files
Create:
- `src/lib/finance/settlementDashboard.ts` — typed hooks + category mapper + status sets
- `src/components/finance/tabs/SettlementDashboardTab.tsx` — composition root
- `src/components/finance/dashboard/DashboardFilters.tsx`
- `src/components/finance/dashboard/DashboardKpiStrip.tsx`
- `src/components/finance/dashboard/MethodAndCategoryBreakdown.tsx`
- `src/components/finance/dashboard/TopLiabilitiesCard.tsx`
- `src/components/finance/dashboard/NextDuePartiesCard.tsx`
- `src/components/finance/dashboard/UpcomingObligationsTable.tsx`
- `src/components/finance/dashboard/DueCalendarCard.tsx`
- `src/components/finance/dashboard/CategoryObligationsTable.tsx` (used for freight + feed slices)

Edit:
- `src/pages/Finance.tsx` — register `settlement-dashboard` tab

## Risks
- Empty `cost_category` / null statuses → mapper always returns a bucket (`miscellaneous` / `pending`)
- Large item table → use server-side filters (`gte/lte/in`) on `due_date`, `execution_status`, `party_id`; pagination on tables
- Date semantics → all time KPIs anchored on `due_date` (Gregorian column); "today" uses Tehran timezone via `todayGregorianISO()`

## Out of scope
Sepidar, voucher creation, bank allocation, amount_type_code, execution actions, role tables.
