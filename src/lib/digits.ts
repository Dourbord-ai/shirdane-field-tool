// Convert Persian/Arabic digits to ASCII digits and vice-versa.
const FA = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"];
const AR = ["٠", "١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩"];

export function toEnDigits(s: string | number | null | undefined): string {
  if (s == null) return "";
  let out = String(s);
  for (let i = 0; i < 10; i++) {
    out = out.replace(new RegExp(FA[i], "g"), String(i));
    out = out.replace(new RegExp(AR[i], "g"), String(i));
  }
  return out;
}

export function toFaDigits(s: string | number | null | undefined): string {
  if (s == null) return "";
  return String(s).replace(/\d/g, (d) => FA[Number(d)]);
}
