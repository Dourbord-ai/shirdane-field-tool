-- =============================================================================
-- Step 2 of 2 — Check categories + auto-posting accounting vouchers
-- =============================================================================
-- Builds on the enum values added in the previous migration.
-- All new logic lives in plpgsql triggers so every code path (UI, RPC,
-- import script) gets the same accounting behaviour for free.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. New columns on finance_checks
-- ---------------------------------------------------------------------------
ALTER TABLE public.finance_checks
  -- The "kind" of check. operational = real money movement (received/payable).
  -- guarantee/cancelled are tracking-only and must never hit the GL.
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'operational',
  -- Convenience pointer to the registration voucher. We also use
  -- finance_vouchers.source_operation_id, but having the FK here makes
  -- list queries cheap (one less join).
  ADD COLUMN IF NOT EXISTS voucher_id uuid NULL REFERENCES public.finance_vouchers(id) ON DELETE SET NULL,
  -- Guarantee-specific metadata.
  ADD COLUMN IF NOT EXISTS expiry_date date NULL,
  ADD COLUMN IF NOT EXISTS guarantee_subject text NULL,
  ADD COLUMN IF NOT EXISTS related_contract text NULL,
  ADD COLUMN IF NOT EXISTS related_project text NULL,
  -- Cancelled-specific metadata.
  ADD COLUMN IF NOT EXISTS cancelled_date date NULL,
  ADD COLUMN IF NOT EXISTS cancel_reason text NULL;

-- Enforce allowed category values. We use a CHECK (not an enum) because the
-- list is tiny and stable; this keeps migration easy if we ever rename.
ALTER TABLE public.finance_checks
  DROP CONSTRAINT IF EXISTS finance_checks_category_check;
ALTER TABLE public.finance_checks
  ADD CONSTRAINT finance_checks_category_check
  CHECK (category IN ('operational','guarantee','cancelled'));

-- Constrain cancel_reason to the 7 documented values (NULL allowed for
-- non-cancelled rows).
ALTER TABLE public.finance_checks
  DROP CONSTRAINT IF EXISTS finance_checks_cancel_reason_check;
ALTER TABLE public.finance_checks
  ADD CONSTRAINT finance_checks_cancel_reason_check
  CHECK (
    cancel_reason IS NULL OR cancel_reason IN (
      'wrong_entry','wrong_amount','wrong_beneficiary',
      'damaged','lost','replaced','other'
    )
  );

-- Helpful indexes for the new tabs / filters.
CREATE INDEX IF NOT EXISTS idx_finance_checks_category
  ON public.finance_checks(category);
CREATE INDEX IF NOT EXISTS idx_finance_checks_voucher_id
  ON public.finance_checks(voucher_id);

-- ---------------------------------------------------------------------------
-- 2. Idempotency guard for auto-posted vouchers
-- ---------------------------------------------------------------------------
-- A given check must have at most ONE voucher per event (register/clear/
-- bounce). We discriminate by voucher_type values 'check_register',
-- 'check_clear', 'check_bounce' and enforce uniqueness at the DB level so
-- duplicate trigger firings or retries can never double-post.
CREATE UNIQUE INDEX IF NOT EXISTS uq_finance_vouchers_check_event
  ON public.finance_vouchers (source_operation_id, voucher_type)
  WHERE source_operation_type = 'finance_check' AND is_deleted = false;

