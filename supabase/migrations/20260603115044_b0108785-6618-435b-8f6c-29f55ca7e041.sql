
-- ============================================================================
-- Phase 8 — Settlement Execution Workflow
-- ----------------------------------------------------------------------------
-- Adds an execution layer on top of finance_payment_request_items.
-- NO financial effect, NO Sepidar fields, NO bank-allocation fields, NO roles.
-- All RPCs gate on authenticated only (role checks deferred to a later phase).
-- ============================================================================


-- 1) Extend execution_status allowed values.
--    We keep `execution_status` as text + CHECK so future values are cheap.
--    Drop the old NOT VALID check and replace with the wider set.
ALTER TABLE public.finance_payment_request_items
  DROP CONSTRAINT IF EXISTS chk_fpri_exec_status;

ALTER TABLE public.finance_payment_request_items
  ADD CONSTRAINT chk_fpri_exec_status CHECK (
    execution_status IS NULL OR execution_status = ANY (ARRAY[
      'pending',
      'ready_for_execution',
      'in_progress',
      'partially_executed',
      'linked',
      'executed',
      'on_hold',
      'cancelled',
      'rejected'
    ])
  );


-- 2) New columns: executed_at, executed_by, closure_reason, on_hold_reason, execution_note.
--    These are the ONLY new columns this phase — no bank/voucher/sepidar fields.
ALTER TABLE public.finance_payment_request_items
  ADD COLUMN IF NOT EXISTS executed_at    timestamptz,
  ADD COLUMN IF NOT EXISTS executed_by    uuid,
  ADD COLUMN IF NOT EXISTS closure_reason text,
  ADD COLUMN IF NOT EXISTS on_hold_reason text,
  ADD COLUMN IF NOT EXISTS execution_note text;


-- 3) finance_settlement_item_events — append-only event log per settlement item.
CREATE TABLE IF NOT EXISTS public.finance_settlement_item_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id     uuid NOT NULL REFERENCES public.finance_payment_request_items(id) ON DELETE CASCADE,
  request_id  uuid NOT NULL,  -- denormalized for fast parent-level queries
  event_type  text NOT NULL CHECK (event_type IN (
    'status_change','executed','linked','cancelled','rejected','reopened',
    'hold','resume','extend_due_date','followup_note','check_linked',
    'attachment_added','note'
  )),
  from_status text,
  to_status   text,
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
  note        text,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Required: explicit GRANTs on every new public-schema table.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.finance_settlement_item_events TO authenticated;
GRANT ALL ON public.finance_settlement_item_events TO service_role;

ALTER TABLE public.finance_settlement_item_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "settlement_item_events_all_authenticated"
  ON public.finance_settlement_item_events
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_fsie_item_created
  ON public.finance_settlement_item_events (item_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_fsie_request_created
  ON public.finance_settlement_item_events (request_id, created_at DESC);


-- 4) Prevent two active check links on the same settlement item.
--    Uses a partial unique index keyed on link_type='payment_request'.
--    We treat a link as "broken" when description->>'broken_at' IS NOT NULL
--    so reopen flows can free the slot without losing audit history.
CREATE UNIQUE INDEX IF NOT EXISTS uq_check_links_active_payment_request
  ON public.finance_check_links (link_id)
  WHERE link_type = 'payment_request'
    AND (description IS NULL OR description NOT LIKE '%"broken_at"%');


-- 5) Validation trigger — enforce allowed transitions + block legacy rows.
CREATE OR REPLACE FUNCTION public.fn_fpri_execution_transitions()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  ok boolean := false;
BEGIN
  -- No-op when status is unchanged.
  IF NEW.execution_status IS NOT DISTINCT FROM OLD.execution_status THEN
    RETURN NEW;
  END IF;

  -- Legacy rows are read-only for execution purposes.
  IF OLD.payment_method = 'legacy' THEN
    RAISE EXCEPTION 'Legacy settlement items cannot change execution_status (item %)', OLD.id;
  END IF;

  -- Allowed transitions matrix.
  ok := (COALESCE(OLD.execution_status,'pending'), NEW.execution_status) IN (
    -- from pending
    ('pending','ready_for_execution'),
    ('pending','cancelled'),
    ('pending','rejected'),
    -- from ready_for_execution
    ('ready_for_execution','in_progress'),
    ('ready_for_execution','on_hold'),
    ('ready_for_execution','cancelled'),
    ('ready_for_execution','rejected'),
    -- from in_progress
    ('in_progress','executed'),
    ('in_progress','linked'),
    ('in_progress','partially_executed'),
    ('in_progress','on_hold'),
    ('in_progress','cancelled'),
    -- from on_hold
    ('on_hold','ready_for_execution'),
    ('on_hold','cancelled'),
    -- from partially_executed
    ('partially_executed','in_progress'),
    ('partially_executed','executed'),
    ('partially_executed','cancelled'),
    -- reopen paths (terminal → pending)
    ('executed','pending'),
    ('linked','pending'),
    ('cancelled','pending'),
    ('rejected','pending')
  );

  IF NOT ok THEN
    RAISE EXCEPTION 'Invalid execution_status transition: % → % (item %)',
      OLD.execution_status, NEW.execution_status, OLD.id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_fpri_execution_transitions ON public.finance_payment_request_items;
