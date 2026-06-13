// =============================================================================
// DatePicker.tsx — The ONE date input every form in the app should use.
// -----------------------------------------------------------------------------
// CONTRACT:
//   • The value passed in/out is ALWAYS a Gregorian ISO string.
//       - mode="date"     → "YYYY-MM-DD"
//       - mode="datetime" → "YYYY-MM-DDTHH:mm:ss+03:30" (Tehran wall clock)
//   • The UI ALWAYS shows a Jalali (Shamsi) calendar with Persian digits.
//   • Conversions happen inside this component using `dateUtils` so callers
//     never touch Date math themselves.
//
// WHY:
//   The product rule is "user sees Jalali, DB stores Gregorian". Centralising
//   the conversion here means form code stays trivial:
//
//       <DatePicker value={row.event_date} onChange={setEventDate} />
//
//   and we can never accidentally write Jalali text into a Gregorian column
//   (or vice versa) again.
// =============================================================================

import { useMemo, useState } from "react";
import { ChevronRight, ChevronLeft, CalendarIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  jalaliMonthNames,
  jalaliWeekDays,
  jalaliMonthLength,
  getJalaliDayOfWeek,
  todayJalali,
  toPersianDigits,
  gregorianToJalali,
  jalaliToGregorian,
  type JalaliDate,
} from "@/lib/jalali";
import {
  jalaliToGregorianDate,
  jalaliToGregorianTimestamp,
  formatGregorianToJalali,
} from "@/lib/dateUtils";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
// We keep the API tiny on purpose — most callers just need value/onChange.
// `mode="datetime"` adds a small HH:mm input next to the calendar trigger so
// the user can pick a time without us pulling in a separate time component.
// ---------------------------------------------------------------------------
interface DatePickerProps {
  // Gregorian ISO string (date or timestamp). Empty/null means "no date".
  value: string | null | undefined;
  // Called with the new Gregorian ISO string, or null when cleared.
  onChange: (value: string | null) => void;
  // "date" → YYYY-MM-DD ; "datetime" → ISO timestamp with +03:30 offset.
  mode?: "date" | "datetime";
  // Field label shown above the input (optional — many table filters skip it).
  label?: string;
  // Hint shown when the field is empty.
  placeholder?: string;
  // Tailwind class hook for layout tweaks at the call site.
  className?: string;
  // Disable interaction (e.g. while saving). The trigger still renders.
  disabled?: boolean;
  // Allow clearing the value (renders a small ✕ when there is a value).
  clearable?: boolean;
}

