
-- Backfill hr_profiles for any app_users that match hr_users by app_username
INSERT INTO public.hr_profiles (user_id, user_name, hr_user_id)
SELECT u.id, COALESCE(u.full_name, u.username), h.id
FROM public.app_users u
JOIN public.hr_users h ON h.app_username = u.username
LEFT JOIN public.hr_profiles p ON p.user_id = u.id
WHERE p.id IS NULL;

-- Backfill hr_user_id on existing profiles missing the link
UPDATE public.hr_profiles p
SET hr_user_id = h.id, updated_at = now()
FROM public.app_users u, public.hr_users h
WHERE p.user_id = u.id
  AND h.app_username = u.username
  AND p.hr_user_id IS NULL;

-- Trigger: when a new app_user is created, auto-create hr_profile if hr_users match exists
CREATE OR REPLACE FUNCTION public.sync_hr_profile_for_app_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hr_id bigint;
BEGIN
  SELECT id INTO v_hr_id FROM public.hr_users WHERE app_username = NEW.username LIMIT 1;
  IF v_hr_id IS NOT NULL THEN
    INSERT INTO public.hr_profiles (user_id, user_name, hr_user_id)
    VALUES (NEW.id, COALESCE(NEW.full_name, NEW.username), v_hr_id)
    ON CONFLICT (user_id) DO UPDATE
      SET hr_user_id = EXCLUDED.hr_user_id,
          user_name = EXCLUDED.user_name,
          updated_at = now();
  END IF;
  RETURN NEW;
END;
$$;

-- Ensure user_id uniqueness for upsert/onConflict
CREATE UNIQUE INDEX IF NOT EXISTS hr_profiles_user_id_key ON public.hr_profiles(user_id);

DROP TRIGGER IF EXISTS trg_sync_hr_profile_app_user ON public.app_users;
CREATE TRIGGER trg_sync_hr_profile_app_user
AFTER INSERT OR UPDATE OF username, full_name ON public.app_users
FOR EACH ROW EXECUTE FUNCTION public.sync_hr_profile_for_app_user();

-- Trigger: when hr_users.app_username changes/inserted, link existing app_user
CREATE OR REPLACE FUNCTION public.sync_hr_profile_for_hr_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user public.app_users%ROWTYPE;
BEGIN
  IF NEW.app_username IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO v_user FROM public.app_users WHERE username = NEW.app_username LIMIT 1;
  IF v_user.id IS NOT NULL THEN
    INSERT INTO public.hr_profiles (user_id, user_name, hr_user_id)
    VALUES (v_user.id, COALESCE(v_user.full_name, v_user.username), NEW.id)
    ON CONFLICT (user_id) DO UPDATE
      SET hr_user_id = EXCLUDED.hr_user_id,
          updated_at = now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_hr_profile_hr_user ON public.hr_users;
CREATE TRIGGER trg_sync_hr_profile_hr_user
AFTER INSERT OR UPDATE OF app_username ON public.hr_users
FOR EACH ROW EXECUTE FUNCTION public.sync_hr_profile_for_hr_user();

-- Keep updated_at fresh on hr_profiles
DROP TRIGGER IF EXISTS trg_hr_profiles_updated_at ON public.hr_profiles;
CREATE TRIGGER trg_hr_profiles_updated_at
BEFORE UPDATE ON public.hr_profiles
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
