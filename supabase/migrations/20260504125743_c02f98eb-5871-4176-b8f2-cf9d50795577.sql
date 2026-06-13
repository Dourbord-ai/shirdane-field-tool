-- =========================================================
-- 1. WORKFLOWS
-- =========================================================
INSERT INTO public.breeding_workflows (id, name, type, category, is_active)
VALUES
  ('00000000-0000-0000-0000-000000000013'::uuid, 'قوانین باروری تلیسه ها', 'WorkFlowFertilityStatus', 0, true),
  ('00000000-0000-0000-0000-000000000012'::uuid, 'قوانین باروری گاو شیری',  'WorkFlowFertilityStatus', 0, true)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  type = EXCLUDED.type,
  category = EXCLUDED.category,
  is_active = EXCLUDED.is_active,
  updated_at = now();

-- =========================================================
-- 2. RULES (title is NOT NULL → synthesize when missing as "قاعده <legacy_id>")
-- =========================================================
INSERT INTO public.breeding_workflow_rules
  (id, workflow_id, fertility_operation_id, title, description, duration_of_credit, alert_enabled, is_active, rule_order)
VALUES
  -- Workflow 13 (تلیسه)
  ('00000000-0000-0000-0000-000000010079'::uuid, '00000000-0000-0000-0000-000000000013'::uuid, 2,  'قاعده 79', NULL, NULL, false, true, 0),
  ('00000000-0000-0000-0000-000000010078'::uuid, '00000000-0000-0000-0000-000000000013'::uuid, 13, 'قاعده 78', NULL, NULL, false, true, 0),
  ('00000000-0000-0000-0000-000000010076'::uuid, '00000000-0000-0000-0000-000000000013'::uuid, 11, 'تست آبستنی سوم', 'تست آبستنی انجام گردد.', 120, true, true, 0),
  ('00000000-0000-0000-0000-000000010073'::uuid, '00000000-0000-0000-0000-000000000013'::uuid, 8,  'قاعده 73', NULL, NULL, false, true, 0),
  ('00000000-0000-0000-0000-000000010066'::uuid, '00000000-0000-0000-0000-000000000013'::uuid, 6,  'قاعده 66', NULL, NULL, false, true, 0),
  ('00000000-0000-0000-0000-000000010065'::uuid, '00000000-0000-0000-0000-000000000013'::uuid, 5,  'قاعده 65', NULL, NULL, false, true, 0),
  ('00000000-0000-0000-0000-000000010064'::uuid, '00000000-0000-0000-0000-000000000013'::uuid, 2,  'تلقیح تلیسه', 'عملیات تلقیح انجام شود .', 2, true, true, 0),
  ('00000000-0000-0000-0000-000000010063'::uuid, '00000000-0000-0000-0000-000000000013'::uuid, 4,  'تست آبستنی مرحله دوم', 'تست آبستنی مرحله دوم صورت پذیرد .', 97, true, true, 0),
  ('00000000-0000-0000-0000-000000010062'::uuid, '00000000-0000-0000-0000-000000000013'::uuid, 3,  'تست آبستنی اول', 'تست آبستنی دور اول انجام پذیرد .', 74, true, true, 0),
  ('00000000-0000-0000-0000-000000010061'::uuid, '00000000-0000-0000-0000-000000000013'::uuid, 1,  'قاعده 61', NULL, NULL, false, true, 0),
  ('00000000-0000-0000-0000-000000010060'::uuid, '00000000-0000-0000-0000-000000000013'::uuid, 1,  'قاعده 60', NULL, NULL, false, true, 0),
  -- Workflow 12 (گاو شیری)
  ('00000000-0000-0000-0000-000000010080'::uuid, '00000000-0000-0000-0000-000000000012'::uuid, 2,  'قاعده 80', NULL, NULL, false, true, 0),
  ('00000000-0000-0000-0000-000000010077'::uuid, '00000000-0000-0000-0000-000000000012'::uuid, 13, 'قاعده 77', NULL, NULL, false, true, 0),
  ('00000000-0000-0000-0000-000000010075'::uuid, '00000000-0000-0000-0000-000000000012'::uuid, 11, 'تست آبستنی سوم', 'تست آبستنی انجام گردد.', 120, true, true, 0),
  ('00000000-0000-0000-0000-000000010074'::uuid, '00000000-0000-0000-0000-000000000012'::uuid, 10, 'قاعده 74', NULL, NULL, false, true, 0),
  ('00000000-0000-0000-0000-000000010067'::uuid, '00000000-0000-0000-0000-000000000012'::uuid, 8,  'قاعده 67', NULL, NULL, false, true, 0),
  ('00000000-0000-0000-0000-000000010059'::uuid, '00000000-0000-0000-0000-000000000012'::uuid, 6,  'قاعده 59', NULL, NULL, false, true, 0),
  ('00000000-0000-0000-0000-000000010057'::uuid, '00000000-0000-0000-0000-000000000012'::uuid, 5,  'قاعده 57', NULL, NULL, false, true, 0),
  ('00000000-0000-0000-0000-000000010056'::uuid, '00000000-0000-0000-0000-000000000012'::uuid, 4,  'تست آبستنی دوم ', 'تست آبستنی انجام گردد. ', 97, true, true, 0),
  ('00000000-0000-0000-0000-000000010055'::uuid, '00000000-0000-0000-0000-000000000012'::uuid, 3,  'تست آبستنی اول', 'تست آبستنی اول انجام شود . ', 74, true, true, 0),
  ('00000000-0000-0000-0000-000000010054'::uuid, '00000000-0000-0000-0000-000000000012'::uuid, 2,  'تلقیح', 'عملیات تلقیح انجام شود .', 2, true, true, 0),
  ('00000000-0000-0000-0000-000000010053'::uuid, '00000000-0000-0000-0000-000000000012'::uuid, 1,  'قاعده 53', NULL, NULL, false, true, 0)
