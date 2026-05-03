// ============================================================
// HrActionCard.tsx
// Compact card for the four HR action buckets:
// ورود و خروج دستی، اضافه‌کاری، ماموریت، شیفت
// ============================================================

import { LucideIcon } from 'lucide-react';

interface Props {
  title: string;
  description: string;
  icon: LucideIcon;
  variant: 'purple' | 'orange';
  onClick: () => void;
}

const HrActionCard = ({ title, description, icon: Icon, variant, onClick }: Props) => {
  const cardClasses = variant === 'purple'
    ? 'card-dashboard card-dashboard-purple'
    : 'card-dashboard card-dashboard-orange';
  const iconBg = variant === 'purple' ? 'bg-gradient-primary' : 'bg-gradient-secondary';

  return (
    <button
      onClick={onClick}
      className={`${cardClasses} cursor-pointer text-right w-full`}
      type="button"
    >
      <div className={`mb-3 inline-flex rounded-2xl ${iconBg} p-3`}>
        <Icon className="h-6 w-6 text-primary-foreground" />
      </div>
      <h3 className="text-lg font-bold text-foreground">{title}</h3>
      <p className="mt-1 text-xs text-muted-foreground leading-6">{description}</p>
    </button>
  );
};

export default HrActionCard;
