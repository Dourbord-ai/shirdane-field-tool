// ============================================================
// useHrAttendance.ts
// Calls the `get-hr-attendance` edge function and adapts the
// normalized legacy payload into the same `AttendanceRecord`
// shape the existing UI already consumes.
//
// SECURITY: never sends or sees passwords. Only the username
// of the logged-in user goes to the edge function, which then
// resolves credentials from `hr_users` server-side.
// ============================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import type { AttendanceRecord } from './useAttendanceRecords';
import type { AttStatus } from '@/lib/hrFormat';

interface LegacyDay {
  date_jalali: string;
  day_name: string;
  shift_codes: unknown;
  shift_dates: unknown;
  shift_minutes: number;
  worked_minutes: number;
  attendance_duration_minutes: number;
  late_minutes: number;
  first_late_minutes: number;
  last_late_minutes: number;
  overtime_minutes: number;
  specific_overtime_minutes: number;
  extra_presence_minutes: number;
  rest: unknown;
  traffics: unknown;
  traffics_verified: unknown;
  is_holiday: boolean;
  is_mission: boolean;
  is_true_leave: boolean;
  is_with_pay_leave: boolean;
  is_without_pay_leave: boolean;
}

export interface HrAttendancePayload {
  success: boolean;
  year: number | null;
  month: number | null;
  report_date: string | null;
  summary: {
    all_attendance_minutes: number;
    all_shift_minutes: number;
    all_worked_minutes: number;
    all_low_minutes: number;
    all_up_minutes: number;
    all_overtime_minutes: number;
    all_first_late_minutes: number;
    all_last_late_minutes: number;
    formatted: Record<string, string>;
  };
  days: LegacyDay[];
  employees: Array<{ legacy_id: string; full_name: string; personnel_code: string; department: string }>;
}

// ------------------------------------------------------------
// Map a legacy day → existing UI record shape
// ------------------------------------------------------------
function pickStatus(d: LegacyDay): AttStatus | string {
  if (d.is_holiday) return 'تعطیل';
  if (d.is_mission) return 'ماموریت';
  if (d.is_true_leave || d.is_with_pay_leave || d.is_without_pay_leave) return 'مرخصی';
  if (d.worked_minutes > 0 || d.attendance_duration_minutes > 0) {
    if (d.late_minutes > 0) return 'تاخیر';
    return 'حضور';
  }
  return 'ثبت نشده';
}

// Try to extract up to 3 in/out pairs from the `traffics` field.
// Legacy can return a string like "08:01 - 12:30 - 13:00 - 17:05"
// or an array; we degrade gracefully when the format is unknown.
function extractTraffics(traffics: unknown): string[] {
  if (Array.isArray(traffics)) return traffics.map((t) => String(t));
  if (typeof traffics === 'string') {
    return traffics.split(/[\-،,]/).map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

function adaptDay(d: LegacyDay, userId: string, userName: string): AttendanceRecord {
  const t = extractTraffics(d.traffics);
  const restMin = typeof d.rest === 'number' ? d.rest : 0;
  return {
    id: `hr-${d.date_jalali}`,
    user_id: userId,
    user_name: userName,
    date_shamsi: d.date_jalali,
    weekday: d.day_name || null,
    shift_type: typeof d.shift_codes === 'string' ? d.shift_codes : null,
    rest_minutes: Number(restMin) || 0,
    in1:  t[0] || null, out1: t[1] || null,
    in2:  t[2] || null, out2: t[3] || null,
    in3:  t[4] || null, out3: t[5] || null,
    other_entries: t.length > 6 ? t.slice(6).join(' - ') : null,
    status: pickStatus(d),
    presence_minutes: d.attendance_duration_minutes || 0,
    hourly_leave_minutes: 0,
    late_minutes: d.late_minutes || 0,
    early_leave_minutes: 0,
    shortfall_minutes: Math.max(0, (d.shift_minutes || 0) - (d.worked_minutes || 0)),
    overtime_minutes: d.overtime_minutes || 0,
    mission_minutes: d.is_mission ? (d.worked_minutes || 0) : 0,
    worked_minutes: d.worked_minutes || 0,
    notes: null,
    created_at: '',
    updated_at: '',
  };
}

// ------------------------------------------------------------
// Hook
// ------------------------------------------------------------
export function useHrAttendance() {
  const { user } = useAuth();
  const [data, setData] = useState<HrAttendancePayload | null>(null);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user?.id) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      // 1. Resolve the legacy HR user id from this app user's profile.
      //    Try by user_id first; fall back to user_name (handles stale
      //    sessions where the local user.id no longer matches DB).
      let hrUserId: number | null = null;

      const { data: profile } = await supabase
        .from('hr_profiles')
        .select('hr_user_id')
        .eq('user_id', user.id)
        .maybeSingle();
      if (profile?.hr_user_id) hrUserId = profile.hr_user_id as number;

      if (!hrUserId && user.username) {
        const { data: byName } = await supabase
          .from('hr_profiles')
          .select('hr_user_id')
          .eq('user_name', user.username)
          .maybeSingle();
        if (byName?.hr_user_id) hrUserId = byName.hr_user_id as number;
      }

      if (!hrUserId && user.username) {
        const { data: hrUser } = await supabase
          .from('hr_users')
          .select('id')
          .eq('username', user.username)
          .maybeSingle();
        if (hrUser?.id) hrUserId = hrUser.id as number;
      }

      if (!hrUserId) {
        throw new Error('شناسه کاربر سامانه منابع انسانی برای این حساب تنظیم نشده است.');
      }

      // 2. Call the edge function with the legacy HR user id only.
      const { data: res, error: invokeErr } = await supabase.functions.invoke<HrAttendancePayload>(
        'get-hr-attendance',
        { body: { hr_user_id: hrUserId } },
      );
      if (invokeErr) {
        const serverMsg = (res as any)?.error;
        throw new Error(serverMsg || invokeErr.message);
      }
      if (!res?.success) throw new Error((res as any)?.error || 'خطا در دریافت اطلاعات تردد');

      setData(res);
      const adapted = (res.days || []).map((d) =>
        adaptDay(d, user.id, user.fullName || user.username),
      );
      setRecords(adapted);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'خطای ناشناخته';
      setError(msg);
      setRecords([]);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [user?.id, user?.username, user?.fullName]);

  useEffect(() => { load(); }, [load]);

  // O(1) lookup by Shamsi date string
  const recordsByDate = useMemo(() => {
    const map = new Map<string, AttendanceRecord>();
    for (const r of records) map.set(r.date_shamsi, r);
    return map;
  }, [records]);

  const totals = useMemo(() => {
    return records.reduce((acc, r) => {
      acc.presence     += r.presence_minutes || 0;
      acc.late         += r.late_minutes || 0;
      acc.early        += r.early_leave_minutes || 0;
      acc.hourly_leave += r.hourly_leave_minutes || 0;
      acc.shortfall    += r.shortfall_minutes || 0;
      acc.overtime     += r.overtime_minutes || 0;
      acc.mission      += r.mission_minutes || 0;
      acc.worked       += r.worked_minutes || 0;
      return acc;
    }, { presence: 0, late: 0, early: 0, hourly_leave: 0, shortfall: 0, overtime: 0, mission: 0, worked: 0 });
  }, [records]);

  return { data, records, recordsByDate, totals, loading, error, reload: load };
}
