
ALTER TABLE public.livestock_fertility_events
  ADD COLUMN IF NOT EXISTS is_cancelled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS cancelled_by_user_id uuid NULL,
  ADD COLUMN IF NOT EXISTS cancel_reason text NULL,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DROP TRIGGER IF EXISTS trg_livestock_fertility_events_updated_at ON public.livestock_fertility_events;
CREATE TRIGGER trg_livestock_fertility_events_updated_at
BEFORE UPDATE ON public.livestock_fertility_events
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.fertility_event_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fertility_event_id uuid NOT NULL,
  action text NOT NULL,
  old_data jsonb,
  new_data jsonb,
  user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.fertility_event_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read fertility_event_audit_logs" ON public.fertility_event_audit_logs;
CREATE POLICY "Allow public read fertility_event_audit_logs"
  ON public.fertility_event_audit_logs FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow public insert fertility_event_audit_logs" ON public.fertility_event_audit_logs;
CREATE POLICY "Allow public insert fertility_event_audit_logs"
  ON public.fertility_event_audit_logs FOR INSERT WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_fertility_event_audit_logs_event_id
  ON public.fertility_event_audit_logs(fertility_event_id);
