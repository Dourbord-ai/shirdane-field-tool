
## Current state (audit)

**Excel import** (`src/components/finance/tabs/BankTransactionsTab.tsx` + `src/lib/bankImport.ts`)
- `parseRowsWithTemplate` joins `description_column_indexes` into a single `description` string and inserts into `finance_bank_transactions`.
- No identifier extraction. `card_number`, `match_type`, `match_content`, `match_name`, `match_bank_name` columns already exist on `finance_bank_transactions` but are unused on import.
- Insert path: builds `payload` then `supabase.from("finance_bank_transactions").insert(payload)` row by row.

**Verification** (`supabase/functions/verify-account/index.ts`)
- Already checks `bankpartyaccountinfos` cache by `(matchtype, matchcontent)` and only calls cardinfo.ir on miss, then upserts the cache. Reusable as-is.
- `bankpartyaccountinfos`: `(id, bankpartyid, status, matchtype '1|2|3', matchcontent, matchname, matchbankname)`. **`bankpartyid` is currently always NULL** — we need to backfill / start writing the matched `finance_parties.id` (or a legacy_id bridge) when we trust the link.

**Receive identification** (`finance_receive_identifications`)
- Trigger `fn_finance_receive_identifications_guard` enforces: tx must be deposit, unassigned/rejected, amount ≤ tx amount, no duplicate identification/allocation on the same tx. **Auto-creation must respect all of this.**
- Has `sepidar_sync_status / sepidar_error_message / sepidar_sync_attempts` already → no schema change needed for posting state.
- No columns for auto-identification metadata yet (matched_by / confidence / source).

**Sepidar posting** — `sepidar-allocate-payment-transaction` handles withdrawals; receives currently go through manual posting from the UI. We will reuse the **existing** receive-posting code path (whatever the "post" button calls today) and only trigger it programmatically — no new Sepidar function.

---

## Proposed migration

```sql
-- 1. Extracted identifiers per bank transaction (multi-value, audit-friendly)
CREATE TABLE public.finance_bank_tx_identifiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_transaction_id uuid NOT NULL REFERENCES finance_bank_transactions(id) ON DELETE CASCADE,
  match_type smallint NOT NULL,        -- 1=card, 2=iban, 3=account
  raw_value text NOT NULL,             -- original extracted substring
  normalized_value text NOT NULL,      -- digits-only / IR-stripped
  bankpartyaccountinfo_id bigint REFERENCES bankpartyaccountinfos(id),
  verified_owner_name text,
  verified_bank_name text,
  created_at timestamptz DEFAULT now(),
  UNIQUE (bank_transaction_id, match_type, normalized_value)
);
CREATE INDEX ON finance_bank_tx_identifiers(normalized_value, match_type);

-- 2. Auto-identification metadata on receive
ALTER TABLE finance_receive_identifications
  ADD COLUMN auto_identified boolean NOT NULL DEFAULT false,
  ADD COLUMN matched_by text,                 -- 'card' | 'iban' | 'account'
  ADD COLUMN matched_identifier text,
  ADD COLUMN bankpartyaccountinfo_id bigint REFERENCES bankpartyaccountinfos(id),
  ADD COLUMN match_confidence numeric,        -- 0..1
  ADD COLUMN identification_source text;      -- 'excel_import_auto'|'manual'|...

-- 3. Audit log
CREATE TABLE public.finance_auto_identification_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_transaction_id uuid NOT NULL REFERENCES finance_bank_transactions(id) ON DELETE CASCADE,
  step text NOT NULL,                  -- extract|cache_hit|verify_api|match|create_receive|post_sepidar
  success boolean NOT NULL,
  candidates jsonb,                    -- identifiers / parties considered
  chosen_party_id uuid,
  message text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE finance_auto_identification_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read auto id log" ON finance_auto_identification_log FOR SELECT USING (auth.role()='authenticated');

-- 4. RPC: auto-create receive identification with full guard reuse
CREATE FUNCTION public.auto_create_receive_identification(
  p_bank_transaction_id uuid,
  p_party_id uuid,
  p_bankpartyaccountinfo_id bigint,
  p_matched_by text,
  p_matched_identifier text,
  p_confidence numeric
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
-- Validates: tx unassigned, deposit, no existing identification/allocation
-- Inserts finance_receive_identifications with status='approved',
-- auto_identified=true, identification_source='excel_import_auto'.
-- Existing fn_finance_receive_identifications_guard runs automatically.
$$;
```

