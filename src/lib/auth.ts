const TOKEN_KEY = "shirdaneh_token";
const USER_KEY = "shirdaneh_user";

export interface User {
  id: string;
  name: string;
  username: string;
  role?: string;
  isSuperAdmin?: boolean;
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
  // Hardcoded super admin bypasses all restrictions
  if (user.isSuperAdmin) return true;
  return true;
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

// Placeholder API endpoint — replace with real endpoint
const API_BASE = "/api";

export async function loginApi(credentials: LoginCredentials): Promise<AuthResponse> {
  // TODO: Replace with real API call
  // Example:
  // const res = await fetch(`${API_BASE}/auth/login`, {
  //   method: "POST",
  //   headers: { "Content-Type": "application/json" },
  //   body: JSON.stringify(credentials),
  // });
  // return res.json();

  // Simulated response for development
  await new Promise((r) => setTimeout(r, 1200));

  if (credentials.username === "admin" && credentials.password === "1234") {
    return {
      success: true,
      token: "mock-jwt-token-xyz",
      user: { id: "1", name: "مدیر سیستم", username: "admin" },
    };
  }

  return { success: false, error: "نام کاربری یا رمز عبور اشتباه است" };
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
