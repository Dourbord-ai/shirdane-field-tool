import { CertificateStatus } from '@/hooks/useCertificates';
import { cn } from '@/lib/utils';

interface Props {
  status: CertificateStatus;
  daysRemaining: number | null;
  className?: string;
}

const CONFIG: Record<CertificateStatus, { label: (d: number | null) => string; cls: string }> = {
  valid: {
    label: () => '🟢 معتبر',
    cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  },
  expiring: {
    label: (d) => (d !== null ? `🟡 ${d} روز تا انقضا` : '🟡 نزدیک انقضا'),
    cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  },
  expired: {
    label: () => '🔴 منقضی شده',
    cls: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  },
  none: {
    label: () => 'بدون تاریخ انقضا',
    cls: 'bg-muted text-muted-foreground',
  },
};

const StatusBadge = ({ status, daysRemaining, className }: Props) => {
  const cfg = CONFIG[status];
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium',
        cfg.cls,
        className
      )}
    >
      {cfg.label(daysRemaining)}
    </span>
  );
};

export default StatusBadge;
