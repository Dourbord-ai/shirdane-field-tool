-- ============================================================
-- 1. Attach triggers using existing sync functions
-- ============================================================
DROP TRIGGER IF EXISTS trg_sync_hr_profile_for_app_user ON public.app_users;
CREATE TRIGGER trg_sync_hr_profile_for_app_user
AFTER INSERT OR UPDATE OF username, full_name ON public.app_users
FOR EACH ROW EXECUTE FUNCTION public.sync_hr_profile_for_app_user();

DROP TRIGGER IF EXISTS trg_sync_hr_profile_for_hr_user ON public.hr_users;
CREATE TRIGGER trg_sync_hr_profile_for_hr_user
AFTER INSERT OR UPDATE OF app_username ON public.hr_users
FOR EACH ROW EXECUTE FUNCTION public.sync_hr_profile_for_hr_user();

-- ============================================================
-- 2. Manual sync function (callable anytime: SELECT * FROM sync_hr_profiles_from_hr_users();)
-- ============================================================
CREATE OR REPLACE FUNCTION public.sync_hr_profiles_from_hr_users()
RETURNS TABLE(action text, app_user_id uuid, hr_user_id bigint, username text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  v_inserted int := 0;
  v_updated int := 0;
BEGIN
  FOR r IN
    SELECT hu.id AS hr_id, hu.app_username, au.id AS au_id, au.full_name, au.username AS au_username
    FROM public.hr_users hu
    JOIN public.app_users au ON au.username = hu.app_username
    WHERE hu.app_username IS NOT NULL
  LOOP
    INSERT INTO public.hr_profiles (user_id, user_name, hr_user_id)
    VALUES (r.au_id, COALESCE(r.full_name, r.au_username), r.hr_id)
    ON CONFLICT (user_id) DO UPDATE
      SET hr_user_id = EXCLUDED.hr_user_id,
          user_name  = EXCLUDED.user_name,
          updated_at = now();

    action := 'synced';
    app_user_id := r.au_id;
    hr_user_id := r.hr_id;
    username := r.app_username;
    RETURN NEXT;
  END LOOP;
END;
$$;

-- ============================================================
-- 3. Auto-create app_users for hr_users that have no app_user yet
-- ============================================================
CREATE OR REPLACE FUNCTION public.ensure_app_users_for_hr_users(_default_password_hash text DEFAULT 'CHANGE_ME')
RETURNS TABLE(created_username text, hr_user_id bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT hu.id, hu.app_username, hu.first_name, hu.last_name
    FROM public.hr_users hu
    LEFT JOIN public.app_users au ON au.username = hu.app_username
    WHERE hu.app_username IS NOT NULL
      AND au.id IS NULL
  LOOP
    INSERT INTO public.app_users (username, full_name, password_hash, is_active)
    VALUES (
      r.app_username,
      COALESCE(NULLIF(trim(coalesce(r.first_name,'') || ' ' || coalesce(r.last_name,'')), ''), r.app_username),
      _default_password_hash,
      true
    )
    ON CONFLICT (username) DO NOTHING;

    created_username := r.app_username;
    hr_user_id := r.id;
    RETURN NEXT;
  END LOOP;
END;
$$;

-- ============================================================
-- 4. Backfill now
-- ============================================================
SELECT public.ensure_app_users_for_hr_users();
SELECT public.sync_hr_profiles_from_hr_users();