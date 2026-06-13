// ============================================================
// HrEntryDialogs.tsx
// Four lightweight entry dialogs for the HR module:
//  - Manual check-in / check-out  (hr_attendance)
//  - Overtime                      (hr_overtime)
//  - Mission                       (hr_missions)
//  - Shift                         (hr_shifts)
// Each dialog also lists the user's recent entries below the form.
// ============================================================

import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import ShamsiDatePicker from '@/components/ShamsiDatePicker';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/hooks/use-toast';
import { getShamsiToday, toPersianDigits } from '@/lib/shamsiNow';
import jalaali from '@/lib/jalaali';
import { LogIn, LogOut, Clock, Briefcase, CalendarClock, CalendarDays, Loader2, MessageSquare, Plane, CalendarRange, MapPin, Building2, Route } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { submitHrRequest } from '@/lib/hrRequests';

// Build an ISO timestamp from a Shamsi date "YYYY/MM/DD" + "HH:MM" time.
const shamsiDateTimeToISO = (dateShamsi: string, time: string): string | null => {
  const dm = dateShamsi.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  const tm = time.match(/^(\d{1,2}):(\d{2})$/);
  if (!dm || !tm) return null;
  const g = jalaali.toGregorian(Number(dm[1]), Number(dm[2]), Number(dm[3]));
  const d = new Date(g.gy, g.gm - 1, g.gd, Number(tm[1]), Number(tm[2]), 0);
  return d.toISOString();
};

const nowHHMM = (): string => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

type Role = 'attendance' | 'overtime' | 'mission' | 'shift' | 'leave';

interface BaseProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}

const labelFor: Record<Role, { title: string; desc: string }> = {
  attendance: { title: 'ورود و خروج دستی', desc: 'ثبت دستی ساعت ورود و خروج برای روزهای خاص.' },
  overtime:   { title: 'ثبت اضافه‌کاری',   desc: 'ساعات اضافه‌کاری انجام‌شده را ثبت کنید.' },
  mission:    { title: 'ماموریت کاری',     desc: 'ماموریت خارج از دفتر را ثبت کنید.' },
  shift:      { title: 'ثبت شیفت کاری',    desc: 'شیفت خود را برای روزهای آینده اعلام کنید.' },
  leave:      { title: 'ثبت مرخصی',        desc: 'درخواست مرخصی ساعتی یا روزانه را ثبت کنید.' },
};

// ============================================================
// Attendance dialog (check-in / check-out)
// ============================================================

export const AttendanceDialog = ({ open, onOpenChange }: BaseProps) => {
  const { user } = useAuth();
  const today = getShamsiToday();
  const [type, setType] = useState<'check_in' | 'check_out'>('check_in');
  const [dateShamsi, setDateShamsi] = useState<string>(today.formatted);
  const [time, setTime] = useState<string>(nowHHMM());
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [recent, setRecent] = useState<any[]>([]);

  // Reset fields each time dialog opens — and refresh "now"
  useEffect(() => {
    if (open) {
      const t = getShamsiToday();
      setType('check_in');
      setDateShamsi(t.formatted);
      setTime(nowHHMM());
      setReason('');
      loadRecent();
    }
  }, [open]);

  const loadRecent = async () => {
    if (!user?.id) return;
    const { data } = await supabase
      .from('hr_attendance')
      .select('*')
      .eq('user_id', user.id)
      .order('entry_at', { ascending: false })
      .limit(5);
    setRecent(data || []);
  };

  const isCheckIn = type === 'check_in';
  const accent = isCheckIn ? 'primary' : 'secondary';
  const canSubmit = !!dateShamsi && /^\d{1,2}:\d{2}$/.test(time) && reason.trim().length > 0 && !saving;

  const submit = async () => {
    if (!user?.id || !canSubmit) return;
    const iso = shamsiDateTimeToISO(dateShamsi, time);
    if (!iso) {
      toast({ title: 'خطا', description: 'تاریخ یا ساعت نامعتبر است.', variant: 'destructive' });
      return;
    }
    setSaving(true);

    // Send to legacy HR API first.
    const legacy = await submitHrRequest({
      type: 'manual_traffic',
      appUserId: user.id,
      payload: {
        Date1: dateShamsi,
        Time: time,
        TrafficFor: 1, // 1 = فراموشی ثبت تردد
        TrafficType: isCheckIn ? 1 : 0, // 1=ورود, 0=خروج
        DescriptionOfReq: reason.trim(),
      },
    });

    if (!legacy.success) {
      setSaving(false);
      toast({ title: 'خطا', description: legacy.error || 'ارسال به سامانه HR ناموفق بود.', variant: 'destructive' });
      return;
    }

    // Mirror locally for audit/UX (recent list).
    const { error } = await supabase.from('hr_attendance').insert({
      user_id: user.id,
      user_name: user.fullName || user.username,
      entry_type: type,
      entry_at: iso,
      entry_date_shamsi: dateShamsi,
      notes: reason.trim(),
    });
    setSaving(false);
    if (error) {
      toast({ title: 'هشدار', description: 'در سامانه HR ثبت شد ولی ثبت محلی ناموفق بود.', variant: 'destructive' });
    } else {
      toast({ title: 'ثبت شد', description: legacy.message || (isCheckIn ? 'ورود ثبت شد.' : 'خروج ثبت شد.') });
    }
    setReason('');
    loadRecent();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-right">
            <Clock className="h-5 w-5 text-primary" />
            {labelFor.attendance.title}
          </DialogTitle>
          <DialogDescription className="text-right">{labelFor.attendance.desc}</DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Type selector — segmented, large touch targets */}
          <div>
            <Label className="mb-2 block text-sm font-medium">نوع ثبت</Label>
            <RadioGroup
              dir="rtl"
              value={type}
              onValueChange={(v) => setType(v as any)}
              className="grid grid-cols-2 gap-3"
            >
              <label
                className={`group relative flex cursor-pointer flex-col items-center gap-1.5 rounded-xl border-2 p-4 transition-all ${
                  isCheckIn
                    ? 'border-primary bg-primary/10 shadow-sm ring-2 ring-primary/20'
                    : 'border-border hover:border-primary/40 hover:bg-primary/5'
                }`}
              >
                <RadioGroupItem value="check_in" className="sr-only" />
                <LogIn className={`h-6 w-6 ${isCheckIn ? 'text-primary' : 'text-muted-foreground'}`} />
                <span className={`text-sm font-semibold ${isCheckIn ? 'text-primary' : 'text-foreground'}`}>ورود</span>
              </label>
              <label
                className={`group relative flex cursor-pointer flex-col items-center gap-1.5 rounded-xl border-2 p-4 transition-all ${
                  !isCheckIn
                    ? 'border-secondary bg-secondary/10 shadow-sm ring-2 ring-secondary/20'
                    : 'border-border hover:border-secondary/40 hover:bg-secondary/5'
                }`}
              >
                <RadioGroupItem value="check_out" className="sr-only" />
                <LogOut className={`h-6 w-6 ${!isCheckIn ? 'text-secondary' : 'text-muted-foreground'}`} />
                <span className={`text-sm font-semibold ${!isCheckIn ? 'text-secondary' : 'text-foreground'}`}>خروج</span>
              </label>
            </RadioGroup>
          </div>

          {/* Conditional fields — same shape, label changes by type */}
          <div className={`rounded-xl border-2 border-dashed p-4 transition-colors ${
            isCheckIn ? 'border-primary/30 bg-primary/5' : 'border-secondary/30 bg-secondary/5'
          }`}>
            <div className="mb-3 flex items-center gap-2">
              {isCheckIn ? <LogIn className="h-4 w-4 text-primary" /> : <LogOut className="h-4 w-4 text-secondary" />}
              <span className={`text-sm font-semibold ${isCheckIn ? 'text-primary' : 'text-secondary'}`}>
                {isCheckIn ? 'اطلاعات ورود' : 'اطلاعات خروج'}
              </span>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <Label className="mb-1 flex items-center gap-1.5 text-xs font-medium">
                  <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
                  {isCheckIn ? 'تاریخ ورود' : 'تاریخ خروج'}
                  <span className="text-destructive">*</span>
                </Label>
                <ShamsiDatePicker value={dateShamsi} onChange={setDateShamsi} />
              </div>
              <div>
                <Label className="mb-1 flex items-center gap-1.5 text-xs font-medium">
                  <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                  {isCheckIn ? 'ساعت ورود' : 'ساعت خروج'}
                  <span className="text-destructive">*</span>
                </Label>
                <Input
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  className="text-center font-mono text-base"
                />
              </div>
            </div>

            <div className="mt-3">
              <Label className="mb-1 flex items-center gap-1.5 text-xs font-medium">
                <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
                دلیل
                <span className="text-destructive">*</span>
              </Label>
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={isCheckIn ? 'مثلاً: ورود زودهنگام برای جلسه' : 'مثلاً: خروج زودهنگام به دلیل ماموریت'}
                rows={2}
                maxLength={500}
              />
              <p className="mt-1 text-left text-[10px] text-muted-foreground">
                {toPersianDigits(reason.length)}/{toPersianDigits(500)}
              </p>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            onClick={submit}
            disabled={!canSubmit}
            className={`min-w-32 ${isCheckIn ? 'btn-primary' : 'bg-secondary text-secondary-foreground hover:bg-secondary/90'}`}
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : isCheckIn ? (
              <><LogIn className="ml-1 h-4 w-4" /> ثبت ورود</>
            ) : (
              <><LogOut className="ml-1 h-4 w-4" /> ثبت خروج</>
            )}
          </Button>
        </DialogFooter>

        <RecentList items={recent} render={(r) => (
          <span>
            {r.entry_type === 'check_in' ? '🟢 ورود' : '🔴 خروج'} — {toPersianDigits(r.entry_date_shamsi || '')}
            {r.entry_at && ` · ${toPersianDigits(new Date(r.entry_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }))}`}
          </span>
        )} />
      </DialogContent>
    </Dialog>
  );
};

