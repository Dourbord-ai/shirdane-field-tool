ALTER TABLE public.finance_parties
  ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'pending_approval',
  ADD COLUMN IF NOT EXISTS approved_by uuid,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejected_by uuid,
  ADD COLUMN IF NOT EXISTS rejected_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS sepidar_dl_id integer,
  ADD COLUMN IF NOT EXISTS sepidar_full_name text,
  ADD COLUMN IF NOT EXISTS sepidar_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS sepidar_sync_attempts integer NOT NULL DEFAULT 0;

ALTER TABLE public.finance_sepidar_sync_logs
  ADD COLUMN IF NOT EXISTS party_id uuid REFERENCES public.finance_parties(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS entity_type text;

CREATE INDEX IF NOT EXISTS idx_finance_parties_approval_status ON public.finance_parties(approval_status);
CREATE INDEX IF NOT EXISTS idx_finance_sepidar_sync_logs_party_id ON public.finance_sepidar_sync_logs(party_id);