// Convert the incoming Gregorian ISO value to the {year,month,day} the
// calendar grid renders. Returns null when the value is empty/invalid so the
// caller can fall back to "today" for the initial view month.
function isoToJalaliDate(iso: string | null | undefined): JalaliDate | null {
  if (!iso) return null;
  // Date-only fast path avoids timezone surprises (a "2025-03-09" coming from
  // Postgres must stay March 9 regardless of the user's browser TZ).
  const m = typeof iso === "string" && iso.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return gregorianToJalali(Number(m[1]), Number(m[2]), Number(m[3]));
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return gregorianToJalali(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

// Extract HH:mm from an ISO timestamp; returns "" when the value isn't a
// timestamp (e.g. plain "YYYY-MM-DD") so we don't fabricate a fake time.
function isoToTime(iso: string | null | undefined): string {
  if (!iso || !/T\d{2}:\d{2}/.test(String(iso))) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function DatePicker({
  value,
  onChange,
  mode = "date",
  label,
  placeholder = "انتخاب تاریخ...",
  className,
  disabled,
  clearable = true,
}: DatePickerProps) {
  // Calendar state — purely visual (which month grid is currently shown).
  const today = todayJalali();
  const initial = isoToJalaliDate(value);
  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(initial?.year ?? today.year);
  const [viewMonth, setViewMonth] = useState(initial?.month ?? today.month);
  // Time portion is stored as its own controlled string in datetime mode so
  // typing "14:" doesn't immediately fire onChange with a malformed value.
  const [timeStr, setTimeStr] = useState<string>(() => isoToTime(value));

  // Memoise grid math — recomputing this every render would be wasteful for
  // a calendar that re-mounts inside frequently re-rendered table rows.
  const { daysInMonth, firstDayOfWeek } = useMemo(
    () => ({
      daysInMonth: jalaliMonthLength(viewYear, viewMonth),
      firstDayOfWeek: getJalaliDayOfWeek(viewYear, viewMonth, 1),
    }),
    [viewYear, viewMonth],
  );

  // The "currently selected" day for highlighting in the grid.
  const selected = initial;

  // Display label rendered inside the trigger button. We reuse the shared
  // formatter so digits / separators always match the rest of the UI.
  const displayValue = formatGregorianToJalali(value, mode === "datetime", "");

  // -----------------------------------------------------------------------
  // Persist a selection — converts the Jalali day (+ current time string in
  // datetime mode) to a Gregorian ISO value and bubbles it up via onChange.
  // -----------------------------------------------------------------------
  const commit = (day: number, time?: string) => {
    const jalaliStr = `${viewYear}/${String(viewMonth).padStart(2, "0")}/${String(day).padStart(2, "0")}`;
    if (mode === "datetime") {
      const t = time ?? timeStr ?? "00:00";
      onChange(jalaliToGregorianTimestamp(jalaliStr, t || "00:00"));
    } else {
      onChange(jalaliToGregorianDate(jalaliStr));
    }
  };

  // Pressing a day commits + closes the popover. In datetime mode we keep
  // the popover open so the user can also tweak the time without re-opening.
  const selectDay = (day: number) => {
    commit(day);
    if (mode !== "datetime") setOpen(false);
  };

  // Time changes only matter when we already have a selected date — there's
  // nothing to commit otherwise. We update local state regardless so typing
  // remains responsive.
  const onTimeChange = (next: string) => {
    setTimeStr(next);
    if (selected && /^\d{1,2}:\d{2}$/.test(next)) {
      commit(selected.day, next);
    }
  };

  const prevMonth = () => {
    if (viewMonth === 1) { setViewMonth(12); setViewYear(viewYear - 1); }
    else setViewMonth(viewMonth - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 12) { setViewMonth(1); setViewYear(viewYear + 1); }
    else setViewMonth(viewMonth + 1);
  };

  return (
    <div className={cn("space-y-2", className)}>
      {label && <label className="block text-sm font-medium text-foreground">{label}</label>}
      <div className="relative">
        {/* Trigger looks like a normal input but opens a Jalali calendar. */}
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen(!open)}
          className="w-full touch-target rounded-xl border border-input bg-background px-4 py-3 text-right text-body flex items-center justify-between gap-2 transition-all duration-200 hover:border-primary/30 focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
        >
          <CalendarIcon className="w-4 h-4 text-muted-foreground shrink-0" />
          <span className={cn("flex-1", !displayValue && "text-muted-foreground")}>
            {displayValue || placeholder}
          </span>
          {/* Clear button — only visible when there's something to clear. */}
          {clearable && value && !disabled && (
            <span
              role="button"
              tabIndex={-1}
              onClick={(e) => { e.stopPropagation(); onChange(null); setTimeStr(""); }}
              className="text-muted-foreground hover:text-foreground text-xs px-1"
              aria-label="پاک کردن تاریخ"
            >
              ✕
            </span>
          )}
        </button>

        {open && (
          <div className="absolute z-50 mt-1 right-0 min-w-[300px] rounded-xl border border-border bg-card shadow-lg animate-fade-in p-4">
            {/* Month nav — RTL: chevron-right moves to next month visually. */}
            <div className="flex items-center justify-between mb-4">
              <button type="button" onClick={nextMonth} className="p-1 rounded-lg hover:bg-secondary transition-colors">
                <ChevronRight className="w-5 h-5 text-muted-foreground" />
              </button>
              <span className="text-sm font-bold text-foreground">
                {jalaliMonthNames[viewMonth - 1]} {toPersianDigits(viewYear)}
              </span>
              <button type="button" onClick={prevMonth} className="p-1 rounded-lg hover:bg-secondary transition-colors">
                <ChevronLeft className="w-5 h-5 text-muted-foreground" />
              </button>
            </div>

            <div className="grid grid-cols-7 gap-1 mb-2">
              {jalaliWeekDays.map((d) => (
                <div key={d} className="text-center text-xs font-medium text-muted-foreground py-1">{d}</div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-1">
              {/* Leading empty cells push day 1 to its real weekday column. */}
              {Array.from({ length: firstDayOfWeek }).map((_, i) => <div key={`e-${i}`} />)}
              {Array.from({ length: daysInMonth }).map((_, i) => {
                const day = i + 1;
                const isSelected =
                  selected?.year === viewYear && selected?.month === viewMonth && selected?.day === day;
                const isToday =
                  today.year === viewYear && today.month === viewMonth && today.day === day;
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => selectDay(day)}
                    className={cn(
                      "w-full aspect-square flex items-center justify-center rounded-lg text-sm transition-all duration-150",
                      isSelected
                        ? "bg-primary text-primary-foreground font-bold"
                        : isToday
                        ? "bg-primary/10 text-primary font-medium"
                        : "hover:bg-secondary text-foreground",
                    )}
                  >
                    {toPersianDigits(day)}
                  </button>
                );
              })}
            </div>

            {/* Time input — only rendered in datetime mode. Native time input
                gives us free keyboard/scroll support across browsers. */}
            {mode === "datetime" && (
              <div className="mt-4 flex items-center gap-2 justify-end" dir="ltr">
                <input
                  type="time"
                  value={timeStr}
                  onChange={(e) => onTimeChange(e.target.value)}
                  className="rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-lg bg-primary text-primary-foreground px-3 py-2 text-sm font-medium hover:opacity-90"
                >
                  تأیید
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
