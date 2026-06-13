// =============================================================================
// SettlementItemEventTimeline — Phase 8
// -----------------------------------------------------------------------------
// Read-only list of events recorded against one settlement item. The events
// are written by the Phase 8 RPCs and by the status-change trigger; this
// component just renders them. We deliberately keep it small (no filtering,
// no pagination) because the event volume per item is naturally bounded.
// =============================================================================
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatJalaliDateTime } from "@/lib/finance";
import { labelForExecutionStatus } from "@/lib/finance/settlementExecution";

// Persian labels per event_type. Matches the CHECK constraint in the
// migration; if a new event_type is added there, add the label here too.
const EVENT_LABEL_FA: Record<string, string> = {
  status_change: "تغییر وضعیت",
  executed: "اجرا شد",
  linked: "ارجاع داده شد",
  cancelled: "لغو شد",
  rejected: "رد شد",
  reopened: "بازگشایی شد",
  hold: "متوقف شد",
  resume: "از سرگیری",
  extend_due_date: "تمدید سررسید",
  followup_note: "یادداشت پیگیری",
  check_linked: "ارجاع به چک",
  attachment_added: "پیوست اضافه شد",
  note: "یادداشت",
};

interface EventRow {
  id: string;
  event_type: string;
  from_status: string | null;
  to_status: string | null;
  payload: unknown;
  note: string | null;
  created_at: string;
}

export default function SettlementItemEventTimeline({ itemId }: { itemId: string }) {
  const [rows, setRows] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Re-fetch whenever the item changes. We don't subscribe in real-time —
  // the panel that hosts this component re-mounts the timeline on every
  // execute action, which is enough for the user-facing latency we want.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("finance_settlement_item_events" as never)
        .select("id,event_type,from_status,to_status,payload,note,created_at")
        .eq("item_id", itemId)
        .order("created_at", { ascending: false });
      if (!cancelled) {
        setRows(((data as never as EventRow[]) || []));
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [itemId]);

  if (loading) {
    return <div className="text-[11px] text-muted-foreground p-2">در حال بارگذاری…</div>;
  }
  if (rows.length === 0) {
    return <div className="text-[11px] text-muted-foreground p-2">رویدادی ثبت نشده است.</div>;
  }
  return (
    <ol className="space-y-1.5">
      {rows.map((r) => (
        <li
          key={r.id}
          // Each row is a tiny chip-shaped card. We use bg-muted/30 so the
          // timeline doesn't visually compete with the action buttons above.
          className="text-[11px] rounded border bg-muted/30 px-2 py-1.5"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-bold">
              {EVENT_LABEL_FA[r.event_type] ?? r.event_type}
            </span>
            <span className="text-muted-foreground" dir="ltr">
              {formatJalaliDateTime(r.created_at)}
            </span>
          </div>
          {/* Show the status transition compactly when it's a status_change. */}
          {r.event_type === "status_change" && (
            <div className="text-muted-foreground mt-0.5">
              {labelForExecutionStatus(r.from_status)} ← {labelForExecutionStatus(r.to_status)}
            </div>
          )}
          {/* Operator note (cancellation reason, hold reason, free text). */}
          {r.note && <div className="mt-0.5 break-words">{r.note}</div>}
        </li>
      ))}
    </ol>
  );
}
