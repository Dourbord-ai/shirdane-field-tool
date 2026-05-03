
-- ============================================================
-- HR module tables
-- ============================================================

-- 1) hr_users : legacy HR credentials (server-side use only)
CREATE TABLE public.hr_users (
  id bigint PRIMARY KEY,
  username text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  personnel_code text,
  full_name text,
  department text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.hr_users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read hr_users"   ON public.hr_users FOR SELECT TO public USING (true);
CREATE POLICY "Allow public insert hr_users" ON public.hr_users FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "Allow public update hr_users" ON public.hr_users FOR UPDATE TO public USING (true);
CREATE POLICY "Allow public delete hr_users" ON public.hr_users FOR DELETE TO public USING (true);

-- 2) hr_profiles : on-call survey + link to hr_users.id
CREATE TABLE public.hr_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  user_name text NOT NULL,
  hr_user_id bigint,
  on_call_tickets boolean NOT NULL DEFAULT false,
  on_call_colleagues boolean NOT NULL DEFAULT false,
  on_call_representatives boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.hr_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read hr_profiles"   ON public.hr_profiles FOR SELECT TO public USING (true);
CREATE POLICY "Allow public insert hr_profiles" ON public.hr_profiles FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "Allow public update hr_profiles" ON public.hr_profiles FOR UPDATE TO public USING (true);
CREATE POLICY "Allow public delete hr_profiles" ON public.hr_profiles FOR DELETE TO public USING (true);

-- 3) hr_attendance
CREATE TABLE public.hr_attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  user_name text,
  entry_type text NOT NULL,           -- 'check_in' | 'check_out'
  entry_at timestamptz NOT NULL,
  entry_date_shamsi text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.hr_attendance ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read hr_attendance"   ON public.hr_attendance FOR SELECT TO public USING (true);
CREATE POLICY "Allow public insert hr_attendance" ON public.hr_attendance FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "Allow public update hr_attendance" ON public.hr_attendance FOR UPDATE TO public USING (true);
CREATE POLICY "Allow public delete hr_attendance" ON public.hr_attendance FOR DELETE TO public USING (true);

-- 4) hr_overtime
CREATE TABLE public.hr_overtime (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  user_name text,
  date_shamsi text NOT NULL,
  hours numeric NOT NULL DEFAULT 0,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.hr_overtime ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read hr_overtime"   ON public.hr_overtime FOR SELECT TO public USING (true);
CREATE POLICY "Allow public insert hr_overtime" ON public.hr_overtime FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "Allow public update hr_overtime" ON public.hr_overtime FOR UPDATE TO public USING (true);
CREATE POLICY "Allow public delete hr_overtime" ON public.hr_overtime FOR DELETE TO public USING (true);

-- 5) hr_missions
CREATE TABLE public.hr_missions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  user_name text,
  date_shamsi text NOT NULL,
  subject text,
  destination text,
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.hr_missions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read hr_missions"   ON public.hr_missions FOR SELECT TO public USING (true);
CREATE POLICY "Allow public insert hr_missions" ON public.hr_missions FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "Allow public update hr_missions" ON public.hr_missions FOR UPDATE TO public USING (true);
CREATE POLICY "Allow public delete hr_missions" ON public.hr_missions FOR DELETE TO public USING (true);

-- 6) hr_shifts
CREATE TABLE public.hr_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  user_name text,
  shift_date_shamsi text NOT NULL,
  shift_type text,
  start_time text,
  end_time text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.hr_shifts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read hr_shifts"   ON public.hr_shifts FOR SELECT TO public USING (true);
CREATE POLICY "Allow public insert hr_shifts" ON public.hr_shifts FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "Allow public update hr_shifts" ON public.hr_shifts FOR UPDATE TO public USING (true);
CREATE POLICY "Allow public delete hr_shifts" ON public.hr_shifts FOR DELETE TO public USING (true);

