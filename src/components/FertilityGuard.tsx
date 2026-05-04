import { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { getSession } from "@/lib/auth";

export default function FertilityGuard({ children }: { children: ReactNode }) {
  const { user } = getSession();
  const isAdmin = !!user && (user.isSuperAdmin || user.role === "admin" || user.role === "super_admin");
  if (!user) return <Navigate to="/login" replace />;
  if (!isAdmin) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}
