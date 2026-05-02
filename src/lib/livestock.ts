// Livestock domain constants & helpers

export const PRESENCE_STATUS_LABELS: Record<number, string> = {
  0: "موجود در گله",
  1: "خارج شده به دلیل فروش",
  2: "خارج شده به دلیل تلفات",
  3: "خارج شده به دلیل کشتار",
  4: "خارج شده به سایر دلایل",
};

export const FERTILITY_STATUS_LABELS: Record<number, string> = {
  1: "بدون وضعیت",
  2: "فحل شده",
  3: "تلقیح شده",
  4: "تست اولیه مثبت",
  5: "تست اولیه مشکوک",
  6: "تست اولیه منفی",
  7: "تست نهایی منفی",
  8: "آبستن قطعی (تست نهایی مثبت)",
  9: "سقط کرده",
  12: "تازه زا",
  14: "شستشو شده",
  15: "کلین تست مثبت",
  16: "تحت درمان",
  17: "تست تکمیلی منفی",
  18: "تست تکمیلی مثبت",
  19: "تست خشکی منفی",
  20: "تست خشکی مثبت",
  21: "همزمان شده جهت فحلی",
  22: "توقف برنامه همزمان سازی فحلی",
};

export const presenceLabel = (s: number | null | undefined) =>
  s == null ? "—" : PRESENCE_STATUS_LABELS[s] ?? "نامشخص";

export const fertilityLabel = (s: number | null | undefined) =>
  s == null ? "—" : FERTILITY_STATUS_LABELS[s] ?? "نامشخص";

export const isFemale = (sextype: string | null | undefined, sex?: number | null) =>
  sextype === "ماده" || sex === 0;

export const dryLabel = (isDry: boolean | null | undefined) =>
  isDry == null ? "—" : isDry ? "خشک" : "دوشا";

// Tone classes for presence status badges using semantic tokens-ish neutrals
export const presenceBadgeClass = (s: number | null | undefined) => {
  switch (s) {
    case 0:
      return "bg-primary/10 text-primary border-primary/20";
    case 1:
      return "bg-blue-100 text-blue-700 border-blue-200";
    case 2:
      return "bg-destructive/10 text-destructive border-destructive/20";
    case 3:
      return "bg-amber-100 text-amber-700 border-amber-200";
    case 4:
      return "bg-muted text-muted-foreground border-border";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
};
