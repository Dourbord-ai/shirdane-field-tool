-- Task 7 — Freight Trip → Settlement Request integration.
-- Add a nullable FK from freight_trips to finance_payment_requests so that
-- each trip can point to the single settlement request created from its
-- detail page.
--
-- NOTE: This is a 1:1 link. A future enhancement to support MULTIPLE
-- settlement requests per trip (e.g. partial settlements, re-issues after
-- cancellation) will require a dedicated link table
-- (freight_trip_settlement_requests) and dropping this column. Document
-- this on the trip detail page so operators understand the current limit.

ALTER TABLE public.freight_trips
  ADD COLUMN settlement_request_id uuid NULL
    REFERENCES public.finance_payment_requests(id)
    ON DELETE SET NULL;

-- Partial unique index: at most one ACTIVE trip may point to a given
-- settlement request. We exclude soft-deleted trips so that cancelling and
-- recreating remains possible later.
CREATE UNIQUE INDEX ux_freight_trips_settlement_request_active
  ON public.freight_trips (settlement_request_id)
  WHERE settlement_request_id IS NOT NULL AND is_deleted = false;

COMMENT ON COLUMN public.freight_trips.settlement_request_id IS
  'FK to finance_payment_requests. 1:1 link for v1. Future multi-request support will require a dedicated link table.';