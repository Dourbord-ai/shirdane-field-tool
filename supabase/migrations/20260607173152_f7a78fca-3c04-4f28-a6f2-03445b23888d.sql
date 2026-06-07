-- Audit table for bank transaction deletions
CREATE TABLE public.finance_bank_tx_delete_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tx_id uuid NOT NULL,
  deleted_by uuid,
  deleted_at timestamptz NOT NULL DEFAULT now(),
  reason text NOT NULL,
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.finance_bank_tx_delete_audit TO authenticated;
GRANT ALL ON public.finance_bank_tx_delete_audit TO service_role;

ALTER TABLE public.finance_bank_tx_delete_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_select_authenticated"
  ON public.finance_bank_tx_delete_audit FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "audit_insert_authenticated"
  ON public.finance_bank_tx_delete_audit FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE INDEX idx_bank_tx_delete_audit_tx ON public.finance_bank_tx_delete_audit(tx_id);
CREATE INDEX idx_bank_tx_delete_audit_deleted_at ON public.finance_bank_tx_delete_audit(deleted_at DESC);

-- ============================================================================
-- RPC: fn_finance_bulk_delete_bank_transactions
-- Safe bulk soft-delete of bank transactions. Locks each row, re-checks
-- eligibility, only deletes truly-free rows (unassigned with no operation
-- linkage). Returns deleted[] and blocked[] with reasons.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_finance_bulk_delete_bank_transactions(
  p_ids uuid[],
  p_actor uuid,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_row finance_bank_transactions%ROWTYPE;
  v_deleted uuid[] := ARRAY[]::uuid[];
  v_blocked jsonb := '[]'::jsonb;
  v_bank_ids uuid[] := ARRAY[]::uuid[];
  v_reason_trim text;
BEGIN
  v_reason_trim := trim(coalesce(p_reason, ''));
  IF length(v_reason_trim) < 3 THEN
    RAISE EXCEPTION 'دلیل حذف الزامی است (حداقل ۳ کاراکتر)';
  END IF;

  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('deleted', '[]'::jsonb, 'blocked', '[]'::jsonb);
  END IF;

  FOREACH v_id IN ARRAY p_ids LOOP
    -- Lock the row to prevent races with auto-identify / assignment writes.
    SELECT * INTO v_row
    FROM finance_bank_transactions
    WHERE id = v_id
    FOR UPDATE;

    IF NOT FOUND THEN
      v_blocked := v_blocked || jsonb_build_object('id', v_id, 'reason', 'not_found');
      CONTINUE;
    END IF;

    IF coalesce(v_row.is_deleted, false) THEN
      v_blocked := v_blocked || jsonb_build_object('id', v_id, 'reason', 'already_deleted');
      CONTINUE;
    END IF;

    -- Eligibility re-check: only unassigned with no operation linkage.
    -- `bank_fee_candidate` (an unassigned hint) is allowed.
    IF v_row.assignment_status <> 'unassigned'
       OR v_row.assigned_operation_id IS NOT NULL
       OR (v_row.assigned_operation_type IS NOT NULL
           AND v_row.assigned_operation_type <> 'bank_fee_candidate') THEN
      v_blocked := v_blocked || jsonb_build_object(
        'id', v_id,
        'reason', 'locked',
        'assignment_status', v_row.assignment_status,
        'assigned_operation_type', v_row.assigned_operation_type,
        'assigned_operation_id', v_row.assigned_operation_id
      );
      CONTINUE;
    END IF;

    -- Snapshot full row, then soft-delete.
    INSERT INTO finance_bank_tx_delete_audit (tx_id, deleted_by, reason, snapshot)
    VALUES (v_id, p_actor, v_reason_trim, to_jsonb(v_row));

    UPDATE finance_bank_transactions
    SET is_deleted = true,
        deleted_at = now(),
        deleted_by = p_actor,
        updated_at = now()
    WHERE id = v_id;

    v_deleted := v_deleted || v_id;
    IF v_row.bank_id IS NOT NULL AND NOT (v_row.bank_id = ANY(v_bank_ids)) THEN
      v_bank_ids := v_bank_ids || v_row.bank_id;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'deleted', to_jsonb(v_deleted),
    'blocked', v_blocked,
    'bank_ids', to_jsonb(v_bank_ids)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_finance_bulk_delete_bank_transactions(uuid[], uuid, text) TO authenticated, service_role;