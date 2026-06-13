DROP TRIGGER IF EXISTS trg_fertility_event_fill_gregorian ON public.livestock_fertility_events;

DROP INDEX IF EXISTS public.idx_lfe_event_date_gregorian;

ALTER TABLE public.livestock_fertility_events
  DROP COLUMN IF EXISTS event_date_gregorian;

DROP FUNCTION IF EXISTS public.fertility_event_fill_gregorian();