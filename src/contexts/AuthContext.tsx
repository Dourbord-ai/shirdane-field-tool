// ============================================================
// AuthContext — thin wrapper around lib/auth so HR module
// (ported from dorbourdban) can use useAuth() unchanged.
// ============================================================
import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { getSession, isAuthenticated as authed, type User as DbUser } from "@/lib/auth";

interface HrUser {
  id: string;
  username: string;
  fullName: string;
}

interface AuthCtx {
  user: HrUser | null;
  isAuthenticated: boolean;
}

const Ctx = createContext<AuthCtx>({ user: null, isAuthenticated: false });

function adapt(u: DbUser | null): HrUser | null {
  if (!u) return null;
  return { id: u.id, username: u.username, fullName: u.name || u.username };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<HrUser | null>(() => adapt(getSession().user));

  useEffect(() => {
    const onStorage = () => setUser(adapt(getSession().user));
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return (
    <Ctx.Provider value={{ user, isAuthenticated: authed() }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  return useContext(Ctx);
}
