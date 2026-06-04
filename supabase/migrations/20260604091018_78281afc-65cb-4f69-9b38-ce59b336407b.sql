
-- ===========================================================================
-- Task 6 — Freight Trips (Multi-Invoice Freight Allocation)
--
-- Adds an OPTIONAL aggregator workflow for the ~2% of freight events that
-- cover multiple invoices in one physical trip. The single-invoice freight
-- workflow (factor_related_costs with cost_category='freight') is untouched
-- and remains the default path.
--
-- This migration is additive only:
--   * Two new tables (freight_trips + freight_trip_invoices)
--   * Three nullable columns on factor_related_costs
--   * One BEFORE-UPDATE trigger on factors to block detach-while-linked
-- No existing rows are modified; existing freight cost rows continue to
-- behave as today (freight_trip_id IS NULL).
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1) freight_trips — the trip header (driver, vehicle, total fee).
-- ---------------------------------------------------------------------------
CREATE TABLE public.freight_trips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Optional human-friendly label like 'T-1404-0007'. Not unique because
  -- operators may reuse codes across years; uniqueness is on id only.
  trip_code text NULL,

  -- When the trip physically happened. Stored as timestamptz to match the
  -- rest of the finance domain.
  trip_date timestamptz NOT NULL DEFAULT now(),

  -- Driver/owner of the obligation — same FK pattern as
  -- factor_related_costs.party_id. Nullable to allow draft trips before the
  -- driver is decided.
  driver_party_id uuid NULL REFERENCES public.finance_parties(id),

  vehicle_plate text NULL,
  vehicle_type  text NULL,

  -- Route info, reusing the Task 4 geo_locations dictionary.
  origin_location_id      uuid NULL REFERENCES public.geo_locations(id),
  destination_location_id uuid NULL REFERENCES public.geo_locations(id),
  origin_text             text NULL,
  destination_text        text NULL,
  route_distance_km       numeric NULL,

  -- The single freight fee paid to the driver. Must be > 0 once the trip
  -- leaves draft, but we don't CHECK > 0 here so drafts can be saved while
  -- being assembled. Application-level validation enforces > 0 on allocate.
  total_amount numeric NOT NULL DEFAULT 0,

  -- How `total_amount` is split across linked invoices. See §3 of the plan.
  allocation_method text NOT NULL DEFAULT 'by_weight'
    CHECK (allocation_method IN ('by_weight', 'by_invoice_amount', 'manual')),

  -- Same gate as factor_related_costs.payment_required: if false, the trip
  -- is bookkeeping-only and produces no settlement obligation to the driver.
  payment_required boolean NOT NULL DEFAULT true,

  notes text NULL,

  -- Lifecycle:
  --   draft              — being assembled; no cost rows materialized
  --   allocated          — shares computed, cost rows materialized
  --   settlement_created — settlement request submitted for the driver
  --   settled            — driver fully paid (set by settlement execution)
  --   cancelled          — trip voided; cost rows soft-deleted
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'allocated', 'settlement_created', 'settled', 'cancelled')),

  -- Standard audit columns.
  created_by uuid NULL REFERENCES public.app_users(id),
  updated_by uuid NULL REFERENCES public.app_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  is_deleted boolean NOT NULL DEFAULT false
);

-- GRANTs FIRST — Supabase Data API needs explicit privileges.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.freight_trips TO authenticated;
GRANT ALL ON public.freight_trips TO service_role;

ALTER TABLE public.freight_trips ENABLE ROW LEVEL SECURITY;

-- Mirrors the existing factor_related_costs policy: any authenticated user
-- of the app can see and manage trips. Multi-tenant scoping is a later
-- concern (already true for the rest of the finance schema).
CREATE POLICY "freight_trips authenticated manage"
  ON public.freight_trips
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Indexes — list view sorts by trip_date desc, filters by driver.
CREATE INDEX ix_freight_trips_trip_date_active
  ON public.freight_trips (trip_date DESC)
  WHERE is_deleted = false;
CREATE INDEX ix_freight_trips_driver_party_id
  ON public.freight_trips (driver_party_id)
  WHERE is_deleted = false;
CREATE INDEX ix_freight_trips_status
  ON public.freight_trips (status)
  WHERE is_deleted = false;


-- ---------------------------------------------------------------------------
-- 2) freight_trip_invoices — link rows (one per invoice attached to a trip).
-- ---------------------------------------------------------------------------
CREATE TABLE public.freight_trip_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- ON DELETE CASCADE so a hard-deleted trip cleans its links automatically
  -- (we still default to soft-delete in the app layer).
  trip_id uuid NOT NULL REFERENCES public.freight_trips(id) ON DELETE CASCADE,

  -- No CASCADE on factor — we want a noisy failure rather than silent loss
  -- of an allocation if someone tries to delete the underlying invoice.
  factor_id uuid NOT NULL REFERENCES public.factors(id),

  -- Required when allocation_method = 'by_weight'. Nullable otherwise so
  -- the operator isn't forced to enter weights when allocating by amount.
  cargo_weight_kg numeric NULL,

  -- Required when allocation_method = 'manual'. App-level validation
  -- enforces SUM(manual_share_amount) = trip.total_amount.
  manual_share_amount numeric NULL,

  -- Final computed share, mirrored down to the materialized cost row.
  -- Starts at 0 until the allocator runs.
  allocated_amount numeric NOT NULL DEFAULT 0,

  -- Back-reference to the cost row this link materialized. SET NULL so a
  -- detached cost row doesn't leave a dangling FK.
  related_cost_id uuid NULL REFERENCES public.factor_related_costs(id) ON DELETE SET NULL,

  notes text NULL,

  created_by uuid NULL REFERENCES public.app_users(id),
  updated_by uuid NULL REFERENCES public.app_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  is_deleted boolean NOT NULL DEFAULT false
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.freight_trip_invoices TO authenticated;
GRANT ALL ON public.freight_trip_invoices TO service_role;

