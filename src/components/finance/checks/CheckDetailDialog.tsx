// =============================================================================
// CheckDetailDialog
// -----------------------------------------------------------------------------
// Modal that shows the full information for a single check together with its
// complete event timeline. The dialog also renders the action buttons that
// are valid for the check's current status (via allowedTransitions) and
// dispatches the status update + event insert in a single helper.
// =============================================================================
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  useCheck, useCheckEvents, useInvalidateChecks, type CheckRow,
} from "@/hooks/useChecks";
import { useInvalidateCheckbooks } from "@/hooks/useCheckbooks";
import StatusBadge from "./StatusBadge";
import {
  allowedTransitions, DIRECTION_LABEL, EVENT_LABEL, partyLabel, bankLabel,
  TERMINAL_STATUSES, CATEGORY_LABEL, CANCEL_REASON_LABEL,
  type CheckStatus, type CheckEventType, type CancelReason,
} from "@/lib/checks";
import { JalaliDateCell, MoneyCell } from "@/components/finance/atoms";
import { Clock, FileText, ShieldCheck, Ban } from "lucide-react";

interface Props {
  checkId: string | null;
  onOpenChange: (open: boolean) => void;
}

// Map a transition action → the matching check_event_type enum value. We need
// this so the timeline shows a meaningful row, not just "status_change".
const ACTION_EVENT: Record<string, CheckEventType> = {
  deposit: "deposited_to_bank",
  transfer_to_party: "transferred_to_party",
  clear: "cleared",
  bounce: "bounced",
  void: "voided",
  mark_lost: "marked_lost",
  deliver: "delivered",
};

