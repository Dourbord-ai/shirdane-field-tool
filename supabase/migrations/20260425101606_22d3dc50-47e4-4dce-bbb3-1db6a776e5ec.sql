
-- 1) Roles catalog
CREATE TABLE public.app_roles (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL UNIQUE,
  display_name text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2) App users
CREATE TABLE public.app_users (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  username text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  full_name text,
  is_active boolean NOT NULL DEFAULT true,
  role_id uuid REFERENCES public.app_roles(id) ON DELETE SET NULL,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_app_users_username ON public.app_users(username);
CREATE INDEX idx_app_users_role_id ON public.app_users(role_id);
CREATE INDEX idx_app_users_is_active ON public.app_users(is_active);

-- 3) Junction table for multi-role support (future extensibility)
CREATE TABLE public.app_user_roles (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES public.app_roles(id) ON DELETE CASCADE,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role_id)
);

CREATE INDEX idx_app_user_roles_user_id ON public.app_user_roles(user_id);
CREATE INDEX idx_app_user_roles_role_id ON public.app_user_roles(role_id);

-- 4) Triggers for updated_at
CREATE TRIGGER trg_app_roles_updated_at
BEFORE UPDATE ON public.app_roles
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_app_users_updated_at
BEFORE UPDATE ON public.app_users
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 5) Enable RLS
ALTER TABLE public.app_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_user_roles ENABLE ROW LEVEL SECURITY;

-- 6) RLS Policies
-- Roles: readable by everyone (catalog data), writable only by service_role
CREATE POLICY "Anyone can read app_roles"
ON public.app_roles FOR SELECT
USING (true);

-- Users: readable by everyone for now (login lookup), writes restricted
CREATE POLICY "Anyone can read app_users"
ON public.app_users FOR SELECT
USING (true);

CREATE POLICY "Anyone can insert app_users"
ON public.app_users FOR INSERT
WITH CHECK (true);

CREATE POLICY "Anyone can update app_users"
ON public.app_users FOR UPDATE
USING (true);

-- User-roles junction
CREATE POLICY "Anyone can read app_user_roles"
ON public.app_user_roles FOR SELECT
USING (true);

CREATE POLICY "Anyone can insert app_user_roles"
ON public.app_user_roles FOR INSERT
WITH CHECK (true);

CREATE POLICY "Anyone can delete app_user_roles"
ON public.app_user_roles FOR DELETE
USING (true);

-- 7) Helper function (security definer to avoid recursion)
CREATE OR REPLACE FUNCTION public.has_app_role(_user_id uuid, _role_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.app_users u
    LEFT JOIN public.app_roles r ON r.id = u.role_id
    LEFT JOIN public.app_user_roles ur ON ur.user_id = u.id
    LEFT JOIN public.app_roles r2 ON r2.id = ur.role_id
    WHERE u.id = _user_id
      AND u.is_active = true
      AND (r.name = _role_name OR r2.name = _role_name)
  );
$$;

-- 8) Seed default roles
INSERT INTO public.app_roles (name, display_name, description) VALUES
  ('super_admin', 'مدیر ارشد', 'دسترسی کامل به تمام بخش‌های سامانه'),
  ('admin',       'مدیر',       'مدیریت سامانه و کاربران'),
  ('manager',     'مدیر بخش',   'مدیریت عملیات روزانه'),
  ('supervisor',  'سرپرست',     'نظارت بر عملیات و تیم‌ها'),
  ('technician',  'تکنسین',     'انجام عملیات فنی'),
  ('maintainer',  'تعمیرکار',   'نگهداری و تعمیرات'),
  ('guard',       'نگهبان',     'کنترل ورود و خروج');
