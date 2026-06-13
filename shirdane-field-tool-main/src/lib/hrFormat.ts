// Helpers for HR attendance display: minute → "HH:MM" formatting,
// status labels & colors, and small time math utilities.
import { toPersianDigits } from "./shamsiNow";

export function minutesToHHMM(min: number | null | undefined): string {
  if (!min || min <= 0) return toPersianDigits("00:00");
  const h = Math.floor(min / 60);
  const m = min % 60;
  return toPersianDigits(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
}
export function hhmmToMinutes(s?: string | null): number | null {
  if (!s) return null;
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}
export function displayTime(s?: string | null): string {
  if (!s) return "—";
  return toPersianDigits(s);
}

export type AttStatus = "حضور" | "تاخیر" | "تعجیل" | "مرخصی" | "ماموریت" | "تعطیل" | "ثبت نشده";

export const statusStyles: Record<AttStatus, { dot: string; text: string; bg: string }> = {
  "حضور":     { dot: "bg-emerald-500", text: "text-emerald-600", bg: "bg-emerald-500/10" },
  "تاخیر":    { dot: "bg-amber-500",   text: "text-amber-600",   bg: "bg-amber-500/10" },
  "تعجیل":    { dot: "bg-orange-500",  text: "text-orange-600",  bg: "bg-orange-500/10" },
  "مرخصی":    { dot: "bg-sky-500",     text: "text-sky-600",     bg: "bg-sky-500/10" },
  "ماموریت":  { dot: "bg-purple-500",  text: "text-purple-600",  bg: "bg-purple-500/10" },
  "تعطیل":    { dot: "bg-muted-foreground", text: "text-muted-foreground", bg: "bg-muted/60" },
  "ثبت نشده": { dot: "bg-muted-foreground/50", text: "text-muted-foreground", bg: "bg-muted/30" },
};

export const ALL_STATUSES: AttStatus[] = ["حضور","تاخیر","تعجیل","مرخصی","ماموریت","تعطیل"];
export const SHIFT_OPTIONS = ["همه","صبح","عصر","شب","آنکال"] as const;
