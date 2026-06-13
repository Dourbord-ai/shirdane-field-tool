-- Add identity to id column for auto-increment
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'bankpartyaccountinfos'
      AND column_name = 'id'
      AND is_identity = 'YES'
  ) THEN
    -- Make id NOT NULL first if it has nulls, set default sequence
    CREATE SEQUENCE IF NOT EXISTS public.bankpartyaccountinfos_id_seq;
    -- Set sequence to start above any existing max
    PERFORM setval('public.bankpartyaccountinfos_id_seq', COALESCE((SELECT MAX(id) FROM public.bankpartyaccountinfos), 0) + 1, false);
    ALTER TABLE public.bankpartyaccountinfos ALTER COLUMN id SET DEFAULT nextval('public.bankpartyaccountinfos_id_seq');
    ALTER SEQUENCE public.bankpartyaccountinfos_id_seq OWNED BY public.bankpartyaccountinfos.id;
  END IF;
END $$;

-- Unique index on (matchtype, matchcontent) for fast cache lookup
CREATE UNIQUE INDEX IF NOT EXISTS idx_bankpartyaccountinfos_type_content
  ON public.bankpartyaccountinfos (matchtype, matchcontent)
  WHERE matchtype IS NOT NULL AND matchcontent IS NOT NULL;

-- Enable RLS and add public policies (matches existing pattern of other tables)
ALTER TABLE public.bankpartyaccountinfos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read bankpartyaccountinfos" ON public.bankpartyaccountinfos;
CREATE POLICY "Allow public read bankpartyaccountinfos"
  ON public.bankpartyaccountinfos FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Allow public insert bankpartyaccountinfos" ON public.bankpartyaccountinfos;
CREATE POLICY "Allow public insert bankpartyaccountinfos"
  ON public.bankpartyaccountinfos FOR INSERT
  WITH CHECK (true);

DROP POLICY IF EXISTS "Allow public update bankpartyaccountinfos" ON public.bankpartyaccountinfos;
CREATE POLICY "Allow public update bankpartyaccountinfos"
  ON public.bankpartyaccountinfos FOR UPDATE
  USING (true);