import { supabase } from "@/integrations/supabase/client";

const TOKEN_KEY = "shirdaneh_token";
const USER_KEY = "shirdaneh_user";

export interface User {
  id: string;
  name: string;
  username: string;
  role?: string;
  isSuperAdmin?: boolean;
}

export interface LoginCredentials {
  username: string;
  password: string;
}

export interface AuthResponse {
  success: boolean;
  token?: string;
  user?: User;
  error?: string;
}

export async function loginApi(credentials: LoginCredentials): Promise<AuthResponse> {
  try {
    const { data, error } = await supabase
      .from("app_users")
      .select("id, username, full_name, password_hash, is_active, role_id, app_roles(name)")
      .eq("username", credentials.username)
      .maybeSingle();

    if (error) {
      return { success: false, error: "خطا در ارتباط با سرور" };
    }
    if (!data) {
      return { success: false, error: "نام کاربری یا رمز عبور اشتباه است" };
    }
    if (!data.is_active) {
      return { success: false, error: "حساب کاربری غیرفعال است" };
    }
    if (data.password_hash !== credentials.password) {
      return { success: false, error: "نام کاربری یا رمز عبور اشتباه است" };
    }

    // Update last_login_at (best-effort)
    supabase
      .from("app_users")
      .update({ last_login_at: new Date().toISOString() })
      .eq("id", data.id)
      .then(() => {});

    const roleName = (data.app_roles as { name?: string } | null)?.name;
    const isSuperAdmin =
      roleName === "super_admin" ||
      roleName === "admin" ||
      data.username === "admin";

    return {
      success: true,
      token: `db-${data.id}`,
      user: {
        id: data.id,
        name: data.full_name || data.username,
        username: data.username,
        role: roleName || undefined,
        isSuperAdmin,
      },
    };
  } catch {
    return { success: false, error: "خطا در ارتباط با سرور" };
  }
}

export function saveSession(token: string, user: User) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function getSession(): { token: string | null; user: User | null } {
  const token = localStorage.getItem(TOKEN_KEY);
  const raw = localStorage.getItem(USER_KEY);
  return { token, user: raw ? JSON.parse(raw) : null };
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function isAuthenticated(): boolean {
  return !!localStorage.getItem(TOKEN_KEY);
}

export function hasRole(role: string): boolean {
  const { user } = getSession();
  if (!user) return false;
  if (user.isSuperAdmin) return true;
  return user.role === role;
}

export function canAccess(_resource?: string): boolean {
  const { user } = getSession();
  if (!user) return false;
  if (user.isSuperAdmin) return true;
  return true;
}
