
-- ============================================================
-- Finance module (امور مالی) — schema
-- ============================================================

-- 1) finance_banks
CREATE TABLE public.finance_banks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_id integer,
  title text,
  bank_name text,
  account_holder_name text,
  account_number text,
  iban_number text,
  card_number text,
  sepidar_dl_id integer,
  sepidar_account_id integer,
  is_official boolean DEFAULT false,
  is_api_enabled boolean DEFAULT false,
  is_cheque boolean DEFAULT false,
  online_balance numeric(18,2) DEFAULT 0,
  last_balance numeric(18,2) DEFAULT 0,
  old_balance numeric(18,2) DEFAULT 0,
  last_update timestamptz,
  api_start_date timestamptz,
  is_active boolean DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  is_deleted boolean DEFAULT false,
  deleted_at timestamptz,
  deleted_by uuid
);
CREATE INDEX idx_finance_banks_active ON public.finance_banks(is_active) WHERE is_deleted = false;

-- 2) finance_parties
CREATE TABLE public.finance_parties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_id integer,
  ownership_type text CHECK (ownership_type IN ('individual','legal')),
  nationality text CHECK (nationality IN ('iranian','foreign')),
  first_name text,
  last_name text,
  company_name text,
  national_code text,
  national_id text,
  identification_code text,
  economic_code text,
  mobile text,
  telephone text,
  address text,
  postal_code text,
  branch_code text,
  description text,
  balance numeric(18,2) DEFAULT 0,
  request_balance numeric(18,2) DEFAULT 0,
  sepidar_party_id integer,
  sepidar_account_id integer,
  sepidar_dl_code integer,
  sepidar_sync_status text DEFAULT 'not_synced',
  sepidar_error_message text,
  status text DEFAULT 'active',
  raw_legacy_status jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  is_deleted boolean DEFAULT false,
  deleted_at timestamptz,
  deleted_by uuid
);
CREATE INDEX idx_finance_parties_status ON public.finance_parties(status) WHERE is_deleted = false;
CREATE INDEX idx_finance_parties_national_code ON public.finance_parties(national_code) WHERE is_deleted = false;

-- 3) finance_bank_transactions
CREATE TABLE public.finance_bank_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_id integer,
  bank_id uuid REFERENCES public.finance_banks(id),
  transaction_datetime timestamptz,
  transaction_jalali_date text,
  transaction_type text CHECK (transaction_type IN ('deposit','withdraw')),
  deposit_amount numeric(18,2) DEFAULT 0,
  withdraw_amount numeric(18,2) DEFAULT 0,
  amount numeric(18,2),
  fee_amount numeric(18,2) DEFAULT 0,
  balance_after numeric(18,2),
  description text,
  document_number text,
  reference_number text,
  tracking_number text,
  card_number text,
  last_four_digits_card_number text,
  source_type text CHECK (source_type IN ('api','excel','manual')),
  assignment_status text DEFAULT 'unassigned',
  assigned_operation_type text,
  assigned_operation_id uuid,
  match_type integer,
  match_content text,
  match_name text,
  match_bank_name text,
  raw_data jsonb,
  imported_file_name text,
  original_file_name text,
  imported_by uuid,
  imported_at timestamptz DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  is_deleted boolean DEFAULT false,
  deleted_at timestamptz,
  deleted_by uuid
);
CREATE INDEX idx_finance_bank_tx_bank ON public.finance_bank_transactions(bank_id) WHERE is_deleted = false;
CREATE INDEX idx_finance_bank_tx_date ON public.finance_bank_transactions(transaction_datetime DESC) WHERE is_deleted = false;
CREATE INDEX idx_finance_bank_tx_assignment ON public.finance_bank_transactions(assignment_status) WHERE is_deleted = false;
-- Duplicate prevention: same bank + datetime + amount + reference cannot repeat
CREATE UNIQUE INDEX uq_finance_bank_tx_dedupe
  ON public.finance_bank_transactions(
    bank_id, transaction_datetime, COALESCE(amount,0),
    COALESCE(reference_number,''), COALESCE(tracking_number,''),
    COALESCE(document_number,'')
  )
  WHERE is_deleted = false;

