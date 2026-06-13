// =============================================================================
// SettlementRequestProgressSummary — Phase 8
// -----------------------------------------------------------------------------
// Compact strip placed at the top of a payment-request detail view, showing
// both a per-state count breakdown AND three monetary KPIs:
//   • مبلغ کل تعهد        = sum(amount)
//   • مبلغ اجراشده        = sum(amount where status in 'executed','linked')
//   • مبلغ باقیمانده      = total − executed
//
// The component is intentionally pure (no fetch) — the parent already loads
// the items list, so we derive everything client-side. This avoids a second
// round-trip and keeps the summary perfectly in sync with the list below it.
// =============================================================================
import { MoneyCell } from "@/components/finance/atoms";
import { categorizeStatus } from "@/lib/finance/settlementExecution";

interface ItemLite {
  amount: number | null;
  execution_status?: string | null;
  // payment_method is read only to exclude legacy rows from the counts —
  // legacy items belong to the pre-Phase-3 world and cannot be executed,
  // so showing them in the progress would be misleading.
  payment_method?: string | null;
}

export default function SettlementRequestProgressSummary({
  items,
}: {
  items: ItemLite[];
}) {
  // Filter out legacy rows: they cannot transition through the execution
  // lifecycle so they shouldn't affect "in progress" / "executed" counts.
  const live = items.filter((i) => i.payment_method !== "legacy");

  // Count by bucket. categorizeStatus collapses partially_executed → executed
  // and rejected → cancelled so the chip set stays small (6 chips).
  const buckets: Record<
    "executed" | "linked" | "in_progress" | "on_hold" | "cancelled" | "pending",
    number
  > = {
    executed: 0,
    linked: 0,
    in_progress: 0,
    on_hold: 0,
    cancelled: 0,
    pending: 0,
  };
  for (const it of live) buckets[categorizeStatus(it.execution_status)]++;

  // Monetary KPIs. We use the item's `amount` (the original commitment) and
  // NOT confirmed_amount/paid_amount — those belong to the approval+payment
  // axis tracked elsewhere. "Executed" here means "the operator declared the
  // settlement-item done or handed off"; downstream financial reality is
  // tracked by the existing bank/check/cashbox modules and is out of scope.
  const total = live.reduce((s, i) => s + Number(i.amount || 0), 0);
  const executed = live
    .filter((i) => {
      const c = categorizeStatus(i.execution_status);
      return c === "executed" || c === "linked";
    })
    .reduce((s, i) => s + Number(i.amount || 0), 0);
  const remaining = Math.max(0, total - executed);

  // Simple progress percentage for the bar. Guard against division by zero
  // when there are no items yet (e.g. brand-new draft).
  const pct = total > 0 ? Math.min(100, Math.round((executed / total) * 100)) : 0;

  return (
    <div className="rounded-xl border bg-card/60 p-3 space-y-3">
      {/* ----- Count chips (one chip per bucket) ----- */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-xs font-bold text-muted-foreground">پیشرفت اجرا</span>
        <div className="flex items-center gap-1.5 flex-wrap">
          <Chip label="کل" value={live.length} tone="muted" />
          <Chip label="اجراشده" value={buckets.executed} tone="success" />
          <Chip label="ارجاع‌شده" value={buckets.linked} tone="info" />
          <Chip label="در حال اجرا" value={buckets.in_progress} tone="warning" />
          <Chip label="متوقف" value={buckets.on_hold} tone="muted" />
          <Chip label="لغو" value={buckets.cancelled} tone="danger" />
        </div>
      </div>

      {/* ----- Progress bar (executed+linked / total) ----- */}
      <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
        {/* We use bg-primary (the agricultural green token) so the bar
            inherits the global theme without hard-coding any colour. */}
        <div
          className="h-full bg-primary transition-all"
          style={{ width: `${pct}%` }}
          aria-label={`${pct}%`}
        />
      </div>

      {/* ----- Monetary KPIs (total / executed / remaining) ----- */}
      <div className="grid grid-cols-3 gap-2">
        <KPI label="مبلغ کل تعهد" value={total} />
        <KPI label="مبلغ اجراشده" value={executed} positive />
        <KPI label="مبلغ باقیمانده" value={remaining} negative={remaining > 0} />
      </div>
    </div>
  );
}

// --- internal atoms ---------------------------------------------------------
// Kept inside this file because they're trivial and never reused.

function Chip({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "success" | "info" | "warning" | "danger" | "muted";
}) {
  // We map each tone to semantic tokens only (per the global design rule:
  // no raw colour classes in components). tone is a small fixed enum so the
  // mapping table can stay inline without losing type safety.
  const cls: Record<typeof tone, string> = {
    success: "bg-primary/15 text-primary border-primary/30",
    info: "bg-accent/30 text-foreground border-border",
    warning: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
    danger: "bg-destructive/15 text-destructive border-destructive/30",
    muted: "bg-muted text-foreground/80 border-border",
  };
  return (
    <span
      className={
        "text-[10px] px-1.5 py-0.5 rounded border tabular-nums " + cls[tone]
      }
    >
      {label}: {toFa(value)}
    </span>
  );
}

function KPI({
  label,
  value,
  positive,
  negative,
}: {
  label: string;
  value: number;
  positive?: boolean;
  negative?: boolean;
}) {
  return (
    <div className="rounded-lg border p-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <MoneyCell value={value} className="text-sm" positive={positive} negative={negative} />
    </div>
  );
}

// Tiny ASCII-to-Persian digit helper (only used for chip counts). Keeping it
// local so we don't import a heavier i18n util for a 6-call use case.
function toFa(n: number): string {
  return String(n).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[+d]);
}
