// =============================================================================
// SettlementDashboardTab — Phase 9
// -----------------------------------------------------------------------------
// Read-only management dashboard. Composes:
//   - Filter bar (date range, party, method, category)
//   - 10-KPI strip
//   - Method breakdown + Category breakdown (side by side)
//   - Top liabilities (by party)
//   - Next due parties (by party)
//   - Upcoming obligations (next 30 days, item-level)
//   - Due calendar (per-day amounts, current Jalali month grid)
//   - Freight obligations + Feed obligations item lists
//
// Everything reads from one shared in-memory universe loaded by
// useDashboardUniverse so all sections stay consistent and refetch once.
// =============================================================================
import { useMemo, useState } from "react";
import {
  Wallet,
  CheckCircle2,
  Clock,
  CalendarDays,
  CalendarClock,
  AlertTriangle,
  ScrollText,
  Banknote,
  FileWarning,
  Sun,
  Filter as FilterIcon,
  X,
} from "lucide-react";

import { formatMoney } from "@/lib/finance";
import { formatGregorianToJalali, todayGregorianISO } from "@/lib/dateUtils";
import { toPersianDigits } from "@/lib/jalali";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { JalaliDatePicker } from "@/components/JalaliDatePicker";

import {
  useDashboardUniverse,
  computeKpis,
  aggregateByMethod,
  aggregateByCategory,
  topLiabilities,
  nextDueParties,
  upcomingObligations,
  calendarBuckets,
  itemsInCategory,
  bucketCostCategory,
  BIZ_CATEGORY_LABELS_FA,
  type BizCategory,
  type DashboardFilters,
  type DashItem,
} from "@/lib/finance/settlementDashboard";
import { labelForExecutionStatus } from "@/lib/finance/settlementExecution";

// -----------------------------------------------------------------------------
// Persian labels for the few raw enums we surface (payment_method values
// come straight from the DB; keep the map tight so unknown values render raw).
// -----------------------------------------------------------------------------
const METHOD_LABELS_FA: Record<string, string> = {
  bank_transfer: "انتقال بانکی",
  check: "چک",
  cashbox: "صندوق",
  barter: "تهاتر",
  deferred: "تعویقی",
  legacy: "قدیمی",
};
const fmtMethod = (m: string | null | undefined) => (m ? METHOD_LABELS_FA[m] ?? m : "—");

