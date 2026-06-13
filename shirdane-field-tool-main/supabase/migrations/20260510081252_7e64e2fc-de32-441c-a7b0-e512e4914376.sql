
ALTER TABLE public.finance_banks
  ADD COLUMN IF NOT EXISTS sepidar_dl_code text,
  ADD COLUMN IF NOT EXISTS sepidar_bank_account_id integer,
  ADD COLUMN IF NOT EXISTS sepidar_full_title text,
  ADD COLUMN IF NOT EXISTS sepidar_mapping_status text NOT NULL DEFAULT 'not_mapped',
  ADD COLUMN IF NOT EXISTS sepidar_mapping_note text,
  ADD COLUMN IF NOT EXISTS sepidar_last_checked_at timestamptz;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'finance_banks_sepidar_mapping_status_chk') THEN
    ALTER TABLE public.finance_banks
      ADD CONSTRAINT finance_banks_sepidar_mapping_status_chk
      CHECK (sepidar_mapping_status IN ('not_mapped','mapped','needs_review'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.finance_sepidar_bank_accounts_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sepidar_bank_account_id integer NOT NULL UNIQUE,
  sepidar_dl_id integer,
  sepidar_dl_code text,
  sepidar_account_id integer,
  title text,
  account_number text,
  bank_name text,
  is_active boolean NOT NULL DEFAULT true,
  raw jsonb,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.finance_sepidar_bank_accounts_cache ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='finance_sepidar_bank_accounts_cache' AND policyname='public read') THEN
    CREATE POLICY "public read" ON public.finance_sepidar_bank_accounts_cache FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='finance_sepidar_bank_accounts_cache' AND policyname='public insert') THEN
    CREATE POLICY "public insert" ON public.finance_sepidar_bank_accounts_cache FOR INSERT WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='finance_sepidar_bank_accounts_cache' AND policyname='public update') THEN
    CREATE POLICY "public update" ON public.finance_sepidar_bank_accounts_cache FOR UPDATE USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='finance_sepidar_bank_accounts_cache' AND policyname='public delete') THEN
    CREATE POLICY "public delete" ON public.finance_sepidar_bank_accounts_cache FOR DELETE USING (true);
  END IF;
END $$;

CREATE TRIGGER trg_finance_sepidar_bank_accounts_cache_updated
  BEFORE UPDATE ON public.finance_sepidar_bank_accounts_cache
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