CREATE TRIGGER tg_fpri_execution_transitions
  BEFORE UPDATE OF execution_status ON public.finance_payment_request_items
  FOR EACH ROW EXECUTE FUNCTION public.fn_fpri_execution_transitions();


-- 6) Status-change logger — append a 'status_change' event automatically.
CREATE OR REPLACE FUNCTION public.fn_fpri_log_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.execution_status IS DISTINCT FROM OLD.execution_status THEN
    INSERT INTO public.finance_settlement_item_events
      (item_id, request_id, event_type, from_status, to_status, payload, note, created_by)
    VALUES
      (NEW.id, NEW.payment_request_id, 'status_change',
       OLD.execution_status, NEW.execution_status,
       jsonb_build_object('payment_method', NEW.payment_method),
       NEW.execution_note,
       auth.uid());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_fpri_log_status_change ON public.finance_payment_request_items;
CREATE TRIGGER tg_fpri_log_status_change
  AFTER UPDATE OF execution_status ON public.finance_payment_request_items
  FOR EACH ROW EXECUTE FUNCTION public.fn_fpri_log_status_change();


-- 7) RPCs — auth-only this phase (no role checks).
-- ============================================================================

-- 7a) execute_settlement_item(item_id, method, payload jsonb)
--     For directly-completed methods (bank_transfer, cashbox, barter,
--     deferred-closure). NOT for check (use link_settlement_item_to_check).
CREATE OR REPLACE FUNCTION public.execute_settlement_item(
  p_item_id uuid,
  p_method  text,
  p_payload jsonb DEFAULT '{}'::jsonb,
  p_note    text  DEFAULT NULL
) RETURNS public.finance_payment_request_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item public.finance_payment_request_items;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO v_item FROM public.finance_payment_request_items WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Settlement item % not found', p_item_id; END IF;

  IF v_item.payment_method <> p_method THEN
    RAISE EXCEPTION 'Method mismatch: item is %, called with %', v_item.payment_method, p_method;
  END IF;
  IF p_method = 'check' THEN
    RAISE EXCEPTION 'For check items, use link_settlement_item_to_check()';
  END IF;

  -- Merge per-method execution payload into details.execution.{method}.
  UPDATE public.finance_payment_request_items
     SET details = COALESCE(details,'{}'::jsonb)
                   || jsonb_build_object('execution',
                        COALESCE(details->'execution','{}'::jsonb)
                        || jsonb_build_object(p_method, p_payload)),
         executed_at    = now(),
         executed_by    = auth.uid(),
         execution_note = COALESCE(p_note, execution_note),
         execution_status = 'executed',
         updated_at = now()
   WHERE id = p_item_id
   RETURNING * INTO v_item;

  INSERT INTO public.finance_settlement_item_events
    (item_id, request_id, event_type, from_status, to_status, payload, note, created_by)
  VALUES
    (v_item.id, v_item.payment_request_id, 'executed', NULL, 'executed',
     jsonb_build_object('method', p_method, 'data', p_payload),
     p_note, auth.uid());

  RETURN v_item;
END;
$$;

REVOKE ALL ON FUNCTION public.execute_settlement_item(uuid, text, jsonb, text) FROM public;
GRANT EXECUTE ON FUNCTION public.execute_settlement_item(uuid, text, jsonb, text) TO authenticated;


