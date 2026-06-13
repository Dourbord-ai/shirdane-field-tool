-- =============================================================================
-- Fix check → finance_voucher accounting mapping to match Sepidar account model
-- =============================================================================
-- Goals (per spec):
--  • Only the party-side line carries party_id; all other lines have party_id = NULL.
--  • Use Sepidar-aware account_type strings the existing sepidar-post-voucher
--    pipeline understands (party_account, bank, notes_receivable_cashbox,
--    notes_receivable_in_collection, notes_payable).
--  • Add a new event/voucher_type `check_deposit` for moving a received check
--    from cashbox (118) to in-collection (119).
--  • Trigger check_deposit automatically when a received operational check
--    transitions to status = 'deposited_to_bank'.
--  • Bounce of a received check credits in-collection if it was deposited,
--    otherwise cashbox.
--  • Guarantee / cancelled checks still bypass all voucher posting.
--  • Keep source_operation_type = 'finance_check'. Keep idempotency unchanged
--    (the existing unique index already discriminates on voucher_type, so
--    check_deposit gets its own slot for free).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_finance_check_post_voucher(
  p_check_id uuid,
  p_event    text                 -- 'register' | 'deposit' | 'clear' | 'bounce'
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
  v_was_deposited boolean := false;
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
    WHEN 'deposit'  THEN 'check_deposit'
    WHEN 'clear'    THEN 'check_clear'
    WHEN 'bounce'   THEN 'check_bounce'
    ELSE NULL END;
  IF v_voucher_type IS NULL THEN
    RAISE EXCEPTION 'invalid event % for check voucher posting', p_event;
  END IF;

  -- Idempotency: reuse any existing non-deleted voucher of this type.
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

  -- Was this check ever moved to in-collection? Used to decide which
  -- "notes receivable" sub-account to credit on a received-check bounce.
  IF v_check.direction = 'received' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.finance_vouchers
       WHERE source_operation_type = 'finance_check'
         AND source_operation_id   = p_check_id
         AND voucher_type          = 'check_deposit'
         AND is_deleted = false
    ) INTO v_was_deposited;
  END IF;

  -- ---- Build the accounting entries ----
  -- account_type strings are stable hooks the Sepidar posting pipeline maps
  -- to AccountIds (118 / 119 / 194 / 105 / per-party / per-bank).
  -- Only `party_account` lines carry party_id. All other lines have party_id = NULL.

  IF p_event = 'register' AND v_check.direction = 'received' THEN
    -- Dr 118 چکهای دریافتنی نزد صندوق  / Cr party_account
    v_debit_acct   := 'notes_receivable_cashbox';
    v_credit_acct  := 'party_account';
    v_credit_party := v_check.party_id;
    v_title := 'ثبت چک دریافتی شماره ' || v_check.check_number;

  ELSIF p_event = 'register' AND v_check.direction = 'payable' THEN
    -- Dr party_account / Cr 194 اسناد پرداختنی ریالی
    v_debit_acct  := 'party_account';
    v_credit_acct := 'notes_payable';
    v_debit_party := v_check.party_id;
    v_title := 'ثبت چک پرداختی شماره ' || v_check.check_number;

  ELSIF p_event = 'deposit' AND v_check.direction = 'received' THEN
    -- Dr 119 چکهای در جریان وصول / Cr 118 چکهای دریافتنی نزد صندوق
    -- No party balance effect.
    v_debit_acct  := 'notes_receivable_in_collection';
    v_credit_acct := 'notes_receivable_cashbox';
    v_title := 'واگذاری چک دریافتی به بانک شماره ' || v_check.check_number;

  ELSIF p_event = 'clear' AND v_check.direction = 'received' THEN
    -- Dr bank (selected bank account; default Sepidar 105 in mapping layer)
    -- Cr 119 چکهای در جریان وصول
    v_debit_acct  := 'bank';
    v_debit_bank  := v_check.bank_id;
    v_credit_acct := 'notes_receivable_in_collection';
    v_title := 'پاس شدن چک دریافتی شماره ' || v_check.check_number;

  ELSIF p_event = 'clear' AND v_check.direction = 'payable' THEN
    -- Dr 194 / Cr bank
    v_debit_acct  := 'notes_payable';
    v_credit_acct := 'bank';
    v_credit_bank := v_check.bank_id;
    v_title := 'پاس شدن چک پرداختی شماره ' || v_check.check_number;

  ELSIF p_event = 'bounce' AND v_check.direction = 'received' THEN
    -- Dr party_account (reopens customer balance) / Cr notes_receivable_*
    v_debit_acct   := 'party_account';
    v_debit_party  := v_check.party_id;
    v_credit_acct  := CASE WHEN v_was_deposited
                           THEN 'notes_receivable_in_collection'
                           ELSE 'notes_receivable_cashbox' END;
    v_title := 'برگشت چک دریافتی شماره ' || v_check.check_number;

  ELSIF p_event = 'bounce' AND v_check.direction = 'payable' THEN
    -- Dr 194 / Cr party_account (reopens supplier balance)
    v_debit_acct   := 'notes_payable';
    v_credit_acct  := 'party_account';
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
  -- Reminder: only party_account rows carry party_id; everything else NULL.
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
-- Extend status-change trigger: also post a check_deposit voucher when a
-- received operational check moves into in-collection.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_finance_check_after_status_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;
  IF NEW.category <> 'operational' THEN RETURN NEW; END IF;

  -- Received check handed to the bank for collection: Dr 119 / Cr 118.
  IF NEW.direction = 'received' AND NEW.status = 'deposited_to_bank' THEN
    PERFORM public.fn_finance_check_post_voucher(NEW.id, 'deposit');
  END IF;

  IF NEW.status = 'cleared' THEN
    PERFORM public.fn_finance_check_post_voucher(NEW.id, 'clear');
  ELSIF NEW.status = 'bounced' THEN
    PERFORM public.fn_finance_check_post_voucher(NEW.id, 'bounce');
  END IF;

  RETURN NEW;
END $$;