-- 4) finance_payment_requests
CREATE TABLE public.finance_payment_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_id integer,
  title text,
  description text,
  request_type text,
  status text DEFAULT 'draft',
  total_amount numeric(18,2) DEFAULT 0,
  confirmed_amount numeric(18,2) DEFAULT 0,
  requested_by uuid,
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  is_deleted boolean DEFAULT false,
  deleted_at timestamptz,
  deleted_by uuid
);

-- 5) finance_payment_request_items
CREATE TABLE public.finance_payment_request_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_id integer,
  payment_request_id uuid REFERENCES public.finance_payment_requests(id) ON DELETE CASCADE,
  party_id uuid REFERENCES public.finance_parties(id),
  amount numeric(18,2),
  confirmed_amount numeric(18,2),
  amount_type text CHECK (amount_type IN ('debtor','creditor')),
  description text,
  status text DEFAULT 'pending',
  paid_transaction_id uuid REFERENCES public.finance_bank_transactions(id),
  voucher_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  is_deleted boolean DEFAULT false
);

-- 6) finance_receive_identifications
CREATE TABLE public.finance_receive_identifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_id integer,
  title text,
  description text,
  party_id uuid REFERENCES public.finance_parties(id),
  bank_id uuid REFERENCES public.finance_banks(id),
  bank_transaction_id uuid REFERENCES public.finance_bank_transactions(id),
  amount numeric(18,2),
  transaction_datetime timestamptz,
  status text DEFAULT 'draft',
  voucher_id uuid,
  created_by uuid,
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  is_deleted boolean DEFAULT false,
  deleted_at timestamptz
);

-- 7) finance_bank_transfers
CREATE TABLE public.finance_bank_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_id integer,
  from_bank_id uuid REFERENCES public.finance_banks(id),
  to_bank_id uuid REFERENCES public.finance_banks(id),
  from_transaction_id uuid REFERENCES public.finance_bank_transactions(id),
  to_transaction_id uuid REFERENCES public.finance_bank_transactions(id),
  from_amount numeric(18,2),
  to_amount numeric(18,2),
  transfer_datetime timestamptz,
  has_fee boolean DEFAULT false,
  fee_amount numeric(18,2) DEFAULT 0,
  fee_party_id uuid REFERENCES public.finance_parties(id),
  description text,
  status text DEFAULT 'draft',
  voucher_id uuid,
  created_by uuid,
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  is_deleted boolean DEFAULT false
);

-- 8) finance_party_transfers
CREATE TABLE public.finance_party_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_id integer,
  from_party_id uuid REFERENCES public.finance_parties(id),
  to_party_id uuid REFERENCES public.finance_parties(id),
  amount numeric(18,2),
  transfer_datetime timestamptz,
  title text,
  description text,
  status text DEFAULT 'draft',
  voucher_id uuid,
  created_by uuid,
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  is_deleted boolean DEFAULT false
);

-- 9) finance_vouchers
CREATE SEQUENCE IF NOT EXISTS public.finance_voucher_number_seq START 1;
CREATE TABLE public.finance_vouchers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_id integer,
  voucher_number bigint DEFAULT nextval('public.finance_voucher_number_seq'),
  voucher_type text,
  source_operation_type text,
  source_operation_id uuid,
  voucher_date timestamptz,
  title text,
  description text,
  total_debit numeric(18,2) DEFAULT 0,
  total_credit numeric(18,2) DEFAULT 0,
  status text DEFAULT 'draft',
  sepidar_sync_status text DEFAULT 'not_synced',
  sepidar_voucher_id integer,
  sepidar_voucher_number integer,
  sepidar_reference_number integer,
  sepidar_daily_number integer,
  sepidar_extra_data_id integer,
  sepidar_synced_at timestamptz,
  sepidar_error_message text,
  sepidar_sync_attempts integer DEFAULT 0,
  created_by uuid,
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  is_deleted boolean DEFAULT false
);
CREATE INDEX idx_finance_vouchers_status ON public.finance_vouchers(status) WHERE is_deleted = false;
CREATE INDEX idx_finance_vouchers_sepidar ON public.finance_vouchers(sepidar_sync_status) WHERE is_deleted = false;

