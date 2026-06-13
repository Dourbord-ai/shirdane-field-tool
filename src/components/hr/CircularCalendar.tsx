// ============================================================
// CircularCalendar.tsx
// Hero element of the HR module — an interactive ring of dots
// (one per day of the current Shamsi month) wrapped by a
// progress arc. The current day is highlighted; the centre
// shows the month name + day number.
// ============================================================

import { useMemo } from 'react';
import { ShamsiToday, toPersianDigits } from '@/lib/shamsiNow';

interface Props {
  today: ShamsiToday;
  /** 0..3 — how many "yes" answers (drives subtle ring tint) */
  onCallScore?: number;
}

const SIZE = 168;        // SVG viewport (compact)
const RADIUS = 66;       // ring radius for the day dots
const PROGRESS_R = 78;   // progress arc radius (outer)
const STROKE = 5;
const CIRCUM = 2 * Math.PI * PROGRESS_R;

const CircularCalendar = ({ today, onCallScore = 0 }: Props) => {
  const dots = useMemo(() => {
    const arr: Array<{ x: number; y: number; day: number; isToday: boolean; passed: boolean }> = [];
    const total = today.daysInMonth;
    // Start at top (-90deg) and go clockwise visually; in RTL feel keeps it neutral.
    for (let i = 0; i < total; i++) {
      const angle = (-Math.PI / 2) + (i / total) * 2 * Math.PI;
      arr.push({
        x: SIZE / 2 + RADIUS * Math.cos(angle),
        y: SIZE / 2 + RADIUS * Math.sin(angle),
        day: i + 1,
        isToday: i + 1 === today.jd,
        passed: i + 1 < today.jd,
      });
    }
    return arr;
  }, [today.daysInMonth, today.jd]);

  const progressOffset = CIRCUM * (1 - today.monthProgress);

  return (
    <div className="relative mx-auto" style={{ width: SIZE, height: SIZE }}>
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
        <defs>
          <linearGradient id="hrProgress" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="hsl(var(--primary))" />
            <stop offset="100%" stopColor="hsl(var(--secondary))" />
          </linearGradient>
          <radialGradient id="hrCenter" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="hsl(var(--card))" />
            <stop offset="100%" stopColor="hsl(var(--accent))" />
          </radialGradient>
        </defs>

        {/* Background progress track */}
        <circle
          cx={SIZE / 2} cy={SIZE / 2} r={PROGRESS_R}
          fill="none"
          stroke="hsl(var(--muted))"
          strokeWidth={STROKE}
          opacity={0.5}
        />

        {/* Progress arc (rotated so it starts at the top) */}
        <circle
          cx={SIZE / 2} cy={SIZE / 2} r={PROGRESS_R}
          fill="none"
          stroke="url(#hrProgress)"
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={CIRCUM}
          strokeDashoffset={progressOffset}
          transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
          style={{ transition: 'stroke-dashoffset 1.2s ease-out' }}
        />

        {/* Inner soft disc */}
        <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS - 10} fill="url(#hrCenter)" />

        {/* Day dots */}
        {dots.map((d) => (
          <g key={d.day}>
            <circle
              cx={d.x}
              cy={d.y}
              r={d.isToday ? 5 : d.passed ? 2.2 : 1.8}
              fill={d.isToday ? 'hsl(var(--primary))' : d.passed ? 'hsl(var(--primary) / 0.55)' : 'hsl(var(--muted-foreground) / 0.45)'}
              style={{ transition: 'all 0.4s ease' }}
            />
            {d.isToday && (
              <circle
                cx={d.x} cy={d.y} r={8}
                fill="none"
                stroke="hsl(var(--primary))"
                strokeWidth={1.5}
                opacity={0.5}
                className="animate-pulse"
              />
            )}
          </g>
        ))}

        {/* Center text */}
        <text
          x={SIZE / 2}
          y={SIZE / 2 - 8}
          textAnchor="middle"
          fontSize="11"
          fontWeight="600"
          fill="hsl(var(--muted-foreground))"
        >
          {today.monthName}
        </text>
        <text
          x={SIZE / 2}
          y={SIZE / 2 + 22}
          textAnchor="middle"
          fontSize="40"
          fontWeight="800"
          fill="hsl(var(--foreground))"
        >
          {toPersianDigits(today.jd)}
        </text>
      </svg>
    </div>
  );
};

export default CircularCalendar;