export default function CheckDetailDialog({ checkId, onOpenChange }: Props) {
  const { data: check } = useCheck(checkId);
  const { data: events = [] } = useCheckEvents(checkId);
  const invalidate = useInvalidateChecks();
  const invalidateBooks = useInvalidateCheckbooks();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  if (!checkId || !check) {
    return (
      <Dialog open={!!checkId} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl"><div className="py-8 text-center text-muted-foreground">در حال بارگیری…</div></DialogContent>
      </Dialog>
    );
  }

  // allowedTransitions now takes category — guarantee checks use a different
  // map, cancelled checks return [] (no actions allowed).
  const transitions = allowedTransitions(check.direction, check.status, check.category);

  // Single helper that flips status + inserts an event. We keep them in one
  // function so the UI never updates one without the other.
  async function doTransition(next: CheckStatus, action: string, label: string) {
    if (!check) return;
    setBusy(true);
    const { error: upErr } = await supabase
      .from("finance_checks" as never)
      .update({ status: next } as never)
      .eq("id", check.id);
    if (upErr) { setBusy(false); return toast.error(upErr.message); }
    const evt = ACTION_EVENT[action] ?? "status_change";
    await supabase.from("finance_check_events" as never).insert({
      check_id: check.id,
      event_type: evt,
      description: label,
      metadata: { from: check.status, to: next, note: note.trim() || null },
    } as never);
    setBusy(false);
    setNote("");
    toast.success(`${label} ثبت شد`);
    invalidate(); invalidateBooks();
  }

  return (
    <Dialog open={!!checkId} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            <span>چک {DIRECTION_LABEL[check.direction]} شماره {check.check_number}</span>
            <StatusBadge status={check.status} />
            {/* Category chip — makes the type explicit when viewing a check
                from any tab. Reuses the same pill styling as StatusBadge. */}
            {check.category !== "operational" && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold border bg-muted/40 text-foreground border-border">
                {check.category === "guarantee" ? <ShieldCheck className="w-3 h-3" /> : <Ban className="w-3 h-3" />}
                {CATEGORY_LABEL[check.category]}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        {/* Top info grid — labels match the form fields exactly. */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
          <InfoCell label="طرف حساب" value={partyLabel(check.party)} />
          <InfoCell label="بانک" value={bankLabel(check.bank)} />
          <InfoCell label="مبلغ" value={<MoneyCell value={check.amount} />} />
          <InfoCell label="شماره صیاد" value={check.sayad_number || "—"} />
          <InfoCell label="تاریخ صدور" value={<JalaliDateCell value={check.issue_date} />} />
          <InfoCell label="تاریخ سررسید" value={<JalaliDateCell value={check.due_date} />} />
          {/* Operational checks: show accounting effect timestamps. */}
          {check.category === "operational" && (
            <>
              <InfoCell label="اثر طرف حساب" value={<JalaliDateCell value={check.party_effected_at} withTime />} />
              <InfoCell label="اثر بانک" value={<JalaliDateCell value={check.bank_effected_at} withTime />} />
            </>
          )}
          {/* Guarantee-specific metadata. */}
          {check.category === "guarantee" && (
            <>
              <InfoCell label="تاریخ انقضا" value={<JalaliDateCell value={check.expiry_date} />} />
              <InfoCell label="موضوع ضمانت" value={check.guarantee_subject || "—"} />
              <InfoCell label="قرارداد مرتبط" value={check.related_contract || "—"} />
              <InfoCell label="پروژه مرتبط" value={check.related_project || "—"} />
            </>
          )}
          {/* Cancelled-specific metadata. */}
          {check.category === "cancelled" && (
            <>
              <InfoCell label="تاریخ ابطال" value={<JalaliDateCell value={check.cancelled_date} />} />
              <InfoCell
                label="علت ابطال"
                value={check.cancel_reason ? CANCEL_REASON_LABEL[check.cancel_reason as CancelReason] : "—"}
              />
            </>
          )}
          {check.description && (
            <div className="col-span-full">
              <div className="text-xs text-muted-foreground mb-1">توضیحات</div>
              <div className="bg-muted/40 rounded p-2 text-xs">{check.description}</div>
            </div>
          )}
        </div>

        {/* Accounting voucher link — only operational checks generate vouchers.
            Guarantee/cancelled show a neutral note instead so the user
            knows nothing was posted to the GL. */}
        {check.category === "operational" ? (
          check.voucher_id && (
            <div className="flex items-center gap-2 text-xs bg-primary/5 border border-primary/20 rounded-md p-2">
              <FileText className="w-3.5 h-3.5 text-primary" />
              <span>سند حسابداری ثبت چک به‌صورت خودکار صادر شده است.</span>
            </div>
          )
        ) : (
          <div className="text-xs text-muted-foreground bg-muted/30 rounded-md p-2">
            این چک سند حسابداری ندارد و روی مانده طرف حساب یا بانک اثر نمی‌گذارد.
          </div>
        )}

        <Separator />


        {/* Action panel — buttons reflect ALLOWED_TRANSITIONS so users can't
            attempt invalid status changes (the DB guard would reject them
            anyway). Terminal checks show a clear notice instead. */}
        {TERMINAL_STATUSES.includes(check.status as CheckStatus) ? (
          <div className="text-xs text-muted-foreground bg-muted/40 rounded p-2 text-center">
            این چک در وضعیت پایانی است و اکشن قابل انجامی ندارد.
          </div>
        ) : (
          <div className="space-y-2">
            <div className="text-xs text-muted-foreground">یادداشت اختیاری برای اکشن بعدی</div>
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="مثلاً «واریز به حساب ملت ۰۰۱»" />
            <div className="flex flex-wrap gap-2">
              {transitions.map((t) => (
                <Button
                  key={t.to + t.action}
                  size="sm"
                  variant={t.action === "void" || t.action === "bounce" ? "destructive" : "default"}
                  disabled={busy}
                  onClick={() => doTransition(t.to, t.action, t.label)}
                >
                  {t.label}
                </Button>
              ))}
            </div>
          </div>
        )}

        <Separator />

        {/* Timeline — most recent event first; renders Persian event label
            from EVENT_LABEL plus the original description text. */}
        <div>
          <div className="flex items-center gap-2 mb-2 text-sm font-bold">
            <Clock className="w-4 h-4 text-primary" /> تاریخچه چک
          </div>
          <div className="space-y-2 max-h-72 overflow-y-auto pl-1">
            {events.map((e) => (
              <div key={e.id} className="border border-border rounded-md p-2 bg-card/50">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold">{EVENT_LABEL[e.event_type as CheckEventType] ?? e.event_type}</span>
                  <JalaliDateCell value={e.event_date} withTime className="text-muted-foreground" />
                </div>
                {e.description && <div className="text-xs text-muted-foreground mt-1">{e.description}</div>}
              </div>
            ))}
            {events.length === 0 && (
              <div className="text-xs text-muted-foreground text-center py-3">رویدادی ثبت نشده است.</div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Tiny presentational helper for the info grid. Keeps the JSX above tidy
// while ensuring every cell has the same label/value layout.
function InfoCell({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="bg-muted/30 rounded p-2">
      <div className="text-[11px] text-muted-foreground mb-0.5">{label}</div>
      <div className="text-sm font-bold">{value}</div>
    </div>
  );
}
