// Local Jalali (Shamsi) calendar utilities — no external dependencies

const g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
const j_d_m = [0, 31, 62, 93, 124, 155, 186, 216, 246, 276, 306, 336];

export interface JalaliDate {
  year: number;
  month: number; // 1-12
  day: number;   // 1-31
}

export function gregorianToJalali(gy: number, gm: number, gd: number): JalaliDate {
  let gy2 = gm > 2 ? gy + 1 : gy;
  let days =
    355666 +
    365 * gy +
    Math.floor((gy2 + 3) / 4) -
    Math.floor((gy2 + 99) / 100) +
    Math.floor((gy2 + 399) / 400) +
    gd +
    g_d_m[gm - 1];
  let jy = -1595 + 33 * Math.floor(days / 12053);
  days %= 12053;
  jy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) {
    jy += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }
  let jm: number;
  if (days < 186) {
    jm = 1 + Math.floor(days / 31);
    const jd = 1 + (days % 31);
    return { year: jy, month: jm, day: jd };
  } else {
    jm = 7 + Math.floor((days - 186) / 30);
    const jd = 1 + ((days - 186) % 30);
    return { year: jy, month: jm, day: jd };
  }
}

export function jalaliToGregorian(jy: number, jm: number, jd: number): { year: number; month: number; day: number } {
  let jy2 = jy + 1595;
  let days =
    -355668 +
    365 * jy2 +
    Math.floor(jy2 / 33) * 8 +
    Math.floor(((jy2 % 33) + 3) / 4) +
    jd +
    (jm < 7 ? (jm - 1) * 31 : (jm - 7) * 30 + 186);
  let gy = 400 * Math.floor(days / 146097);
  days %= 146097;
  if (days > 36524) {
    gy += 100 * Math.floor(--days / 36524);
    days %= 36524;
    if (days >= 365) days++;
  }
  gy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) {
    gy += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }
  let gd = days + 1;
  const sal_a = [0, 31, (gy % 4 === 0 && gy % 100 !== 0) || gy % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let gm = 0;
  for (gm = 0; gm < 13 && gd > sal_a[gm]; gm++) gd -= sal_a[gm];
  return { year: gy, month: gm, day: gd };
}

export function isJalaliLeap(jy: number): boolean {
  const breaks = [1, 5, 9, 13, 17, 22, 26, 30];
  const r = jy % 33;
  return breaks.includes(r);
}

export function jalaliMonthLength(jy: number, jm: number): number {
  if (jm <= 6) return 31;
  if (jm <= 11) return 30;
  return isJalaliLeap(jy) ? 30 : 29;
}

export const jalaliMonthNames = [
  "فروردین", "اردیبهشت", "خرداد",
  "تیر", "مرداد", "شهریور",
  "مهر", "آبان", "آذر",
  "دی", "بهمن", "اسفند",
];

export const jalaliWeekDays = ["ش", "ی", "د", "س", "چ", "پ", "ج"];

export function getJalaliDayOfWeek(jy: number, jm: number, jd: number): number {
  const g = jalaliToGregorian(jy, jm, jd);
  const d = new Date(g.year, g.month - 1, g.day);
  // Saturday = 0 in our system
  return (d.getDay() + 1) % 7;
}

export function formatJalali(j: JalaliDate): string {
  return `${j.year}/${String(j.month).padStart(2, "0")}/${String(j.day).padStart(2, "0")}`;
}

export function todayJalali(): JalaliDate {
  const now = new Date();
  return gregorianToJalali(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

export function toPersianDigits(str: string | number): string {
  const persianDigits = "۰۱۲۳۴۵۶۷۸۹";
  return String(str).replace(/\d/g, (d) => persianDigits[parseInt(d)]);
}
