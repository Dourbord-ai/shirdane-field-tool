// ============================================================
// ShamsiDatePicker — string-based ("YYYY/MM/DD") wrapper around
// the existing JalaliDatePicker so ported dialogs work as-is.
// Accepts an optional placeholder (passed through as label) so
// callers can hint at intent (e.g. "انتخاب تاریخ صدور").
// ============================================================
import JalaliDatePicker from "@/components/JalaliDatePicker";
import type { JalaliDate } from "@/lib/jalali";

interface Props {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}

const parse = (s: string): JalaliDate | null => {
  const m = s?.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (!m) return null;
  return { year: +m[1], month: +m[2], day: +m[3] };
};

export default function ShamsiDatePicker({ value, onChange, placeholder }: Props) {
  return (
    <JalaliDatePicker
      value={parse(value)}
      onChange={(d) =>
        onChange(`${d.year}/${String(d.month).padStart(2, "0")}/${String(d.day).padStart(2, "0")}`)
      }
      label={placeholder}
    />
  );
}
