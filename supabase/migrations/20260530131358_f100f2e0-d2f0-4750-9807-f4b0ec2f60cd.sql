CREATE TABLE public.milk_production_alerts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  livestock_id bigint NOT NULL,
  animal_number text,
  reference_date date NOT NULL,
  baseline_mode text NOT NULL,
  baseline_records_count int NOT NULL,
  session text,
  today_kg numeric(10,2) NOT NULL,
  baseline_kg numeric(10,2) NOT NULL,
  diff_kg numeric(10,2) NOT NULL,
  diff_pct numeric(7,2) NOT NULL,
  threshold_pct numeric(7,2) NOT NULL,
  direction text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  notified_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Functional unique index (CHECK/UNIQUE can't use COALESCE directly).
CREATE UNIQUE INDEX milk_production_alerts_unique
  ON public.milk_production_alerts (
    livestock_id, reference_date, baseline_mode, COALESCE(session,'all')
  );
CREATE INDEX idx_mpa_reference_date ON public.milk_production_alerts(reference_date DESC);
CREATE INDEX idx_mpa_status ON public.milk_production_alerts(status);
CREATE INDEX idx_mpa_livestock ON public.milk_production_alerts(livestock_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.milk_production_alerts TO authenticated;
GRANT ALL ON public.milk_production_alerts TO service_role;

ALTER TABLE public.milk_production_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read alerts"
  ON public.milk_production_alerts FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert alerts"
  ON public.milk_production_alerts FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update alerts"
  ON public.milk_production_alerts FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated can delete alerts"
  ON public.milk_production_alerts FOR DELETE TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER trg_mpa_updated_at
BEFORE UPDATE ON public.milk_production_alerts
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();