// ============================================================
// Overtime dialog
// ============================================================
// Compute decimal hours between two HH:MM strings (handles overnight by adding 24h).
const diffHours = (from: string, to: string): number | null => {
  const fm = from.match(/^(\d{1,2}):(\d{2})$/);
  const tm = to.match(/^(\d{1,2}):(\d{2})$/);
  if (!fm || !tm) return null;
  const fMin = Number(fm[1]) * 60 + Number(fm[2]);
  let tMin = Number(tm[1]) * 60 + Number(tm[2]);
  if (tMin <= fMin) tMin += 24 * 60; // overnight
  return Math.round(((tMin - fMin) / 60) * 100) / 100;
};

const formatHoursLabel = (h: number): string => {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  if (mm === 0) return `${toPersianDigits(hh)} ساعت`;
  if (hh === 0) return `${toPersianDigits(mm)} دقیقه`;
  return `${toPersianDigits(hh)} ساعت و ${toPersianDigits(mm)} دقیقه`;
};

export const OvertimeDialog = ({ open, onOpenChange }: BaseProps) => {
  const { user } = useAuth();
  const today = getShamsiToday();
  const [dateShamsi, setDateShamsi] = useState<string>(today.formatted);
  const [fromTime, setFromTime] = useState<string>('17:00');
  const [toTime, setToTime] = useState<string>('19:00');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [recent, setRecent] = useState<any[]>([]);

  useEffect(() => {
    if (open) {
      const t = getShamsiToday();
      setDateShamsi(t.formatted);
      setFromTime('17:00');
      setToTime('19:00');
      setReason('');
      loadRecent();
    }
  }, [open]);

  const loadRecent = async () => {
    if (!user?.id) return;
    const { data } = await supabase
      .from('hr_overtime')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(5);
    setRecent(data || []);
  };

  const computedHours = useMemo(() => diffHours(fromTime, toTime), [fromTime, toTime]);
  const validTimes = computedHours !== null && computedHours > 0;
  const canSubmit = !!dateShamsi && validTimes && reason.trim().length > 0 && !saving;

  const submit = async () => {
    if (!user?.id || !canSubmit || computedHours === null) return;
    setSaving(true);

    const legacy = await submitHrRequest({
      type: 'overtime',
      appUserId: user.id,
      payload: {
        Date1: dateShamsi,
        StartTime: fromTime,
        EndTime: toTime,
        DescriptionOfReq: reason.trim(),
      },
    });

    if (!legacy.success) {
      setSaving(false);
      toast({ title: 'خطا', description: legacy.error || 'ارسال به سامانه HR ناموفق بود.', variant: 'destructive' });
      return;
    }

    const composedReason = `از ساعت ${fromTime} تا ${toTime} — ${reason.trim()}`;
    const { error } = await supabase.from('hr_overtime').insert({
      user_id: user.id,
      user_name: user.fullName || user.username,
      date_shamsi: dateShamsi,
      hours: computedHours,
      reason: composedReason,
    });
    setSaving(false);
    if (error) {
      toast({ title: 'هشدار', description: 'در سامانه HR ثبت شد ولی ثبت محلی ناموفق بود.', variant: 'destructive' });
    } else {
      toast({ title: 'ثبت شد', description: legacy.message || `اضافه‌کاری ${formatHoursLabel(computedHours)} ثبت شد.` });
    }
    setReason('');
    loadRecent();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-right">
            <CalendarClock className="h-5 w-5 text-secondary" />
            {labelFor.overtime.title}
          </DialogTitle>
          <DialogDescription className="text-right">{labelFor.overtime.desc}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Date */}
          <div className="rounded-xl border-2 border-dashed border-secondary/30 bg-secondary/5 p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CalendarClock className="h-4 w-4 text-secondary" />
                <span className="text-sm font-semibold text-secondary">اطلاعات اضافه‌کاری</span>
              </div>
              {validTimes && (
                <span className="rounded-full bg-secondary/15 px-2.5 py-1 text-[11px] font-semibold text-secondary">
                  {formatHoursLabel(computedHours!)}
                </span>
              )}
            </div>

            <div className="space-y-3">
              <div>
                <Label className="mb-1 flex items-center gap-1.5 text-xs font-medium">
                  <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
                  تاریخ اضافه‌کاری
                  <span className="text-destructive">*</span>
                </Label>
                <ShamsiDatePicker value={dateShamsi} onChange={setDateShamsi} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="mb-1 flex items-center gap-1.5 text-xs font-medium">
                    <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                    از ساعت
                    <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    type="time"
                    value={fromTime}
                    onChange={(e) => setFromTime(e.target.value)}
                    className="text-center font-mono text-base"
                  />
                </div>
                <div>
                  <Label className="mb-1 flex items-center gap-1.5 text-xs font-medium">
                    <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                    تا ساعت
                    <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    type="time"
                    value={toTime}
                    onChange={(e) => setToTime(e.target.value)}
                    className="text-center font-mono text-base"
                  />
                </div>
              </div>

              {!validTimes && (fromTime && toTime) && (
                <p className="text-[11px] text-destructive">ساعت پایان باید بعد از ساعت شروع باشد.</p>
              )}

              <div>
                <Label className="mb-1 flex items-center gap-1.5 text-xs font-medium">
                  <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
                  دلیل
                  <span className="text-destructive">*</span>
                </Label>
                <Textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="مثلاً: انجام پروژه فوری مشتری"
                  rows={2}
                  maxLength={500}
                />
                <p className="mt-1 text-left text-[10px] text-muted-foreground">
                  {toPersianDigits(reason.length)}/{toPersianDigits(500)}
                </p>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            onClick={submit}
            disabled={!canSubmit}
            className="min-w-32 bg-secondary text-secondary-foreground hover:bg-secondary/90"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <><CalendarClock className="ml-1 h-4 w-4" /> ثبت اضافه‌کاری</>
            )}
          </Button>
        </DialogFooter>

        <RecentList items={recent} render={(r) => (
          <span>
            {toPersianDigits(r.date_shamsi)} — {formatHoursLabel(Number(r.hours))}
            {r.reason && <span className="text-muted-foreground"> · {r.reason}</span>}
          </span>
        )} />
      </DialogContent>
    </Dialog>
  );
};

