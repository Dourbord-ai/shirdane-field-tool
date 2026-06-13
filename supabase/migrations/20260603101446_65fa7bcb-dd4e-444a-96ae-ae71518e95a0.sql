-- Phase 7A: factor_related_costs
-- Structured related costs (freight, weighing, unloading, misc) for any factor.
-- References public.factors (the existing invoice/factor table), NOT a purchase-only table.

CREATE TABLE public.factor_related_costs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  -- Link to the parent invoice/factor. Cascade so deleting a factor cleans up its cost rows.
  factor_id uuid NOT NULL REFERENCES public.factors(id) ON DELETE CASCADE,

  -- High-level bucket constrained to a known vocabulary.
  cost_category text NOT NULL CHECK (cost_category IN ('freight','logistics','insurance','storage','commission','misc')),
  -- Sub-type kept open-text; UI seeds: driver, waybill, unloading, loading, weighing, transport_insurance, storage_fee, commission, misc
  cost_type text NOT NULL,

  amount numeric(18,2) NOT NULL CHECK (amount >= 0),

  -- party_id is the source of truth for the counterparty (driver/provider/etc).
  -- Nullable so misc costs without a counterparty can still be recorded.
  party_id uuid NULL REFERENCES public.finance_parties(id) ON DELETE RESTRICT,

  description text NULL,
  source_document_number text NULL,
  payment_required boolean NOT NULL DEFAULT true,
  attachment_path text NULL,

  -- Freight convenience fields (display-only; party_id remains source of truth)
  vehicle_plate text NULL,
  driver_name text NULL,

  -- When the cost was incurred (may differ from invoice_date and from created_at)
  cost_date timestamptz NOT NULL DEFAULT now(),

  -- Future link strategy: once a settlement request is generated from this cost row,
  -- we will store the resulting settlement_request_item id here. Nullable until then.
  -- Kept as uuid (not FK) for now so we don't depend on the settlement-item table's
  -- final shape; a follow-up phase will add the FK + index when execution lands.
  settlement_request_item_id uuid NULL,

  is_deleted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes to support the common query patterns (list by factor, filter by party,
-- and quickly find payment-required rows that still need a settlement item).
CREATE INDEX idx_frc_factor_id ON public.factor_related_costs (factor_id);
CREATE INDEX idx_frc_party_id ON public.factor_related_costs (party_id) WHERE party_id IS NOT NULL;
CREATE INDEX idx_frc_factor_payable ON public.factor_related_costs (factor_id, payment_required) WHERE is_deleted = false;
CREATE INDEX idx_frc_pending_settlement
  ON public.factor_related_costs (factor_id)
  WHERE is_deleted = false AND payment_required = true AND settlement_request_item_id IS NULL;

-- GRANTs (mandatory; mirrors sibling factor-domain tables in this dev project).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.factor_related_costs TO anon, authenticated;
GRANT ALL ON public.factor_related_costs TO service_role;

ALTER TABLE public.factor_related_costs ENABLE ROW LEVEL SECURITY;

-- Open policy matches the existing dev posture for factor_* tables.
CREATE POLICY dev_open_access_policy ON public.factor_related_costs
  FOR ALL TO public USING (true) WITH CHECK (true);

-- Reuse existing updated_at trigger function if present; otherwise define a local one.
CREATE OR REPLACE FUNCTION public.fn_frc_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER tg_frc_touch_updated_at
BEFORE UPDATE ON public.factor_related_costs
FOR EACH ROW EXECUTE FUNCTION public.fn_frc_touch_updated_at();