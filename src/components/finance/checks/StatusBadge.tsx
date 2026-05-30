// =============================================================================
// StatusBadge — single component used by every check table/list to render the
// current status with consistent Persian wording and semantic colour tones.
// Keeping this in its own tiny file lets the colour mapping live next to its
// only consumer pattern and makes it trivial to reuse on detail pages.
// =============================================================================
import { cn } from "@/lib/utils";
import { STATUS_LABEL, STATUS_TONE, type CheckStatus } from "@/lib/checks";

export default function StatusBadge({
  status,
  className,
}: {
  // We accept the raw enum string straight from Supabase; the maps default to
  // a muted look if a brand-new status is added before this file is updated.
  status: CheckStatus | string | null | undefined;
  className?: string;
}) {
  // Coerce unknown values to a safe default so the badge never throws.
  const s = (status ?? "draft") as CheckStatus;
  const tone = STATUS_TONE[s] ?? "bg-muted text-muted-foreground";
  const label = STATUS_LABEL[s] ?? s;
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold border whitespace-nowrap",
        tone,
        className,
      )}
    >
      {label}
    </span>
  );
}
