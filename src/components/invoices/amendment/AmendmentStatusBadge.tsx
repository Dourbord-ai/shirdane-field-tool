// =============================================================================
// components/invoices/amendment/AmendmentStatusBadge.tsx
// -----------------------------------------------------------------------------
// نمایش وضعیت یک Amendment به‌صورت badge رنگی با آیکون
// =============================================================================

import React from "react";
import { FileEdit, Clock, CheckCircle2, XCircle } from "lucide-react";

import {
  AmendmentStatus,
  AMENDMENT_STATUS_LABEL,
  AMENDMENT_STATUS_COLOR,
} from "@/lib/finance/amendment";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface AmendmentStatusBadgeProps {
  status: AmendmentStatus;
  showIcon?: boolean;
  className?: string;
}

// ---------------------------------------------------------------------------
// Icon map
// ---------------------------------------------------------------------------

const STATUS_ICON: Record<AmendmentStatus, React.ReactNode> = {
  draft:    <FileEdit    className="w-3.5 h-3.5" />,
  review:   <Clock       className="w-3.5 h-3.5" />,
  approved: <CheckCircle2 className="w-3.5 h-3.5" />,
  rejected: <XCircle    className="w-3.5 h-3.5" />,
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AmendmentStatusBadge({
  status,
  showIcon = true,
  className,
}: AmendmentStatusBadgeProps) {
  const label = AMENDMENT_STATUS_LABEL[status] ?? status;
  const color = AMENDMENT_STATUS_COLOR[status] ?? "bg-gray-100 text-gray-700";
  const icon  = STATUS_ICON[status];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium",
        color,
        className,
      )}
    >
      {showIcon && icon}
      {label}
    </span>
  );
}

export default AmendmentStatusBadge;