ON CONFLICT (id) DO UPDATE SET
  workflow_id = EXCLUDED.workflow_id,
  fertility_operation_id = EXCLUDED.fertility_operation_id,
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  duration_of_credit = EXCLUDED.duration_of_credit,
  alert_enabled = EXCLUDED.alert_enabled,
  is_active = EXCLUDED.is_active,
  updated_at = now();

-- =========================================================
-- 3. CONDITIONS — wipe and reinsert for each rule (idempotent)
-- =========================================================
DELETE FROM public.breeding_workflow_rule_conditions
WHERE rule_id IN (
  '00000000-0000-0000-0000-000000010079'::uuid,'00000000-0000-0000-0000-000000010078'::uuid,
  '00000000-0000-0000-0000-000000010076'::uuid,'00000000-0000-0000-0000-000000010073'::uuid,
  '00000000-0000-0000-0000-000000010066'::uuid,'00000000-0000-0000-0000-000000010065'::uuid,
  '00000000-0000-0000-0000-000000010064'::uuid,'00000000-0000-0000-0000-000000010063'::uuid,
  '00000000-0000-0000-0000-000000010062'::uuid,'00000000-0000-0000-0000-000000010061'::uuid,
  '00000000-0000-0000-0000-000000010060'::uuid,'00000000-0000-0000-0000-000000010080'::uuid,
  '00000000-0000-0000-0000-000000010077'::uuid,'00000000-0000-0000-0000-000000010075'::uuid,
  '00000000-0000-0000-0000-000000010074'::uuid,'00000000-0000-0000-0000-000000010067'::uuid,
  '00000000-0000-0000-0000-000000010059'::uuid,'00000000-0000-0000-0000-000000010057'::uuid,
  '00000000-0000-0000-0000-000000010056'::uuid,'00000000-0000-0000-0000-000000010055'::uuid,
  '00000000-0000-0000-0000-000000010054'::uuid,'00000000-0000-0000-0000-000000010053'::uuid
);

