// ============================================================
// AttendanceDetailDialog.tsx
// Per-day attendance details — mirrors the right-hand mockup:
//  - General info (date, weekday, shift, status pill)
//  - Entry / exit pairs (in1/out1, in2/out2, in3/out3, other)
//  - Daily summary card (presence, late, early, leave, shortfall,
//    overtime, mission, worked)
// ============================================================

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ArrowDownCircle, ArrowUpCircle, Info } from 'lucide-react';
import type { AttendanceRecord } from '@/hooks/useAttendanceRecords';
import { displayTime, minutesToHHMM, statusStyles, type AttStatus } from '@/lib/hrFormat';
import { toPersianDigits } from '@/lib/shamsiNow';

interface Props {
  record: AttendanceRecord | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}

const Row = ({ label, time, kind }: { label: string; time?: string | null; kind: 'in' | 'out' | 'other' }) => {
  const Icon = kind === 'in' ? ArrowDownCircle : kind === 'out' ? ArrowUpCircle : Info;
  const iconColor = kind === 'in' ? 'text-emerald-500' : kind === 'out' ? 'text-rose-500' : 'text-sky-500';
  return (
    <div className="flex items-center justify-between border-b border-border/60 py-2.5 last:border-b-0">
      <div className="flex items-center gap-2">
        <Icon className={`h-4 w-4 ${iconColor}`} />
        <span className="text-sm text-muted-foreground">{label}</span>
      </div>
      <span className="font-mono text-sm font-medium text-foreground">{displayTime(time)}</span>
    </div>
  );
};

const SummaryRow = ({ label, value, danger }: { label: string; value: string; danger?: boolean }) => (
  <div className="flex items-center justify-between py-1.5">
    <span className="text-xs text-muted-foreground">{label}</span>
    <span className={`font-mono text-sm font-semibold ${danger ? 'text-destructive' : 'text-foreground'}`}>{value}</span>
  </div>
);

const AttendanceDetailDialog = ({ record, open, onOpenChange }: Props) => {
  if (!record) return null;
  const st = (statusStyles as any)[record.status] || statusStyles['حضور'];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-h-[90vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-center text-base">
            جزئیات تردد — {toPersianDigits(record.date_shamsi)}
          </DialogTitle>
        </DialogHeader>

        {/* اطلاعات کلی */}
        <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <h4 className="mb-3 text-right text-sm font-semibold text-foreground">اطلاعات کلی</h4>
          <div className="space-y-2.5 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">تاریخ</span><span className="font-mono">{toPersianDigits(record.date_shamsi)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">روز</span><span>{record.weekday || '—'}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">شیفت</span><span>{record.shift_type || '—'}</span></div>
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">وضعیت</span>
              <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${st.bg} ${st.text}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />
                {record.status}
              </span>
            </div>
          </div>
        </section>

        {/* نوع تردد */}
        <section className="mt-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
          <h4 className="mb-1 text-right text-sm font-semibold text-foreground">نوع تردد — ساعت</h4>
          <Row label="ورود ۱"  time={record.in1}  kind="in"  />
          <Row label="خروج ۱" time={record.out1} kind="out" />
          <Row label="ورود ۲"  time={record.in2}  kind="in"  />
          <Row label="خروج ۲" time={record.out2} kind="out" />
          <Row label="ورود ۳"  time={record.in3}  kind="in"  />
          <Row label="خروج ۳" time={record.out3} kind="out" />
          <Row label="سایر ترددها" time={record.other_entries} kind="other" />
        </section>

        {/* خلاصه کارکرد */}
        <section className="mt-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
          <h4 className="mb-3 text-right text-sm font-semibold text-foreground">خلاصه کارکرد</h4>
          <div className="grid grid-cols-2 gap-x-6">
            <SummaryRow label="حضور"        value={minutesToHHMM(record.presence_minutes)} />
            <SummaryRow label="تاخیر"       value={minutesToHHMM(record.late_minutes)} danger={record.late_minutes > 0} />
            <SummaryRow label="تعجیل"       value={minutesToHHMM(record.early_leave_minutes)} danger={record.early_leave_minutes > 0} />
            <SummaryRow label="کسر کار"     value={minutesToHHMM(record.shortfall_minutes)} danger={record.shortfall_minutes > 0} />
            <SummaryRow label="مرخصی ساعتی" value={minutesToHHMM(record.hourly_leave_minutes)} />
            <SummaryRow label="اضافه‌کار"   value={minutesToHHMM(record.overtime_minutes)} />
            <SummaryRow label="ماموریت"     value={minutesToHHMM(record.mission_minutes)} />
            <SummaryRow label="کارکرد"      value={minutesToHHMM(record.worked_minutes)} />
          </div>
          {record.notes && (
            <div className="mt-3 rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
              {record.notes}
            </div>
          )}
        </section>
      </DialogContent>
    </Dialog>
  );
};

export default AttendanceDetailDialog;
