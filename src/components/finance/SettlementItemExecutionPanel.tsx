// =============================================================================
// SettlementItemExecutionPanel — Phase 8
// -----------------------------------------------------------------------------
// Per-item execution UI rendered inside the request detail view. It routes
// by `payment_method` to a small set of method-specific actions:
//
//   bank_transfer → "ثبت انجام پرداخت"  → execute (status='executed')
//   check         → "صدور چک"           → opens NewPayableCheckDialog;
//                                          on creation links the check and
//                                          flips status to 'linked'.
//   cashbox       → "ثبت پرداخت صندوق"  → execute (status='executed')
//   deferred      → "تمدید" / "پیگیری" / "بستن"
//                    تمدید   → extend_due_date  (status UNCHANGED)
//                    پیگیری → followup note    (status UNCHANGED)
//                    بستن    → execute         (status='executed')
//   barter        → "ثبت انجام تهاتر"   → execute (status='executed')
//
// Plus method-agnostic actions: hold/resume/cancel/reject/reopen.
//
// Important: this component DOES NOT mirror downstream lifecycles. After a
// check is linked, the check module owns its lifecycle entirely. After a
// bank_transfer execute, the bank-transaction / allocation flow owns it.
// We only record "execution was declared" and append a typed event row.
// =============================================================================
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import ShamsiDatePicker from "@/components/ShamsiDatePicker";
import { toast } from "sonner";
import {
  CheckCircle2,
  FileText,
  Banknote,
  Wallet,
  RotateCcw,
  Pause,
  Play,
  XCircle,
  CalendarClock,
  MessageSquare,
  Lock,
} from "lucide-react";
import NewPayableCheckDialog from "@/components/finance/checks/NewPayableCheckDialog";
import SettlementItemEventTimeline from "@/components/finance/SettlementItemEventTimeline";
import {
  cancelSettlementItem,
  executeSettlementItem,
  extendSettlementItemDueDate,
  holdSettlementItem,
  labelForExecutionStatus,
  linkSettlementItemToCheck,
  rejectSettlementItem,
  reopenSettlementItem,
  resumeSettlementItem,
} from "@/lib/finance/settlementExecution";
import { jalaliToGregorianDate } from "@/lib/dateUtils";

// -----------------------------------------------------------------------------
// Local "item view" — only the fields this panel needs. Kept loose on
// purpose: callers pass already-fetched rows from finance_payment_request_items
// directly, so we don't enforce the full type and stay decoupled from PRItemFull.
// -----------------------------------------------------------------------------
export interface ExecPanelItem {
  id: string;
  party_id?: string | null;
  amount: number;
  payment_method?: string | null;
  due_date?: string | null;
  description?: string | null;
  execution_status?: string | null;
  // Task 1: optional method-specific payload (matches finance_payment_request_items.details).
  // Typed loosely so this panel stays decoupled from PRItemFull; we only
  // read a couple of fields (payee_name, payee_national_id) for check seeding.
  details?: Record<string, unknown> | null;
}

interface Props {
  item: ExecPanelItem;
  // Called after any successful action so the parent can reload the items
  // list (status badges, progress summary, etc.). Kept as a callback rather
  // than a query-cache invalidation because PRDetail uses local state.
  onChanged: () => void | Promise<void>;
}

