// ============================================================
// useAttendanceRecords.ts
// Fetches the current user's daily attendance records from the
// `hr_attendance_records` table, optionally filtered by a Shamsi
// date range, status, and shift.
//
// `recordsByDate` is also exposed so callers can render every
// day of a month and look up real records by Shamsi date string.
// ============================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import type { AttStatus } from '@/lib/hrFormat';

export interface AttendanceRecord {
  id: string;
  user_id: string;
  user_name: string;
  date_shamsi: string;
  weekday: string | null;
  shift_type: string | null;
  rest_minutes: number;
  in1: string | null; out1: string | null;
  in2: string | null; out2: string | null;
  in3: string | null; out3: string | null;
  other_entries: string | null;
  status: AttStatus | string;
  presence_minutes: number;
  hourly_leave_minutes: number;
  late_minutes: number;
  early_leave_minutes: number;
  shortfall_minutes: number;
  overtime_minutes: number;
  mission_minutes: number;
  worked_minutes: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface AttendanceFilters {
  fromShamsi?: string;
  toShamsi?: string;
  status?: string; // 'all' or AttStatus
  shift?: string;  // 'all' or shift label
  search?: string;
}

export function useAttendanceRecords(filters: AttendanceFilters) {
  const { user } = useAuth();
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user?.id) { setLoading(false); return; }
    setLoading(true);
    let q = supabase
      .from('hr_attendance_records')
      .select('*')
      .eq('user_id', user.id)
      .order('date_shamsi', { ascending: false });

    if (filters.fromShamsi) q = q.gte('date_shamsi', filters.fromShamsi);
    if (filters.toShamsi)   q = q.lte('date_shamsi', filters.toShamsi);
    if (filters.status && filters.status !== 'all') q = q.eq('status', filters.status);
    if (filters.shift && filters.shift !== 'all' && filters.shift !== 'همه') q = q.eq('shift_type', filters.shift);

    const { data } = await q;
    setRecords((data || []) as AttendanceRecord[]);
    setLoading(false);
  }, [user?.id, filters.fromShamsi, filters.toShamsi, filters.status, filters.shift]);

  useEffect(() => { load(); }, [load]);

  // O(1) lookup by Shamsi date string
  const recordsByDate = useMemo(() => {
    const map = new Map<string, AttendanceRecord>();
    for (const r of records) map.set(r.date_shamsi, r);
    return map;
  }, [records]);

  // Aggregate totals across the visible window
  const totals = useMemo(() => {
    return records.reduce((acc, r) => {
      acc.presence       += r.presence_minutes || 0;
      acc.late           += r.late_minutes || 0;
      acc.early          += r.early_leave_minutes || 0;
      acc.hourly_leave   += r.hourly_leave_minutes || 0;
      acc.shortfall      += r.shortfall_minutes || 0;
      acc.overtime       += r.overtime_minutes || 0;
      acc.mission        += r.mission_minutes || 0;
      acc.worked         += r.worked_minutes || 0;
      return acc;
    }, { presence: 0, late: 0, early: 0, hourly_leave: 0, shortfall: 0, overtime: 0, mission: 0, worked: 0 });
  }, [records]);

  return { records, recordsByDate, loading, totals, reload: load };
}
