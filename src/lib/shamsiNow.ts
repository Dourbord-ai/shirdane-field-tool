// ============================================================
// shamsiNow.ts — re-implemented on top of the project's existing
// jalali utilities so HR module ports cleanly.
// ============================================================
import {
  gregorianToJalali,
  jalaliToGregorian,
  jalaliMonthLength,
  toPersianDigits as _toPersianDigits,
} from "./jalali";

export const PERSIAN_MONTH_NAMES = [
  "فروردین","اردیبهشت","خرداد","تیر","مرداد","شهریور",
  "مهر","آبان","آذر","دی","بهمن","اسفند",
];
export const PERSIAN_WEEKDAYS = [
  "شنبه","یک‌شنبه","دوشنبه","سه‌شنبه","چهارشنبه","پنج‌شنبه","جمعه",
];

export const toPersianDigits = _toPersianDigits;

export function jalaaliWeekday(date: Date): number {
  return (date.getDay() + 1) % 7;
}

export interface ShamsiToday {
  jy: number; jm: number; jd: number;
  monthName: string;
  weekdayName: string;
  daysInMonth: number;
  formatted: string;
  monthProgress: number;
}

export function getShamsiToday(date: Date = new Date()): ShamsiToday {
  const j = gregorianToJalali(date.getFullYear(), date.getMonth() + 1, date.getDate());
  const days = jalaliMonthLength(j.year, j.month);
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    jy: j.year, jm: j.month, jd: j.day,
    monthName: PERSIAN_MONTH_NAMES[j.month - 1],
    weekdayName: PERSIAN_WEEKDAYS[jalaaliWeekday(date)],
    daysInMonth: days,
    formatted: `${j.year}/${pad(j.month)}/${pad(j.day)}`,
    monthProgress: j.day / days,
  };
}

export function parseShamsi(s: string | null | undefined) {
  if (!s) return null;
  const m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (!m) return null;
  return { jy: +m[1], jm: +m[2], jd: +m[3] };
}

export interface ShamsiDay {
  date: string;
  jy: number; jm: number; jd: number;
  weekday: string;
  isFriday: boolean;
}

const pad2 = (n: number) => String(n).padStart(2, "0");
const fmt = (jy: number, jm: number, jd: number) => `${jy}/${pad2(jm)}/${pad2(jd)}`;

export function expandShamsiRange(from: string, to: string): ShamsiDay[] {
  const a = parseShamsi(from); const b = parseShamsi(to);
  if (!a || !b) return [];
  const ga = jalaliToGregorian(a.jy, a.jm, a.jd);
  const gb = jalaliToGregorian(b.jy, b.jm, b.jd);
  const start = new Date(ga.year, ga.month - 1, ga.day);
  const end = new Date(gb.year, gb.month - 1, gb.day);
  if (start > end) return [];
  const out: ShamsiDay[] = [];
  const cur = new Date(start);
  let safety = 0;
  while (cur <= end && safety++ < 366) {
    const j = gregorianToJalali(cur.getFullYear(), cur.getMonth() + 1, cur.getDate());
    const w = jalaaliWeekday(cur);
    out.push({
      date: fmt(j.year, j.month, j.day),
      jy: j.year, jm: j.month, jd: j.day,
      weekday: PERSIAN_WEEKDAYS[w],
      isFriday: w === 6,
    });
    cur.setDate(cur.getDate() + 1);
  }
  return out.reverse();
}
