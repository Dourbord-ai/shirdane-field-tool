// ============================================================
// OnCallStars.tsx
// Displays "On Call" status with up to 3 filled stars derived
// from the user's answers to the on-call readiness questions.
// ============================================================

import { Star, PhoneCall } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Props {
  score: number;        // 0..3
  onEdit?: () => void;
}

const OnCallStars = ({ score, onEdit }: Props) => {
  const safe = Math.max(0, Math.min(3, score));
  return (
    <div className="mx-auto mt-2 flex max-w-sm flex-col items-center gap-2 rounded-2xl border border-border bg-card/70 px-5 py-4 shadow-sm backdrop-blur">
      <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
        <PhoneCall className="h-4 w-4 text-primary" />
        <span>On Call</span>
      </div>
      <div className="flex items-center gap-1.5">
        {[0, 1, 2].map((i) => (
          <Star
            key={i}
            className={
              i < safe
                ? 'h-7 w-7 fill-secondary text-secondary drop-shadow-[0_0_6px_hsl(var(--secondary)/0.6)] transition-all'
                : 'h-7 w-7 text-muted-foreground/40 transition-all'
            }
          />
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {safe === 0 ? 'پاسخگویی خارج از تایم کاری: غیرفعال'
          : safe === 3 ? 'پاسخگویی کامل خارج از ساعات کاری'
          : `پاسخگویی به ${safe} مورد از ۳ مورد`}
      </p>
      {onEdit && (
        <Button variant="ghost" size="sm" onClick={onEdit} className="h-7 px-2 text-xs text-primary">
          ویرایش پاسخ‌ها
        </Button>
      )}
    </div>
  );
};

export default OnCallStars;
