// ============================================================
// get-hr-attendance
// Bridges the React app to the legacy HR API. Looks up the
// caller's HR credentials in `hr_users`, calls the legacy
// service server-side, and returns a normalized JSON payload.
//
// Frontend NEVER sees credentials or raw legacy response.
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const LEGACY_URL = Deno.env.get('HR_API_URL')!;

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------
function minutesToHHMM(min: number | null | undefined): string {
  const m = Number(min || 0);
  if (!isFinite(m) || m <= 0) return '00:00';
  const h = Math.floor(m / 60);
  const r = m % 60;
  return `${String(h).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

function num(v: unknown): number {
  const n = Number(v);
  return isFinite(n) ? n : 0;
}

function bool(v: unknown): boolean {
  return v === true || v === 'true' || v === 1 || v === '1';
}

// Parse "رزقی مهران-163-مدیریت" — split FROM THE END so names with "-" survive.
function parseEmployeeValue(value: string) {
  const parts = String(value || '').split('-');
  if (parts.length < 3) {
    return { full_name: String(value || '').trim(), personnel_code: '', department: '' };
  }
  const department = parts.pop()!.trim();
  const personnel_code = parts.pop()!.trim();
  const full_name = parts.join('-').trim();
  return { full_name, personnel_code, department };
}

function pick<T = unknown>(obj: any, keys: string[]): T | undefined {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null) return obj[k] as T;
  }
  return undefined;
}

function normalizeEmployees(raw: unknown) {
  if (!Array.isArray(raw)) return [];
  return raw.map((e: any) => {
    const key = pick<string>(e, ['Key', 'key', 'm_Key']) ?? '';
    const value = pick<string>(e, ['Value', 'value', 'm_Value']) ?? '';
    const parsed = parseEmployeeValue(String(value));
    return { legacy_id: String(key), ...parsed };
  });
}

/**
 * The legacy daily payload (m_Item4) contains many parallel
 * Key/Value arrays where Key = Jalali date ("1405/02/01") and
 * Value = the metric for that day. We MERGE BY DATE (not by
 * array index) so missing days don't shift other metrics.
 *
 * Plus: m_Item4 carries pre-computed "All*" totals which we
 * prefer over locally-summed values (the legacy system is the
 * source of truth for payroll figures).
 */
type KV = { Key?: string; Value?: unknown; key?: string; value?: unknown };

function kvArr(raw: any, name: string): KV[] {
  const v = raw?.[name];
  return Array.isArray(v) ? (v as KV[]) : [];
}

function indexByDate(items: KV[]): Map<string, unknown> {
  const map = new Map<string, unknown>();
  for (const it of items) {
    const k = (it?.Key ?? it?.key) as string | undefined;
    if (k) map.set(String(k), it?.Value ?? it?.value);
  }
  return map;
}

function normalizeDays(raw: any) {
  if (!raw || typeof raw !== 'object') return [];

  // Index every metric by date
  const dayOfWeeks   = indexByDate(kvArr(raw, 'DayOfWeeks'));
  const durationAtt  = indexByDate(kvArr(raw, 'DurationOfAttendances'));
  const firstLow     = indexByDate(kvArr(raw, 'FirstLowTimes'));
  const lastLow      = indexByDate(kvArr(raw, 'LastLowTimes'));
  const lowTimes     = indexByDate(kvArr(raw, 'LowTimes'));
  const overTimes    = indexByDate(kvArr(raw, 'OverTimes'));
  const restDates    = indexByDate(kvArr(raw, 'RestDates'));
  const shiftCodes   = indexByDate(kvArr(raw, 'ShiftCodes'));
  const shiftDates   = indexByDate(kvArr(raw, 'ShiftDates'));
  const shiftTimes   = indexByDate(kvArr(raw, 'ShiftTimes'));
  const specOver     = indexByDate(kvArr(raw, 'SpecificOverTimes'));
  const times        = indexByDate(kvArr(raw, 'Times'));
  const traffics     = indexByDate(kvArr(raw, 'Traffics'));
  const traffics2    = indexByDate(kvArr(raw, 'Traffics2'));
  const upTimes      = indexByDate(kvArr(raw, 'UpTimes'));

  // Union of every date that appears in any metric
  const allDates = new Set<string>();
  for (const m of [
    dayOfWeeks, durationAtt, firstLow, lastLow, lowTimes, overTimes, restDates,
    shiftCodes, shiftDates, shiftTimes, specOver, times, traffics, traffics2, upTimes,
  ]) {
    for (const k of m.keys()) allDates.add(k);
  }

  // Sort chronologically (Jalali strings YYYY/MM/DD compare lexicographically)
  const sortedDates = Array.from(allDates).sort();

  return sortedDates.map((date) => {
    const trafficsVal = traffics.get(date);
    const trafficsArr = Array.isArray(trafficsVal)
      ? trafficsVal
      : (typeof trafficsVal === 'string'
          ? trafficsVal.split(/[\-،,]/).map((s) => s.trim()).filter(Boolean)
          : []);

    const restVal = restDates.get(date);

    return {
      date_jalali: date,
      day_name: String(dayOfWeeks.get(date) ?? ''),
      shift_codes: shiftCodes.get(date) ?? '',
      shift_dates: shiftDates.get(date) ?? '',
      shift_minutes: num(shiftTimes.get(date)),
      worked_minutes: num(times.get(date)),
      attendance_duration_minutes: num(durationAtt.get(date)),
      late_minutes: num(lowTimes.get(date)),
      first_late_minutes: num(firstLow.get(date)),
      last_late_minutes: num(lastLow.get(date)),
      overtime_minutes: num(overTimes.get(date)),
      specific_overtime_minutes: num(specOver.get(date)),
      extra_presence_minutes: num(upTimes.get(date)),
      rest: restVal ?? null,
      traffics: trafficsArr,
      traffics_verified: traffics2.get(date) ?? null,
      // Date-array based flags from real legacy API
      is_holiday: Array.isArray(raw?.Holidays)
        ? raw.Holidays.includes(date)
        : dayOfWeeks.get(date) === 'جمعه',
      is_mission: Array.isArray(raw?.MissionDates) && raw.MissionDates.includes(date),
      is_true_mission: Array.isArray(raw?.TrueMissionDates) && raw.TrueMissionDates.includes(date),
      is_true_leave: Array.isArray(raw?.TrueLeaveDates) && raw.TrueLeaveDates.includes(date),
      is_with_pay_leave: Array.isArray(raw?.WithPayLeaveDates) && raw.WithPayLeaveDates.includes(date),
      is_without_pay_leave: Array.isArray(raw?.WithoutPayLeaveDates) && raw.WithoutPayLeaveDates.includes(date),
    };
  });
}

/**
 * Prefer the legacy-provided "All*" totals from m_Item4 (official
 * payroll figures). If a total is missing, fall back to summing
 * the matching per-day field so the UI always has a number.
 */
function normalizeSummary(raw: any, days: ReturnType<typeof normalizeDays>) {
  const sumDays = (k: keyof typeof days[number]) =>
    days.reduce((acc, d) => acc + num(d[k] as number), 0);

  const official = (key: string, fallback: number) => {
    const v = raw?.[key];
    return v === undefined || v === null ? fallback : num(v);
  };

  const all_attendance_minutes  = official('AllDurationOfAttendances', sumDays('attendance_duration_minutes'));
  const all_shift_minutes       = official('AllShiftTimes',           sumDays('shift_minutes'));
  const all_worked_minutes      = official('AllTimes',                sumDays('worked_minutes'));
  const all_low_minutes         = official('AllLowTimes',             sumDays('late_minutes'));
  const all_up_minutes          = official('AllUpTimes',              sumDays('extra_presence_minutes'));
  const all_overtime_minutes    = official('AllOverTimes',            sumDays('overtime_minutes'));
  const all_first_late_minutes  = official('AllFirstLowTimes',        sumDays('first_late_minutes'));
  const all_last_late_minutes   = official('AllLastLowTimes',         sumDays('last_late_minutes'));
  const all_true_leave_minutes  = official('AllTrueLeaveTimes',       0);
  const all_true_mission_minutes= official('AllTrueMissionTimes',     0);

  return {
    all_attendance_minutes,
    all_shift_minutes,
    all_worked_minutes,
    all_low_minutes,
    all_up_minutes,
    all_overtime_minutes,
    all_first_late_minutes,
    all_last_late_minutes,
    all_true_leave_minutes,
    all_true_mission_minutes,
    formatted: {
      all_attendance:    minutesToHHMM(all_attendance_minutes),
      all_shift:         minutesToHHMM(all_shift_minutes),
      all_worked:        minutesToHHMM(all_worked_minutes),
      all_low:           minutesToHHMM(all_low_minutes),
      all_up:            minutesToHHMM(all_up_minutes),
      all_overtime:      minutesToHHMM(all_overtime_minutes),
      all_first_late:    minutesToHHMM(all_first_late_minutes),
      all_last_late:     minutesToHHMM(all_last_late_minutes),
      all_true_leave:    minutesToHHMM(all_true_leave_minutes),
      all_true_mission:  minutesToHHMM(all_true_mission_minutes),
    },
  };
}

// ------------------------------------------------------------
// Handler
// ------------------------------------------------------------
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const username: string | undefined = body?.username;
    const hrUserId: number | string | undefined = body?.hr_user_id;

    if (!username && !hrUserId) {
      return new Response(
        JSON.stringify({ success: false, error: 'شناسه کاربری ارسال نشده است.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Look up HR credentials
    let q = supabase.from('hr_users').select('id, username, password_hash, personnel_code').limit(1);
    q = hrUserId ? q.eq('id', hrUserId) : q.eq('username', username!);
    const { data: hrUser, error: lookupErr } = await q.maybeSingle();

    if (lookupErr || !hrUser) {
      return new Response(
        JSON.stringify({ success: false, error: 'کاربر در سامانه منابع انسانی یافت نشد.' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Call legacy API server-side
    const legacyPayload = {
      UserInfo: {
        Id: String(hrUser.id),
        UserName: hrUser.username,
        Password: hrUser.password_hash,
      },
      AppVersion: '2.0.0',
      SearchWithOpenRequest: 2,
    };

    const legacyRes = await fetch(LEGACY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(legacyPayload),
    });

    if (!legacyRes.ok) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `سامانه منابع انسانی پاسخ نداد (HTTP ${legacyRes.status}).`,
        }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const legacyJson: any = await legacyRes.json().catch(() => ({}));

    // Some WCF endpoints wrap the result inside a top-level key
    const root = legacyJson?.GetAllTrafficsD79B1412BEBB2Result
      ?? legacyJson?.d
      ?? legacyJson;

    const status     = pick(root, ['m_Item1', 'Item1']);
    const employees  = normalizeEmployees(pick(root, ['m_Item3', 'Item3']));
    const daysRaw    = pick(root, ['m_Item4', 'Item4']);
    const year       = pick(root, ['m_Item5', 'Item5']);
    const month      = pick(root, ['m_Item6', 'Item6']);
    const reportDate = pick(root, ['m_Item7', 'Item7']);

    const days = normalizeDays(daysRaw);
    const summary = normalizeSummary(daysRaw, days);

    return new Response(
      JSON.stringify({
        success: true,
        legacy_status: status ?? null,
        year: year ?? null,
        month: month ?? null,
        report_date: reportDate ?? null,
        summary,
        days,
        employees,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'خطای ناشناخته';
    return new Response(
      JSON.stringify({ success: false, error: `خطا در اتصال به سامانه: ${msg}` }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
