ALTER TABLE public.fertility_thresholds
ADD COLUMN IF NOT EXISTS sync_to_service_window_days SMALLINT NOT NULL DEFAULT 14;