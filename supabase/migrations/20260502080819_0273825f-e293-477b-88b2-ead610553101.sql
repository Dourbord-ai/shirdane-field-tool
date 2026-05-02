-- Add new livestock-management columns to cows table
ALTER TABLE public.cows
  ADD COLUMN IF NOT EXISTS presence_status smallint,
  ADD COLUMN IF NOT EXISTS is_dry boolean,
  ADD COLUMN IF NOT EXISTS last_fertility_status integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS tag_number text,
  ADD COLUMN IF NOT EXISTS purchase_date text,
  ADD COLUMN IF NOT EXISTS purchase_price numeric,
  ADD COLUMN IF NOT EXISTS supplier text,
  ADD COLUMN IF NOT EXISTS purchase_invoice_number text,
  ADD COLUMN IF NOT EXISTS created_at timestamp with time zone NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone NOT NULL DEFAULT now();

-- Backfill tag_number from earnumber/bodynumber when missing
UPDATE public.cows
SET tag_number = COALESCE(tag_number, earnumber::text, bodynumber::text)
WHERE tag_number IS NULL;

-- Backfill presence_status from legacy existancestatus.
-- Legacy: 1 = in herd (موجود), 2 = تلفات, 3 = کشتار, others (e.g. existancestatusdes='فروش') => sale
-- New mapping: 0 موجود, 1 فروش, 2 تلفات, 3 کشتار, 4 سایر
UPDATE public.cows
SET presence_status = CASE
  WHEN existancestatus = 1 THEN 0                                  -- موجود در گله
  WHEN existancestatus = 2 OR existancestatusdes = 'تلفات' THEN 2  -- تلفات
  WHEN existancestatus = 3 OR existancestatusdes = 'کشتار' THEN 3  -- کشتار
  WHEN existancestatusdes = 'فروش' THEN 1                          -- فروش
  ELSE 4                                                            -- سایر دلایل
END
WHERE presence_status IS NULL;

-- For females currently in herd, default fertility status to 1 (بدون وضعیت) and is_dry=false (دوشا) if null
UPDATE public.cows
SET is_dry = false
WHERE is_dry IS NULL AND sextype = 'ماده';

-- Index for fast filters
CREATE INDEX IF NOT EXISTS idx_cows_presence_status ON public.cows(presence_status);
CREATE INDEX IF NOT EXISTS idx_cows_tag_number ON public.cows(tag_number);
CREATE INDEX IF NOT EXISTS idx_cows_created_at ON public.cows(created_at DESC);

-- Enable RLS and add public policies (matches the rest of this project's pattern)
ALTER TABLE public.cows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read cows" ON public.cows;
CREATE POLICY "Allow public read cows" ON public.cows FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow public insert cows" ON public.cows;
CREATE POLICY "Allow public insert cows" ON public.cows FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Allow public update cows" ON public.cows;
CREATE POLICY "Allow public update cows" ON public.cows FOR UPDATE USING (true);

DROP POLICY IF EXISTS "Allow public delete cows" ON public.cows;
CREATE POLICY "Allow public delete cows" ON public.cows FOR DELETE USING (true);

-- Auto-update updated_at on row update
DROP TRIGGER IF EXISTS update_cows_updated_at ON public.cows;
CREATE TRIGGER update_cows_updated_at
BEFORE UPDATE ON public.cows
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Livestock events / timeline table for future use
CREATE TABLE IF NOT EXISTS public.livestock_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cow_id bigint NOT NULL,
  event_type text NOT NULL,           -- presence_change | dry_change | fertility_change | sale | death | slaughter | other
  from_value text,
  to_value text,
  description text,
  event_date text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_livestock_events_cow_id ON public.livestock_events(cow_id);
CREATE INDEX IF NOT EXISTS idx_livestock_events_created_at ON public.livestock_events(created_at DESC);

ALTER TABLE public.livestock_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read livestock_events" ON public.livestock_events FOR SELECT USING (true);
CREATE POLICY "Allow public insert livestock_events" ON public.livestock_events FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update livestock_events" ON public.livestock_events FOR UPDATE USING (true);
CREATE POLICY "Allow public delete livestock_events" ON public.livestock_events FOR DELETE USING (true);