-- Strip time portion from shamsi event_date so values are clean dates like "1405/02/12"
UPDATE public.livestock_fertility_events
SET event_date = split_part(event_date, ' ', 1)
WHERE event_date IS NOT NULL AND event_date ~ ' ';