ALTER TABLE public.freight_trip_invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "freight_trip_invoices authenticated manage"
  ON public.freight_trip_invoices
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- One link per (trip, invoice) — prevents duplicating the same invoice
-- inside the same trip. Partial so soft-deleted rows don't block re-add.
CREATE UNIQUE INDEX ux_freight_trip_invoices_trip_factor_active
  ON public.freight_trip_invoices (trip_id, factor_id)
  WHERE is_deleted = false;

-- An invoice may belong to only ONE active freight trip at a time
-- (revision per Task 6 sign-off). "Active" here means the link is not
-- soft-deleted AND the parent trip is not cancelled/deleted. We enforce
-- the trip-side condition via a trigger because partial unique indexes
-- can't reference another table.
CREATE UNIQUE INDEX ux_freight_trip_invoices_factor_active
  ON public.freight_trip_invoices (factor_id)
  WHERE is_deleted = false;

CREATE INDEX ix_freight_trip_invoices_trip_id
  ON public.freight_trip_invoices (trip_id)
  WHERE is_deleted = false;


-- ---------------------------------------------------------------------------
-- 3) factor_related_costs — additive trip linkage columns.
--
-- All three are nullable so existing freight rows remain valid and behave
-- exactly as before (freight_trip_id IS NULL → ordinary per-invoice freight).
-- ---------------------------------------------------------------------------
ALTER TABLE public.factor_related_costs
  ADD COLUMN IF NOT EXISTS freight_trip_id uuid NULL
    REFERENCES public.freight_trips(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS freight_trip_invoice_id uuid NULL
    REFERENCES public.freight_trip_invoices(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS freight_trip_share_basis text NULL
    CHECK (freight_trip_share_basis IS NULL
           OR freight_trip_share_basis IN ('weight', 'amount', 'manual'));

-- 1:1 link between a trip-invoice row and its materialized cost row.
-- Partial because most cost rows have freight_trip_invoice_id IS NULL.
CREATE UNIQUE INDEX IF NOT EXISTS ux_factor_related_costs_freight_trip_invoice_active
  ON public.factor_related_costs (freight_trip_invoice_id)
  WHERE freight_trip_invoice_id IS NOT NULL AND is_deleted = false;

CREATE INDEX IF NOT EXISTS ix_factor_related_costs_freight_trip_id
  ON public.factor_related_costs (freight_trip_id)
  WHERE freight_trip_id IS NOT NULL AND is_deleted = false;


-- ---------------------------------------------------------------------------
-- 4) updated_at trigger function (shared if not already present) +
--    triggers for the two new tables.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_freight_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_freight_trips_set_updated_at
  BEFORE UPDATE ON public.freight_trips
  FOR EACH ROW EXECUTE FUNCTION public.tg_freight_set_updated_at();

CREATE TRIGGER trg_freight_trip_invoices_set_updated_at
  BEFORE UPDATE ON public.freight_trip_invoices
  FOR EACH ROW EXECUTE FUNCTION public.tg_freight_set_updated_at();


-- ---------------------------------------------------------------------------
-- 5) Delete protection — block soft-deleting (or hard-deleting) any factor
--    that is currently linked to an active freight trip.
--
-- "Active" = link not soft-deleted AND parent trip not cancelled/deleted.
-- We trigger on:
--   * UPDATE that flips factors.is_deleted false → true (soft delete)
--   * DELETE (hard delete) — defensive, the app uses soft-delete
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_block_factor_delete_if_in_active_trip()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_count integer;
  v_factor_id uuid;
BEGIN
  -- Pick the right id column for the firing event.
  IF TG_OP = 'DELETE' THEN
    v_factor_id := OLD.id;
  ELSE
    -- For UPDATE, only intervene when this update is the soft-delete flip.
    IF NOT (COALESCE(OLD.is_deleted, false) = false
            AND COALESCE(NEW.is_deleted, false) = true) THEN
      RETURN NEW;
    END IF;
    v_factor_id := NEW.id;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.freight_trip_invoices fti
  JOIN public.freight_trips ft ON ft.id = fti.trip_id
  WHERE fti.factor_id = v_factor_id
    AND fti.is_deleted = false
    AND ft.is_deleted = false
    AND ft.status <> 'cancelled';

  IF v_count > 0 THEN
    RAISE EXCEPTION
      'این فاکتور به % سرویس حمل فعال متصل است. ابتدا اتصال را قطع کنید.', v_count
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$;

CREATE TRIGGER trg_factors_block_delete_if_in_active_trip_upd
  BEFORE UPDATE ON public.factors
  FOR EACH ROW EXECUTE FUNCTION public.tg_block_factor_delete_if_in_active_trip();

CREATE TRIGGER trg_factors_block_delete_if_in_active_trip_del
  BEFORE DELETE ON public.factors
  FOR EACH ROW EXECUTE FUNCTION public.tg_block_factor_delete_if_in_active_trip();