`bankpartyid` on `bankpartyaccountinfos` will be repurposed to hold the matched `finance_parties.legacy_id` once a user manually confirms a receive — that becomes our "previously trusted link" anchor for future auto-matching. Alternative: add a new `finance_party_id uuid` column. **Decision needed from user.**

---

## Frontend / pipeline changes

### Phase 1 — extraction (`src/lib/bankImport.ts`)
- Add `extractIdentifiers(description: string): { type:1|2|3; raw:string; normalized:string }[]`.
- Regexes (after `toEnDigits` + RTL strip):
  - card: `\b\d{16}\b` (also `\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}`)
  - IBAN: `IR\d{24}` (also bare `\d{24}` near keywords "شبا"/"IBAN")
  - account: configurable per-bank pattern; default `\b\d{6,20}\b` filtered to avoid collisions with card/IBAN/document numbers.
- Attach extracted list to `ParsedRow`.

### Phase 2 — cache-first verification (new helper `src/lib/autoIdentify.ts`)
- For each parsed row, for each identifier:
  1. `select * from bankpartyaccountinfos where matchtype=$1 and matchcontent=$2`
  2. On miss → call `supabase.functions.invoke('verify-account', { body:{ type, number } })` (already upserts cache).
  3. Skip silently on API error; identifier becomes "unverified".

### Phase 3 — trusted-party matching
- For each verified identifier, query:
  ```
  finance_receive_identifications
    JOIN finance_bank_transactions ON ...
  WHERE status='approved' AND is_deleted=false
    AND EXISTS (matching identifier with same normalized value)
  GROUP BY party_id
  ```
- Auto-confirm **only if exactly one** distinct `party_id` historically used this normalized identifier AND `bankpartyaccountinfos.matchname` is non-empty.
- Multiple parties / name mismatch → flag `needs_review`, do not auto-create.

### Phase 4 — auto-create receive (after tx insert)
- Call `rpc('auto_create_receive_identification', …)`. Trigger guards prevent duplicates/over-allocation; if it raises, log to `finance_auto_identification_log` as `success=false` and surface to UI.
- On success: write rows in `finance_bank_tx_identifiers` and log `success=true`.

### Phase 5 — Sepidar posting
- After successful auto-create, invoke the **existing** receive-posting code (same function called by the manual "post" button) with the newly created receive id. Existing idempotency (`sepidar_sync_status` + voucher_id) prevents duplicates.
- Failure → `sepidar_sync_status='failed'`, error stored, receive stays `auto_identified` with retry button.

### Phase 6 — UI (`BankTransactionsTab.tsx` import results screen + list)
- Import result summary chips: imported / auto-identified / posted-to-sepidar / needs-review / sepidar-failed.
- Per-row columns: extracted identifier (with type icon), verified owner name, matched party, auto status badge, sepidar badge.
- Filters: `auto_identified`, `needs_review` (assignment_status='unassigned' + has identifier), `sepidar_failed`, `manually_identified`.
- Re-use existing `AccountVerifyButton` UI conventions.

---

## Safety rules (enforced in code + DB)
- Cache-first: `verify-account` is only called on cache miss (already true server-side; we'll also short-circuit client-side).
- Auto-confirm requires **exactly one** historical party + matching verified owner name (case-insensitive normalized compare).
- DB guards (`fn_finance_receive_identifications_guard`) untouched and rely on for duplicate / amount / status validation.
- Sepidar posting reuses existing idempotent flow; no new voucher path.
- Every step writes to `finance_auto_identification_log`.

---

## Open questions before I implement
1. **`bankpartyid` column**: repurpose existing `bigint` (legacy_id link) or add new `finance_party_id uuid`? Recommend the latter for cleanliness.
2. **Account number regex**: confirm there's no per-bank template field I should reuse (e.g. account length per `BankImportTemplate`). Current templates have no account-pattern field.
3. **Sepidar posting trigger**: do you want auto-posting in this pass, or land Phases 1–4 first, gated behind a feature flag, then enable Phase 5? Recommend ship behind `feature_flag.auto_post_receives = false` initially.
4. **Confidence scoring**: OK with binary (1.0 if single trusted match + verified-name agreement, else 0 → manual review) for v1, with finer scoring later?

Once you answer these (or say "use recommendations"), I'll send the migration for approval and then ship the code in one pass.