export default function SettlementItemExecutionPanel({ item, onChanged }: Props) {
  // Sub-dialog visibility flags. Only one is shown at a time so it's fine to
  // keep them as independent booleans rather than a discriminated union.
  const [openBank, setOpenBank] = useState(false);
  const [openCheck, setOpenCheck] = useState(false);
  const [openCashbox, setOpenCashbox] = useState(false);
  const [openBarter, setOpenBarter] = useState(false);
  const [openExtend, setOpenExtend] = useState(false);
  const [openFollowup, setOpenFollowup] = useState(false);
  const [openClose, setOpenClose] = useState(false);
  const [openHold, setOpenHold] = useState(false);
  const [openCancel, setOpenCancel] = useState(false);
  const [openReject, setOpenReject] = useState(false);
  const [openReopen, setOpenReopen] = useState(false);

  // Legacy items are read-only by spec — show a static notice and bail out
  // before rendering any action. The DB transition trigger also blocks them,
  // but hiding the UI keeps the operator from even attempting an action.
  if (item.payment_method === "legacy") {
    return (
      <div className="rounded-lg border border-amber-400/30 bg-amber-50/40 dark:bg-amber-950/20 p-2 text-[11px] text-amber-800 dark:text-amber-200">
        این آیتم قدیمی است و قابل اجرا نیست.
      </div>
    );
  }

  const status = item.execution_status ?? "pending";
  const isTerminal =
    status === "executed" ||
    status === "linked" ||
    status === "cancelled" ||
    status === "rejected";
  const isHeld = status === "on_hold";

  // ---------------------------------------------------------------------------
  // Action visibility rules
  // ---------------------------------------------------------------------------
  // We don't gate strictly on "ready_for_execution" because most operators
  // skip the explicit ready step today — the DB trigger validates whatever
  // transition we attempt, so the UI just needs to keep the action visible
  // when it's plausible. Terminal states hide everything except reopen.
  const canExecutePrimary = !isTerminal && !isHeld;
  // Hand-off matrix per payment_method — only the primary execute button for
  // the current method is shown, to avoid suggesting an action that doesn't
  // match the row's method.
  const showBank = canExecutePrimary && item.payment_method === "bank_transfer";
  const showCheck = canExecutePrimary && item.payment_method === "check";
  const showCashbox = canExecutePrimary && item.payment_method === "cashbox";
  const showBarter = canExecutePrimary && item.payment_method === "barter";
  const showDeferred = canExecutePrimary && item.payment_method === "deferred";

  return (
    <div className="rounded-lg border bg-card/40 p-2 space-y-2">
      {/* Status header — single-line so it stays compact when many items
          are stacked in the request detail. */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-muted-foreground">وضعیت اجرا</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded border bg-muted text-foreground/80">
          {labelForExecutionStatus(status)}
        </span>
      </div>

      {/* ----- Primary (per-method) actions ----- */}
      <div className="flex flex-wrap gap-1.5">
        {showBank && (
          <Button size="sm" variant="outline" onClick={() => setOpenBank(true)}>
            <Banknote className="w-3.5 h-3.5 ml-1" /> ثبت انجام پرداخت
          </Button>
        )}
        {showCheck && (
          <Button size="sm" variant="outline" onClick={() => setOpenCheck(true)}>
            <FileText className="w-3.5 h-3.5 ml-1" /> صدور چک
          </Button>
        )}
        {showCashbox && (
          <Button size="sm" variant="outline" onClick={() => setOpenCashbox(true)}>
            <Wallet className="w-3.5 h-3.5 ml-1" /> ثبت پرداخت صندوق
          </Button>
        )}
        {showBarter && (
          <Button size="sm" variant="outline" onClick={() => setOpenBarter(true)}>
            <CheckCircle2 className="w-3.5 h-3.5 ml-1" /> ثبت انجام تهاتر
          </Button>
        )}
        {showDeferred && (
          <>
            <Button size="sm" variant="outline" onClick={() => setOpenExtend(true)}>
              <CalendarClock className="w-3.5 h-3.5 ml-1" /> تمدید
            </Button>
            <Button size="sm" variant="outline" onClick={() => setOpenFollowup(true)}>
              <MessageSquare className="w-3.5 h-3.5 ml-1" /> پیگیری
            </Button>
            <Button size="sm" variant="outline" onClick={() => setOpenClose(true)}>
              <Lock className="w-3.5 h-3.5 ml-1" /> بستن
            </Button>
          </>
        )}

        {/* ----- Method-agnostic actions ----- */}
        {canExecutePrimary && (
          <Button size="sm" variant="ghost" onClick={() => setOpenHold(true)}>
            <Pause className="w-3.5 h-3.5 ml-1" /> توقف
          </Button>
        )}
        {isHeld && (
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              try { await resumeSettlementItem(item.id); toast.success("از سرگیری شد"); await onChanged(); }
              catch (e) { toast.error((e as Error).message); }
            }}
          >
            <Play className="w-3.5 h-3.5 ml-1" /> از سرگیری
          </Button>
        )}
        {!isTerminal && (
          <>
            <Button size="sm" variant="ghost" onClick={() => setOpenCancel(true)}>
              <XCircle className="w-3.5 h-3.5 ml-1" /> لغو
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpenReject(true)}>
              <XCircle className="w-3.5 h-3.5 ml-1" /> رد
            </Button>
          </>
        )}
        {isTerminal && (
          <Button size="sm" variant="ghost" onClick={() => setOpenReopen(true)}>
            <RotateCcw className="w-3.5 h-3.5 ml-1" /> بازگشایی
          </Button>
        )}
      </div>

      {/* Event timeline — collapsed-by-default would be nicer but always-on
          keeps the panel transparent and matches the cattle-farm CRM's
          "everything is auditable" expectation. */}
      <div className="pt-1 border-t border-dashed">
        <SettlementItemEventTimeline itemId={item.id} />
      </div>

      {/* =====================================================================
          Sub-dialogs (rendered conditionally for cheap state isolation)
          ===================================================================== */}

      {/* bank_transfer — minimal execution form */}
      {openBank && (
        <SimpleExecuteDialog
          title="ثبت انجام پرداخت بانکی"
          fields={["reference_note", "external_ref"]}
          onClose={() => setOpenBank(false)}
          onSubmit={async (payload, note) => {
            await executeSettlementItem(item.id, "bank_transfer", payload, note);
            toast.success("پرداخت بانکی ثبت شد");
            await onChanged();
          }}
        />
      )}

      {/* check — reuses the existing NewPayableCheckDialog, then links */}
      {openCheck && (
        <NewPayableCheckDialog
          open={openCheck}
          onOpenChange={setOpenCheck}
          seed={{
            partyId: item.party_id ?? undefined,
            amount: item.amount,
            dueDateISO: item.due_date ?? undefined,
            description: item.description ?? undefined,
            // Task 1: forward payee identity (name + national id) from the
            // settlement item's details jsonb so the operator can verify the
            // recipient inside the cheque dialog without re-typing.
            payeeName: (item.details as Record<string, unknown> | null | undefined)?.payee_name as string | undefined,
            payeeNationalId: (item.details as Record<string, unknown> | null | undefined)?.payee_national_id as string | undefined,
          }}
          onCreated={async (checkId) => {
            // Link runs in its own try/catch — if linking fails we surface a
            // distinct toast so the operator knows the CHECK was created but
            // the SETTLEMENT side wasn't updated yet (can be retried).
            try {
              await linkSettlementItemToCheck(item.id, checkId);
              toast.success("چک به آیتم تسویه متصل شد");
              await onChanged();
            } catch (e) {
              toast.error("چک صادر شد اما اتصال انجام نشد: " + (e as Error).message);
            }
          }}
        />
      )}

      {/* cashbox */}
      {openCashbox && (
        <SimpleExecuteDialog
          title="ثبت پرداخت صندوق"
          fields={["cashbox_label", "receipt_no"]}
          onClose={() => setOpenCashbox(false)}
          onSubmit={async (payload, note) => {
            await executeSettlementItem(item.id, "cashbox", payload, note);
            toast.success("پرداخت صندوق ثبت شد");
            await onChanged();
          }}
        />
      )}

      {/* barter */}
      {openBarter && (
        <SimpleExecuteDialog
          title="ثبت انجام تهاتر"
          fields={["barter_reference", "counter_factor_id"]}
          onClose={() => setOpenBarter(false)}
          onSubmit={async (payload, note) => {
            await executeSettlementItem(item.id, "barter", payload, note);
            toast.success("تهاتر ثبت شد");
            await onChanged();
          }}
        />
      )}

      {/* deferred — تمدید */}
      {openExtend && (
        <ExtendDueDateDialog
          onClose={() => setOpenExtend(false)}
          onSubmit={async (newDueISO, note) => {
            await extendSettlementItemDueDate(item.id, newDueISO, note);
            toast.success("سررسید تمدید شد");
            await onChanged();
          }}
        />
      )}

      {/* deferred — پیگیری (note only, status unchanged) */}
      {openFollowup && (
        <ReasonDialog
          title="یادداشت پیگیری"
          submitLabel="ثبت پیگیری"
          requireReason
          onClose={() => setOpenFollowup(false)}
          onSubmit={async (reason) => {
            // We piggy-back on extend_due_date with the same date — there is
            // no dedicated followup RPC and adding one is overkill. We could
            // simply write a no-op via the events insert path, but the
            // cleanest no-status-change action is "extend to same date with a
            // note". This is intentional: deferred actions must NEVER flip
            // status, and extend is the only RPC that guarantees that.
            await extendSettlementItemDueDate(
              item.id,
              item.due_date ?? new Date().toISOString().slice(0, 10),
              reason,
            );
            toast.success("یادداشت ثبت شد");
            await onChanged();
          }}
        />
      )}

      {/* deferred — بستن */}
      {openClose && (
        <ReasonDialog
          title="بستن آیتم معوق"
          submitLabel="بستن"
          requireReason
          onClose={() => setOpenClose(false)}
          onSubmit={async (reason) => {
            await executeSettlementItem(
              item.id,
              "deferred",
              { closure_reason: reason },
              reason,
            );
            toast.success("آیتم بسته شد");
            await onChanged();
          }}
        />
      )}

      {/* hold */}
      {openHold && (
        <ReasonDialog
          title="توقف موقت"
          submitLabel="توقف"
          requireReason
          onClose={() => setOpenHold(false)}
          onSubmit={async (reason) => {
            await holdSettlementItem(item.id, reason);
            toast.success("آیتم متوقف شد");
            await onChanged();
          }}
        />
      )}

      {/* cancel */}
      {openCancel && (
        <ReasonDialog
          title="لغو آیتم"
          submitLabel="لغو"
          requireReason
          onClose={() => setOpenCancel(false)}
          onSubmit={async (reason) => {
            await cancelSettlementItem(item.id, reason);
            toast.success("آیتم لغو شد");
            await onChanged();
          }}
        />
      )}

      {/* reject */}
      {openReject && (
        <ReasonDialog
          title="رد آیتم"
          submitLabel="رد"
          requireReason
          onClose={() => setOpenReject(false)}
          onSubmit={async (reason) => {
            await rejectSettlementItem(item.id, reason);
            toast.success("آیتم رد شد");
            await onChanged();
          }}
        />
      )}

      {/* reopen */}
      {openReopen && (
        <ReasonDialog
          title="بازگشایی آیتم"
          submitLabel="بازگشایی"
          requireReason
          onClose={() => setOpenReopen(false)}
          onSubmit={async (reason) => {
            await reopenSettlementItem(item.id, reason);
            toast.success("آیتم بازگشایی شد");
            await onChanged();
          }}
        />
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// SimpleExecuteDialog — generic 1..2 text-field execution dialog used by
// bank_transfer / cashbox / barter. We deliberately keep the schema loose
// (jsonb) because the downstream modules own the canonical truth; this
// dialog only collects a human-readable trace for the event timeline.
// -----------------------------------------------------------------------------
function SimpleExecuteDialog({
  title,
  fields,
  onClose,
  onSubmit,
}: {
  title: string;
  fields: string[];
  onClose: () => void;
  onSubmit: (payload: Record<string, string>, note: string) => Promise<void>;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  // Persian labels per known field key — the dialog is generic but the keys
  // we pass are a closed set, so a small lookup is fine and keeps the UI
  // localised without dragging an i18n framework in.
  const LABEL_FA: Record<string, string> = {
    reference_note: "شماره مرجع",
    external_ref: "شناسه بیرونی",
    cashbox_label: "نام صندوق",
    receipt_no: "شماره رسید",
    barter_reference: "شماره مرجع تهاتر",
    counter_factor_id: "شناسه فاکتور متقابل",
  };

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <div className="space-y-2">
          {fields.map((k) => (
            <div key={k}>
              <Label>{LABEL_FA[k] ?? k}</Label>
              <Input value={values[k] ?? ""} onChange={(e) => setValues({ ...values, [k]: e.target.value })} />
            </div>
          ))}
          <div>
            <Label>یادداشت</Label>
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>انصراف</Button>
          <Button
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              try {
                // Trim and drop empties so details.execution doesn't carry
                // visually empty fields.
                const payload: Record<string, string> = {};
                for (const k of fields) if ((values[k] || "").trim()) payload[k] = values[k].trim();
                await onSubmit(payload, note.trim());
                onClose();
              } catch (e) { toast.error((e as Error).message); }
              finally { setSaving(false); }
            }}
          >
            ثبت
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// -----------------------------------------------------------------------------
// ExtendDueDateDialog — Shamsi date picker → ISO Gregorian. The RPC validates
// that the date is non-null; we additionally require Shamsi → ISO conversion
// to succeed before submitting.
// -----------------------------------------------------------------------------
function ExtendDueDateDialog({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (newDueISO: string, note: string) => Promise<void>;
}) {
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>تمدید سررسید</DialogTitle></DialogHeader>
        <div className="space-y-2">
          <div>
            <Label>سررسید جدید</Label>
            <ShamsiDatePicker value={date} onChange={setDate} placeholder="انتخاب تاریخ" />
          </div>
          <div>
            <Label>یادداشت</Label>
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <p className="text-[11px] text-muted-foreground">
            تمدید فقط تاریخ سررسید را تغییر می‌دهد و وضعیت آیتم را اجرا نمی‌کند.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>انصراف</Button>
          <Button
            disabled={saving}
            onClick={async () => {
              const iso = jalaliToGregorianDate(date);
              if (!iso) { toast.error("تاریخ معتبر نیست"); return; }
              setSaving(true);
              try { await onSubmit(iso, note.trim()); onClose(); }
              catch (e) { toast.error((e as Error).message); }
              finally { setSaving(false); }
            }}
          >
            ثبت تمدید
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// -----------------------------------------------------------------------------
// ReasonDialog — reusable "type a reason and confirm" dialog. Used by every
// transition that requires an operator note (cancel, reject, hold, reopen,
// followup, deferred-close).
// -----------------------------------------------------------------------------
function ReasonDialog({
  title,
  submitLabel,
  requireReason,
  onClose,
  onSubmit,
}: {
  title: string;
  submitLabel: string;
  requireReason?: boolean;
  onClose: () => void;
  onSubmit: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <div className="space-y-2">
          <Label>توضیحات{requireReason ? " (الزامی)" : ""}</Label>
          <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>انصراف</Button>
          <Button
            disabled={saving}
            onClick={async () => {
              if (requireReason && !reason.trim()) { toast.error("توضیحات الزامی است"); return; }
              setSaving(true);
              try { await onSubmit(reason.trim()); onClose(); }
              catch (e) { toast.error((e as Error).message); }
              finally { setSaving(false); }
            }}
          >
            {submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
