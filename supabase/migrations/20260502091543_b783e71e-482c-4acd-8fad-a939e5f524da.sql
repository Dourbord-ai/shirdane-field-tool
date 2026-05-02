-- Unified fertility events table mapping legacy SQL Server fertility tables
CREATE TABLE IF NOT EXISTS public.livestock_fertility_events (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  livestock_id bigint NOT NULL,
  event_type text NOT NULL, -- heat | insemination | pregnancy_test | calving | abortion | dry_off | clean_test | rinse | prescription | synchronization | sync_detail | fertility_status
  event_date text,
  status_code integer,
  result text,
  operator_user_id bigint,
  operator_name text,
  notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  legacy_table_name text, -- CowErotics | CowInoculations | CowPregnancies | CowBirths | CowAbortions | CowDreis | CowCleanTests | CowRinses | CowPrescriptions | CowSyncs | CowSyncDetails | CowFertilityStatuses
  legacy_record_id bigint,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lfe_livestock_id ON public.livestock_fertility_events(livestock_id);
CREATE INDEX IF NOT EXISTS idx_lfe_event_type ON public.livestock_fertility_events(event_type);
CREATE INDEX IF NOT EXISTS idx_lfe_event_date ON public.livestock_fertility_events(event_date DESC);
CREATE INDEX IF NOT EXISTS idx_lfe_legacy ON public.livestock_fertility_events(legacy_table_name, legacy_record_id);

ALTER TABLE public.livestock_fertility_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read livestock_fertility_events"
  ON public.livestock_fertility_events FOR SELECT USING (true);
CREATE POLICY "Allow public insert livestock_fertility_events"
  ON public.livestock_fertility_events FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update livestock_fertility_events"
  ON public.livestock_fertility_events FOR UPDATE USING (true);
CREATE POLICY "Allow public delete livestock_fertility_events"
  ON public.livestock_fertility_events FOR DELETE USING (true);