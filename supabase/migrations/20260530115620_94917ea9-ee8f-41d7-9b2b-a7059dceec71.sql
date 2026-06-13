-- =====================================================================
-- مدیریت چک‌ها — Check Management Module
-- v1 schema: finance_checks, finance_check_events, finance_checkbooks,
-- finance_checkbook_leaves, finance_check_links + enums, triggers, GRANTs, RLS.
-- =====================================================================

-- ---------- Enums --------------------------------------------------------
-- direction of a check: received from a party, or payable to a party.
DO $$ BEGIN
  CREATE TYPE public.check_direction AS ENUM ('received','payable');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Full lifecycle status (covers both directions).
DO $$ BEGIN
  CREATE TYPE public.check_status AS ENUM (
    'draft','received','in_cashbox','deposited_to_bank',
    'transferred_to_party','issued','delivered',
    'cleared','bounced','voided','lost'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Event types stored on the immutable history table.
DO $$ BEGIN
  CREATE TYPE public.check_event_type AS ENUM (
    'received','issued','deposited_to_bank','transferred_to_party',
    'delivered','cleared','bounced','voided','marked_lost',
    'party_effect_posted','bank_effect_posted','note','status_change'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Status of a single leaf inside a checkbook.
DO $$ BEGIN
  CREATE TYPE public.checkbook_leaf_status AS ENUM (
    'available','issued','cleared','bounced','voided','lost'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------- finance_checkbooks ------------------------------------------
CREATE TABLE IF NOT EXISTS public.finance_checkbooks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_id         uuid NOT NULL REFERENCES public.finance_banks(id) ON DELETE RESTRICT,
  -- bank_account_id is kept as text snapshot because the project does not have
  -- a separate bank_accounts table — account info lives on finance_banks itself.
  bank_account_id text,
  title           text NOT NULL,
  start_serial    bigint NOT NULL,
  end_serial      bigint NOT NULL,
  sheet_count     int    GENERATED ALWAYS AS ((end_serial - start_serial + 1)) STORED,
  issued_at       date,
  is_active       boolean NOT NULL DEFAULT true,
  description     text,
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finance_checkbooks_serial_range CHECK (end_serial >= start_serial)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.finance_checkbooks TO authenticated;
GRANT ALL ON public.finance_checkbooks TO service_role;
ALTER TABLE public.finance_checkbooks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "checkbooks_all_authenticated" ON public.finance_checkbooks
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ---------- finance_checks ----------------------------------------------
CREATE TABLE IF NOT EXISTS public.finance_checks (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  direction          public.check_direction NOT NULL,
  party_id           uuid REFERENCES public.finance_parties(id) ON DELETE SET NULL,
  amount             numeric(18,2) NOT NULL CHECK (amount > 0),
  check_number       text NOT NULL,
  sayad_number       text,
  -- For received checks: payer's bank (free text or fk to finance_banks if known).
  -- For payable checks: our bank (fk to finance_banks).
  bank_id            uuid REFERENCES public.finance_banks(id) ON DELETE SET NULL,
  bank_account_id    text,
  -- Link to checkbook leaf when this is a payable check we issued.
  checkbook_leaf_id  uuid, -- FK added below after leaves table exists
  issue_date         date,
  receive_date       date,
  due_date           date NOT NULL,
  status             public.check_status NOT NULL,
  description        text,
  -- Accounting effect markers:
  -- party_effected_at is set when the check is received/issued (party impact).
  -- bank_effected_at  is set only when the check clears (bank impact).
  party_effected_at  timestamptz,
  bank_effected_at   timestamptz,
  created_by         uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.finance_checks TO authenticated;
GRANT ALL ON public.finance_checks TO service_role;
ALTER TABLE public.finance_checks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "checks_all_authenticated" ON public.finance_checks
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_finance_checks_dir_status_due
  ON public.finance_checks (direction, status, due_date);
CREATE INDEX IF NOT EXISTS idx_finance_checks_party
  ON public.finance_checks (party_id);
CREATE INDEX IF NOT EXISTS idx_finance_checks_bank
  ON public.finance_checks (bank_id);

-- ---------- finance_checkbook_leaves ------------------------------------
CREATE TABLE IF NOT EXISTS public.finance_checkbook_leaves (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checkbook_id      uuid NOT NULL REFERENCES public.finance_checkbooks(id) ON DELETE CASCADE,
  serial_number     bigint NOT NULL,
  status            public.checkbook_leaf_status NOT NULL DEFAULT 'available',
  issued_check_id   uuid REFERENCES public.finance_checks(id) ON DELETE SET NULL,
  used_at           timestamptz,
  voided_at         timestamptz,
  description       text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (checkbook_id, serial_number)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.finance_checkbook_leaves TO authenticated;
GRANT ALL ON public.finance_checkbook_leaves TO service_role;
ALTER TABLE public.finance_checkbook_leaves ENABLE ROW LEVEL SECURITY;
CREATE POLICY "leaves_all_authenticated" ON public.finance_checkbook_leaves
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Now wire the back-reference from finance_checks to a leaf (after both exist).
ALTER TABLE public.finance_checks
  ADD CONSTRAINT finance_checks_leaf_fkey
  FOREIGN KEY (checkbook_leaf_id)
  REFERENCES public.finance_checkbook_leaves(id) ON DELETE SET NULL;

-- ---------- finance_check_events ----------------------------------------
CREATE TABLE IF NOT EXISTS public.finance_check_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  check_id     uuid NOT NULL REFERENCES public.finance_checks(id) ON DELETE CASCADE,
  event_type   public.check_event_type NOT NULL,
  event_date   timestamptz NOT NULL DEFAULT now(),
  description  text,
  metadata     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.finance_check_events TO authenticated;
GRANT ALL ON public.finance_check_events TO service_role;
ALTER TABLE public.finance_check_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "check_events_all_authenticated" ON public.finance_check_events
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_finance_check_events_check_date
  ON public.finance_check_events (check_id, event_date DESC);

-- ---------- finance_check_links -----------------------------------------
-- Polymorphic light link table — connects a check to invoices/vouchers/
-- bank transactions/payment requests/receive identifications without forcing
-- a hard FK to every possible target.
CREATE TABLE IF NOT EXISTS public.finance_check_links (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  check_id    uuid NOT NULL REFERENCES public.finance_checks(id) ON DELETE CASCADE,
  link_type   text NOT NULL CHECK (link_type IN
                ('factor','voucher','bank_transaction','payment_request','receive_identification','party_transfer')),
  link_id     uuid NOT NULL,
  description text,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (check_id, link_type, link_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.finance_check_links TO authenticated;
GRANT ALL ON public.finance_check_links TO service_role;
ALTER TABLE public.finance_check_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "check_links_all_authenticated" ON public.finance_check_links
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_finance_check_links_check
  ON public.finance_check_links (check_id);
CREATE INDEX IF NOT EXISTS idx_finance_check_links_target
  ON public.finance_check_links (link_type, link_id);

-- ---------- updated_at trigger (shared) ---------------------------------
CREATE OR REPLACE FUNCTION public.fn_finance_checks_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

CREATE TRIGGER trg_finance_checks_touch
  BEFORE UPDATE ON public.finance_checks
  FOR EACH ROW EXECUTE FUNCTION public.fn_finance_checks_touch();
CREATE TRIGGER trg_finance_checkbooks_touch
  BEFORE UPDATE ON public.finance_checkbooks
  FOR EACH ROW EXECUTE FUNCTION public.fn_finance_checks_touch();
CREATE TRIGGER trg_finance_checkbook_leaves_touch
  BEFORE UPDATE ON public.finance_checkbook_leaves
  FOR EACH ROW EXECUTE FUNCTION public.fn_finance_checks_touch();

-- ---------- Auto-generate leaves on checkbook insert --------------------
CREATE OR REPLACE FUNCTION public.fn_finance_checkbook_generate_leaves()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s bigint;
BEGIN
  FOR s IN NEW.start_serial..NEW.end_serial LOOP
    INSERT INTO public.finance_checkbook_leaves (checkbook_id, serial_number, status)
    VALUES (NEW.id, s, 'available')
    ON CONFLICT DO NOTHING;
  END LOOP;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_finance_checkbook_generate_leaves
  AFTER INSERT ON public.finance_checkbooks
  FOR EACH ROW EXECUTE FUNCTION public.fn_finance_checkbook_generate_leaves();

-- ---------- Initial event + party_effected_at on check insert -----------
CREATE OR REPLACE FUNCTION public.fn_finance_check_after_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_event public.check_event_type;
BEGIN
  -- Party impact happens at the moment of receive/issue, NOT at clearing.
  IF NEW.party_effected_at IS NULL THEN
    UPDATE public.finance_checks SET party_effected_at = now() WHERE id = NEW.id;
  END IF;
  v_event := CASE WHEN NEW.direction = 'received' THEN 'received'::public.check_event_type
                  ELSE 'issued'::public.check_event_type END;
  INSERT INTO public.finance_check_events (check_id, event_type, description, metadata, created_by)
  VALUES (NEW.id, v_event,
          CASE WHEN NEW.direction='received' THEN 'ثبت چک دریافتی' ELSE 'صدور چک پرداختی' END,
          jsonb_build_object('status', NEW.status),
          NEW.created_by);
  -- If a payable check references a leaf, mark that leaf as issued.
  IF NEW.direction = 'payable' AND NEW.checkbook_leaf_id IS NOT NULL THEN
    UPDATE public.finance_checkbook_leaves
       SET status = 'issued', issued_check_id = NEW.id, used_at = now()
     WHERE id = NEW.checkbook_leaf_id;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_finance_check_after_insert
  AFTER INSERT ON public.finance_checks
  FOR EACH ROW EXECUTE FUNCTION public.fn_finance_check_after_insert();

-- ---------- Status transition guard -------------------------------------
-- Allowed direction-aware transitions (kept liberal — UI also enforces).
CREATE OR REPLACE FUNCTION public.fn_finance_check_status_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE ok boolean := false;
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;

  -- Terminal states cannot transition further.
  IF OLD.status IN ('voided','lost','cleared') THEN
    RAISE EXCEPTION 'تغییر وضعیت از حالت پایانی % مجاز نیست', OLD.status;
  END IF;

  -- Received-side transitions
  IF NEW.direction = 'received' THEN
    ok := (OLD.status, NEW.status) IN (
      ('received','in_cashbox'),
      ('received','deposited_to_bank'),
      ('received','transferred_to_party'),
      ('received','cleared'),
      ('received','bounced'),
      ('received','voided'),
      ('in_cashbox','deposited_to_bank'),
      ('in_cashbox','transferred_to_party'),
      ('in_cashbox','voided'),
      ('deposited_to_bank','cleared'),
      ('deposited_to_bank','bounced'),
      ('transferred_to_party','cleared'),
      ('transferred_to_party','bounced')
    );
  ELSE
    -- Payable-side transitions
    ok := (OLD.status, NEW.status) IN (
      ('draft','issued'),
      ('draft','voided'),
      ('issued','delivered'),
      ('issued','voided'),
      ('issued','lost'),
      ('delivered','cleared'),
      ('delivered','bounced'),
      ('delivered','lost'),
      ('issued','cleared'),
      ('issued','bounced')
    );
  END IF;

  IF NOT ok THEN
    RAISE EXCEPTION 'انتقال وضعیت % → % برای چک % مجاز نیست', OLD.status, NEW.status, NEW.direction;
  END IF;

  -- Side-effects on accounting markers.
  IF NEW.status = 'cleared' AND NEW.bank_effected_at IS NULL THEN
    NEW.bank_effected_at := now();
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER trg_finance_check_status_guard
  BEFORE UPDATE OF status ON public.finance_checks
  FOR EACH ROW EXECUTE FUNCTION public.fn_finance_check_status_guard();

-- ---------- Sync leaf status with payable check status ------------------
CREATE OR REPLACE FUNCTION public.fn_finance_checkbook_leaf_sync()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.direction <> 'payable' OR NEW.checkbook_leaf_id IS NULL THEN RETURN NEW; END IF;
  UPDATE public.finance_checkbook_leaves SET
    status = CASE NEW.status
      WHEN 'cleared' THEN 'cleared'::public.checkbook_leaf_status
      WHEN 'bounced' THEN 'bounced'::public.checkbook_leaf_status
      WHEN 'voided'  THEN 'voided'::public.checkbook_leaf_status
      WHEN 'lost'    THEN 'lost'::public.checkbook_leaf_status
      ELSE status END,
    voided_at = CASE WHEN NEW.status IN ('voided','lost') THEN now() ELSE voided_at END
  WHERE id = NEW.checkbook_leaf_id;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_finance_checkbook_leaf_sync
  AFTER UPDATE OF status ON public.finance_checks
  FOR EACH ROW EXECUTE FUNCTION public.fn_finance_checkbook_leaf_sync();
