# خلاصه باروری — Plan

## Scope
Add a derived, real-data «خلاصه باروری» block to پروفایل دام and contextual insights inside fertility operation tabs. All metrics computed from `livestock_fertility_events` (source of truth). Cached `cows.*` fields used only as fallback. Persian UI, Shamsi dates, Gregorian math.

## 1. Shared calculation layer (new files)

`src/lib/fertility/fertilityCalculations.ts`
- `parseEventDate(text) → Date | null` (handles Gregorian + Jalali via existing `safe_text_to_date` logic in JS, reusing `jalaliToGregorian`)
- `daysBetween(a, b)`
- Constants: `GESTATION_DAYS = 283`, `DRY_OFF_BEFORE_CALVING = 60`, `HEAT_CYCLE_MIN = 18`, `HEAT_CYCLE_MAX = 24`, `REPEAT_BREEDER_THRESHOLD = 3`, `PREG_TEST_EARLY = 28`, `PREG_TEST_LATE = 45`

`src/lib/fertility/fertilityTimeline.ts`
- `buildTimeline(events) → SortedTimeline` — sorts active events by (event_date asc, event_time asc, created_at asc), groups into reproductive cycles (boundaries: calving / abortion / fertility status reset).
- `currentCycle(timeline)` — events since last calving/abortion.
- `lastEventOf(opId)` helpers.
- `linkPregnancyTestsToInsemination(timeline)` — associates each test/abortion/calving with the most recent prior insemination.

`src/lib/fertility/fertilityRiskEngine.ts`
- `deriveFertilitySummary(cow, events) → FertilitySummary` returns:
  - currentState: آبستن / باز / تلقیح‌شده / خشکی / انتظار زایش / Fresh Cow / Repeat Breeder / Synced / نیازمند بررسی
  - daysPregnant, expectedCalvingDate, daysToCalving
  - daysSinceLastAI, inseminationsThisPregnancy, inseminationsCurrentCycle, totalInseminations, consecutiveFailedAI, lastSperm, lastInseminator
  - lastHeatDate, heatToAIInterval, heatsSinceLastCalving, lastHeatCycleNormal
  - lastCalvingDate, dim, calvingCount, lastCalvingType, prevCalvingInterval, predictedDryDate
  - openDays, ageDays, pregnancyAgeDays, riskState (green/yellow/red/blue + reason)
  - dryStatus, dryDate, dryDuration, expectedReturnToMilking
  - lastPregnancyTest: { date, result, stage(early/standard/late), vet, operator }
- `detectRepeatBreeder(currentCycle)`, `classifyHeatCycle(prevHeat, thisHeat)`, `classifyPregTestTiming(daysAfterAI)`.

## 2. Data hook

`src/hooks/useFertilitySummary.ts`
- React Query key `["fertility_summary", cowId]`.
- Fetches: active fertility_events for cow (single query, ordered), cow row, sperm + operation + status ref maps (already cached separately).
- Returns memoized `FertilitySummary` + `timeline`.
- Realtime: subscribe to `livestock_fertility_events` filtered by `livestock_id=eq.{cowId}` → invalidate query on INSERT/UPDATE/DELETE. Also invalidate on success callbacks already in dialogs (existing pattern).

## 3. UI — Profile

`src/components/livestock/FertilitySummaryCard.tsx`
- RTL grid of compact metric cards grouped:
  - وضعیت فعلی (big badge, color-coded)
  - آبستنی (days pregnant, expected calving, days to calving, AI count this pregnancy, last test)
  - تلقیح (totals, last AI, sperm, inseminator, consecutive fails)
  - فحلی (last heat, heat→AI, heats since calving, cycle normal)
  - زایش (last calving, DIM, parity, interval, predicted dry)
  - روزهای باز / راندمان / ریسک
  - خشکی (dry status, dry date, duration, return-to-milk)
- Mini timeline strip across bottom: horizontally scrollable colored chips per event in last cycle.
- Tooltips explain each formula.
- Uses semantic tokens (`bg-card`, `text-primary`, `text-destructive`, `bg-emerald-500/10` style via tailwind config already extended).

Wire into `src/pages/LivestockProfile.tsx` above existing `FertilitySection`.

## 4. UI — Tab contextual headers + per-row enrichment

Refactor `FertilitySection.tsx` so each tab receives `summary` + `enrichedRows` from a new helper `enrichEventsForTab(timeline, opId)`.

- **تلقیح**: header strip with cycle AI count, days since calving, days since heat, consecutive fails, last test result, last sperm/inseminator, repeat-breeder warning badge. Rows add: AI# in cycle, gap from previous AI, outcome (آبستن / ناموفق / نامشخص — derived from next pregnancy_test/calving/abortion vs next AI), vet, operator.
- **تست آبستنی**: header with current pregnancy state, pregnancy age, linked AI, consecutive positives/negatives, last vet/operator. Rows: days after linked AI, timing badge (زودهنگام/استاندارد/دیرهنگام), linked AI id/date, "بعد از این سقط شد؟" flag, operator.
- **زایش**: rows add prev interval, gestation length (linked AI→calving), AI that led to calving, AI count before calving, DIM before dry, vet, operator.
- **سقط**: rows add pregnancy age at abortion, linked AI, last positive test before abortion, days since that test, abortion type (early <90 / mid 90-180 / late >180), operator.
- **فحلی**: rows add heat# in cycle, days since calving, days to next AI, cycle normal flag, detection method (from metadata), operator.
- **خشکی**: header dry status + duration; rows add DIM at dry, days until expected calving.

All enrichment is pure functions on already-fetched timeline — no extra queries.

## 5. Realtime

Single `useEffect` in `useFertilitySummary` subscribes to a Supabase channel; on event invalidates the query. `syncCowFertilityCache` already runs server-side via trigger, so cached cow fields stay in sync.

## 6. Performance

- One query for events per profile load (limit 500 desc, then reverse).
- Ref tables (`fertility_operations`, `fertility_statuses`, `sperms`, `app_users`) loaded via existing cached `useQuery` hooks with `staleTime: 5min`.
- All derived values memoized with `useMemo` keyed on events array reference.

## 7. Files

New:
- `src/lib/fertility/fertilityCalculations.ts`
- `src/lib/fertility/fertilityTimeline.ts`
- `src/lib/fertility/fertilityRiskEngine.ts`
- `src/hooks/useFertilitySummary.ts`
- `src/components/livestock/FertilitySummaryCard.tsx`
- `src/components/livestock/fertility-tabs/TabInsightHeader.tsx` (shared header strip)

Modified:
- `src/pages/LivestockProfile.tsx` — mount summary card.
- `src/components/livestock/FertilitySection.tsx` — pass enriched data + per-tab headers + extra columns.

## 8. Out of scope (kept for later, architecture-ready)
- Herd-wide KPI dashboard, fertility AI scoring, synchronization protocol suggestions — engine signatures designed to be reusable, but no new pages now.

## Estimate
~7 new files, 2 edits. No DB migration needed (data already present). No new edge functions.

Approve to implement?
