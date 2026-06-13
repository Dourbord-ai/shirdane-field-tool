ALTER TABLE public.cows REPLICA IDENTITY FULL;
ALTER TABLE public.livestock_fertility_events REPLICA IDENTITY FULL;
ALTER TABLE public.livestock_events REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.cows;
ALTER PUBLICATION supabase_realtime ADD TABLE public.livestock_fertility_events;
ALTER PUBLICATION supabase_realtime ADD TABLE public.livestock_events;