// Adapter exposing the jalaali-js style API on top of the
// project's existing src/lib/jalali utilities.
import { gregorianToJalali, jalaliToGregorian, isJalaliLeap } from "./jalali";

export function toJalaali(gy: number, gm: number, gd: number) {
  const r = gregorianToJalali(gy, gm, gd);
  return { jy: r.year, jm: r.month, jd: r.day };
}
export function toGregorian(jy: number, jm: number, jd: number) {
  const r = jalaliToGregorian(jy, jm, jd);
  return { gy: r.year, gm: r.month, gd: r.day };
}
export function isLeapJalaaliYear(jy: number) { return isJalaliLeap(jy); }

const jalaali = { toJalaali, toGregorian, isLeapJalaaliYear };
export default jalaali;
