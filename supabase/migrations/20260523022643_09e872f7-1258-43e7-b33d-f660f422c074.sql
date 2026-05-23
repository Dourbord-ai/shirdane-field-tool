
-- Group B migration: convert 6 text date/time columns to timestamptz
-- All values pre-verified as day-first D/M/YYYY HH24:MI:SS Gregorian wall-clock (Tehran).
ALTER TABLE public.cow_syncs
  ALTER COLUMN event_date TYPE timestamptz
    USING (to_timestamp(event_date, 'FMDD/FMMM/YYYY HH24:MI:SS') AT TIME ZONE 'Asia/Tehran'),
  ALTER COLUMN inoculation_date_time TYPE timestamptz
    USING (to_timestamp(inoculation_date_time, 'FMDD/FMMM/YYYY HH24:MI:SS') AT TIME ZONE 'Asia/Tehran'),
  ALTER COLUMN stop_date TYPE timestamptz
    USING (CASE WHEN stop_date IS NULL THEN NULL
                ELSE to_timestamp(stop_date, 'FMDD/FMMM/YYYY HH24:MI:SS') AT TIME ZONE 'Asia/Tehran' END);

ALTER TABLE public.cow_sync_details
  ALTER COLUMN date_time TYPE timestamptz
    USING (to_timestamp(date_time, 'FMDD/FMMM/YYYY HH24:MI:SS') AT TIME ZONE 'Asia/Tehran'),
  ALTER COLUMN injection_date_time TYPE timestamptz
    USING (CASE WHEN injection_date_time IS NULL THEN NULL
                ELSE to_timestamp(injection_date_time, 'FMDD/FMMM/YYYY HH24:MI:SS') AT TIME ZONE 'Asia/Tehran' END);

ALTER TABLE public.livestock_events
  ALTER COLUMN event_date TYPE timestamptz
    USING (to_timestamp(event_date, 'FMDD/FMMM/YYYY HH24:MI:SS') AT TIME ZONE 'Asia/Tehran');
