// =============================================================================
// ChecksTab — the «مدیریت چک‌ها» tab inside Finance.
// -----------------------------------------------------------------------------
// One self-contained component that renders:
//   - KPI cards (totals + due-soon buckets) for operational checks
//   - seven sub-sections: received, payable, guarantee, cancelled,
//     checkbooks, due, bounced
//   - shared reusable table for any list of checks
//   - top-right buttons to open the registration dialogs
// =============================================================================
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Plus, BookCopy, AlertTriangle, CalendarClock, Wallet,
  ArrowDownToLine, ArrowUpFromLine, ShieldCheck, Ban,
} from "lucide-react";
import { useChecks, type CheckRow } from "@/hooks/useChecks";
import { useCheckbooks, useCheckbookLeaves, type CheckbookRow } from "@/hooks/useCheckbooks";
import StatusBadge from "./StatusBadge";
import NewReceivedCheckDialog from "./NewReceivedCheckDialog";
import NewPayableCheckDialog from "./NewPayableCheckDialog";
import NewCheckbookDialog from "./NewCheckbookDialog";
import NewGuaranteeCheckDialog from "./NewGuaranteeCheckDialog";
import NewCancelledCheckDialog from "./NewCancelledCheckDialog";
import CheckDetailDialog from "./CheckDetailDialog";
import GuaranteeChecksTab from "./GuaranteeChecksTab";
import CancelledChecksTab from "./CancelledChecksTab";
import { partyLabel, bankLabel, LEAF_STATUS_LABEL } from "@/lib/checks";
import { JalaliDateCell, MoneyCell } from "@/components/finance/atoms";
import { formatMoney } from "@/lib/finance";

// Sub-tabs configuration — order matches the product spec exactly.
// Operational tabs come first, then guarantee/cancelled, then management
// utility tabs (checkbooks, due, bounced).
const SUBTABS = [
  { key: "received", label: "چک‌های دریافتنی", icon: ArrowDownToLine },
  { key: "payable", label: "چک‌های پرداختنی", icon: ArrowUpFromLine },
  { key: "guarantee", label: "چک‌های ضمانتی", icon: ShieldCheck },
  { key: "cancelled", label: "چک‌های ابطالی", icon: Ban },
  { key: "checkbooks", label: "دسته‌چک‌ها", icon: BookCopy },
  { key: "due", label: "سررسیدها", icon: CalendarClock },
  { key: "bounced", label: "برگشتی‌ها", icon: AlertTriangle },
] as const;

type SubTab = (typeof SUBTABS)[number]["key"];

