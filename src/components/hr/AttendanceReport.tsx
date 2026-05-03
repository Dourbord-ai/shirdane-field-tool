// ============================================================
// AttendanceReport.tsx
// Daily attendance report with full-month preview:
//  - Always renders EVERY day of the selected Shamsi range
//    (real records merged in, empty days shown as "ثبت نشده")
//  - Mobile: clean table mirroring the reference mockup
//    (# / تاریخ / روز / شیفت / وضعیت)
//  - Desktop: full 21-column table with all metric columns
//  - Tap/click any day → opens AttendanceDetailDialog
// ============================================================

import { useMemo, useState } from 'react';
import { Filter, FileText } from 'lucide-react';
import ShamsiDatePicker from '@/components/ShamsiDatePicker';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { type AttendanceRecord } from '@/hooks/useAttendanceRecords';
import { useHrAttendance } from '@/hooks/useHrAttendance';
import {
  ALL_STATUSES, SHIFT_OPTIONS,
  displayTime, minutesToHHMM, statusStyles,
} from '@/lib/hrFormat';
import {
  getShamsiToday, toPersianDigits, expandShamsiRange, type ShamsiDay,
} from '@/lib/shamsiNow';
import AttendanceDetailDialog from './AttendanceDetailDialog';

// ============================================================
// Helpers
// ============================================================
const StatusPill = ({ status }: { status: string }) => {
  const st = (statusStyles as any)[status] || statusStyles['حضور'];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${st.bg} ${st.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />
      {status}
    </span>
  );
};

/**
 * One unified day row used by both mobile and desktop renderers.
 * Combines a calendar `ShamsiDay` with the matching record (if any).
 */
interface DayRow {
  day: ShamsiDay;
  record: AttendanceRecord | null;
  /** Resolved status: real record status, or 'تعطیل' for Friday, or 'ثبت نشده' */
  status: string;
  shift: string;
}

const buildRow = (day: ShamsiDay, record: AttendanceRecord | null): DayRow => {
  if (record) return { day, record, status: record.status, shift: record.shift_type || '—' };
  if (day.isFriday) return { day, record: null, status: 'تعطیل', shift: '—' };
  return { day, record: null, status: 'ثبت نشده', shift: '—' };
};

