
-- ============================================================
-- 1. fertility_operations
-- ============================================================
CREATE TABLE IF NOT EXISTS public.fertility_operations (
  id smallint PRIMARY KEY,
  name text NOT NULL,
  operation_name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.fertility_operations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read fertility_operations" ON public.fertility_operations FOR SELECT USING (true);
CREATE POLICY "Allow public insert fertility_operations" ON public.fertility_operations FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update fertility_operations" ON public.fertility_operations FOR UPDATE USING (true);
CREATE POLICY "Allow public delete fertility_operations" ON public.fertility_operations FOR DELETE USING (true);

INSERT INTO public.fertility_operations (id, name, operation_name, sort_order) VALUES
  (1,  'فحلی',                'AddCowErotic',      1),
  (2,  'تلقیح',               'AddCowInoculation', 2),
  (3,  'تست آبستنی اولیه',    'AddCowPregnancy1',  3),
  (4,  'تست آبستنی نهایی',    'AddCowPregnancy2',  4),
  (5,  'سقط',                'AddCowAbortion',    5),
  (6,  'زایش',               'AddCowBirth',       6),
  (7,  'خشک',                'AddCowDry',         7),
  (8,  'شستشو',              'AddCowRinse',       8),
  (10, 'کلین تست',           'AddCowCleanTest',   10),
  (11, 'تست آبستنی تکمیلی',  'AddCowPregnancy3',  11),
  (12, 'تست آبستنی خشکی',    'AddCowPregnancy4',  12),
  (13, 'همزمان سازی فحلی',  'AddCowSync',        13)
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, operation_name = EXCLUDED.operation_name;

-- ============================================================
-- 2. fertility_statuses
-- ============================================================
CREATE TABLE IF NOT EXISTS public.fertility_statuses (
  id smallint PRIMARY KEY,
  name text NOT NULL,
  color text NOT NULL DEFAULT '#888888',
  pregnancy_state text NOT NULL DEFAULT 'unknown', -- unknown/open/pregnant/suspect
  milking_state text NOT NULL DEFAULT 'unknown',   -- unknown/milking/dry
  is_abortion boolean NOT NULL DEFAULT false,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.fertility_statuses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read fertility_statuses" ON public.fertility_statuses FOR SELECT USING (true);
CREATE POLICY "Allow public insert fertility_statuses" ON public.fertility_statuses FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update fertility_statuses" ON public.fertility_statuses FOR UPDATE USING (true);
CREATE POLICY "Allow public delete fertility_statuses" ON public.fertility_statuses FOR DELETE USING (true);

INSERT INTO public.fertility_statuses (id, name, color, pregnancy_state, milking_state, is_abortion, sort_order) VALUES
  (1,  'بدون وضعیت',                       '#9CA3AF', 'unknown',  'unknown', false, 1),
  (2,  'فحل شده',                          '#EC4899', 'open',     'unknown', false, 2),
  (3,  'تلقیح شده',                        '#3B82F6', 'unknown',  'unknown', false, 3),
  (4,  'تست اولیه مثبت',                   '#10B981', 'pregnant', 'unknown', false, 4),
  (5,  'تست اولیه مشکوک',                  '#F59E0B', 'suspect',  'unknown', false, 5),
  (6,  'تست اولیه منفی',                   '#EF4444', 'open',     'unknown', false, 6),
  (7,  'تست نهایی منفی',                   '#DC2626', 'open',     'unknown', false, 7),
  (8,  'آبستن قطعی',                       '#059669', 'pregnant', 'unknown', false, 8),
  (9,  'سقط کرده',                         '#B91C1C', 'open',     'unknown', true,  9),
  (10, 'باز خشک',                          '#92400E', 'open',     'dry',     false, 10),
  (14, 'شستشو شده',                        '#06B6D4', 'unknown',  'unknown', false, 14),
  (15, 'کلین تست مثبت',                    '#0D9488', 'unknown',  'unknown', false, 15),
  (16, 'تست درمان',                        '#F97316', 'unknown',  'unknown', false, 16),
  (17, 'تست تکمیلی منفی',                  '#EF4444', 'open',     'unknown', false, 17),
  (18, 'تست تکمیلی مثبت',                  '#10B981', 'pregnant', 'unknown', false, 18),
  (19, 'تست خشکی منفی',                    '#EF4444', 'open',     'dry',     false, 19),
  (20, 'تست خشکی مثبت',                    '#10B981', 'pregnant', 'dry',     false, 20),
  (21, 'همزمان سازی فحلی',                 '#6366F1', 'unknown',  'unknown', false, 21),
  (22, 'توقف برنامه همزمان سازی فحلی',    '#6B7280', 'unknown',  'unknown', false, 22)
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, color = EXCLUDED.color,
  pregnancy_state = EXCLUDED.pregnancy_state, milking_state = EXCLUDED.milking_state,
  is_abortion = EXCLUDED.is_abortion, sort_order = EXCLUDED.sort_order;

-- ============================================================
-- 3. breeding_workflows
-- ============================================================
CREATE TABLE IF NOT EXISTS public.breeding_workflows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  type text NOT NULL DEFAULT 'WorkFlowFertilityStatus',
  category smallint NOT NULL DEFAULT 0, -- 0=all,1=milk cow,2=heifer,3=male
  start_date text,
  end_date text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.breeding_workflows ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read breeding_workflows" ON public.breeding_workflows FOR SELECT USING (true);
CREATE POLICY "Allow public insert breeding_workflows" ON public.breeding_workflows FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update breeding_workflows" ON public.breeding_workflows FOR UPDATE USING (true);
CREATE POLICY "Allow public delete breeding_workflows" ON public.breeding_workflows FOR DELETE USING (true);

CREATE TRIGGER trg_breeding_workflows_updated
BEFORE UPDATE ON public.breeding_workflows
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- 4. breeding_workflow_rules
-- ============================================================
CREATE TABLE IF NOT EXISTS public.breeding_workflow_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id uuid NOT NULL REFERENCES public.breeding_workflows(id) ON DELETE CASCADE,
  fertility_operation_id smallint NOT NULL REFERENCES public.fertility_operations(id),
  rule_order int NOT NULL DEFAULT 0,
  title text NOT NULL,
  description text,
  alert_enabled boolean NOT NULL DEFAULT false,
  alert_group_id text,
  duration_of_credit int, -- days alert remains valid
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.breeding_workflow_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read breeding_workflow_rules" ON public.breeding_workflow_rules FOR SELECT USING (true);
CREATE POLICY "Allow public insert breeding_workflow_rules" ON public.breeding_workflow_rules FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update breeding_workflow_rules" ON public.breeding_workflow_rules FOR UPDATE USING (true);
CREATE POLICY "Allow public delete breeding_workflow_rules" ON public.breeding_workflow_rules FOR DELETE USING (true);

CREATE INDEX IF NOT EXISTS idx_brw_rules_workflow ON public.breeding_workflow_rules(workflow_id);
CREATE INDEX IF NOT EXISTS idx_brw_rules_op ON public.breeding_workflow_rules(fertility_operation_id);

CREATE TRIGGER trg_breeding_workflow_rules_updated
BEFORE UPDATE ON public.breeding_workflow_rules
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- 5. breeding_workflow_rule_conditions
-- ============================================================
CREATE TABLE IF NOT EXISTS public.breeding_workflow_rule_conditions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id uuid NOT NULL REFERENCES public.breeding_workflow_rules(id) ON DELETE CASCADE,
  condition_type text NOT NULL,
  min_value numeric,
  max_value numeric,
  bool_value boolean,
  text_value text,
  extra_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.breeding_workflow_rule_conditions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read brw_rule_conditions" ON public.breeding_workflow_rule_conditions FOR SELECT USING (true);
CREATE POLICY "Allow public insert brw_rule_conditions" ON public.breeding_workflow_rule_conditions FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update brw_rule_conditions" ON public.breeding_workflow_rule_conditions FOR UPDATE USING (true);
CREATE POLICY "Allow public delete brw_rule_conditions" ON public.breeding_workflow_rule_conditions FOR DELETE USING (true);

CREATE INDEX IF NOT EXISTS idx_brw_cond_rule ON public.breeding_workflow_rule_conditions(rule_id);

-- ============================================================
-- 6. Extend livestock_fertility_events
-- ============================================================
ALTER TABLE public.livestock_fertility_events
  ADD COLUMN IF NOT EXISTS fertility_operation_id smallint REFERENCES public.fertility_operations(id),
  ADD COLUMN IF NOT EXISTS fertility_status_id smallint REFERENCES public.fertility_statuses(id),
  ADD COLUMN IF NOT EXISTS event_time text,
  ADD COLUMN IF NOT EXISTS result_code text,
  ADD COLUMN IF NOT EXISTS created_by uuid;

CREATE INDEX IF NOT EXISTS idx_lfe_cow_date ON public.livestock_fertility_events(livestock_id, event_date);
CREATE INDEX IF NOT EXISTS idx_lfe_op ON public.livestock_fertility_events(fertility_operation_id);

-- ============================================================
-- 7. breeding_alerts
-- ============================================================
CREATE TABLE IF NOT EXISTS public.breeding_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cow_id bigint NOT NULL,
  workflow_id uuid REFERENCES public.breeding_workflows(id) ON DELETE SET NULL,
  rule_id uuid REFERENCES public.breeding_workflow_rules(id) ON DELETE SET NULL,
  fertility_operation_id smallint REFERENCES public.fertility_operations(id),
  title text NOT NULL,
  description text,
  alert_date timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  status text NOT NULL DEFAULT 'open', -- open/done/cancelled/expired
  reference_event_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.breeding_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read breeding_alerts" ON public.breeding_alerts FOR SELECT USING (true);
CREATE POLICY "Allow public insert breeding_alerts" ON public.breeding_alerts FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update breeding_alerts" ON public.breeding_alerts FOR UPDATE USING (true);
CREATE POLICY "Allow public delete breeding_alerts" ON public.breeding_alerts FOR DELETE USING (true);

CREATE INDEX IF NOT EXISTS idx_breeding_alerts_cow ON public.breeding_alerts(cow_id);
CREATE INDEX IF NOT EXISTS idx_breeding_alerts_status ON public.breeding_alerts(status);

-- Unique active alert per cow/rule/reference
CREATE UNIQUE INDEX IF NOT EXISTS uq_breeding_alerts_active
  ON public.breeding_alerts(cow_id, rule_id, COALESCE(reference_event_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE status = 'open';
