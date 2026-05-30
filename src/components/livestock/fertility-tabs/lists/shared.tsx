// Shared helpers used by every per-operation fertility list table.
// Keeping these centralised lets each list component focus only on its own
// columns instead of re-implementing date/time formatting and action buttons.
import { Pencil, Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatShamsi } from "@/lib/dateDisplay";
import type { FertilityEvent } from "@/lib/fertility";

// EmptyState — every list renders this when there are zero rows for the type.
// Reusing one tiny component keeps the look consistent across tabs.
export function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-card/40 p-8 text-center text-sm text-muted-foreground">
      {text}
    </div>
  );
}

// TableShell — gives every list the same surface chrome: card background,
// border, rounded corners, and horizontal scroll on small screens so the
// many columns stay accessible on phones without breaking the desktop view.
export function TableShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card overflow-x-auto">
      <table className="w-full text-sm border-collapse min-w-[720px]">
        {children}
      </table>
    </div>
  );
}

// Th / Td — semantic-token cells. Keeping them as components avoids
// repeating the same Tailwind classes in every list file and ensures any
// future spacing/typography tweak only needs to change in one place.
export function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={`text-right font-medium text-xs text-muted-foreground px-3 py-2.5 border-b border-border bg-muted/30 whitespace-nowrap ${className}`}>
      {children}
    </th>
  );
}

export function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <td className={`px-3 py-2.5 text-foreground align-top ${className}`}>
      {children || <span className="text-muted-foreground">—</span>}
    </td>
  );
}

// formatEventDateTime — every fertility list shows a Jalali date + a time.
// The time portion is stored either inside event_date itself (timestamp)
// or — for older rows — inside metadata.time. We prefer metadata.time when
// present so the user sees exactly the value they typed in the form.
export function formatEventDateTime(
  eventDate: string | null,
  metadataTime?: unknown,
): { date: string; time: string } {
  // formatShamsi handles both date-only and timestamp inputs.
  const date = eventDate ? formatShamsi(eventDate) : "";
  // Prefer the explicit form-time when available; otherwise extract HH:MM from
  // the timestamp tail. Falsy values render as the muted dash in <Td>.
  let time = "";
  if (typeof metadataTime === "string" && /^\d{1,2}:\d{2}/.test(metadataTime)) {
    time = metadataTime;
  } else if (eventDate && /\d{2}:\d{2}/.test(eventDate)) {
    const m = eventDate.match(/(\d{2}:\d{2})/);
    if (m) time = m[1];
  }
  return { date, time };
}

// CancelBadge — a small visual marker so cancelled rows are obvious in the
// table without changing the column layout. We avoid hiding cancelled rows
// here because that filter already lives in the parent FertilitySection.
export function CancelBadge({ e }: { e: FertilityEvent }) {
  if (!e.is_cancelled) return null;
  return (
    <Badge variant="destructive" className="text-[10px]">لغو شده</Badge>
  );
}

// RowActions — every list ends with the same edit/cancel pair. Extracting
// it lets each list file only worry about its own data columns. The buttons
// reuse the existing setEditEvent / setCancelEvent state in FertilitySection,
// so editing/cancelling continues to use the canonical dialogs.
export function RowActions({
  e,
  onEdit,
  onCancel,
  extra,
}: {
  e: FertilityEvent;
  onEdit?: (e: FertilityEvent) => void;
  onCancel?: (e: FertilityEvent) => void;
  // `extra` lets list-specific actions (e.g. "Create calves" on calving rows)
  // sit next to the shared edit/cancel buttons without each list re-creating
  // the wrapper div.
  extra?: React.ReactNode;
}) {
  // Cancelled rows are read-only — there's nothing to edit or cancel again.
  const disabled = !!e.is_cancelled;
  return (
    <div className="flex items-center gap-1 justify-end">
      {extra}
      {onEdit && (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => onEdit(e)}
          disabled={disabled}
          title="ویرایش"
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      )}
      {onCancel && (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-destructive hover:text-destructive"
          onClick={() => onCancel(e)}
          disabled={disabled}
          title="لغو"
        >
          <Ban className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}

// pick — tiny helper for reading typed values out of the JSONB metadata bag
// without sprinkling `(e.metadata as any)?.foo` everywhere.
export function pick<T = unknown>(metadata: Record<string, unknown> | null | undefined, key: string): T | undefined {
  if (!metadata) return undefined;
  return metadata[key] as T | undefined;
}

// yesNo — many forms store booleans (e.g. is_helped). The user sees Persian
// values in the form, so the list should mirror that wording.
export function yesNo(v: unknown): string {
  if (v === true) return "بله";
  if (v === false) return "خیر";
  return "";
}
