CREATE TABLE IF NOT EXISTS public.finance_sepidar_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation text NOT NULL,
  request_payload jsonb,
  response_payload jsonb,
  success boolean NOT NULL DEFAULT false,
  raw_error text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_finance_sepidar_logs_op_created
  ON public.finance_sepidar_logs (operation, created_at DESC);

ALTER TABLE public.finance_sepidar_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sepidar_logs_select_all" ON public.finance_sepidar_logs;
CREATE POLICY "sepidar_logs_select_all"
  ON public.finance_sepidar_logs
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "sepidar_logs_insert_all" ON public.finance_sepidar_logs;
CREATE POLICY "sepidar_logs_insert_all"
  ON public.finance_sepidar_logs
  FOR INSERT
  WITH CHECK (true);