-- 7) hr_leave
CREATE TABLE public.hr_leave (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  user_name text,
  leave_kind text NOT NULL,           -- 'hourly' | 'daily'
  leave_type text,                    -- daily-only label
  date_shamsi text,
  from_time text,
  to_time text,
  hours numeric,
  from_date_shamsi text,
  to_date_shamsi text,
  days numeric,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.hr_leave ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read hr_leave"   ON public.hr_leave FOR SELECT TO public USING (true);
CREATE POLICY "Allow public insert hr_leave" ON public.hr_leave FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "Allow public update hr_leave" ON public.hr_leave FOR UPDATE TO public USING (true);
CREATE POLICY "Allow public delete hr_leave" ON public.hr_leave FOR DELETE TO public USING (true);

-- 8) hr_attendance_records
CREATE TABLE public.hr_attendance_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  user_name text,
  date_shamsi text NOT NULL,
  weekday text,
  shift_type text,
  rest_minutes integer NOT NULL DEFAULT 0,
  in1 text, out1 text,
  in2 text, out2 text,
  in3 text, out3 text,
  other_entries text,
  status text NOT NULL DEFAULT 'حضور',
  presence_minutes integer NOT NULL DEFAULT 0,
  hourly_leave_minutes integer NOT NULL DEFAULT 0,
  late_minutes integer NOT NULL DEFAULT 0,
  early_leave_minutes integer NOT NULL DEFAULT 0,
  shortfall_minutes integer NOT NULL DEFAULT 0,
  overtime_minutes integer NOT NULL DEFAULT 0,
  mission_minutes integer NOT NULL DEFAULT 0,
  worked_minutes integer NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, date_shamsi)
);
ALTER TABLE public.hr_attendance_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read hr_attendance_records"   ON public.hr_attendance_records FOR SELECT TO public USING (true);
CREATE POLICY "Allow public insert hr_attendance_records" ON public.hr_attendance_records FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "Allow public update hr_attendance_records" ON public.hr_attendance_records FOR UPDATE TO public USING (true);
CREATE POLICY "Allow public delete hr_attendance_records" ON public.hr_attendance_records FOR DELETE TO public USING (true);

-- 9) hr_notification_alerts
CREATE TABLE public.hr_notification_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  hr_user_id bigint NOT NULL,
  username text NOT NULL,
  alert_date text NOT NULL,
  alert_type text NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  dismissed_until timestamptz,
  last_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hr_user_id, alert_date, alert_type)
);
ALTER TABLE public.hr_notification_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read hr_notification_alerts"   ON public.hr_notification_alerts FOR SELECT TO public USING (true);
CREATE POLICY "Allow public insert hr_notification_alerts" ON public.hr_notification_alerts FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "Allow public update hr_notification_alerts" ON public.hr_notification_alerts FOR UPDATE TO public USING (true);
CREATE POLICY "Allow public delete hr_notification_alerts" ON public.hr_notification_alerts FOR DELETE TO public USING (true);

-- 10) hr_requests_log
CREATE TABLE public.hr_requests_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  hr_user_id bigint,
  request_type text NOT NULL,
  payload jsonb,
  legacy_payload jsonb,
  response jsonb,
  status text NOT NULL DEFAULT 'pending',
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.hr_requests_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read hr_requests_log"   ON public.hr_requests_log FOR SELECT TO public USING (true);
CREATE POLICY "Allow public insert hr_requests_log" ON public.hr_requests_log FOR INSERT TO public WITH CHECK (true);

-- 11) push_subscriptions
CREATE TABLE public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read push_subscriptions"   ON public.push_subscriptions FOR SELECT TO public USING (true);
CREATE POLICY "Allow public insert push_subscriptions" ON public.push_subscriptions FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "Allow public update push_subscriptions" ON public.push_subscriptions FOR UPDATE TO public USING (true);
CREATE POLICY "Allow public delete push_subscriptions" ON public.push_subscriptions FOR DELETE TO public USING (true);

-- updated_at triggers (function already exists)
CREATE TRIGGER trg_hr_users_updated_at              BEFORE UPDATE ON public.hr_users              FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_hr_profiles_updated_at           BEFORE UPDATE ON public.hr_profiles           FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_hr_attendance_records_updated_at BEFORE UPDATE ON public.hr_attendance_records FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_hr_notification_alerts_updated_at BEFORE UPDATE ON public.hr_notification_alerts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- helpful indexes
CREATE INDEX idx_hr_attendance_user        ON public.hr_attendance(user_id, entry_at DESC);
CREATE INDEX idx_hr_overtime_user          ON public.hr_overtime(user_id, created_at DESC);
CREATE INDEX idx_hr_missions_user          ON public.hr_missions(user_id, created_at DESC);
CREATE INDEX idx_hr_shifts_user            ON public.hr_shifts(user_id, created_at DESC);
CREATE INDEX idx_hr_leave_user             ON public.hr_leave(user_id, created_at DESC);
CREATE INDEX idx_hr_alerts_username_status ON public.hr_notification_alerts(username, status);
CREATE INDEX idx_hr_requests_log_user      ON public.hr_requests_log(user_id, created_at DESC);
CREATE INDEX idx_push_subs_user            ON public.push_subscriptions(user_id);
