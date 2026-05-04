// ============================================================
// CertificatesGuard.tsx — Route guard for مدارک و مجوزها.
// Shirdane uses a single-role auth model (no department), so any
// authenticated user can access this page. Adapt later if roles
// are added.
// ============================================================

import { Navigate } from 'react-router-dom';
import { ReactNode } from 'react';
import { useAuth } from '@/contexts/AuthContext';

interface Props {
  children: ReactNode;
}

const CertificatesGuard = ({ children }: Props) => {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
};

export default CertificatesGuard;