// =============================================================================
// Sub-component: KpiTile
// -----------------------------------------------------------------------------
// Lightweight semantic-token tile used by the strip. We avoid the photoreal
// KPIWidget here because the dashboard needs a compact, dense grid — 10 tiles
// at once — and the imagery would compete with the data.
// =============================================================================
function KpiTile({
  label,
  value,
  hint,
  icon: Icon,
  tone = "default",
}: {
  label: string;
  value: number;
  hint?: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: "default" | "warning" | "danger" | "success" | "info";
}) {
  // Tone maps to a subtle border + icon accent. We do NOT change the
  // background so the dashboard reads as one calm surface.
  const toneCls: Record<string, string> = {
    default: "text-foreground",
    warning: "text-amber-500",
    danger: "text-red-500",
    success: "text-emerald-500",
    info: "text-sky-500",
  };
  return (
    <div className="rounded-lg border border-border bg-card/60 p-3 flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-muted-foreground text-xs">
        <span>{label}</span>
        <Icon className={cn("w-4 h-4", toneCls[tone])} />
      </div>
      <div className="font-bold tabular-nums text-lg leading-tight truncate" title={String(value)}>
        {formatMoney(value)}
      </div>
      {hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

// =============================================================================
// Sub-component: FiltersBar
// -----------------------------------------------------------------------------
// Multi-select dimensions are rendered as toggle chips (cheaper than a real
// multi-select dropdown for ≤6 options and works great on mobile).
// =============================================================================
function FiltersBar({
  value,
  onChange,
}: {
  value: DashboardFilters;
  onChange: (next: DashboardFilters) => void;
}) {
  const methodOpts = ["bank_transfer", "check", "cashbox", "barter", "deferred", "legacy"];
  const categoryOpts: BizCategory[] = ["feed", "medicine", "freight", "services", "miscellaneous"];

  // Toggle helper — adds or removes a value from an array filter.
  const toggle = <T extends string,>(arr: T[] | undefined, v: T): T[] | undefined => {
    const set = new Set(arr ?? []);
    if (set.has(v)) set.delete(v);
    else set.add(v);
    const next = Array.from(set);
    return next.length === 0 ? undefined : next;
  };

  const reset = () => onChange({});

  return (
    <div className="rounded-lg border border-border bg-card/60 p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-bold text-muted-foreground">
          <FilterIcon className="w-4 h-4" />
          فیلترها
        </div>
        <Button variant="ghost" size="sm" onClick={reset} className="h-8">
          <X className="w-3.5 h-3.5 ml-1" />
          پاکسازی
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Date range — uses the existing Jalali picker so the rest of the
            app's date semantics (Tehran timezone, no drift) is preserved. */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">از تاریخ سررسید</label>
          <JalaliDatePicker
            value={value.fromDate ?? ""}
            onChange={(iso) => onChange({ ...value, fromDate: iso || undefined })}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">تا تاریخ سررسید</label>
          <JalaliDatePicker
            value={value.toDate ?? ""}
            onChange={(iso) => onChange({ ...value, toDate: iso || undefined })}
          />
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-xs text-muted-foreground">روش پرداخت</div>
        <div className="flex flex-wrap gap-1.5">
          {methodOpts.map((m) => {
            const active = value.methods?.includes(m);
            return (
              <button
                key={m}
                onClick={() => onChange({ ...value, methods: toggle(value.methods, m) })}
                className={cn(
                  "px-2.5 py-1 rounded-md text-xs border transition",
                  active
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background text-muted-foreground border-border hover:bg-muted",
                )}
              >
                {fmtMethod(m)}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-xs text-muted-foreground">دسته کسب‌وکاری</div>
        <div className="flex flex-wrap gap-1.5">
          {categoryOpts.map((c) => {
            const active = value.categories?.includes(c);
            return (
              <button
                key={c}
                onClick={() => onChange({ ...value, categories: toggle(value.categories, c) })}
                className={cn(
                  "px-2.5 py-1 rounded-md text-xs border transition",
                  active
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background text-muted-foreground border-border hover:bg-muted",
                )}
              >
                {BIZ_CATEGORY_LABELS_FA[c]}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Section wrappers
// =============================================================================
function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-sm">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}

// =============================================================================
// Sub-component: MethodBreakdown / CategoryBreakdown
// -----------------------------------------------------------------------------
// Both render the same horizontal-bar style table. Bar widths are computed
// relative to the row with the largest amount, giving an at-a-glance sense
// of proportion without bringing in a chart library.
// =============================================================================
function BreakdownTable({
  title,
  rows,
}: {
  title: string;
  rows: { label: string; amount: number; count: number }[];
}) {
  const max = Math.max(1, ...rows.map((r) => r.amount));
  return (
    <Section title={title}>
      {rows.length === 0 ? (
        <div className="text-xs text-muted-foreground py-6 text-center">داده‌ای یافت نشد</div>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.label} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-foreground">{r.label}</span>
                <span className="text-muted-foreground">
                  {toPersianDigits(String(r.count))} مورد · {formatMoney(r.amount)}
                </span>
              </div>
              {/* Width-based mini-bar; no dependency required. */}
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-primary/70"
                  style={{ width: `${(r.amount / max) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

// =============================================================================
// Sub-component: PartyTable — used by Top Liabilities AND Next Due Parties.
// Generic so the same structure handles both shapes via a render function.
// =============================================================================
function PartyTable<T>({
  title,
  rows,
  cols,
  empty = "داده‌ای یافت نشد",
}: {
  title: string;
  rows: T[];
  cols: { header: string; cell: (r: T) => React.ReactNode; align?: "left" | "right" }[];
  empty?: string;
}) {
  return (
    <Section title={title}>
      {rows.length === 0 ? (
        <div className="text-xs text-muted-foreground py-6 text-center">{empty}</div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              {cols.map((c, i) => (
                <TableHead key={i} className={c.align === "left" ? "text-left" : "text-right"}>
                  {c.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r, i) => (
              <TableRow key={i}>
                {cols.map((c, j) => (
                  <TableCell key={j} className={c.align === "left" ? "text-left" : "text-right"}>
                    {c.cell(r)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Section>
  );
}

// =============================================================================
// Sub-component: UpcomingObligationsTable — item-level rows for next 30 days
// =============================================================================
function UpcomingTable({ items }: { items: DashItem[] }) {
  return (
    <Section title="تعهدات پیش‌رو (۳۰ روز آینده)">
      {items.length === 0 ? (
        <div className="text-xs text-muted-foreground py-6 text-center">تعهد فعالی در ۳۰ روز آینده ثبت نشده</div>
      ) : (
        <div className="max-h-[420px] overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-right">سررسید</TableHead>
                <TableHead className="text-right">ذینفع</TableHead>
                <TableHead className="text-right">روش</TableHead>
                <TableHead className="text-right">دسته</TableHead>
                <TableHead className="text-right">وضعیت</TableHead>
                <TableHead className="text-left">مبلغ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((it) => (
                <TableRow key={it.id}>
                  <TableCell className="text-right whitespace-nowrap">
                    {formatGregorianToJalali(it.due_date)}
                  </TableCell>
                  <TableCell className="text-right">{it.party_name ?? "—"}</TableCell>
                  <TableCell className="text-right">{fmtMethod(it.payment_method)}</TableCell>
                  <TableCell className="text-right">
                    {BIZ_CATEGORY_LABELS_FA[bucketCostCategory(it.cost_category)]}
                  </TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">
                    {labelForExecutionStatus(it.execution_status)}
                  </TableCell>
                  <TableCell className="text-left font-bold tabular-nums">
                    {formatMoney(it.remaining_amount ?? it.amount)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Section>
  );
}

// =============================================================================
// Sub-component: DueCalendar
// -----------------------------------------------------------------------------
// A compact 7-column grid of the next 35 days (5 weeks). Each cell shows the
// Jalali day number and the total remaining amount due that day. We render
// the next 35 days starting today rather than a true calendar month so the
// "what's coming up" framing matches the dashboard's purpose.
// =============================================================================
function DueCalendar({ buckets }: { buckets: Map<string, number> }) {
  // Generate 35 consecutive days from today.
  const today = todayGregorianISO();
  const days: { iso: string; amount: number }[] = [];
  const base = new Date(today + "T00:00:00Z");
  for (let i = 0; i < 35; i++) {
    const d = new Date(base);
    d.setUTCDate(base.getUTCDate() + i);
    const iso = d.toISOString().slice(0, 10);
    days.push({ iso, amount: buckets.get(iso) ?? 0 });
  }
  const max = Math.max(1, ...days.map((d) => d.amount));

  return (
    <Section title="تقویم سررسید (۳۵ روز آینده)">
      <div className="grid grid-cols-7 gap-1.5">
        {days.map((d) => {
          // Intensity ramps the background opacity by relative amount; a day
          // with no obligation stays flat so the eye is drawn to busy days.
          const intensity = d.amount > 0 ? 0.15 + (d.amount / max) * 0.55 : 0;
          // Pull just the Jalali day-of-month number for the cell label.
          const jalaliFull = formatGregorianToJalali(d.iso);
          const dayNum = jalaliFull.split("/")[2] ?? jalaliFull;
          return (
            <div
              key={d.iso}
              className="aspect-square rounded-md border border-border p-1.5 flex flex-col justify-between text-[10px]"
              style={{ backgroundColor: intensity > 0 ? `hsl(var(--primary) / ${intensity})` : undefined }}
              title={`${jalaliFull} — ${formatMoney(d.amount)}`}
            >
              <div className="font-bold text-foreground">{dayNum}</div>
              {d.amount > 0 && (
                <div className="text-[9px] tabular-nums truncate text-foreground">
                  {formatMoney(d.amount)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Section>
  );
}

// =============================================================================
// Sub-component: CategoryItemsTable — used twice for Freight + Feed slices
// =============================================================================
function CategoryItemsTable({ title, items }: { title: string; items: DashItem[] }) {
  return (
    <Section title={title}>
      {items.length === 0 ? (
        <div className="text-xs text-muted-foreground py-6 text-center">داده‌ای یافت نشد</div>
      ) : (
        <div className="max-h-[320px] overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-right">سررسید</TableHead>
                <TableHead className="text-right">ذینفع</TableHead>
                <TableHead className="text-right">روش</TableHead>
                <TableHead className="text-left">مبلغ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((it) => (
                <TableRow key={it.id}>
                  <TableCell className="text-right whitespace-nowrap">
                    {formatGregorianToJalali(it.due_date)}
                  </TableCell>
                  <TableCell className="text-right">{it.party_name ?? "—"}</TableCell>
                  <TableCell className="text-right">{fmtMethod(it.payment_method)}</TableCell>
                  <TableCell className="text-left font-bold tabular-nums">
                    {formatMoney(it.remaining_amount ?? it.amount)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Section>
  );
}

// =============================================================================
// MAIN — composes everything against a single shared universe query.
// =============================================================================
export default function SettlementDashboardTab() {
  // Filters live in local state; React Query keys off them so any change
  // refetches only the affected universe (single query).
  const [filters, setFilters] = useState<DashboardFilters>({});
  const { data: items = [], isLoading, error } = useDashboardUniverse(filters);

  // Derive every aggregate with useMemo so re-renders triggered by filter
  // toggles don't re-run the math unnecessarily.
  const kpis = useMemo(() => computeKpis(items), [items]);
  const byMethod = useMemo(() => aggregateByMethod(items), [items]);
  const byCategory = useMemo(() => aggregateByCategory(items), [items]);
  const top = useMemo(() => topLiabilities(items), [items]);
  const nextDue = useMemo(() => nextDueParties(items), [items]);
  const upcoming = useMemo(() => upcomingObligations(items), [items]);
  const calendar = useMemo(() => calendarBuckets(items), [items]);
  const freightItems = useMemo(() => itemsInCategory(items, "freight").slice(0, 50), [items]);
  const feedItems = useMemo(() => itemsInCategory(items, "feed").slice(0, 50), [items]);

  return (
    <div className="space-y-4" dir="rtl">
      <FiltersBar value={filters} onChange={setFilters} />

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          خطا در بارگذاری داشبورد: {(error as Error).message}
        </div>
      )}

      {/* KPI strip — 10 tiles. */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
        <KpiTile label="کل تعهدات باز" value={kpis.totalOpen} icon={Wallet} tone="info" />
        <KpiTile label="مبلغ اجرا شده" value={kpis.executed} icon={CheckCircle2} tone="success" />
        <KpiTile label="مبلغ باقی‌مانده" value={kpis.remaining} icon={Clock} />
        <KpiTile label="سررسید امروز" value={kpis.dueToday} icon={Sun} tone="warning" />
        <KpiTile label="سررسید ۷ روز" value={kpis.due7d} icon={CalendarDays} />
        <KpiTile label="سررسید ۳۰ روز" value={kpis.due30d} icon={CalendarClock} />
        <KpiTile label="معوق" value={kpis.overdue} icon={AlertTriangle} tone="danger" />
        <KpiTile label="ارجاع به چک" value={kpis.checkLinked} icon={ScrollText} tone="info" />
        <KpiTile label="در انتظار حواله بانکی" value={kpis.bankPending} icon={Banknote} />
        <KpiTile
          label="اجرا شده بدون بستن مالی"
          value={kpis.executedNotClosed}
          icon={FileWarning}
          tone="warning"
          hint="فاقد سند حسابداری"
        />
      </div>

      {/* Loading placeholder for the rest of the page. */}
      {isLoading ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          در حال بارگذاری...
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <BreakdownTable
              title="تفکیک بر اساس روش پرداخت"
              rows={byMethod.map((r) => ({ label: fmtMethod(r.method), amount: r.amount, count: r.count }))}
            />
            <BreakdownTable
              title="تفکیک بر اساس دسته کسب‌وکاری"
              rows={byCategory.map((r) => ({
                label: BIZ_CATEGORY_LABELS_FA[r.category],
                amount: r.amount,
                count: r.count,
              }))}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <PartyTable
              title="بیشترین بدهی‌ها (Top Liabilities)"
              rows={top}
              cols={[
                { header: "ذینفع", cell: (r) => r.party_name },
                {
                  header: "تعداد",
                  cell: (r) => toPersianDigits(String(r.count)),
                },
                {
                  header: "مبلغ باقی‌مانده",
                  cell: (r) => <span className="font-bold tabular-nums">{formatMoney(r.amount)}</span>,
                  align: "left",
                },
              ]}
            />
            <PartyTable
              title="نزدیک‌ترین سررسیدها (Next Due Parties)"
              rows={nextDue}
              cols={[
                { header: "ذینفع", cell: (r) => r.party_name },
                {
                  header: "سررسید",
                  cell: (r) => (
                    <span className={r.overdue ? "text-red-500" : ""}>
                      {formatGregorianToJalali(r.nextDue)}
                    </span>
                  ),
                },
                {
                  header: "مبلغ",
                  cell: (r) => <span className="font-bold tabular-nums">{formatMoney(r.amount)}</span>,
                  align: "left",
                },
              ]}
            />
          </div>

          <UpcomingTable items={upcoming} />

          <DueCalendar buckets={calendar} />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <CategoryItemsTable title="تعهدات حمل و نقل / راننده" items={freightItems} />
            <CategoryItemsTable title="تعهدات تامین‌کنندگان خوراک" items={feedItems} />
          </div>
        </>
      )}
    </div>
  );
}
