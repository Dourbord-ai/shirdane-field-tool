import { cn } from "@/lib/utils";
import {
  formatMoney,
  formatJalaliDateTime,
  formatJalaliDate,
  OP_STATUS_LABEL,
  ASSIGNMENT_STATUS_LABEL,
  SEPIDAR_STATUS_LABEL,
} from "@/lib/finance";

export function MoneyCell({
  value,
  className,
  positive,
  negative,
}: {
  value: number | string | null | undefined;
  className?: string;
  positive?: boolean;
  negative?: boolean;
}) {
  const tone = positive
    ? "text-emerald-700"
    : negative
      ? "text-red-700"
      : "text-foreground";
  return (
    <span className={cn("font-bold tabular-nums tracking-tight", tone, className)}>
      {formatMoney(value)}
    </span>
  );
}

export function JalaliDateCell({
  value,
  withTime = false,
  className,
}: {
  value: string | null | undefined;
  withTime?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("tabular-nums text-sm text-foreground", className)}>
      {withTime ? formatJalaliDateTime(value) : formatJalaliDate(value)}
    </span>
  );
}

const STATUS_TONES: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  pending_approval: "bg-amber-100 text-amber-800",
  pending: "bg-amber-100 text-amber-800",
  approved: "bg-blue-100 text-blue-800",
  posted: "bg-emerald-100 text-emerald-800",
  paid: "bg-emerald-100 text-emerald-800",
  rejected: "bg-red-100 text-red-800",
  cancelled: "bg-red-100 text-red-800",
  deleted: "bg-red-100 text-red-800",
  unassigned: "bg-amber-100 text-amber-800",
  assigned: "bg-emerald-100 text-emerald-800",
  partially_assigned: "bg-blue-100 text-blue-800",
  not_synced: "bg-muted text-muted-foreground",
  syncing: "bg-blue-100 text-blue-800",
  synced: "bg-emerald-100 text-emerald-800",
  failed: "bg-red-100 text-red-800",
  deleted_from_sepidar: "bg-red-100 text-red-800",
};

export function FinanceStatusBadge({ status }: { status: string | null | undefined }) {
  const key = status || "draft";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold",
        STATUS_TONES[key] || "bg-muted text-muted-foreground",
      )}
    >
      {OP_STATUS_LABEL[key] || ASSIGNMENT_STATUS_LABEL[key] || key}
    </span>
  );
}

export function SepidarStatusBadge({ status }: { status: string | null | undefined }) {
  const key = status || "not_synced";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold",
        STATUS_TONES[key] || "bg-muted text-muted-foreground",
      )}
    >
      {SEPIDAR_STATUS_LABEL[key] || key}
    </span>
  );
}
