import { useState } from "react";
import { ChevronRight, ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  JalaliDate,
  jalaliMonthNames,
  jalaliWeekDays,
  jalaliMonthLength,
  getJalaliDayOfWeek,
  todayJalali,
  formatJalali,
  toPersianDigits,
} from "@/lib/jalali";

interface JalaliDatePickerProps {
  value: JalaliDate | null;
  onChange: (date: JalaliDate) => void;
  label?: string;
  className?: string;
}

export default function JalaliDatePicker({ value, onChange, label, className }: JalaliDatePickerProps) {
  const today = todayJalali();
  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(value?.year || today.year);
  const [viewMonth, setViewMonth] = useState(value?.month || today.month);

  const daysInMonth = jalaliMonthLength(viewYear, viewMonth);
  const firstDayOfWeek = getJalaliDayOfWeek(viewYear, viewMonth, 1);

  const prevMonth = () => {
    if (viewMonth === 1) { setViewMonth(12); setViewYear(viewYear - 1); }
    else setViewMonth(viewMonth - 1);
  };

  const nextMonth = () => {
    if (viewMonth === 12) { setViewMonth(1); setViewYear(viewYear + 1); }
    else setViewMonth(viewMonth + 1);
  };

  const selectDay = (day: number) => {
    onChange({ year: viewYear, month: viewMonth, day });
    setOpen(false);
  };

  return (
    <div className={cn("space-y-2", className)}>
      {label && <label className="block text-sm font-medium text-foreground">{label}</label>}
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="w-full touch-target rounded-xl border border-input bg-background px-4 py-3 text-right text-body flex items-center justify-between gap-2 transition-all duration-200 hover:shadow-[0_2px_12px_-2px_hsl(142_50%_36%/0.15)] hover:border-primary/20 focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <span className={cn(!value && "text-muted-foreground")}>
            {value ? toPersianDigits(formatJalali(value)) : "انتخاب تاریخ..."}
          </span>
        </button>

        {open && (
          <div className="absolute z-50 mt-1 w-full min-w-[300px] rounded-xl border border-border bg-card shadow-lg animate-fade-in p-4">
            {/* Header */}
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

            {/* Week day headers */}
            <div className="grid grid-cols-7 gap-1 mb-2">
              {jalaliWeekDays.map((d) => (
                <div key={d} className="text-center text-xs font-medium text-muted-foreground py-1">{d}</div>
              ))}
            </div>

            {/* Days */}
            <div className="grid grid-cols-7 gap-1">
              {Array.from({ length: firstDayOfWeek }).map((_, i) => (
                <div key={`e-${i}`} />
              ))}
              {Array.from({ length: daysInMonth }).map((_, i) => {
                const day = i + 1;
                const isSelected = value?.year === viewYear && value?.month === viewMonth && value?.day === day;
                const isToday = today.year === viewYear && today.month === viewMonth && today.day === day;
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
                        : "hover:bg-secondary text-foreground"
                    )}
                  >
                    {toPersianDigits(day)}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
