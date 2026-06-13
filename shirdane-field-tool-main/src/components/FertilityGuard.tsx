import { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { getSession } from "@/lib/auth";
import { DEV_ACCESS_MODE } from "@/lib/devAccess";

export default function FertilityGuard({ children }: { children: ReactNode }) {
  const { user } = getSession();
  if (DEV_ACCESS_MODE) return <>{children}</>; // TEMP: dev bypass
  const isAdmin = !!user && (user.isSuperAdmin || user.role === "admin" || user.role === "super_admin");
  if (!user) return <Navigate to="/login" replace />;
  if (!isAdmin) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}