-- ---------------------------------------------------------------------------
-- 3. Voucher posting helper
-- ---------------------------------------------------------------------------
-- One central function for all three events. Keeps the accounting matrix
-- in a single readable place. Always safe to call — bails early for
-- non-operational checks or when a matching voucher already exists.
CREATE OR REPLACE FUNCTION public.fn_finance_check_post_voucher(
  p_check_id uuid,
  p_event    text                 -- 'register' | 'clear' | 'bounce'
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_check         public.finance_checks%ROWTYPE;
  v_voucher_type  text;
  v_voucher_id    uuid;
  v_existing_id   uuid;
  v_debit_acct    text;
  v_credit_acct   text;
  v_debit_party   uuid;
  v_credit_party  uuid;
  v_debit_bank    uuid;
  v_credit_bank   uuid;
  v_title         text;
BEGIN
  -- Load + row-lock the check so concurrent triggers can't race.
  SELECT * INTO v_check FROM public.finance_checks WHERE id = p_check_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'check % not found', p_check_id;
  END IF;

  -- Guarantee / cancelled checks never hit the GL.
  IF v_check.category <> 'operational' THEN
    RETURN NULL;
  END IF;

  -- Map event → voucher_type discriminator used by the idempotency index.
  v_voucher_type := CASE p_event
    WHEN 'register' THEN 'check_register'
    WHEN 'clear'    THEN 'check_clear'
    WHEN 'bounce'   THEN 'check_bounce'
    ELSE NULL END;
  IF v_voucher_type IS NULL THEN
    RAISE EXCEPTION 'invalid event % for check voucher posting', p_event;
  END IF;

  -- Idempotency: if a voucher of this type already exists for this check
  -- (not soft-deleted), reuse it and return.
  SELECT id INTO v_existing_id
    FROM public.finance_vouchers
   WHERE source_operation_type = 'finance_check'
     AND source_operation_id   = p_check_id
     AND voucher_type          = v_voucher_type
     AND is_deleted = false
   LIMIT 1;
  IF v_existing_id IS NOT NULL THEN
    RETURN v_existing_id;
  END IF;

  -- ---- Build the accounting entries ----
  -- account_type strings are stable hooks; a future mapping table will
  -- translate them to Sepidar account IDs without touching this trigger.
  IF p_event = 'register' AND v_check.direction = 'received' THEN
    v_debit_acct  := 'notes_receivable';
    v_credit_acct := 'party_receivable';
    v_credit_party := v_check.party_id;
    v_title := 'ثبت چک دریافتی شماره ' || v_check.check_number;
  ELSIF p_event = 'register' AND v_check.direction = 'payable' THEN
    v_debit_acct  := 'party_payable';
    v_credit_acct := 'notes_payable';
    v_debit_party := v_check.party_id;
    v_title := 'ثبت چک پرداختی شماره ' || v_check.check_number;
  ELSIF p_event = 'clear' AND v_check.direction = 'received' THEN
    v_debit_acct  := 'bank';
    v_credit_acct := 'notes_receivable';
    v_debit_bank  := v_check.bank_id;
    v_title := 'پاس شدن چک دریافتی شماره ' || v_check.check_number;
  ELSIF p_event = 'clear' AND v_check.direction = 'payable' THEN
    v_debit_acct  := 'notes_payable';
    v_credit_acct := 'bank';
    v_credit_bank := v_check.bank_id;
    v_title := 'پاس شدن چک پرداختی شماره ' || v_check.check_number;
  ELSIF p_event = 'bounce' AND v_check.direction = 'received' THEN
    v_debit_acct  := 'party_receivable';
    v_credit_acct := 'notes_receivable';
    v_debit_party := v_check.party_id;
    v_title := 'برگشت چک دریافتی شماره ' || v_check.check_number;
  ELSIF p_event = 'bounce' AND v_check.direction = 'payable' THEN
    v_debit_acct  := 'notes_payable';
    v_credit_acct := 'party_payable';
    v_credit_party := v_check.party_id;
    v_title := 'برگشت چک پرداختی شماره ' || v_check.check_number;
  ELSE
    RAISE EXCEPTION 'unsupported event/direction combo: %/%', p_event, v_check.direction;
  END IF;

  -- ---- Create the voucher header ----
  INSERT INTO public.finance_vouchers (
    voucher_type, source_operation_type, source_operation_id,
    voucher_date, title, description, status, created_by
  ) VALUES (
    v_voucher_type, 'finance_check', p_check_id,
    now(), v_title, v_title, 'posted', v_check.created_by
  ) RETURNING id INTO v_voucher_id;

  -- ---- Voucher items (debit + credit) ----
  -- The recompute_party_balance trigger on finance_voucher_items will
  -- automatically refresh affected party balances after these inserts.
  INSERT INTO public.finance_voucher_items (
    voucher_id, row_number, account_type, party_id, bank_id,
    debit, credit, description
  ) VALUES
    (v_voucher_id, 1, v_debit_acct,  v_debit_party,  v_debit_bank,
     v_check.amount, 0, v_title),
    (v_voucher_id, 2, v_credit_acct, v_credit_party, v_credit_bank,
     0, v_check.amount, v_title);

  -- ---- Cross-reference link (audit / future integrations) ----
  INSERT INTO public.finance_check_links (
    check_id, link_type, link_id, description, created_by
  ) VALUES (
    p_check_id, 'voucher', v_voucher_id,
    'auto-posted ' || p_event, v_check.created_by
  );

  -- ---- Timeline event ----
  INSERT INTO public.finance_check_events (
    check_id, event_type, description, metadata, created_by
  ) VALUES (
    p_check_id,
    CASE WHEN p_event = 'bounce' THEN 'voucher_reversed'::public.check_event_type
         ELSE 'voucher_posted'::public.check_event_type END,
    v_title,
    jsonb_build_object('event', p_event, 'voucher_id', v_voucher_id, 'voucher_type', v_voucher_type),
    v_check.created_by
  );

  -- Store the registration voucher on the check for fast UI joins.
  IF p_event = 'register' THEN
    UPDATE public.finance_checks SET voucher_id = v_voucher_id WHERE id = p_check_id;
  END IF;

  RETURN v_voucher_id;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Extend the AFTER INSERT trigger to auto-post registration vouchers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_finance_check_after_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_event public.check_event_type;
BEGIN
  -- Operational checks immediately affect the party — stamp the timestamp
  -- so reports see the effect even before voucher items are computed.
  IF NEW.category = 'operational' AND NEW.party_effected_at IS NULL THEN
    UPDATE public.finance_checks SET party_effected_at = now() WHERE id = NEW.id;
  END IF;

  -- Pick the right initial event based on direction. Guarantee/cancelled
  -- checks log their own dedicated event types so the timeline reads well.
  v_event := CASE
    WHEN NEW.category = 'cancelled' THEN 'cancelled'::public.check_event_type
    WHEN NEW.direction = 'received' THEN 'received'::public.check_event_type
    ELSE 'issued'::public.check_event_type
  END;
  INSERT INTO public.finance_check_events (check_id, event_type, description, metadata, created_by)
  VALUES (NEW.id, v_event,
          CASE
            WHEN NEW.category = 'guarantee' THEN 'ثبت چک ضمانتی'
            WHEN NEW.category = 'cancelled' THEN 'ثبت چک ابطالی'
            WHEN NEW.direction = 'received' THEN 'ثبت چک دریافتی'
            ELSE 'صدور چک پرداختی'
          END,
          jsonb_build_object('status', NEW.status, 'category', NEW.category),
          NEW.created_by);

  -- Operational payable checks consume a checkbook leaf.
  IF NEW.category = 'operational' AND NEW.direction = 'payable' AND NEW.checkbook_leaf_id IS NOT NULL THEN
    UPDATE public.finance_checkbook_leaves
       SET status = 'issued', issued_check_id = NEW.id, used_at = now()
     WHERE id = NEW.checkbook_leaf_id;
  END IF;

  -- Auto-post the registration voucher (no-op for guarantee/cancelled).
  IF NEW.category = 'operational' THEN
    PERFORM public.fn_finance_check_post_voucher(NEW.id, 'register');
  END IF;

  RETURN NEW;
END $$;

-- ---------------------------------------------------------------------------
-- 5. AFTER UPDATE trigger — post clear / bounce vouchers automatically
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_finance_check_after_status_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;
  IF NEW.category <> 'operational' THEN RETURN NEW; END IF;

  IF NEW.status = 'cleared' THEN
    PERFORM public.fn_finance_check_post_voucher(NEW.id, 'clear');
  ELSIF NEW.status = 'bounced' THEN
    PERFORM public.fn_finance_check_post_voucher(NEW.id, 'bounce');
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_finance_check_after_status_change ON public.finance_checks;
CREATE TRIGGER trg_finance_check_after_status_change
  AFTER UPDATE OF status ON public.finance_checks
  FOR EACH ROW EXECUTE FUNCTION public.fn_finance_check_after_status_change();

-- ---------------------------------------------------------------------------
-- 6. Replace the status guard to handle the new categories
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_finance_check_status_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE ok boolean := false;
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;

  -- Guarantee checks: their own short lifecycle. They can never reach
  -- accounting-impacting states (cleared/bounced).
  IF NEW.category = 'guarantee' THEN
    IF NEW.status IN ('cleared','bounced') THEN
      RAISE EXCEPTION 'چک ضمانتی نمی‌تواند به وضعیت % برسد', NEW.status;
    END IF;
    ok := (OLD.status, NEW.status) IN (
      ('active','returned'),
      ('active','claimed'),
      ('active','expired'),
      ('active','voided'),
      ('returned','voided')
    );
    IF NOT ok THEN
      RAISE EXCEPTION 'انتقال وضعیت % → % برای چک ضمانتی مجاز نیست', OLD.status, NEW.status;
    END IF;
    RETURN NEW;
  END IF;

  -- Cancelled checks are born terminal — no transitions allowed.
  IF NEW.category = 'cancelled' THEN
    RAISE EXCEPTION 'چک ابطالی قابل تغییر وضعیت نیست';
  END IF;

  -- ---- Operational checks: original logic ----
  IF OLD.status IN ('voided','lost','cleared') THEN
    RAISE EXCEPTION 'تغییر وضعیت از حالت پایانی % مجاز نیست', OLD.status;
  END IF;

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

  -- Side-effect: stamp bank effect timestamp on clearing.
  IF NEW.status = 'cleared' AND NEW.bank_effected_at IS NULL THEN
    NEW.bank_effected_at := now();
  END IF;

  RETURN NEW;
END $$;