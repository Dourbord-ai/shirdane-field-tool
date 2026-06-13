import React from "react";
import { cn } from "@/lib/utils";

type AmendmentStatus = "draft" | "review" | "approved" | "rejected";

const LABEL: Record<AmendmentStatus, string> = {
  draft:    "پیش‌نویس",
  review:   "در انتظار بررسی",
  approved: "تأیید شده",
  rejected: "رد شده",
};

const COLOR: Record<AmendmentStatus, string> = {
  draft:    "bg-muted text-muted-foreground",
  review:   "bg-yellow-100 text-yellow-800",
  approved: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-800",
};

export function AmendmentStatusBadge({ status, className }: { status: AmendmentStatus; className?: string }) {
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium", COLOR[status], className)}>
      {LABEL[status]}
    </span>
  );
}

export default AmendmentStatusBadge;
