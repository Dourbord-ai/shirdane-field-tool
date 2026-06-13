-- Archive of generated livestock lists. Stores the exact cow ids + filters
-- so the same list can be reopened later and group actions reapplied.
CREATE TABLE public.livestock_list_archives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  note text,
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  column_keys text[] NOT NULL DEFAULT '{}'::text[],
  cow_ids bigint[] NOT NULL DEFAULT '{}'::bigint[],
  cow_count integer NOT NULL DEFAULT 0,
  created_by_user_id uuid,
  created_by_username text,
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.livestock_list_archives ENABLE ROW LEVEL SECURITY;

-- This project uses an internal app_users auth model (not Supabase auth.uid()),
-- matching the access pattern of other operational tables in the project.
CREATE POLICY "anyone can read livestock list archives"
  ON public.livestock_list_archives FOR SELECT USING (true);

CREATE POLICY "anyone can insert livestock list archives"
  ON public.livestock_list_archives FOR INSERT WITH CHECK (true);

CREATE POLICY "anyone can update livestock list archives"
  ON public.livestock_list_archives FOR UPDATE USING (true);

CREATE POLICY "anyone can delete livestock list archives"
  ON public.livestock_list_archives FOR DELETE USING (true);

CREATE INDEX idx_livestock_list_archives_created_at
  ON public.livestock_list_archives (created_at DESC);

CREATE TRIGGER trg_livestock_list_archives_updated
  BEFORE UPDATE ON public.livestock_list_archives
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();