-- 7b) link_settlement_item_to_check(item_id, check_id, note)
--     Inserts finance_check_links row + flips item to 'linked' immediately.
--     Settlement does NOT mirror downstream check lifecycle.
CREATE OR REPLACE FUNCTION public.link_settlement_item_to_check(
  p_item_id  uuid,
  p_check_id uuid,
  p_note     text DEFAULT NULL
) RETURNS public.finance_payment_request_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item   public.finance_payment_request_items;
  v_check  public.finance_checks;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  SELECT * INTO v_item FROM public.finance_payment_request_items WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Settlement item % not found', p_item_id; END IF;
  IF v_item.payment_method <> 'check' THEN
    RAISE EXCEPTION 'Item % is not a check item (method=%)', p_item_id, v_item.payment_method;
  END IF;

  SELECT * INTO v_check FROM public.finance_checks WHERE id = p_check_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Check % not found', p_check_id; END IF;

  -- Insert link; partial unique index guarantees only one active link.
  INSERT INTO public.finance_check_links (check_id, link_type, link_id, description)
  VALUES (
    p_check_id, 'payment_request', p_item_id,
    jsonb_build_object(
      'payment_request_id', v_item.payment_request_id,
      'item_id', p_item_id,
      'linked_at', now()
    )::text
  );

  UPDATE public.finance_payment_request_items
     SET execution_status = 'linked',
         executed_at      = now(),
         executed_by      = auth.uid(),
         execution_note   = COALESCE(p_note, execution_note),
         details          = COALESCE(details,'{}'::jsonb)
                            || jsonb_build_object('execution',
                                 COALESCE(details->'execution','{}'::jsonb)
                                 || jsonb_build_object('check', jsonb_build_object(
                                      'check_id', p_check_id,
                                      'linked_at', now()
                                    ))),
         updated_at = now()
   WHERE id = p_item_id
   RETURNING * INTO v_item;

  INSERT INTO public.finance_settlement_item_events
    (item_id, request_id, event_type, from_status, to_status, payload, note, created_by)
  VALUES
    (v_item.id, v_item.payment_request_id, 'check_linked', NULL, 'linked',
     jsonb_build_object('check_id', p_check_id), p_note, auth.uid());

  RETURN v_item;
END;
$$;

REVOKE ALL ON FUNCTION public.link_settlement_item_to_check(uuid, uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.link_settlement_item_to_check(uuid, uuid, text) TO authenticated;


-- 7c) cancel_settlement_item(item_id, reason)
CREATE OR REPLACE FUNCTION public.cancel_settlement_item(
  p_item_id uuid,
  p_reason  text
) RETURNS public.finance_payment_request_items
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_item public.finance_payment_request_items;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'closure_reason is required';
  END IF;

  UPDATE public.finance_payment_request_items
     SET execution_status = 'cancelled',
         closure_reason   = p_reason,
         execution_note   = COALESCE(p_reason, execution_note),
         updated_at = now()
   WHERE id = p_item_id
   RETURNING * INTO v_item;
  IF NOT FOUND THEN RAISE EXCEPTION 'Settlement item % not found', p_item_id; END IF;

  INSERT INTO public.finance_settlement_item_events
    (item_id, request_id, event_type, to_status, payload, note, created_by)
  VALUES (v_item.id, v_item.payment_request_id, 'cancelled', 'cancelled',
          jsonb_build_object('reason', p_reason), p_reason, auth.uid());
  RETURN v_item;
END $$;
REVOKE ALL ON FUNCTION public.cancel_settlement_item(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.cancel_settlement_item(uuid, text) TO authenticated;


-- 7d) reject_settlement_item(item_id, reason)
CREATE OR REPLACE FUNCTION public.reject_settlement_item(
  p_item_id uuid,
  p_reason  text
) RETURNS public.finance_payment_request_items
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_item public.finance_payment_request_items;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'reason is required';
  END IF;

  UPDATE public.finance_payment_request_items
     SET execution_status = 'rejected',
         closure_reason   = p_reason,
         execution_note   = COALESCE(p_reason, execution_note),
         updated_at = now()
   WHERE id = p_item_id
   RETURNING * INTO v_item;
  IF NOT FOUND THEN RAISE EXCEPTION 'Settlement item % not found', p_item_id; END IF;

  INSERT INTO public.finance_settlement_item_events
    (item_id, request_id, event_type, to_status, payload, note, created_by)
  VALUES (v_item.id, v_item.payment_request_id, 'rejected', 'rejected',
          jsonb_build_object('reason', p_reason), p_reason, auth.uid());
  RETURN v_item;
END $$;
REVOKE ALL ON FUNCTION public.reject_settlement_item(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.reject_settlement_item(uuid, text) TO authenticated;


-- 7e) hold_settlement_item / resume_settlement_item
CREATE OR REPLACE FUNCTION public.hold_settlement_item(
  p_item_id uuid,
  p_reason  text
) RETURNS public.finance_payment_request_items
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_item public.finance_payment_request_items;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_reason IS NULL OR length(btrim(p_reason))=0 THEN RAISE EXCEPTION 'on_hold_reason is required'; END IF;

  UPDATE public.finance_payment_request_items
     SET execution_status = 'on_hold',
         on_hold_reason   = p_reason,
         execution_note   = COALESCE(p_reason, execution_note),
         updated_at = now()
   WHERE id = p_item_id
   RETURNING * INTO v_item;
  IF NOT FOUND THEN RAISE EXCEPTION 'Settlement item % not found', p_item_id; END IF;

  INSERT INTO public.finance_settlement_item_events
    (item_id, request_id, event_type, to_status, payload, note, created_by)
  VALUES (v_item.id, v_item.payment_request_id, 'hold', 'on_hold',
          jsonb_build_object('reason', p_reason), p_reason, auth.uid());
  RETURN v_item;
