-- 1) Add category column to factor_item_type to route parents to product groups
ALTER TABLE public.factor_item_type
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'other';

-- Tag parent id=5 ("معاینات و مشاوره پزشکی") as services examinations
UPDATE public.factor_item_type
SET category = 'services_examinations'
WHERE id = 5;

-- 2) Create wage_items table for اجرت
CREATE TABLE IF NOT EXISTS public.wage_items (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  factor_id uuid NOT NULL,
  purpose text,
  work_mode text,            -- 'daily' or 'contract'
  start_date text,
  end_date text,
  payment_type text,
  daily_amount numeric DEFAULT 0,
  contract_amount numeric DEFAULT 0,
  account_holder text,
  iban_or_card text,
  row_total numeric DEFAULT 0,
  description text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.wage_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read wage_items" ON public.wage_items FOR SELECT USING (true);
CREATE POLICY "Allow public insert wage_items" ON public.wage_items FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update wage_items" ON public.wage_items FOR UPDATE USING (true);
CREATE POLICY "Allow public delete wage_items" ON public.wage_items FOR DELETE USING (true);

-- 3) Create daily_worker_items table for کارگر روز مزد
CREATE TABLE IF NOT EXISTS public.daily_worker_items (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  factor_id uuid NOT NULL,
  purpose text,
  worker_name text,
  days_count numeric DEFAULT 0,
  hours_count numeric DEFAULT 0,
  daily_rate numeric DEFAULT 0,
  hourly_rate numeric DEFAULT 0,
  start_date text,
  end_date text,
  row_total numeric DEFAULT 0,
  description text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.daily_worker_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read daily_worker_items" ON public.daily_worker_items FOR SELECT USING (true);
CREATE POLICY "Allow public insert daily_worker_items" ON public.daily_worker_items FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update daily_worker_items" ON public.daily_worker_items FOR UPDATE USING (true);
CREATE POLICY "Allow public delete daily_worker_items" ON public.daily_worker_items FOR DELETE USING (true);