-- Add a real Gregorian DATE column on fertility events.
-- Existing event_date (TEXT, Jalali "YYYY/MM/DD") stays as-is for backward compatibility.
-- The new column is auto-populated by a trigger so every form write ends up with a real میلادی date.

ALTER TABLE public.livestock_fertility_events
  ADD COLUMN IF NOT EXISTS event_date_gregorian DATE;

-- Trigger function: on INSERT/UPDATE, derive Gregorian from the incoming Jalali text via safe_text_to_date.
-- If the caller already supplied event_date_gregorian directly, we respect it.
CREATE OR REPLACE FUNCTION public.fertility_event_fill_gregorian()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.event_date_gregorian IS NULL AND NEW.event_date IS NOT NULL THEN
    NEW.event_date_gregorian := public.safe_text_to_date(NEW.event_date);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fertility_event_fill_gregorian ON public.livestock_fertility_events;
CREATE TRIGGER trg_fertility_event_fill_gregorian
BEFORE INSERT OR UPDATE OF event_date, event_date_gregorian
ON public.livestock_fertility_events
FOR EACH ROW
EXECUTE FUNCTION public.fertility_event_fill_gregorian();

-- Backfill existing rows
UPDATE public.livestock_fertility_events
SET event_date_gregorian = public.safe_text_to_date(event_date)
WHERE event_date_gregorian IS NULL AND event_date IS NOT NULL;

-- Helpful index for future Gregorian-based queries/sorting
CREATE INDEX IF NOT EXISTS idx_lfe_event_date_gregorian
  ON public.livestock_fertility_events (event_date_gregorian);