END $$;
REVOKE ALL ON FUNCTION public.hold_settlement_item(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.hold_settlement_item(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.resume_settlement_item(
  p_item_id uuid
) RETURNS public.finance_payment_request_items
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_item public.finance_payment_request_items;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  UPDATE public.finance_payment_request_items
     SET execution_status = 'ready_for_execution',
         on_hold_reason   = NULL,
         updated_at = now()
   WHERE id = p_item_id
   RETURNING * INTO v_item;
  IF NOT FOUND THEN RAISE EXCEPTION 'Settlement item % not found', p_item_id; END IF;

  INSERT INTO public.finance_settlement_item_events
    (item_id, request_id, event_type, to_status, created_by)
  VALUES (v_item.id, v_item.payment_request_id, 'resume', 'ready_for_execution', auth.uid());
  RETURN v_item;
END $$;
REVOKE ALL ON FUNCTION public.resume_settlement_item(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.resume_settlement_item(uuid) TO authenticated;


-- 7f) reopen_settlement_item(item_id, reason)
--     Returns the item to 'pending'. For 'linked' items, marks the active
--     finance_check_links row as broken (soft) so the partial unique index
--     frees the slot without losing audit history.
CREATE OR REPLACE FUNCTION public.reopen_settlement_item(
  p_item_id uuid,
  p_reason  text
) RETURNS public.finance_payment_request_items
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_item public.finance_payment_request_items;
  v_was  text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_reason IS NULL OR length(btrim(p_reason))=0 THEN RAISE EXCEPTION 'reason is required'; END IF;

  SELECT * INTO v_item FROM public.finance_payment_request_items WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Settlement item % not found', p_item_id; END IF;
  v_was := v_item.execution_status;

  -- Break any active payment_request → check link by soft-marking it.
  IF v_was = 'linked' THEN
    UPDATE public.finance_check_links
       SET description = COALESCE(
             -- Try to keep existing description as JSON and merge a broken_at.
             CASE
               WHEN description IS NOT NULL AND description ~ '^\s*\{'
               THEN (description::jsonb || jsonb_build_object(
                       'broken_at', now()::text,
                       'broken_reason', p_reason
                     ))::text
               ELSE jsonb_build_object(
                      'note', description,
                      'broken_at', now()::text,
                      'broken_reason', p_reason
                    )::text
             END,
             jsonb_build_object('broken_at', now()::text)::text
           )
     WHERE link_type = 'payment_request'
       AND link_id = p_item_id
       AND (description IS NULL OR description NOT LIKE '%"broken_at"%');
  END IF;

  UPDATE public.finance_payment_request_items
     SET execution_status = 'pending',
         executed_at      = NULL,
         executed_by      = NULL,
         closure_reason   = NULL,
         on_hold_reason   = NULL,
         execution_note   = p_reason,
         updated_at = now()
   WHERE id = p_item_id
   RETURNING * INTO v_item;

  INSERT INTO public.finance_settlement_item_events
    (item_id, request_id, event_type, from_status, to_status, payload, note, created_by)
  VALUES
    (v_item.id, v_item.payment_request_id, 'reopened', v_was, 'pending',
     jsonb_build_object('reason', p_reason), p_reason, auth.uid());

  RETURN v_item;
END $$;
REVOKE ALL ON FUNCTION public.reopen_settlement_item(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.reopen_settlement_item(uuid, text) TO authenticated;


-- 7g) extend_settlement_item_due_date — for deferred items.
--     IMPORTANT: status is NEVER changed by this RPC.
CREATE OR REPLACE FUNCTION public.extend_settlement_item_due_date(
  p_item_id      uuid,
  p_new_due_date date,
  p_note         text DEFAULT NULL
) RETURNS public.finance_payment_request_items
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_item public.finance_payment_request_items;
  v_old  date;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_new_due_date IS NULL THEN RAISE EXCEPTION 'new_due_date is required'; END IF;

  SELECT * INTO v_item FROM public.finance_payment_request_items WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Settlement item % not found', p_item_id; END IF;
  v_old := v_item.due_date;

  UPDATE public.finance_payment_request_items
     SET due_date = p_new_due_date,
         execution_note = COALESCE(p_note, execution_note),
         updated_at = now()
   WHERE id = p_item_id
   RETURNING * INTO v_item;

  INSERT INTO public.finance_settlement_item_events
    (item_id, request_id, event_type, payload, note, created_by)
  VALUES (v_item.id, v_item.payment_request_id, 'extend_due_date',
          jsonb_build_object('from', v_old, 'to', p_new_due_date),
          p_note, auth.uid());
  RETURN v_item;
END $$;
REVOKE ALL ON FUNCTION public.extend_settlement_item_due_date(uuid, date, text) FROM public;
GRANT EXECUTE ON FUNCTION public.extend_settlement_item_due_date(uuid, date, text) TO authenticated;
