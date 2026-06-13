// ============================================================
// HumanResources.tsx
// Main HR module page — circular Shamsi calendar centerpiece,
// On-Call status, and 4 action cards (manual attendance,
// overtime, mission, shift). First-time visitors must answer
// the on-call survey before they can use the module.
// ============================================================

import { useState } from 'react';
import DashboardHeader from '@/components/DashboardHeader';
import CircularCalendar from '@/components/hr/CircularCalendar';
import HrActionCard from '@/components/hr/HrActionCard';
import { AttendanceDialog, OvertimeDialog, HrMissionDialog, ShiftDialog, LeaveDialog } from '@/components/hr/HrEntryDialogs';
import AttendanceReport from '@/components/hr/AttendanceReport';
import { useHrProfile } from '@/hooks/useHrProfile';
import { getShamsiToday, toPersianDigits } from '@/lib/shamsiNow';
import { Clock, CalendarClock, Briefcase, CalendarDays, Plane } from 'lucide-react';

const HumanResources = () => {
  const today = getShamsiToday();
  const { onCallScore } = useHrProfile();

  const [openDialog, setOpenDialog] = useState<null | 'attendance' | 'overtime' | 'mission' | 'shift' | 'leave'>(null);

  return (
    <div className="min-h-screen bg-background">
      <DashboardHeader title="منابع انسانی" />

      <main className="container mx-auto px-3 py-4 md:px-6 md:py-6">
        {/* ============================================================
            Compact hero: circular calendar + summary
        ============================================================ */}
        <section className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-card via-accent/20 to-card p-4 md:p-5 shadow-sm">
          <div className="absolute -top-8 -right-8 h-28 w-28 rounded-full bg-gradient-primary opacity-10 blur-2xl" />
          <div className="absolute -bottom-8 -left-8 h-28 w-28 rounded-full bg-gradient-secondary opacity-10 blur-2xl" />

          <div className="relative flex items-center gap-4 md:gap-6 animate-scale-in">
            <div className="shrink-0">
              <CircularCalendar today={today} onCallScore={onCallScore} />
            </div>

            <div className="flex-1 min-w-0 space-y-3">
              <div>
                <div className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                  امروز
                </div>
                <h2 className="mt-2 text-xl md:text-2xl font-bold text-foreground leading-tight">
                  {today.weekdayName}
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {toPersianDigits(today.formatted)}
                </p>
              </div>

              <div>
                <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-1">
                  <span>پیشرفت ماه</span>
                  <span className="font-semibold text-foreground">
                    {toPersianDigits(Math.round(today.monthProgress * 100))}٪
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-primary to-secondary transition-all duration-1000"
                    style={{ width: `${today.monthProgress * 100}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ============================================================
            Action cards
        ============================================================ */}
        <section className="mt-6">
          <h3 className="mb-3 text-sm font-semibold text-foreground">عملیات‌های منابع انسانی</h3>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5 md:gap-4">
            <HrActionCard
              title="ورود و خروج دستی"
              description="ثبت دستی ساعت ورود و خروج"
              icon={Clock}
              variant="purple"
              onClick={() => setOpenDialog('attendance')}
            />
            <HrActionCard
              title="اضافه‌کاری"
              description="ثبت ساعات اضافه‌کاری"
              icon={CalendarClock}
              variant="orange"
              onClick={() => setOpenDialog('overtime')}
            />
            <HrActionCard
              title="مرخصی"
              description="ثبت مرخصی ساعتی یا روزانه"
              icon={Plane}
              variant="purple"
              onClick={() => setOpenDialog('leave')}
            />
            <HrActionCard
              title="ماموریت"
              description="ثبت ماموریت‌های اداری شخصی"
              icon={Briefcase}
              variant="purple"
              onClick={() => setOpenDialog('mission')}
            />
            <HrActionCard
              title="شیفت"
              description="ثبت و مشاهده شیفت‌های کاری"
              icon={CalendarDays}
              variant="orange"
              onClick={() => setOpenDialog('shift')}
            />
          </div>
        </section>

        {/* ============================================================
            Attendance report (daily breakdown table + per-day details)
        ============================================================ */}
        <AttendanceReport />
      </main>

      {/* Survey disabled */}

      {/* Entry dialogs */}
      <AttendanceDialog open={openDialog === 'attendance'} onOpenChange={(o) => setOpenDialog(o ? 'attendance' : null)} />
      <OvertimeDialog   open={openDialog === 'overtime'}   onOpenChange={(o) => setOpenDialog(o ? 'overtime' : null)} />
      <HrMissionDialog  open={openDialog === 'mission'}    onOpenChange={(o) => setOpenDialog(o ? 'mission' : null)} />
      <ShiftDialog      open={openDialog === 'shift'}      onOpenChange={(o) => setOpenDialog(o ? 'shift' : null)} />
      <LeaveDialog      open={openDialog === 'leave'}      onOpenChange={(o) => setOpenDialog(o ? 'leave' : null)} />
    </div>
  );
};

export default HumanResources;