// ============================================================
// Mission dialog
// Hourly / Daily mission with location-type classification.
// Persists into existing hr_missions schema:
//   - subject       : "ماموریت {ساعتی|روزانه} - {locationTypeLabel}"
//   - date_shamsi   : start date (Shamsi)
//   - destination   : mission location text
//   - description   : composed metadata + reason
// ============================================================

const LOCATION_TYPES = [
  { value: 'intracity',         label: 'درون شهری',                      icon: Building2 },
  { value: 'intercity_lt70',    label: 'برون شهری زیر ۷۰ کیلومتر',       icon: Route },
  { value: 'intercity_70_200',  label: 'برون شهری از ۷۰ تا ۲۰۰ کیلومتر', icon: Route },
  { value: 'intercity_gt200',   label: 'برون شهری بالای ۲۰۰ کیلومتر',    icon: Route },
] as const;

export const HrMissionDialog = ({ open, onOpenChange }: BaseProps) => {
  const { user } = useAuth();
  const today = getShamsiToday();

  const [kind, setKind] = useState<'hourly' | 'daily'>('hourly');

  // Hourly fields
  const [dateShamsi, setDateShamsi] = useState<string>(today.formatted);
  const [fromTime, setFromTime] = useState<string>('09:00');
  const [toTime, setToTime] = useState<string>('12:00');

  // Daily fields
  const [fromDate, setFromDate] = useState<string>(today.formatted);
  const [toDate, setToDate] = useState<string>(today.formatted);

  // Common
  const [locationType, setLocationType] = useState<typeof LOCATION_TYPES[number]['value']>('intracity');
  const [location, setLocation] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [recent, setRecent] = useState<any[]>([]);

  useEffect(() => {
    if (open) {
      const t = getShamsiToday();
      setKind('hourly');
      setDateShamsi(t.formatted);
      setFromTime('09:00');
      setToTime('12:00');
      setFromDate(t.formatted);
      setToDate(t.formatted);
      setLocationType('intracity');
      setLocation('');
      setReason('');
      loadRecent();
    }
  }, [open]);

  const loadRecent = async () => {
    if (!user?.id) return;
    const { data } = await supabase
      .from('hr_missions')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(5);
    setRecent(data || []);
  };

  const computedHours = useMemo(
    () => (kind === 'hourly' ? diffHours(fromTime, toTime) : null),
    [kind, fromTime, toTime],
  );
  const computedDays = useMemo(
    () => (kind === 'daily' ? diffDaysInclusive(fromDate, toDate) : null),
    [kind, fromDate, toDate],
  );

  const locationLabel = LOCATION_TYPES.find((l) => l.value === locationType)?.label || '';

  const canSubmit = (() => {
    if (saving) return false;
    if (!location.trim() || !reason.trim()) return false;
    if (kind === 'hourly') {
      return !!dateShamsi && computedHours !== null && computedHours > 0;
    }
    return !!fromDate && !!toDate && computedDays !== null && computedDays > 0;
  })();

  const submit = async () => {
    if (!user?.id || !canSubmit) return;
    setSaving(true);

    const kindLabel = kind === 'hourly' ? 'ساعتی' : 'روزانه';
    const subject = `ماموریت ${kindLabel} - ${locationLabel}`;

    // Map UI location types -> legacy LocationType (1=داخل شهر, 2=خارج شهر)
    const legacyLocationType = locationType === 'intracity' ? 1 : 2;

    const legacyPayload: Record<string, any> =
      kind === 'hourly'
        ? {
            TypeOfMission: true,
            Date1: dateShamsi,
            StartTime: fromTime,
            EndTime: toTime,
            LocationType: legacyLocationType,
            Location: location.trim(),
            DescriptionOfReq: `${locationLabel} — ${reason.trim()}`,
          }
        : {
            TypeOfMission: false,
            StartDate: fromDate,
            EndDate: toDate,
            LocationType: legacyLocationType,
            Location: location.trim(),
            DescriptionOfReq: `${locationLabel} — ${reason.trim()}`,
          };

    const legacy = await submitHrRequest({
      type: 'mission',
      appUserId: user.id,
      payload: legacyPayload,
    });

    if (!legacy.success) {
      setSaving(false);
      toast({ title: 'خطا', description: legacy.error || 'ارسال به سامانه HR ناموفق بود.', variant: 'destructive' });
      return;
    }

    const metaLines: string[] = [];
    metaLines.push(`نوع ماموریت: ${kindLabel}`);
    metaLines.push(`نوع محل ماموریت: ${locationLabel}`);
    if (kind === 'hourly') {
      metaLines.push(`تاریخ: ${dateShamsi}`);
      metaLines.push(`از ساعت ${fromTime} تا ${toTime} (${formatHoursLabel(computedHours!)})`);
    } else {
      metaLines.push(`از تاریخ ${fromDate} تا تاریخ ${toDate} (${toPersianDigits(computedDays!)} روز)`);
    }
    metaLines.push('');
    metaLines.push(`دلیل: ${reason.trim()}`);

    const { error } = await supabase.from('hr_missions').insert({
      user_id: user.id,
      user_name: user.fullName || user.username,
      date_shamsi: kind === 'hourly' ? dateShamsi : fromDate,
      subject,
      destination: location.trim(),
      description: metaLines.join('\n'),
    });

    setSaving(false);
    if (error) {
      toast({ title: 'هشدار', description: 'در سامانه HR ثبت شد ولی ثبت محلی ناموفق بود.', variant: 'destructive' });
    } else {
      toast({ title: 'ثبت شد', description: legacy.message || 'ماموریت ثبت شد.' });
    }
    setReason('');
    setLocation('');
    loadRecent();
  };

  const accentClass = 'text-primary';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-right">
            <Briefcase className={`h-5 w-5 ${accentClass}`} />
            {labelFor.mission.title}
          </DialogTitle>
          <DialogDescription className="text-right">{labelFor.mission.desc}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Mission kind tabs */}
          <div>
            <Label className="mb-2 block text-sm font-medium">نوع ماموریت</Label>
            <Tabs value={kind} onValueChange={(v) => setKind(v as any)} dir="rtl">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="hourly" className="gap-1.5">
                  <Clock className="h-4 w-4" /> ساعتی
                </TabsTrigger>
                <TabsTrigger value="daily" className="gap-1.5">
                  <CalendarRange className="h-4 w-4" /> روزانه
                </TabsTrigger>
              </TabsList>

              {/* HOURLY */}
              <TabsContent value="hourly" className="mt-3">
                <div className="rounded-xl border-2 border-dashed border-primary/30 bg-primary/5 p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Clock className="h-4 w-4 text-primary" />
                      <span className="text-sm font-semibold text-primary">ماموریت ساعتی</span>
                    </div>
                    {computedHours !== null && computedHours > 0 && (
                      <span className="rounded-full bg-primary/15 px-2.5 py-1 text-[11px] font-semibold text-primary">
                        {formatHoursLabel(computedHours)}
                      </span>
                    )}
                  </div>

                  <div className="space-y-3">
                    <div>
                      <Label className="mb-1 flex items-center gap-1.5 text-xs font-medium">
                        <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
                        تاریخ ماموریت <span className="text-destructive">*</span>
                      </Label>
                      <ShamsiDatePicker value={dateShamsi} onChange={setDateShamsi} />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="mb-1 flex items-center gap-1.5 text-xs font-medium">
                          <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                          از ساعت <span className="text-destructive">*</span>
                        </Label>
                        <Input
                          type="time"
                          value={fromTime}
                          onChange={(e) => setFromTime(e.target.value)}
                          className="text-center font-mono text-base"
                        />
                      </div>
                      <div>
                        <Label className="mb-1 flex items-center gap-1.5 text-xs font-medium">
                          <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                          تا ساعت <span className="text-destructive">*</span>
                        </Label>
                        <Input
                          type="time"
                          value={toTime}
                          onChange={(e) => setToTime(e.target.value)}
                          className="text-center font-mono text-base"
                        />
                      </div>
                    </div>

                    {computedHours !== null && computedHours <= 0 && (
                      <p className="text-[11px] text-destructive">ساعت پایان باید بعد از ساعت شروع باشد.</p>
                    )}
                  </div>
                </div>
              </TabsContent>

              {/* DAILY */}
              <TabsContent value="daily" className="mt-3">
                <div className="rounded-xl border-2 border-dashed border-primary/30 bg-primary/5 p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <CalendarRange className="h-4 w-4 text-primary" />
                      <span className="text-sm font-semibold text-primary">ماموریت روزانه</span>
                    </div>
                    {computedDays !== null && computedDays > 0 && (
                      <span className="rounded-full bg-primary/15 px-2.5 py-1 text-[11px] font-semibold text-primary">
                        {toPersianDigits(computedDays)} روز
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div>
                      <Label className="mb-1 flex items-center gap-1.5 text-xs font-medium">
                        <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
                        از تاریخ <span className="text-destructive">*</span>
                      </Label>
                      <ShamsiDatePicker value={fromDate} onChange={setFromDate} />
                    </div>
                    <div>
                      <Label className="mb-1 flex items-center gap-1.5 text-xs font-medium">
                        <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
                        تا تاریخ <span className="text-destructive">*</span>
                      </Label>
                      <ShamsiDatePicker value={toDate} onChange={setToDate} />
                    </div>
                  </div>

                  {computedDays !== null && computedDays <= 0 && (
                    <p className="mt-2 text-[11px] text-destructive">تاریخ پایان باید بعد از تاریخ شروع باشد.</p>
                  )}
                </div>
              </TabsContent>
            </Tabs>
          </div>

          {/* Location type — segmented chips */}
          <div>
            <Label className="mb-2 block text-sm font-medium">نوع محل ماموریت <span className="text-destructive">*</span></Label>
            <div className="grid grid-cols-2 gap-2">
              {LOCATION_TYPES.map((opt) => {
                const Icon = opt.icon;
                const active = locationType === opt.value;
                return (
                  <button
                    type="button"
                    key={opt.value}
                    onClick={() => setLocationType(opt.value)}
                    className={`flex items-center gap-2 rounded-lg border-2 p-2.5 text-right text-xs font-medium transition-all ${
                      active
                        ? 'border-primary bg-primary/10 text-primary shadow-sm ring-2 ring-primary/20'
                        : 'border-border bg-background text-foreground hover:border-primary/40 hover:bg-primary/5'
                    }`}
                  >
                    <Icon className={`h-4 w-4 shrink-0 ${active ? 'text-primary' : 'text-muted-foreground'}`} />
                    <span className="leading-tight">{opt.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Location text */}
          <div>
            <Label className="mb-1 flex items-center gap-1.5 text-sm font-medium">
              <MapPin className="h-4 w-4 text-muted-foreground" />
              محل ماموریت <span className="text-destructive">*</span>
            </Label>
            <Input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="مثلاً: دفتر مرکزی - خیابان آزادی"
              maxLength={200}
            />
          </div>

          {/* Reason */}
          <div>
            <Label className="mb-1 flex items-center gap-1.5 text-sm font-medium">
              <MessageSquare className="h-4 w-4 text-muted-foreground" />
              دلیل <span className="text-destructive">*</span>
            </Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="مثلاً: جلسه با مشتری برای بررسی پروژه"
              rows={3}
              maxLength={500}
            />
            <p className="mt-1 text-left text-[10px] text-muted-foreground">
              {toPersianDigits(reason.length)}/{toPersianDigits(500)}
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button onClick={submit} disabled={!canSubmit} className="btn-primary min-w-32">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : (
              <><Briefcase className="ml-1 h-4 w-4" /> ثبت ماموریت</>
            )}
          </Button>
        </DialogFooter>

        <RecentList items={recent} render={(r) => (
          <span>{toPersianDigits(r.date_shamsi)} — {r.subject}</span>
        )} />
      </DialogContent>
    </Dialog>
  );
};

// ============================================================
// Shift dialog
// ============================================================
type ShiftKind = 'عادی' | 'جمعه کاری' | 'تعطیل کاری';

// Returns the next 7 Shamsi dates starting from tomorrow (formatted "YYYY/MM/DD")
const nextNShamsiDates = (n: number): string[] => {
  const out: string[] = [];
  const base = new Date();
  for (let i = 1; i <= n; i++) {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i);
    const j = jalaali.toJalaali(d.getFullYear(), d.getMonth() + 1, d.getDate());
    out.push(`${j.jy}/${String(j.jm).padStart(2, '0')}/${String(j.jd).padStart(2, '0')}`);
  }
  return out;
};

export const ShiftDialog = ({ open, onOpenChange }: BaseProps) => {
  const { user } = useAuth();
  const today = getShamsiToday();

  const [shiftKind, setShiftKind] = useState<ShiftKind>('عادی');
  const [shiftDate, setShiftDate] = useState<string>(today.formatted);
  const [start, setStart] = useState('08:00');
  const [end, setEnd] = useState('17:00');
  const [isNight, setIsNight] = useState<'yes' | 'no'>('no');
  const [breakFrom, setBreakFrom] = useState('');
  const [breakTo, setBreakTo] = useState('');
  const [reason, setReason] = useState('');
  const [altDate, setAltDate] = useState<string>(''); // alternate holiday date for جمعه کاری

  const [saving, setSaving] = useState(false);
  const [recent, setRecent] = useState<any[]>([]);

  const allowedAltDates = useMemo(() => nextNShamsiDates(7), [open]);

  useEffect(() => {
    if (open) {
      const t = getShamsiToday();
      setShiftKind('عادی');
      setShiftDate(t.formatted);
      setStart('08:00'); setEnd('17:00');
      setIsNight('no');
      setBreakFrom(''); setBreakTo('');
      setReason('');
      setAltDate('');
      loadRecent();
    }
  }, [open]);

  const loadRecent = async () => {
    if (!user?.id) return;
    const { data } = await supabase
      .from('hr_shifts')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(5);
    setRecent(data || []);
  };

  const canSubmit =
    !!shiftDate &&
    !!start && !!end &&
    reason.trim().length > 0 &&
    (shiftKind !== 'جمعه کاری' || !!altDate) &&
    !saving;

  const submit = async () => {
    if (!user?.id || !canSubmit) return;
    setSaving(true);

    // Build a compact structured note so we don't change the table schema.
    const noteParts: string[] = [
      `نوع: ${shiftKind}`,
      `شیفت شب: ${isNight === 'yes' ? 'بلی' : 'خیر'}`,
    ];
    if (breakFrom && breakTo) noteParts.push(`استراحت: ${breakFrom}-${breakTo}`);
    if (shiftKind === 'جمعه کاری' && altDate) noteParts.push(`تعطیل جایگزین: ${altDate}`);
    if (reason.trim()) noteParts.push(`دلیل: ${reason.trim()}`);
    const composedNotes = noteParts.join(' | ');

    // Try legacy bridge first (best-effort; still write local audit row even if it fails).
    const legacy = await submitHrRequest({
      type: 'exception_shift',
      appUserId: user.id,
      payload: {
        Date1: shiftDate,
        ShiftType: shiftKind === 'عادی' ? 1 : shiftKind === 'جمعه کاری' ? 2 : 3,
        StartTime: start,
        EndTime: end,
        IsNightShift: isNight === 'yes',
        BreakStart: breakFrom || null,
        BreakEnd: breakTo || null,
        AlternateShiftDate: shiftKind === 'جمعه کاری' ? altDate : null,
        DescriptionOfReq: reason.trim(),
      },
    });

    const { error } = await supabase.from('hr_shifts').insert({
      user_id: user.id,
      user_name: user.fullName || user.username,
      shift_date_shamsi: shiftDate,
      shift_type: shiftKind,
      start_time: start,
      end_time: end,
      notes: composedNotes,
    });

    setSaving(false);

    if (error) {
      toast({ title: 'خطا', description: error.message, variant: 'destructive' });
      return;
    }
    if (!legacy.success) {
      toast({
        title: 'ثبت شد (هشدار)',
        description: legacy.error || legacy.message || 'ارسال به سامانه HR موفق نبود.',
      });
    } else {
      toast({ title: 'ثبت شد', description: 'شیفت ثبت شد.' });
    }
    loadRecent();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-right">
            <CalendarClock className="h-5 w-5 text-secondary" />
            {labelFor.shift.title}
          </DialogTitle>
          <DialogDescription className="text-right">{labelFor.shift.desc}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* نوع شیفت */}
          <div>
            <Label className="mb-2 block text-sm">نوع شیفت</Label>
            <RadioGroup
              value={shiftKind}
              onValueChange={(v) => { setShiftKind(v as ShiftKind); setAltDate(''); }}
              className="grid grid-cols-3 gap-2"
            >
              {(['عادی', 'جمعه کاری', 'تعطیل کاری'] as ShiftKind[]).map((k) => (
                <label
                  key={k}
                  className={`flex items-center justify-center gap-2 rounded-lg border p-2 cursor-pointer text-sm transition-colors ${
                    shiftKind === k ? 'border-secondary bg-secondary/10 text-secondary font-medium' : 'border-border hover:bg-accent'
                  }`}
                >
                  <RadioGroupItem value={k} className="sr-only" />
                  {k}
                </label>
              ))}
            </RadioGroup>
          </div>

          {/* تاریخ شیفت */}
          <div>
            <Label className="mb-1 block text-sm">تاریخ شیفت</Label>
            <ShamsiDatePicker value={shiftDate} onChange={setShiftDate} />
          </div>

          {/* شیفت: از / تا */}
          <div>
            <Label className="mb-1 block text-sm">شیفت</Label>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="mb-1 block text-xs text-muted-foreground">از ساعت</Label>
                <Input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
              </div>
              <div>
                <Label className="mb-1 block text-xs text-muted-foreground">تا ساعت</Label>
                <Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
              </div>
            </div>
          </div>

          {/* شیفت شب */}
          <div>
            <Label className="mb-2 block text-sm">شیفت شب</Label>
            <RadioGroup
              value={isNight}
              onValueChange={(v) => setIsNight(v as 'yes' | 'no')}
              className="grid grid-cols-2 gap-2"
            >
              {([
                { v: 'yes', label: 'بلی' },
                { v: 'no', label: 'خیر' },
              ] as const).map((o) => (
                <label
                  key={o.v}
                  className={`flex items-center justify-center gap-2 rounded-lg border p-2 cursor-pointer text-sm transition-colors ${
                    isNight === o.v ? 'border-primary bg-primary/10 text-primary font-medium' : 'border-border hover:bg-accent'
                  }`}
                >
                  <RadioGroupItem value={o.v} className="sr-only" />
                  {o.label}
                </label>
              ))}
            </RadioGroup>
          </div>

          {/* بازه استراحت */}
          <div>
            <Label className="mb-1 block text-sm">بازه استراحت</Label>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="mb-1 block text-xs text-muted-foreground">از ساعت</Label>
                <Input type="time" value={breakFrom} onChange={(e) => setBreakFrom(e.target.value)} />
              </div>
              <div>
                <Label className="mb-1 block text-xs text-muted-foreground">تا ساعت</Label>
                <Input type="time" value={breakTo} onChange={(e) => setBreakTo(e.target.value)} />
              </div>
            </div>
          </div>

          {/* Conditional: alternate holiday date for جمعه کاری */}
          {shiftKind === 'جمعه کاری' && (
            <div className="rounded-lg border border-secondary/30 bg-secondary/5 p-3">
              <Label className="mb-2 block text-sm font-medium text-secondary">
                تایم تعطیل جایگزین خود را تا هفت روز آینده انتخاب کنید
              </Label>
              <Select value={altDate} onValueChange={setAltDate}>
                <SelectTrigger><SelectValue placeholder="انتخاب تاریخ جایگزین" /></SelectTrigger>
                <SelectContent>
                  {allowedAltDates.map((d) => (
                    <SelectItem key={d} value={d}>{toPersianDigits(d)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Conditional notice for تعطیل کاری */}
          {shiftKind === 'تعطیل کاری' && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              امکان انتخاب تایم تعطیل جایگزین وجود ندارد
            </div>
          )}

          {/* دلیل */}
          <div>
            <Label className="mb-1 block text-sm">دلیل</Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="دلیل ثبت شیفت را وارد کنید"
              rows={3}
              maxLength={500}
            />
            <p className="mt-1 text-left text-[10px] text-muted-foreground">
              {toPersianDigits(reason.length)}/{toPersianDigits(500)}
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button onClick={submit} disabled={!canSubmit} className="btn-primary min-w-32">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : (
              <><CalendarClock className="ml-1 h-4 w-4" /> ثبت شیفت</>
            )}
          </Button>
        </DialogFooter>

        <RecentList items={recent} render={(r) => (
          <span>{toPersianDigits(r.shift_date_shamsi)} — {r.shift_type} ({toPersianDigits(r.start_time || '')}–{toPersianDigits(r.end_time || '')})</span>
        )} />
      </DialogContent>
    </Dialog>
  );
};

// ============================================================
// Leave dialog (مرخصی) — hourly + daily tabs
// ============================================================

const DAILY_LEAVE_TYPES = [
  { value: 'استحقاقی',          label: 'استحقاقی',          desc: 'مرخصی روزانه استحقاقی' },
  { value: 'استحقاقی اضطراری', label: 'استحقاقی اضطراری', desc: 'مرخصی استحقاقی فوری/اضطراری' },
  { value: 'بدون حقوق',         label: 'بدون حقوق',         desc: 'مرخصی بدون حقوق' },
  { value: 'موارد خاص',         label: 'موارد خاص',         desc: 'سایر موارد خاص' },
] as const;

// Convert Shamsi YYYY/MM/DD → Date (00:00 local).
const shamsiToDate = (s: string): Date | null => {
  const m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (!m) return null;
  const g = jalaali.toGregorian(Number(m[1]), Number(m[2]), Number(m[3]));
  return new Date(g.gy, g.gm - 1, g.gd);
};

// Inclusive day-count between two Shamsi dates.
const diffDaysInclusive = (from: string, to: string): number | null => {
  const a = shamsiToDate(from);
  const b = shamsiToDate(to);
  if (!a || !b) return null;
  const ms = b.getTime() - a.getTime();
  if (ms < 0) return null;
  return Math.round(ms / 86400000) + 1;
};

export const LeaveDialog = ({ open, onOpenChange }: BaseProps) => {
  const { user } = useAuth();
  const today = getShamsiToday();

  const [kind, setKind] = useState<'hourly' | 'daily'>('hourly');

  // Hourly state
  const [hDate, setHDate] = useState<string>(today.formatted);
  const [hFrom, setHFrom] = useState<string>('09:00');
  const [hTo, setHTo]     = useState<string>('11:00');
  const [hReason, setHReason] = useState('');

  // Daily state
  const [dType, setDType] = useState<string>('استحقاقی');
  const [dFromDate, setDFromDate] = useState<string>(today.formatted);
  const [dToDate, setDToDate]     = useState<string>(today.formatted);
  const [dReason, setDReason] = useState('');

  const [saving, setSaving] = useState(false);
  const [recent, setRecent] = useState<any[]>([]);

  useEffect(() => {
    if (open) {
      const t = getShamsiToday();
      setKind('hourly');
      setHDate(t.formatted); setHFrom('09:00'); setHTo('11:00'); setHReason('');
      setDType('استحقاقی'); setDFromDate(t.formatted); setDToDate(t.formatted); setDReason('');
      loadRecent();
    }
  }, [open]);

  const loadRecent = async () => {
    if (!user?.id) return;
    const { data } = await supabase
      .from('hr_leave')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(5);
    setRecent(data || []);
  };

  const isHourly = kind === 'hourly';
  const accentClass = isHourly ? 'text-primary' : 'text-secondary';
  const accentBorder = isHourly ? 'border-primary/30 bg-primary/5' : 'border-secondary/30 bg-secondary/5';

  const computedHours = useMemo(() => diffHours(hFrom, hTo), [hFrom, hTo]);
  const computedDays  = useMemo(() => diffDaysInclusive(dFromDate, dToDate), [dFromDate, dToDate]);

  const canSubmitHourly = !!hDate && computedHours !== null && computedHours > 0 && hReason.trim().length > 0 && !saving;
  const canSubmitDaily  = !!dType && !!dFromDate && !!dToDate && computedDays !== null && computedDays > 0 && dReason.trim().length > 0 && !saving;
  const canSubmit = isHourly ? canSubmitHourly : canSubmitDaily;

  const submit = async () => {
    if (!user?.id || !canSubmit) return;
    setSaving(true);

    // Map UI leave_type -> legacy TypeOfFalseLeave (1=استحقاقی, 2=استعلاجی, 3=بدون حقوق, 4=سایر)
    const leaveTypeMap: Record<string, number> = {
      'استحقاقی': 1,
      'استحقاقی اضطراری': 1,
      'بدون حقوق': 3,
      'موارد خاص': 4,
    };

    const legacyPayload: Record<string, any> = isHourly
      ? {
          TypeOfLeave: true,
          Date1: hDate,
          StartTime: hFrom,
          EndTime: hTo,
          DescriptionOfReq: hReason.trim(),
        }
      : {
          TypeOfLeave: false,
          TypeOfFalseLeave: leaveTypeMap[dType] ?? 4,
          StartDate: dFromDate,
          EndDate: dToDate,
          DescriptionOfReq: dReason.trim(),
        };

    const legacy = await submitHrRequest({
      type: 'leave',
      appUserId: user.id,
      payload: legacyPayload,
    });

    if (!legacy.success) {
      setSaving(false);
      toast({ title: 'خطا', description: legacy.error || 'ارسال به سامانه HR ناموفق بود.', variant: 'destructive' });
      return;
    }

    const payload = isHourly
      ? {
          user_id: user.id,
          user_name: user.fullName || user.username,
          leave_kind: 'hourly',
          date_shamsi: hDate,
          from_time: hFrom,
          to_time: hTo,
          hours: computedHours!,
          reason: hReason.trim(),
        }
      : {
          user_id: user.id,
          user_name: user.fullName || user.username,
          leave_kind: 'daily',
          leave_type: dType,
          from_date_shamsi: dFromDate,
          to_date_shamsi: dToDate,
          days: computedDays!,
          reason: dReason.trim(),
        };
    const { error } = await supabase.from('hr_leave').insert(payload as any);
    setSaving(false);
    if (error) {
      toast({ title: 'هشدار', description: 'در سامانه HR ثبت شد ولی ثبت محلی ناموفق بود.', variant: 'destructive' });
    } else {
      toast({
        title: 'ثبت شد',
        description: legacy.message || (isHourly
          ? `مرخصی ساعتی ${formatHoursLabel(computedHours!)} ثبت شد.`
          : `مرخصی روزانه ${toPersianDigits(computedDays!)} روز ثبت شد.`),
      });
    }
    if (isHourly) setHReason(''); else setDReason('');
    loadRecent();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-right">
            <Plane className={`h-5 w-5 ${accentClass}`} />
            {labelFor.leave.title}
          </DialogTitle>
          <DialogDescription className="text-right">{labelFor.leave.desc}</DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Kind selector — segmented */}
          <div>
            <Label className="mb-2 block text-sm font-medium">نوع مرخصی</Label>
            <RadioGroup
              dir="rtl"
              value={kind}
              onValueChange={(v) => setKind(v as any)}
              className="grid grid-cols-2 gap-3"
            >
              <label
                className={`group relative flex cursor-pointer flex-col items-center gap-1.5 rounded-xl border-2 p-4 transition-all ${
                  isHourly
                    ? 'border-primary bg-primary/10 shadow-sm ring-2 ring-primary/20'
                    : 'border-border hover:border-primary/40 hover:bg-primary/5'
                }`}
              >
                <RadioGroupItem value="hourly" className="sr-only" />
                <Clock className={`h-6 w-6 ${isHourly ? 'text-primary' : 'text-muted-foreground'}`} />
                <span className={`text-sm font-semibold ${isHourly ? 'text-primary' : 'text-foreground'}`}>ساعتی</span>
              </label>
              <label
                className={`group relative flex cursor-pointer flex-col items-center gap-1.5 rounded-xl border-2 p-4 transition-all ${
                  !isHourly
                    ? 'border-secondary bg-secondary/10 shadow-sm ring-2 ring-secondary/20'
                    : 'border-border hover:border-secondary/40 hover:bg-secondary/5'
                }`}
              >
                <RadioGroupItem value="daily" className="sr-only" />
                <CalendarRange className={`h-6 w-6 ${!isHourly ? 'text-secondary' : 'text-muted-foreground'}`} />
                <span className={`text-sm font-semibold ${!isHourly ? 'text-secondary' : 'text-foreground'}`}>روزانه</span>
              </label>
            </RadioGroup>
          </div>

          {/* Conditional body */}
          <div className={`rounded-xl border-2 border-dashed p-4 transition-colors ${accentBorder}`}>
            {isHourly ? (
              <>
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-primary" />
                    <span className="text-sm font-semibold text-primary">مرخصی ساعتی</span>
                  </div>
                  {computedHours !== null && computedHours > 0 && (
                    <span className="rounded-full bg-primary/15 px-2.5 py-1 text-[11px] font-semibold text-primary">
                      {formatHoursLabel(computedHours)}
                    </span>
                  )}
                </div>

                <div className="space-y-3">
                  <div>
                    <Label className="mb-1 flex items-center gap-1.5 text-xs font-medium">
                      <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
                      تاریخ
                      <span className="text-destructive">*</span>
                    </Label>
                    <ShamsiDatePicker value={hDate} onChange={setHDate} />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="mb-1 flex items-center gap-1.5 text-xs font-medium">
                        <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                        از ساعت
                        <span className="text-destructive">*</span>
                      </Label>
                      <Input
                        type="time"
                        value={hFrom}
                        onChange={(e) => setHFrom(e.target.value)}
                        className="text-center font-mono text-base"
                      />
                    </div>
                    <div>
                      <Label className="mb-1 flex items-center gap-1.5 text-xs font-medium">
                        <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                        تا ساعت
                        <span className="text-destructive">*</span>
                      </Label>
                      <Input
                        type="time"
                        value={hTo}
                        onChange={(e) => setHTo(e.target.value)}
                        className="text-center font-mono text-base"
                      />
                    </div>
                  </div>

                  {(computedHours === null || computedHours <= 0) && hFrom && hTo && (
                    <p className="text-[11px] text-destructive">ساعت پایان باید بعد از ساعت شروع باشد.</p>
                  )}

                  <div>
                    <Label className="mb-1 flex items-center gap-1.5 text-xs font-medium">
                      <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
                      دلیل
                      <span className="text-destructive">*</span>
                    </Label>
                    <Textarea
                      value={hReason}
                      onChange={(e) => setHReason(e.target.value)}
                      placeholder="مثلاً: مراجعه به پزشک"
                      rows={2}
                      maxLength={500}
                    />
                    <p className="mt-1 text-left text-[10px] text-muted-foreground">
                      {toPersianDigits(hReason.length)}/{toPersianDigits(500)}
                    </p>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CalendarRange className="h-4 w-4 text-secondary" />
                    <span className="text-sm font-semibold text-secondary">مرخصی روزانه</span>
                  </div>
                  {computedDays !== null && computedDays > 0 && (
                    <span className="rounded-full bg-secondary/15 px-2.5 py-1 text-[11px] font-semibold text-secondary">
                      {toPersianDigits(computedDays)} روز
                    </span>
                  )}
                </div>

                <div className="space-y-3">
                  {/* Leave type chips */}
                  <div>
                    <Label className="mb-2 block text-xs font-medium">
                      نوع مرخصی <span className="text-destructive">*</span>
                    </Label>
                    <div className="grid grid-cols-2 gap-2">
                      {DAILY_LEAVE_TYPES.map((opt) => {
                        const active = dType === opt.value;
                        return (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => setDType(opt.value)}
                            className={`rounded-lg border-2 p-2.5 text-right transition-all ${
                              active
                                ? 'border-secondary bg-secondary/10 ring-2 ring-secondary/20'
                                : 'border-border hover:border-secondary/40 hover:bg-secondary/5'
                            }`}
                          >
                            <div className={`text-[13px] font-semibold ${active ? 'text-secondary' : 'text-foreground'}`}>
                              {opt.label}
                            </div>
                            <div className="mt-0.5 text-[10px] text-muted-foreground">{opt.desc}</div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="mb-1 flex items-center gap-1.5 text-xs font-medium">
                        <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
                        از تاریخ
                        <span className="text-destructive">*</span>
                      </Label>
                      <ShamsiDatePicker value={dFromDate} onChange={setDFromDate} />
                    </div>
                    <div>
                      <Label className="mb-1 flex items-center gap-1.5 text-xs font-medium">
                        <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
                        تا تاریخ
                        <span className="text-destructive">*</span>
                      </Label>
                      <ShamsiDatePicker value={dToDate} onChange={setDToDate} />
                    </div>
                  </div>

                  {(computedDays === null || computedDays <= 0) && dFromDate && dToDate && (
                    <p className="text-[11px] text-destructive">تاریخ پایان باید بعد از تاریخ شروع باشد.</p>
                  )}

                  <div>
                    <Label className="mb-1 flex items-center gap-1.5 text-xs font-medium">
                      <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
                      دلیل
                      <span className="text-destructive">*</span>
                    </Label>
                    <Textarea
                      value={dReason}
                      onChange={(e) => setDReason(e.target.value)}
                      placeholder="مثلاً: سفر خانوادگی"
                      rows={2}
                      maxLength={500}
                    />
                    <p className="mt-1 text-left text-[10px] text-muted-foreground">
                      {toPersianDigits(dReason.length)}/{toPersianDigits(500)}
                    </p>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            onClick={submit}
            disabled={!canSubmit}
            className={`min-w-32 ${isHourly ? 'btn-primary' : 'bg-secondary text-secondary-foreground hover:bg-secondary/90'}`}
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <><Plane className="ml-1 h-4 w-4" /> ثبت مرخصی</>
            )}
          </Button>
        </DialogFooter>

        <RecentList items={recent} render={(r) => (
          <span>
            {r.leave_kind === 'hourly' ? (
              <>
                🕒 ساعتی — {toPersianDigits(r.date_shamsi || '')} · {toPersianDigits(r.from_time || '')}–{toPersianDigits(r.to_time || '')}
                {r.hours != null && ` (${formatHoursLabel(Number(r.hours))})`}
              </>
            ) : (
              <>
                📅 {r.leave_type || 'روزانه'} — {toPersianDigits(r.from_date_shamsi || '')} تا {toPersianDigits(r.to_date_shamsi || '')}
                {r.days != null && ` (${toPersianDigits(r.days)} روز)`}
              </>
            )}
            {r.reason && <span className="text-muted-foreground"> · {r.reason}</span>}
          </span>
        )} />
      </DialogContent>
    </Dialog>
  );
};
// ============================================================
const RecentList = ({ items, render }: { items: any[]; render: (i: any) => React.ReactNode }) => {
  if (!items.length) return null;
  return (
    <div className="mt-4 border-t border-border pt-3">
      <p className="mb-2 text-xs font-semibold text-muted-foreground">آخرین موارد ثبت‌شده</p>
      <ul className="space-y-1.5 max-h-40 overflow-y-auto">
        {items.map((it) => (
          <li key={it.id} className="rounded-lg bg-muted/40 px-3 py-1.5 text-xs text-foreground">
            {render(it)}
          </li>
        ))}
      </ul>
    </div>
  );
};
