-- Concurrency-safe uniqueness for auto-generated sales invoice numbers.
-- Two operators can open "new sales invoice" at the same time and both see
-- the same next number from the client-side max()+1 lookup. To guarantee
-- final uniqueness we add a PARTIAL UNIQUE INDEX scoped to sale-type rows
-- only. Purchase invoices (`buy`, `milk_receipt`, etc.) are untouched —
-- their numbers come from supplier paperwork and may legitimately repeat
-- across different suppliers.
--
-- We use a unique INDEX (not a constraint) so we can scope it with a WHERE
-- clause. NULLs are excluded so legacy / draft rows without a number don't
-- collide. Behavior on conflict: Postgres raises SQLSTATE 23505 which the
-- frontend translates to a Persian error and prompts the user to refresh
-- the auto-generated number.
CREATE UNIQUE INDEX IF NOT EXISTS factors_sales_invoice_number_unique
  ON public.factors (invoice_number)
  WHERE invoice_type IN ('sell', 'retail_sell')
    AND invoice_number IS NOT NULL;