export default function ChecksTab() {
  const [sub, setSub] = useState<SubTab>("received");
  const [openReceived, setOpenReceived] = useState(false);
  const [openPayable, setOpenPayable] = useState(false);
  const [openCheckbook, setOpenCheckbook] = useState(false);
  const [openGuarantee, setOpenGuarantee] = useState(false);
  const [openCancelled, setOpenCancelled] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  // Fetch ONLY operational checks for the KPI/list views — guarantee and
  // cancelled checks have their own dedicated tabs and must never leak into
  // the received/payable/due/bounced sections per spec.
  const { data: opChecks = [] } = useChecks({ category: "operational" });

  // Bucket operational checks by direction + status for the KPI cards and
  // the bounced section. Memoised to avoid recomputing on every render.
  const buckets = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const weekEnd = new Date(today); weekEnd.setDate(today.getDate() + 7);
    const dueToday = opChecks.filter((c) => {
      const d = c.due_date ? new Date(c.due_date) : null;
      return d && +d === +today;
    });
    const dueThisWeek = opChecks.filter((c) => {
      const d = c.due_date ? new Date(c.due_date) : null;
      return d && d > today && d <= weekEnd;
    });
    const overdue = opChecks.filter((c) => {
      const d = c.due_date ? new Date(c.due_date) : null;
      const open = !["cleared", "voided", "lost"].includes(c.status);
      return open && d && d < today;
    });
    const received = opChecks.filter((c) => c.direction === "received");
    const payable = opChecks.filter((c) => c.direction === "payable");
    const bounced = opChecks.filter((c) => c.status === "bounced");
    const receivedSum = received.filter((c) => !["voided", "bounced"].includes(c.status))
      .reduce((s, c) => s + Number(c.amount || 0), 0);
    const payableSum = payable.filter((c) => !["voided", "bounced", "cleared"].includes(c.status))
      .reduce((s, c) => s + Number(c.amount || 0), 0);
    return { dueToday, dueThisWeek, overdue, received, payable, bounced, receivedSum, payableSum };
  }, [opChecks]);

  // Rows shown in the currently selected operational sub-tab.
  const visibleRows = useMemo(() => {
    switch (sub) {
      case "received": return buckets.received;
      case "payable": return buckets.payable;
      case "due": return [...buckets.overdue, ...buckets.dueToday, ...buckets.dueThisWeek];
      case "bounced": return buckets.bounced;
      default: return [];
    }
  }, [sub, buckets]);

  return (
    <div className="space-y-4">
      {/* Top KPI strip — five cards summarising the operational module. */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <KPI title="چک‌های دریافتی باز" value={`${formatMoney(buckets.receivedSum)} ریال`} icon={ArrowDownToLine} tone="primary" />
        <KPI title="چک‌های پرداختی باز" value={`${formatMoney(buckets.payableSum)} ریال`} icon={ArrowUpFromLine} tone="muted" />
        <KPI title="سررسید امروز" value={`${buckets.dueToday.length} فقره`} icon={CalendarClock} tone="amber" onClick={() => setSub("due")} />
        <KPI title="هفته جاری" value={`${buckets.dueThisWeek.length} فقره`} icon={Wallet} tone="cyan" onClick={() => setSub("due")} />
        <KPI title="معوق / برگشتی" value={`${buckets.overdue.length + buckets.bounced.length} فقره`} icon={AlertTriangle} tone="destructive" onClick={() => setSub("bounced")} />
      </div>

      {/* Sub-tabs — same visual style as the main Finance tab bar. */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="inline-flex gap-1 p-1 rounded-xl bg-muted/40 border overflow-x-auto">
          {SUBTABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setSub(t.key)}
              className={cn(
                "shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all",
                sub === t.key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <t.icon className="w-3.5 h-3.5" />
              {t.label}
            </button>
          ))}
        </div>
        {/* Action buttons — contextual to the active sub-tab. */}
        <div className="flex gap-2">
          {sub === "received" && (
            <Button size="sm" onClick={() => setOpenReceived(true)}><Plus className="w-4 h-4" /> ثبت چک دریافتی</Button>
          )}
          {sub === "payable" && (
            <Button size="sm" onClick={() => setOpenPayable(true)}><Plus className="w-4 h-4" /> صدور چک پرداختی</Button>
          )}
          {sub === "guarantee" && (
            <Button size="sm" onClick={() => setOpenGuarantee(true)}><Plus className="w-4 h-4" /> ثبت چک ضمانتی</Button>
          )}
          {sub === "cancelled" && (
            <Button size="sm" onClick={() => setOpenCancelled(true)}><Plus className="w-4 h-4" /> ثبت چک ابطالی</Button>
          )}
          {sub === "checkbooks" && (
            <Button size="sm" onClick={() => setOpenCheckbook(true)}><Plus className="w-4 h-4" /> افزودن دسته‌چک</Button>
          )}
        </div>
      </div>

      {/* Body — switches on sub-tab. Guarantee/cancelled have full custom
          views with their own KPI strips; the rest share the table. */}
      {sub === "checkbooks" ? (
        <CheckbooksSection />
      ) : sub === "guarantee" ? (
        <GuaranteeChecksTab onOpenDetail={setDetailId} />
      ) : sub === "cancelled" ? (
        <CancelledChecksTab onOpenDetail={setDetailId} />
      ) : (
        <ChecksTable rows={visibleRows} onOpen={(id) => setDetailId(id)} highlightOverdue={sub === "due"} />
      )}

      {/* Dialogs mounted once at the root so opening doesn't remount the tree. */}
      <NewReceivedCheckDialog open={openReceived} onOpenChange={setOpenReceived} />
      <NewPayableCheckDialog open={openPayable} onOpenChange={setOpenPayable} />
      <NewCheckbookDialog open={openCheckbook} onOpenChange={setOpenCheckbook} />
      <NewGuaranteeCheckDialog open={openGuarantee} onOpenChange={setOpenGuarantee} />
      <NewCancelledCheckDialog open={openCancelled} onOpenChange={setOpenCancelled} />
      <CheckDetailDialog checkId={detailId} onOpenChange={(o) => !o && setDetailId(null)} />
    </div>
  );
}

// ---------- KPI tile ---------------------------------------------------------
function KPI({
  title, value, icon: Icon, tone, onClick,
}: {
  title: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: "primary" | "muted" | "amber" | "cyan" | "destructive";
  onClick?: () => void;
}) {
  // Map tone names → semantic-token-driven Tailwind classes. Keeping the
  // mapping inline (not in lib/checks) because it's purely presentational.
  const toneCls: Record<string, string> = {
    primary: "border-primary/30 bg-primary/5",
    muted: "border-border bg-muted/20",
    amber: "border-amber-500/30 bg-amber-500/5",
    cyan: "border-cyan-500/30 bg-cyan-500/5",
    destructive: "border-destructive/30 bg-destructive/5",
  };
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-xl border p-3 text-right transition-all hover:scale-[1.01] hover:shadow-sm",
        toneCls[tone],
        !onClick && "cursor-default hover:scale-100",
      )}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-muted-foreground">{title}</span>
        <Icon className="w-4 h-4 text-muted-foreground" />
      </div>
      <div className="text-sm font-bold tabular-nums">{value}</div>
    </button>
  );
}