// ============================================================
// Component
// ============================================================
const AttendanceReport = () => {
  const today = getShamsiToday();

  // Default range = whole current Shamsi month (1st → end of month)
  const monthStart = `${today.jy}/${String(today.jm).padStart(2, '0')}/01`;
  const monthEnd   = `${today.jy}/${String(today.jm).padStart(2, '0')}/${String(today.daysInMonth).padStart(2, '0')}`;
  const [from, setFrom] = useState(monthStart);
  const [to, setTo]     = useState(monthEnd);
  const [status, setStatus] = useState<string>('all');
  const [shift, setShift]   = useState<string>('همه');
  const [activeRow, setActiveRow] = useState<DayRow | null>(null);

  // Live data from the legacy HR system, normalized server-side
  // by the `get-hr-attendance` edge function.
  const { recordsByDate, loading, totals, error } = useHrAttendance();

  // Build the visible day list (every day of the range, newest → oldest)
  const rows = useMemo<DayRow[]>(() => {
    const days = expandShamsiRange(from, to);
    // expandShamsiRange returns newest-first; reverse to show 1st → end of month
    let list = days.slice().reverse().map((d) => buildRow(d, recordsByDate.get(d.date) || null));

    if (status !== 'all') list = list.filter((r) => r.status === status);
    if (shift !== 'همه' && shift !== 'all') {
      list = list.filter((r) => (r.record?.shift_type || '') === shift);
    }
    return list;
  }, [from, to, recordsByDate, status, shift]);

  const handleOpen = (row: DayRow) => {
    // Build a pseudo-record for empty days so the dialog has something to show
    const rec: AttendanceRecord = row.record ?? {
      id: `empty-${row.day.date}`,
      user_id: '', user_name: '',
      date_shamsi: row.day.date,
      weekday: row.day.weekday,
      shift_type: null,
      rest_minutes: 0,
      in1: null, out1: null, in2: null, out2: null, in3: null, out3: null,
      other_entries: null,
      status: row.status,
      presence_minutes: 0, hourly_leave_minutes: 0, late_minutes: 0,
      early_leave_minutes: 0, shortfall_minutes: 0, overtime_minutes: 0,
      mission_minutes: 0, worked_minutes: 0,
      notes: row.day.isFriday ? 'تعطیلی رسمی هفته' : 'برای این روز تردد ثبت نشده است.',
      created_at: '', updated_at: '',
    };
    setActiveRow({ ...row, record: rec });
  };

  return (
    <section className="mt-6">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <FileText className="h-4 w-4 text-primary" />
          گزارش تردد پرسنلی
        </h3>
        <span className="text-xs text-muted-foreground">{toPersianDigits(rows.length)} روز</span>
      </div>

      {/* ============================================================
          Filters
      ============================================================ */}
      <div className="mb-3 rounded-2xl border border-border bg-card p-3 shadow-sm">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4 md:gap-3">
          <div>
            <label className="mb-1 block text-[11px] text-muted-foreground">از تاریخ</label>
            <ShamsiDatePicker value={from} onChange={setFrom} />
          </div>
          <div>
            <label className="mb-1 block text-[11px] text-muted-foreground">تا تاریخ</label>
            <ShamsiDatePicker value={to} onChange={setTo} />
          </div>
          <div>
            <label className="mb-1 block text-[11px] text-muted-foreground">وضعیت</label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">همه وضعیت‌ها</SelectItem>
                {ALL_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                <SelectItem value="ثبت نشده">ثبت نشده</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-[11px] text-muted-foreground">شیفت</label>
            <Select value={shift} onValueChange={setShift}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {SHIFT_OPTIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="mt-2 flex items-center justify-between gap-2">
          <p className="text-[11px] text-muted-foreground">
            برای دیدن جزئیات هر روز، روی ردیف کلیک کنید.
          </p>
          <Button
            type="button" size="sm" variant="outline" className="h-8 text-xs"
            onClick={() => {
              setStatus('all'); setShift('همه');
              setFrom(monthStart); setTo(monthEnd);
            }}
          >
            <Filter className="ml-1 h-3.5 w-3.5" />
            بازنشانی فیلترها
          </Button>
        </div>
      </div>

      {/* ============================================================
          Error state (legacy HR system unreachable / unauthorized)
      ============================================================ */}
      {!loading && error && (
        <div className="mb-3 rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-center text-xs text-destructive">
          {error}
        </div>
      )}

      {/* ============================================================
          Loading skeleton
      ============================================================ */}
      {loading && (
        <div className="space-y-2">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-11 animate-pulse rounded-xl bg-muted/50" />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && rows.length === 0 && (
        <div className="rounded-2xl border border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
          برای بازه انتخاب‌شده، رکورد ترددی ثبت نشده است.
        </div>
      )}

      {/* ============================================================
          Aggregate summary cards — shown above the table
      ============================================================ */}
      {!loading && (
        <div className="mx-auto mb-3 grid max-w-2xl grid-cols-3 gap-2 sm:grid-cols-6">
          {[
            { label: 'حضور', value: totals.presence },
            { label: 'کارکرد', value: totals.worked },
            { label: 'تاخیر', value: totals.late, danger: true },
            { label: 'اضافه‌کار', value: totals.overtime },
            { label: 'ماموریت', value: totals.mission },
            { label: 'کسر کار', value: totals.shortfall, danger: true },
          ].map((t) => (
            <div key={t.label} className="rounded-xl border border-border bg-card px-2 py-2 text-center shadow-sm">
              <p className="text-[10px] text-muted-foreground">{t.label}</p>
              <p className={`mt-0.5 font-mono text-sm font-semibold ${t.danger && t.value > 0 ? 'text-destructive' : 'text-foreground'}`}>{toPersianDigits(minutesToHHMM(t.value))}</p>
            </div>
          ))}
        </div>
      )}

      {/* ============================================================
          Compact tap-to-open table (used at ALL viewport sizes
          so users can always tap a date to see details).
      ============================================================ */}
      {!loading && (
        <div className="mx-auto max-w-2xl overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <table className="w-full text-right text-xs">
            <thead className="bg-muted/40 text-[11px] text-muted-foreground">
              <tr>
                <th className="w-10 px-2 py-2.5 font-medium">#</th>
                <th className="px-2 py-2.5 font-medium">تاریخ</th>
                <th className="px-2 py-2.5 font-medium">روز</th>
                <th className="px-2 py-2.5 font-medium">شیفت</th>
                <th className="px-2 py-2.5 font-medium">وضعیت</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr
                  key={row.day.date}
                  onClick={() => handleOpen(row)}
                  className="cursor-pointer border-t border-border/60 transition active:bg-accent/60"
                >
                  <td className="px-2 py-3 text-[11px] text-muted-foreground">{toPersianDigits(i + 1)}</td>
                  <td className="whitespace-nowrap px-2 py-3 font-mono font-medium">{toPersianDigits(row.day.date)}</td>
                  <td className="px-2 py-3">{row.day.weekday}</td>
                  <td className="px-2 py-3 text-muted-foreground">{row.shift}</td>
                  <td className="px-2 py-3"><StatusPill status={row.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AttendanceDetailDialog
        record={activeRow?.record ?? null}
        open={!!activeRow}
        onOpenChange={(o) => { if (!o) setActiveRow(null); }}
      />
    </section>
  );
};

export default AttendanceReport;