-- 10) finance_voucher_items
CREATE TABLE public.finance_voucher_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_id uuid REFERENCES public.finance_vouchers(id) ON DELETE CASCADE,
  row_number integer,
  party_id uuid REFERENCES public.finance_parties(id),
  bank_id uuid REFERENCES public.finance_banks(id),
  account_type text,
  debit numeric(18,2) DEFAULT 0,
  credit numeric(18,2) DEFAULT 0,
  description text,
  sepidar_account_id integer,
  sepidar_dl_id integer,
  sepidar_party_id integer,
  sepidar_voucher_item_id integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 11) finance_sepidar_settings
CREATE TABLE public.finance_sepidar_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bridge_base_url text,
  bridge_enabled boolean DEFAULT false,
  default_bank_fee_party_id uuid REFERENCES public.finance_parties(id),
  default_receive_account_id integer,
  default_payment_account_id integer,
  default_party_debit_account_id integer,
  default_party_credit_account_id integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 12) finance_sepidar_sync_logs
CREATE TABLE public.finance_sepidar_sync_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_id uuid REFERENCES public.finance_vouchers(id),
  operation_type text,
  request_payload jsonb,
  response_payload jsonb,
  status text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- updated_at triggers
CREATE TRIGGER trg_finance_banks_updated BEFORE UPDATE ON public.finance_banks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_finance_parties_updated BEFORE UPDATE ON public.finance_parties
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_finance_bank_tx_updated BEFORE UPDATE ON public.finance_bank_transactions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_finance_payment_requests_updated BEFORE UPDATE ON public.finance_payment_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_finance_payment_request_items_updated BEFORE UPDATE ON public.finance_payment_request_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_finance_receive_ids_updated BEFORE UPDATE ON public.finance_receive_identifications
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_finance_bank_transfers_updated BEFORE UPDATE ON public.finance_bank_transfers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_finance_party_transfers_updated BEFORE UPDATE ON public.finance_party_transfers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_finance_vouchers_updated BEFORE UPDATE ON public.finance_vouchers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_finance_sepidar_settings_updated BEFORE UPDATE ON public.finance_sepidar_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- RLS — match project pattern (custom auth, public policies)
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'finance_banks','finance_parties','finance_bank_transactions',
    'finance_payment_requests','finance_payment_request_items',
    'finance_receive_identifications','finance_bank_transfers',
    'finance_party_transfers','finance_vouchers','finance_voucher_items',
    'finance_sepidar_settings','finance_sepidar_sync_logs'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY "Allow public read %1$s" ON public.%1$I FOR SELECT USING (true)', t);
    EXECUTE format('CREATE POLICY "Allow public insert %1$s" ON public.%1$I FOR INSERT WITH CHECK (true)', t);
    EXECUTE format('CREATE POLICY "Allow public update %1$s" ON public.%1$I FOR UPDATE USING (true)', t);
    EXECUTE format('CREATE POLICY "Allow public delete %1$s" ON public.%1$I FOR DELETE USING (true)', t);
  END LOOP;
END$$;

-- Voucher balance helper trigger: keep totals in sync
CREATE OR REPLACE FUNCTION public.recalc_finance_voucher_totals()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_id uuid; v_d numeric; v_c numeric;
BEGIN
  v_id := COALESCE(NEW.voucher_id, OLD.voucher_id);
  SELECT COALESCE(SUM(debit),0), COALESCE(SUM(credit),0) INTO v_d, v_c
    FROM public.finance_voucher_items WHERE voucher_id = v_id;
  UPDATE public.finance_vouchers
    SET total_debit = v_d, total_credit = v_c, updated_at = now()
    WHERE id = v_id;
  RETURN NULL;
END$$;

CREATE TRIGGER trg_finance_voucher_items_recalc
  AFTER INSERT OR UPDATE OR DELETE ON public.finance_voucher_items
  FOR EACH ROW EXECUTE FUNCTION public.recalc_finance_voucher_totals();

-- Seed singleton sepidar settings row
INSERT INTO public.finance_sepidar_settings (bridge_enabled) VALUES (false);
