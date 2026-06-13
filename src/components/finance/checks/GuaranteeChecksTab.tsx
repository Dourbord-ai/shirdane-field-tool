// =============================================================================
// GuaranteeChecksTab
// -----------------------------------------------------------------------------
// List + KPI cards for guarantee checks (category='guarantee'). Mirrors the
// table layout used by the main ChecksTab so users get a familiar UX, but
// surfaces the guarantee-specific metadata (subject, expiry, project).
// =============================================================================
import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ShieldCheck, AlertTriangle, Coins } from "lucide-react";
import { useGuaranteeChecks, type CheckRow } from "@/hooks/useChecks";
import { partyLabel, bankLabel } from "@/lib/checks";
import StatusBadge from "./StatusBadge";
import { JalaliDateCell, MoneyCell } from "@/components/finance/atoms";
import { formatMoney } from "@/lib/finance";

interface Props {
  onOpenDetail: (id: string) => void;
}

export default function GuaranteeChecksTab({ onOpenDetail }: Props) {
  const { data: rows = [] } = useGuaranteeChecks();

  // Aggregate KPIs in a single pass so re-renders are cheap.
  const kpis = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    let active = 0, total = 0, expired = 0;
    for (const c of rows) {
      // Sum total amount of every guarantee regardless of status — the spec
      // asks for جمع مبلغ چک‌های ضمانتی (no filter).
      total += Number(c.amount || 0);
      if (c.status === "active") active += 1;
      // A guarantee counts as expired if its status is `expired` OR its
      // expiry_date has passed while still flagged active.
      const exp = c.expiry_date ? new Date(c.expiry_date) : null;
      if (c.status === "expired" || (c.status === "active" && exp && exp < today)) {
        expired += 1;
      }
    }
    return { active, total, expired };
  }, [rows]);

  return (
    <div className="space-y-4">
      {/* KPI strip — three cards as specified. */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <KPI title="چک‌های ضمانتی فعال" value={`${kpis.active} فقره`} icon={ShieldCheck} tone="primary" />
        <KPI title="جمع مبلغ چک‌های ضمانتی" value={`${formatMoney(kpis.total)} ریال`} icon={Coins} tone="cyan" />
        <KPI title="چک‌های ضمانتی منقضی" value={`${kpis.expired} فقره`} icon={AlertTriangle} tone="amber" />
      </div>

      {/* List */}
      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-card/40 p-10 text-center text-sm text-muted-foreground">
          هنوز چک ضمانتی ثبت نشده است.
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
                <Th>انقضا</Th>
                <Th>موضوع</Th>
                <Th>وضعیت</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <GuaranteeRow key={c.id} c={c} onOpen={onOpenDetail} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// Row rendered as a small component so we can compute the "is expired" flag
// once per row and highlight it without polluting the parent.
function GuaranteeRow({ c, onOpen }: { c: CheckRow; onOpen: (id: string) => void }) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const exp = c.expiry_date ? new Date(c.expiry_date) : null;
  const overdue = c.status === "active" && exp && exp < today;
  return (
    <tr className={cn("border-b border-border last:border-b-0 hover:bg-muted/20", overdue && "bg-amber-500/5")}>
      <Td className="font-bold">{c.check_number}</Td>
      <Td>{partyLabel(c.party)}</Td>
      <Td>{bankLabel(c.bank)}</Td>
      <Td><MoneyCell value={c.amount} /></Td>
      <Td><JalaliDateCell value={c.issue_date} /></Td>
      <Td><JalaliDateCell value={c.expiry_date} /></Td>
      <Td className="text-xs">{c.guarantee_subject || "—"}</Td>
      <Td><StatusBadge status={c.status} /></Td>
      <Td className="text-left">
        <Button size="sm" variant="ghost" onClick={() => onOpen(c.id)}>جزئیات</Button>
      </Td>
    </tr>
  );
}

// Local helpers — duplicated tiny presentational pieces are cheaper than
// extracting a shared file just for two-line components.
function Th({ children }: { children?: React.ReactNode }) {
  return <th className="text-right font-medium px-3 py-2 whitespace-nowrap">{children}</th>;
}
function Td({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <td className={cn("px-3 py-2 align-middle", className)}>{children ?? <span className="text-muted-foreground">—</span>}</td>;
}

function KPI({
  title, value, icon: Icon, tone,
}: { title: string; value: string; icon: React.ComponentType<{ className?: string }>; tone: "primary" | "cyan" | "amber" }) {
  // Same tone palette as ChecksTab so the visual language stays consistent.
  const toneCls: Record<string, string> = {
    primary: "border-primary/30 bg-primary/5",
    cyan: "border-cyan-500/30 bg-cyan-500/5",
    amber: "border-amber-500/30 bg-amber-500/5",
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
