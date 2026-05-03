// ============================================================
// OnCallSurveyDialog.tsx
// First-time (or editable) survey collecting the 3 on-call
// readiness questions. Persists into hr_profiles.
// ============================================================

import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { toast } from '@/hooks/use-toast';
import { useHrProfile } from '@/hooks/useHrProfile';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When true, dialog cannot be dismissed without answering (first time) */
  required?: boolean;
}

const QUESTIONS: Array<{ key: 'on_call_tickets' | 'on_call_colleagues' | 'on_call_representatives'; label: string }> = [
  { key: 'on_call_tickets',         label: 'آیا قادر به پاسخگویی به تیکت‌ها خارج از تایم کاری هستید؟' },
  { key: 'on_call_colleagues',      label: 'آیا قادر به پاسخگویی به همکاران خارج از تایم کاری هستید؟' },
  { key: 'on_call_representatives', label: 'آیا قادر به پاسخگویی به نمایندگان و مشتریان اختصاصی خارج از تایم کاری هستید؟' },
];

const OnCallSurveyDialog = ({ open, onOpenChange, required = false }: Props) => {
  const { profile, saving, saveAnswers } = useHrProfile();
  const [answers, setAnswers] = useState({
    on_call_tickets: false,
    on_call_colleagues: false,
    on_call_representatives: false,
  });

  useEffect(() => {
    if (profile) {
      setAnswers({
        on_call_tickets: profile.on_call_tickets,
        on_call_colleagues: profile.on_call_colleagues,
        on_call_representatives: profile.on_call_representatives,
      });
    }
  }, [profile]);

  const handleSubmit = async () => {
    const res = await saveAnswers(answers);
    if (res.success) {
      toast({ title: 'ذخیره شد', description: 'پاسخ‌های شما با موفقیت ذخیره شد.' });
      onOpenChange(false);
    } else {
      toast({ title: 'خطا', description: 'ذخیره با خطا مواجه شد.', variant: 'destructive' });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!required || profile) onOpenChange(v); }}>
      <DialogContent className="max-w-lg" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-right">سنجش بهره‌وری و آمادگی</DialogTitle>
          <DialogDescription className="text-right leading-7 text-muted-foreground">
            به دلیل محاسبه دقیق بهره‌وری لطفاً به سؤالات زیر پاسخ دهید.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {QUESTIONS.map((q) => (
            <div key={q.key} className="rounded-xl border border-border bg-card/50 p-4">
              <p className="mb-3 text-sm font-medium text-foreground leading-7">{q.label}</p>
              <RadioGroup
                dir="rtl"
                value={answers[q.key] ? 'yes' : 'no'}
                onValueChange={(v) => setAnswers((prev) => ({ ...prev, [q.key]: v === 'yes' }))}
                className="flex gap-6"
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="yes" id={`${q.key}-yes`} />
                  <Label htmlFor={`${q.key}-yes`} className="cursor-pointer text-sm">بله</Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="no" id={`${q.key}-no`} />
                  <Label htmlFor={`${q.key}-no`} className="cursor-pointer text-sm">خیر</Label>
                </div>
              </RadioGroup>
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button onClick={handleSubmit} disabled={saving} className="btn-primary min-w-32">
            {saving ? 'در حال ذخیره...' : 'ذخیره پاسخ‌ها'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default OnCallSurveyDialog;
