// =============================================================================
// CancelledChecksTab
// -----------------------------------------------------------------------------
// List + KPI cards for cancelled checks (category='cancelled'). Includes a
// reason breakdown so users can see what's driving cancellations at a glance.
// =============================================================================
import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Ban, Coins, ListTree } from "lucide-react";
import { useCancelledChecks } from "@/hooks/useChecks";
import { partyLabel, bankLabel, CANCEL_REASON_LABEL, type CancelReason } from "@/lib/checks";
import StatusBadge from "./StatusBadge";
import { JalaliDateCell, MoneyCell } from "@/components/finance/atoms";
import { formatMoney } from "@/lib/finance";

interface Props {
  onOpenDetail: (id: string) => void;
}

export default function CancelledChecksTab({ onOpenDetail }: Props) {
  const { data: rows = [] } = useCancelledChecks();

  // Aggregate count, total amount and a reason breakdown in one pass.
  const kpis = useMemo(() => {
    let total = 0;
    const byReason: Record<string, { count: number; sum: number }> = {};
    for (const c of rows) {
      total += Number(c.amount || 0);
      const key = c.cancel_reason || "other";
      byReason[key] = byReason[key] || { count: 0, sum: 0 };
      byReason[key].count += 1;
      byReason[key].sum += Number(c.amount || 0);
    }
    return {
      count: rows.length,
      total,
      byReason: Object.entries(byReason).sort((a, b) => b[1].count - a[1].count),
    };
  }, [rows]);

  return (
    <div className="space-y-4">
      {/* KPI strip — count, total, breakdown trigger card. */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <KPI title="تعداد چک‌های ابطالی" value={`${kpis.count} فقره`} icon={Ban} tone="destructive" />
        <KPI title="جمع مبلغ چک‌های ابطالی" value={`${formatMoney(kpis.total)} ریال`} icon={Coins} tone="muted" />
        {/* Breakdown card — small list rendered inline so the user sees it
            without needing to drill in. */}
        <div className="rounded-xl border border-border bg-card/50 p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-muted-foreground">ابطال بر اساس علت</span>
            <ListTree className="w-4 h-4 text-muted-foreground" />
          </div>
          {kpis.byReason.length === 0 ? (
            <div className="text-xs text-muted-foreground">داده‌ای موجود نیست.</div>
          ) : (
            <ul className="space-y-1 text-xs">
              {kpis.byReason.slice(0, 4).map(([reason, agg]) => (
                <li key={reason} className="flex items-center justify-between">
                  <span>{CANCEL_REASON_LABEL[reason as CancelReason] ?? reason}</span>
                  <span className="tabular-nums text-muted-foreground">{agg.count} فقره</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* List */}
      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-card/40 p-10 text-center text-sm text-muted-foreground">
          هنوز چک ابطالی ثبت نشده است.
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-card overflow-x-auto">
          <table className="w-full text-sm border-collapse min-w-[960px]">
            <thead>
              <tr className="bg-muted/30 text-muted-foreground text-xs">
                <Th>شماره چک</Th>
                <Th>ذینفع</Th>
                <Th>بانک</Th>
                <Th>مبلغ</Th>
                <Th>تاریخ چک</Th>
                <Th>تاریخ ابطال</Th>
                <Th>علت</Th>
                <Th>وضعیت</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="border-b border-border last:border-b-0 hover:bg-muted/20">
                  <Td className="font-bold">{c.check_number}</Td>
                  <Td>{partyLabel(c.party)}</Td>
                  <Td>{bankLabel(c.bank)}</Td>
                  <Td><MoneyCell value={c.amount} /></Td>
                  <Td><JalaliDateCell value={c.issue_date} /></Td>
                  <Td><JalaliDateCell value={c.cancelled_date} /></Td>
                  <Td className="text-xs">{CANCEL_REASON_LABEL[(c.cancel_reason || "other") as CancelReason]}</Td>
                  <Td><StatusBadge status={c.status} /></Td>
                  <Td className="text-left">
                    <Button size="sm" variant="ghost" onClick={() => onOpenDetail(c.id)}>جزئیات</Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Th({ children }: { children?: React.ReactNode }) {
  return <th className="text-right font-medium px-3 py-2 whitespace-nowrap">{children}</th>;
}
function Td({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <td className={cn("px-3 py-2 align-middle", className)}>{children ?? <span className="text-muted-foreground">—</span>}</td>;
}

function KPI({
  title, value, icon: Icon, tone,
}: { title: string; value: string; icon: React.ComponentType<{ className?: string }>; tone: "destructive" | "muted" }) {
  const toneCls: Record<string, string> = {
    destructive: "border-destructive/30 bg-destructive/5",
    muted: "border-border bg-muted/20",
  };
  return (
    <div className={cn("rounded-xl border p-3 text-right", toneCls[tone])}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-muted-foreground">{title}</span>
        <Icon className="w-4 h-4 text-muted-foreground" />
      </div>
      <div className="text-sm font-bold tabular-nums">{value}</div>
    </div>
  );
}