// ---------- Shared checks table ---------------------------------------------
function ChecksTable({
  rows, onOpen, highlightOverdue,
}: {
  rows: CheckRow[];
  onOpen: (id: string) => void;
  highlightOverdue?: boolean;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card/40 p-10 text-center text-sm text-muted-foreground">
        موردی برای نمایش وجود ندارد.
      </div>
    );
  }
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return (
    <div className="rounded-lg border border-border bg-card overflow-x-auto">
      <table className="w-full text-sm border-collapse min-w-[820px]">
        <thead>
          <tr className="bg-muted/30 text-muted-foreground text-xs">
            <Th>شماره چک</Th>
            <Th>طرف حساب</Th>
            <Th>بانک</Th>
            <Th>مبلغ</Th>
            <Th>سررسید</Th>
            <Th>وضعیت</Th>
            <Th>اثر طرف حساب</Th>
            <Th>اثر بانک</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => {
            const d = c.due_date ? new Date(c.due_date) : null;
            const isOverdue = highlightOverdue && d && d < today && !["cleared", "voided", "lost"].includes(c.status);
            return (
              <tr key={c.id} className={cn("border-b border-border last:border-b-0 hover:bg-muted/20", isOverdue && "bg-destructive/5")}>
                <Td className="font-bold">{c.check_number}</Td>
                <Td>{partyLabel(c.party)}</Td>
                <Td>{bankLabel(c.bank)}</Td>
                <Td><MoneyCell value={c.amount} /></Td>
                <Td><JalaliDateCell value={c.due_date} /></Td>
                <Td><StatusBadge status={c.status} /></Td>
                <Td><JalaliDateCell value={c.party_effected_at} /></Td>
                <Td><JalaliDateCell value={c.bank_effected_at} /></Td>
                <Td className="text-left">
                  <Button size="sm" variant="ghost" onClick={() => onOpen(c.id)}>جزئیات</Button>
                </Td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children }: { children?: React.ReactNode }) {
  return <th className="text-right font-medium px-3 py-2 whitespace-nowrap">{children}</th>;
}
function Td({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <td className={cn("px-3 py-2 align-middle", className)}>{children ?? <span className="text-muted-foreground">—</span>}</td>;
}

// ---------- Checkbooks section ----------------------------------------------
// Lists every checkbook with quick stats + a drill-in to its leaves.
function CheckbooksSection() {
  const { data: books = [] } = useCheckbooks();
  const [openBookId, setOpenBookId] = useState<string | null>(null);
  if (books.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card/40 p-10 text-center text-sm text-muted-foreground">
        هنوز دسته‌چکی ثبت نشده است. روی «افزودن دسته‌چک» کلیک کنید.
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {books.map((b) => (
          <CheckbookCard
            key={b.id}
            book={b}
            open={openBookId === b.id}
            onToggle={() => setOpenBookId(openBookId === b.id ? null : b.id)}
          />
        ))}
      </div>
    </div>
  );
}

function CheckbookCard({ book, open, onToggle }: { book: CheckbookRow; open: boolean; onToggle: () => void }) {
  // Only load leaves on demand to keep first paint cheap.
  const { data: leaves = [] } = useCheckbookLeaves(open ? book.id : null);
  const available = leaves.filter((l) => l.status === "available").length;
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <button onClick={onToggle} className="w-full flex items-center justify-between text-right">
        <div>
          <div className="font-bold">{book.title}</div>
          <div className="text-xs text-muted-foreground">{bankLabel(book.bank)} — سریال {book.start_serial}–{book.end_serial}</div>
        </div>
        <div className="text-xs text-muted-foreground">{book.sheet_count} برگ</div>
      </button>
      {open && (
        <div className="mt-3 border-t border-border pt-3">
          <div className="text-xs text-muted-foreground mb-2">{available} برگ آزاد از {leaves.length}</div>
          <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-1.5">
            {leaves.map((l) => (
              <div
                key={l.id}
                className={cn(
                  "rounded-md text-[11px] px-2 py-1 text-center border tabular-nums",
                  l.status === "available" && "bg-emerald-500/10 border-emerald-500/30 text-emerald-300",
                  l.status === "issued" && "bg-amber-500/10 border-amber-500/30 text-amber-300",
                  l.status === "cleared" && "bg-primary/10 border-primary/30 text-primary",
                  l.status === "bounced" && "bg-destructive/10 border-destructive/30 text-destructive",
                  (l.status === "voided" || l.status === "lost") && "bg-muted text-muted-foreground border-border",
                )}
                title={LEAF_STATUS_LABEL[l.status]}
              >
                {l.serial_number}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