INSERT INTO public.breeding_workflow_rule_conditions
  (rule_id, condition_type, min_value, max_value, bool_value, text_value, extra_json)
VALUES
  ('00000000-0000-0000-0000-000000010079'::uuid, 'Sync',            0,   0,    true,  NULL, '{}'::jsonb),
  ('00000000-0000-0000-0000-000000010079'::uuid, 'FertilityStatus', NULL, NULL, NULL, NULL, '{"status_ids":[21]}'::jsonb),
  ('00000000-0000-0000-0000-000000010078'::uuid, 'IsPregnancy',     NULL, NULL, false, NULL, '{}'::jsonb),
  ('00000000-0000-0000-0000-000000010078'::uuid, 'FertilityStatus', NULL, NULL, NULL, NULL, '{"status_ids":[1,6,7,9,14,15,17,22]}'::jsonb),
  ('00000000-0000-0000-0000-000000010076'::uuid, 'Inoculation',     125, 350,  NULL, NULL, '{}'::jsonb),
  ('00000000-0000-0000-0000-000000010076'::uuid, 'FertilityStatus', NULL, NULL, NULL, NULL, '{"status_ids":[3,4,5,8,18]}'::jsonb),
  ('00000000-0000-0000-0000-000000010073'::uuid, 'IsPregnancy',     NULL, NULL, false, NULL, '{}'::jsonb),
  ('00000000-0000-0000-0000-000000010066'::uuid, 'Inoculation',     211, 350,  NULL, NULL, '{}'::jsonb),
  ('00000000-0000-0000-0000-000000010066'::uuid, 'FertilityStatus', NULL, NULL, NULL, NULL, '{"status_ids":[3,4,5,8,18,20]}'::jsonb),
  ('00000000-0000-0000-0000-000000010065'::uuid, 'Inoculation',     55,  350,  NULL, NULL, '{}'::jsonb),
  ('00000000-0000-0000-0000-000000010065'::uuid, 'FertilityStatus', NULL, NULL, NULL, NULL, '{"status_ids":[3,4,5,8,18]}'::jsonb),
  ('00000000-0000-0000-0000-000000010064'::uuid, 'Erotic',          0,   1,    NULL, NULL, '{}'::jsonb),
  ('00000000-0000-0000-0000-000000010064'::uuid, 'FertilityStatus', NULL, NULL, NULL, NULL, '{"status_ids":[2]}'::jsonb),
  ('00000000-0000-0000-0000-000000010063'::uuid, 'Inoculation',     57,  350,  NULL, NULL, '{}'::jsonb),
  ('00000000-0000-0000-0000-000000010063'::uuid, 'FertilityStatus', NULL, NULL, NULL, NULL, '{"status_ids":[3,4,5,8]}'::jsonb),
  ('00000000-0000-0000-0000-000000010062'::uuid, 'Inoculation',     28,  350,  NULL, NULL, '{}'::jsonb),
  ('00000000-0000-0000-0000-000000010062'::uuid, 'FertilityStatus', NULL, NULL, NULL, NULL, '{"status_ids":[3,4,5]}'::jsonb),
  ('00000000-0000-0000-0000-000000010061'::uuid, 'DateOfBirth',     330, 3000, NULL, NULL, '{}'::jsonb),
  ('00000000-0000-0000-0000-000000010061'::uuid, 'FertilityStatus', NULL, NULL, NULL, NULL, '{"status_ids":[1,2,3,4,5,6,7,9,14,17,18]}'::jsonb),
  ('00000000-0000-0000-0000-000000010060'::uuid, 'Weight',          350, 650,  NULL, NULL, '{}'::jsonb),
  ('00000000-0000-0000-0000-000000010060'::uuid, 'FertilityStatus', NULL, NULL, NULL, NULL, '{"status_ids":[1,2,3,4,5,6,7,9,14,15,17,18]}'::jsonb),
  ('00000000-0000-0000-0000-000000010080'::uuid, 'Sync',            0,   0,    true,  NULL, '{}'::jsonb),
  ('00000000-0000-0000-0000-000000010080'::uuid, 'FertilityStatus', NULL, NULL, NULL, NULL, '{"status_ids":[21]}'::jsonb),
  ('00000000-0000-0000-0000-000000010077'::uuid, 'IsPregnancy',     NULL, NULL, false, NULL, '{}'::jsonb),
  ('00000000-0000-0000-0000-000000010077'::uuid, 'FertilityStatus', NULL, NULL, NULL, NULL, '{"status_ids":[1,6,7,9,14,15,17,22]}'::jsonb),
  ('00000000-0000-0000-0000-000000010075'::uuid, 'Inoculation',     125, 350,  NULL, NULL, '{}'::jsonb),
  ('00000000-0000-0000-0000-000000010075'::uuid, 'FertilityStatus', NULL, NULL, NULL, NULL, '{"status_ids":[3,4,5,8,18]}'::jsonb),
  ('00000000-0000-0000-0000-000000010074'::uuid, 'Birth',           5,   5000, NULL, NULL, '{}'::jsonb),
  ('00000000-0000-0000-0000-000000010074'::uuid, 'FertilityStatus', NULL, NULL, NULL, NULL, '{"status_ids":[2,9,12,14,15,16]}'::jsonb),
  ('00000000-0000-0000-0000-000000010067'::uuid, 'IsPregnancy',     NULL, NULL, false, NULL, '{}'::jsonb),
  ('00000000-0000-0000-0000-000000010059'::uuid, 'Inoculation',     211, 350,  NULL, NULL, '{}'::jsonb),
  ('00000000-0000-0000-0000-000000010059'::uuid, 'FertilityStatus', NULL, NULL, NULL, NULL, '{"status_ids":[3,4,5,8,18,20]}'::jsonb),
  ('00000000-0000-0000-0000-000000010057'::uuid, 'Inoculation',     55,  350,  NULL, NULL, '{}'::jsonb),
  ('00000000-0000-0000-0000-000000010057'::uuid, 'FertilityStatus', NULL, NULL, NULL, NULL, '{"status_ids":[3,4,5,8,18]}'::jsonb),
  ('00000000-0000-0000-0000-000000010056'::uuid, 'Inoculation',     57,  350,  NULL, NULL, '{}'::jsonb),
  ('00000000-0000-0000-0000-000000010056'::uuid, 'FertilityStatus', NULL, NULL, NULL, NULL, '{"status_ids":[3,4,5,8]}'::jsonb),
  ('00000000-0000-0000-0000-000000010055'::uuid, 'Inoculation',     28,  350,  NULL, NULL, '{}'::jsonb),
  ('00000000-0000-0000-0000-000000010055'::uuid, 'FertilityStatus', NULL, NULL, NULL, NULL, '{"status_ids":[3,4,5]}'::jsonb),
  ('00000000-0000-0000-0000-000000010054'::uuid, 'Erotic',          0,   1,    NULL, NULL, '{}'::jsonb),
  ('00000000-0000-0000-0000-000000010054'::uuid, 'Birth',           20,  2000, NULL, NULL, '{}'::jsonb),
  ('00000000-0000-0000-0000-000000010054'::uuid, 'FertilityStatus', NULL, NULL, NULL, NULL, '{"status_ids":[2]}'::jsonb),
  ('00000000-0000-0000-0000-000000010053'::uuid, 'Birth',           10,  500,  NULL, NULL, '{}'::jsonb),
  ('00000000-0000-0000-0000-000000010053'::uuid, 'FertilityStatus', NULL, NULL, NULL, NULL, '{"status_ids":[2,3,4,5,6,7,8,9,12,14,15,17,18,21,22]}'::jsonb);
