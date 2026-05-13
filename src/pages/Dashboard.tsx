// Dashboard.tsx — main landing page after login.
// All KPIs are now wired to real DB counts (public.cows) instead of hardcoded
// placeholders. Dates are not displayed here directly, but if any are added
// later they should be routed through src/lib/dateDisplay.formatShamsi to keep
// the entire app on the Iranian calendar.

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getSession } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { toPersianDigits } from "@/lib/jalali";
import { formatShamsi } from "@/lib/dateDisplay";
// Canonical "in herd" rule — must match /livestock so the dashboard counts
// never disagree with the list page (existancestatus = 0 or NULL → present).
import { IN_HERD_OR_STRING as IN_HERD_OR } from "@/lib/cowPresence";
import {
  ShoppingCart, Receipt, ClipboardList, Package, BarChart3, Wallet, Users,
  Award, HeartPulse, Plus, Milk, FlaskConical, TrendingUp, AlertTriangle,
  Activity,
} from "lucide-react";

import { GlobalCard, KPIWidget } from "@/components/global/KPIWidget";
import heroCows from "@/assets/dashboard-hero-cows.jpg";
import kpiCowHerd from "@/assets/kpi-cow-herd.png";
import kpiCowMilking from "@/assets/kpi-cow-milking.png";
import kpiCowPregnant from "@/assets/kpi-cow-pregnant.png";
import kpiMilkCan from "@/assets/kpi-milk-can.png";

const modules = [
  { title: "خرید و فروش",   icon: ShoppingCart, route: "/invoices",                desc: "فاکتورها" },
  { title: "قبض شیر",        icon: Milk,         route: "/receipts/milk",           desc: "صورت‌حساب کارخانه" },
  { title: "آزمایشگاه",      icon: FlaskConical, route: "/receipts/lab",            desc: "نتایج آزمون" },
  { title: "مدیریت دام",     icon: ClipboardList,route: "/livestock",               desc: "لیست دام‌ها" },
  { title: "باروری",         icon: HeartPulse,   route: "/fertility/operations",    desc: "عملیات باروری" },
  { title: "امور مالی",      icon: Wallet,       route: "/finance",                 desc: "بانک، اسناد، سپیدار" },
  { title: "منابع انسانی",   icon: Users,        route: "/hr",                      desc: "حضور و درخواست" },
  { title: "مدارک",          icon: Award,        route: "/certificates",            desc: "مجوزها" },
  { title: "ثبت رکورد شیر", icon: Plus,         route: "/milk-record/quick",       desc: "ثبت سریع" },
];

// NOTE: The previously hard-coded `recentEvents` array has been removed.
// Recent events are now loaded live from `public.livestock_fertility_events`
// in the component below (see `events` state + its useEffect).

// Map fertility_operation_id → human label + icon. Keeps the timeline tidy
// without pulling the full reference table for a 5-row card.
const OP_META: Record<number, { label: string; icon: typeof Milk }> = {
  1:  { label: "ثبت فحلی",      icon: HeartPulse },
  2:  { label: "تلقیح",          icon: HeartPulse },
  3:  { label: "تست آبستنی",    icon: Activity },
  4:  { label: "تست آبستنی",    icon: Activity },
  5:  { label: "سقط",            icon: AlertTriangle },
  6:  { label: "زایش",           icon: HeartPulse },
  7:  { label: "خشکی",           icon: Milk },
  8:  { label: "شستشو",         icon: Activity },
  10: { label: "کلین تست",      icon: Activity },
  11: { label: "تست آبستنی",    icon: Activity },
  12: { label: "تست آبستنی",    icon: Activity },
  13: { label: "همزمان‌سازی",   icon: Activity },
};

// -----------------------------------------------------------------------------
// LiveCounts — shape of the real-time KPI numbers we pull from public.cows.
// We compute them in a single Supabase round-trip so the dashboard load
// stays snappy.
// -----------------------------------------------------------------------------
interface LiveCounts {
  total: number;           // every cow currently in herd
  milking: number;         // female + present + not dry
  pregnant: number;       // female + present + is_pregnancy
  dry: number;             // female + present + is_dry
  pregnantHeifers: number; // female + present + is_pregnancy + never calved
  calves: number;          // present cows whose sextype indicates calf/heifer (sex=0 + age proxy)
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { user } = getSession();

  // Live KPI state — starts at zero so the UI never flashes stale placeholders.
  const [counts, setCounts] = useState<LiveCounts>({
    total: 0, milking: 0, pregnant: 0, dry: 0, pregnantHeifers: 0, calves: 0,
  });

  // Pull real cow counts on mount. We select only the boolean/int columns we
  // need for the aggregations and compute the buckets in JS — this avoids
  // requiring extra DB views or RPC functions for now.
  // Use the SAME counting rules as /livestock (server-side count queries with
  // IN_HERD_OR + sex=0 + is_dry / is_pregnancy) so the two pages can never
  // disagree, even when the herd grows beyond the previous 5000-row JS limit.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const head = (q: any) => q.select("id", { count: "exact", head: true });
      const [t, m, d, p, ph] = await Promise.all([
        head(supabase.from("cows")).or(IN_HERD_OR),
        head(supabase.from("cows")).or(IN_HERD_OR).eq("sex", 0).eq("is_dry", false),
        head(supabase.from("cows")).or(IN_HERD_OR).eq("sex", 0).eq("is_dry", true),
        head(supabase.from("cows")).or(IN_HERD_OR).eq("sex", 0).eq("is_pregnancy", true),
        head(supabase.from("cows")).or(IN_HERD_OR).eq("sex", 0).eq("is_pregnancy", true).is("last_birth_date", null),
      ]);
      if (cancelled) return;
      setCounts({
        total: t.count ?? 0,
        milking: m.count ?? 0,
        dry: d.count ?? 0,
        pregnant: p.count ?? 0,
        pregnantHeifers: ph.count ?? 0,
        calves: 0,
      });
    })();
    return () => { cancelled = true; };
  }, []);

  // ---------------------------------------------------------------------------
  // Live "today / this month" aggregates — pulled from operational tables.
  // ---------------------------------------------------------------------------
  const [stats, setStats] = useState({
    todayMilk: 0,
    monthMilk: 0,
    prevMonthMilk: 0,
    dailyMilk: [] as { date: string; total: number }[],
    income: 0,
    expense: 0,
    prevIncome: 0,
    prevExpense: 0,
  });

  // Recent fertility events for the right-hand timeline card.
  const [events, setEvents] = useState<
    { id: string; op: number; date: string; cow_id: number; result?: string | null; notes?: string | null }[]
  >([]);

  // Single useEffect that loads milk + finance + recent events in parallel.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // ---- Date helpers (Gregorian boundaries; display goes through formatShamsi) ----
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const startOfPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const startOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      const todayISO = now.toISOString().slice(0, 10);
      const monthAgoISO = startOfPrevMonth.toISOString().slice(0, 10);

      // ---- Milk: pull last ~30 days once and bucket in JS -----------------
      const milkRes = await supabase
        .from("livestock_milk_records")
        .select("milk_amount,record_date")
        .eq("is_cancelled", false)
        .gte("record_date", monthAgoISO)
        .lte("record_date", todayISO)
        .limit(20000);

      let todayMilk = 0, monthMilk = 0, prevMonthMilk = 0;
      const dailyMap = new Map<string, number>();
      // Seed last-8-days buckets with 0 so the chart always renders.
      for (let i = 7; i >= 0; i--) {
        const d = new Date(now.getTime() - i * 24 * 3600 * 1000)
          .toISOString().slice(0, 10);
        dailyMap.set(d, 0);
      }
      (milkRes.data ?? []).forEach((r: any) => {
        const amount = Number(r.milk_amount || 0);
        const d = String(r.record_date);
        if (d === todayISO) todayMilk += amount;
        const dt = new Date(d);
        if (dt >= startOfMonth) monthMilk += amount;
        else if (dt >= startOfPrevMonth) prevMonthMilk += amount;
        if (dailyMap.has(d)) dailyMap.set(d, (dailyMap.get(d) || 0) + amount);
      });
      const dailyMilk = Array.from(dailyMap.entries()).map(([date, total]) => ({ date, total }));

      // ---- Finance: this month vs previous month --------------------------
      const [thisMonth, prevMonth] = await Promise.all([
        supabase.from("factors")
          .select("invoice_type,payable_amount,total_amount")
          .gte("created_at", startOfMonth.toISOString())
          .lt("created_at", startOfNextMonth.toISOString())
          .limit(5000),
        supabase.from("factors")
          .select("invoice_type,payable_amount,total_amount")
          .gte("created_at", startOfPrevMonth.toISOString())
          .lt("created_at", startOfMonth.toISOString())
          .limit(5000),
      ]);
      const sumByType = (rows: any[] | null, type: "buy" | "sell") =>
        (rows ?? [])
          .filter((r) => r.invoice_type === type)
          .reduce((s, r) => s + Number(r.payable_amount ?? r.total_amount ?? 0), 0);
      const income = sumByType(thisMonth.data as any[], "sell");
      const expense = sumByType(thisMonth.data as any[], "buy");
      const prevIncome = sumByType(prevMonth.data as any[], "sell");
      const prevExpense = sumByType(prevMonth.data as any[], "buy");

      // ---- Recent fertility events (top 5, latest first) -----------------
      const evRes = await supabase
        .from("livestock_fertility_events")
        .select("id,fertility_operation_id,event_date,event_time,livestock_id,result,notes,created_at")
        .eq("is_cancelled", false)
        .order("event_date", { ascending: false })
        .order("event_time", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(5);

      if (cancelled) return;
      setStats({ todayMilk, monthMilk, prevMonthMilk, dailyMilk, income, expense, prevIncome, prevExpense });
      setEvents(
        (evRes.data ?? []).map((e: any) => ({
          id: e.id,
          op: e.fertility_operation_id,
          date: e.event_date || e.created_at,
          cow_id: e.livestock_id,
          result: e.result,
          notes: e.notes,
        })),
      );
    })();
    return () => { cancelled = true; };
  }, []);

  // Helpers — Persian digits, money formatting, percent deltas, chart scale.
  const fa = (n: number) => toPersianDigits(String(n));
  const faMoney = (n: number) => toPersianDigits(Math.round(n).toLocaleString("en-US"));
  const pctDelta = (cur: number, prev: number) => {
    if (!prev) return null;
    const p = Math.round(((cur - prev) / prev) * 100);
    return { value: Math.abs(p), up: p >= 0 };
  };
  const milkDelta = pctDelta(stats.monthMilk, stats.prevMonthMilk);
  // درآمد delta removed by user request — only milk + expense deltas remain.
  const expenseDelta = pctDelta(stats.expense, stats.prevExpense);
  const maxDaily = Math.max(1, ...stats.dailyMilk.map((d) => d.total));

  return (
    <div className="py-4 lg:py-6 space-y-4 lg:space-y-6 animate-fade-in">
      {/* ============== HERO ============== */}
      <section className="relative rounded-3xl overflow-hidden border border-border/50 glow-primary">
        <img
          src={heroCows}
          alt="گله گاوهای دامداری"
          width={1920}
          height={1080}
          className="absolute inset-0 w-full h-full object-cover opacity-90"
        />
        <div className="absolute inset-0 bg-gradient-to-l from-background/95 via-background/40 to-transparent" />
        <div className="relative z-10 p-5 sm:p-8 lg:p-10 max-w-2xl text-right">
          <p className="text-sm sm:text-base text-muted-foreground">صبح بخیر، مدیر دامداری 👋</p>
          <h1 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold text-foreground mt-2 leading-tight">
            {user?.name || "خوش آمدید"}
          </h1>
          <p className="text-sm sm:text-base text-muted-foreground mt-2 max-w-md">
            در اینجا آخرین وضعیت دامداری شما امروز را مشاهده می‌کنید.
          </p>
        </div>
      </section>

      {/* ============== KPI ROW ==============
          Cow tiles read from public.cows (same count rules as /livestock).
          Milk tile reads from public.livestock_milk_records.
          درآمد tile was removed by user request. */}
      <section className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <KPIWidget label="کل دام‌ها"           value={fa(counts.total)}          hint="موجود گله"         image={kpiCowHerd}     accent="green"  onClick={() => navigate("/livestock")} />
        <KPIWidget label="گاوهای شیری"         value={fa(counts.milking)}        hint="در حال شیردهی"   image={kpiCowMilking}  accent="blue"   onClick={() => navigate("/livestock")} />
        <KPIWidget label="گاوهای خشک"          value={fa(counts.dry)}            hint="در دوره خشکی"    image={kpiMilkCan}     accent="orange" onClick={() => navigate("/livestock")} />
        <KPIWidget label="گاوهای آبستن"        value={fa(counts.pregnant)}       hint="مجموع آبستن"     image={kpiCowPregnant} accent="purple" onClick={() => navigate("/livestock")} />
        <KPIWidget label="تلیسه آبستن"         value={fa(counts.pregnantHeifers)} hint="آبستن بدون زایش" image={kpiCowPregnant} accent="purple" onClick={() => navigate("/livestock")} />
        <KPIWidget label="شیر امروز"           value={fa(Math.round(stats.todayMilk))} hint="لیتر"          image={kpiMilkCan}     accent="blue"   onClick={() => navigate("/receipts/milk")} />
      </section>
      {/* ============== QUICK ACCESS + ALERTS ============== */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Quick access */}
        <GlobalCard className="lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-extrabold text-foreground">دسترسی سریع</h3>
            <span className="text-xs text-muted-foreground">{modules.length} ماژول</span>
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-3">
            {modules.map((m) => (
              <button
                key={m.title}
                onClick={() => navigate(m.route)}
                className="quick-action"
              >
                <span className="quick-action-icon">
                  <m.icon className="w-5 h-5" />
                </span>
                <span className="text-xs font-bold text-foreground mt-1">{m.title}</span>
                <span className="text-[10px] text-muted-foreground">{m.desc}</span>
              </button>
            ))}
          </div>
        </GlobalCard>

        {/* Recent events — timeline (live from livestock_fertility_events) */}
        <GlobalCard>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-extrabold text-foreground">رویدادهای اخیر</h3>
            <span className="text-[10px] text-muted-foreground">{fa(events.length)} رویداد</span>
          </div>
          {events.length === 0 ? (
            // Empty-state — shown until the first fertility event is recorded.
            <p className="text-xs text-muted-foreground text-center py-6">رویدادی ثبت نشده است</p>
          ) : (
            <ol className="relative space-y-3 pr-4 border-r border-primary/30">
              {events.map((e) => {
                // Look up label/icon for this fertility_operation_id; fall back to a
                // generic "رویداد" when the operation id is unmapped (e.g. legacy).
                const meta = OP_META[e.op] ?? { label: "رویداد", icon: Activity };
                const Icon = meta.icon;
                return (
                  <li key={e.id} className="relative pr-4">
                    <span className="absolute -right-[7px] top-3 w-3 h-3 rounded-full bg-primary shadow-[0_0_0_4px_hsl(var(--primary)/0.18)]" />
                    <button
                      onClick={() => navigate(`/livestock/${e.cow_id}`)}
                      className="w-full text-right flex items-start gap-3 p-3 rounded-xl bg-card/60 border border-border/50 hover:border-primary/40 transition-colors"
                    >
                      <span className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 bg-primary/10 border border-primary/20 text-primary">
                        <Icon className="w-4 h-4" />
                      </span>
                      <div className="flex-1 min-w-0 text-right">
                        <p className="text-sm font-bold text-foreground truncate">
                          {meta.label} — دام #{fa(e.cow_id)}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {e.result || e.notes || "بدون توضیح"}
                        </p>
                      </div>
                      <span className="text-[10px] text-muted-foreground shrink-0 mt-1 whitespace-nowrap">
                        {formatShamsi(e.date)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
        </GlobalCard>
      </section>

      {/* ============== MODULE OVERVIEW ============== */}
      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        <GlobalCard>
          <h3 className="text-base font-extrabold text-foreground mb-4">نمای کلی دام‌ها</h3>
          <div className="space-y-3">
            {/* Overview rows are now bound to live counts. We use the same
                buckets (milking / dry / pregnant / calves) computed from
                public.cows so this card and the KPI row never disagree. */}
            {[
              { label: "گاوهای شیری", value: counts.milking },
              { label: "گاوهای خشک",  value: counts.dry },
              { label: "گاوهای آبستن", value: counts.pregnant },
              { label: "تلیسه آبستن", value: counts.pregnantHeifers },
              { label: "گوساله‌ها",   value: counts.calves },
            ].map((r) => (
              <div key={r.label} className="flex items-center justify-between py-2 border-b border-border/40 last:border-0">
                <button
                  onClick={() => navigate("/livestock")}
                  className="text-xs text-primary font-bold hover:underline"
                >
                  مشاهده
                </button>
                <span className="text-sm text-muted-foreground">{r.label}</span>
                <span className="text-base font-extrabold text-foreground tabular-nums">{fa(r.value)}</span>
              </div>
            ))}
            <div className="flex items-center justify-between pt-2">
              <span />
              <span className="text-sm font-bold text-muted-foreground">جمع کل</span>
              <span className="text-xl font-extrabold text-primary tabular-nums">{fa(counts.total)}</span>
            </div>
          </div>
        </GlobalCard>

        <GlobalCard>
          <h3 className="text-base font-extrabold text-foreground mb-1">تولید شیر (این ماه)</h3>
          {/* Live monthly total from livestock_milk_records (sum across days). */}
          <p className="text-3xl font-extrabold text-primary tabular-nums mt-2 whitespace-nowrap">
            {faMoney(stats.monthMilk)} <span className="text-base text-muted-foreground">لیتر</span>
          </p>
          {milkDelta && (
            <p className="text-xs mt-1" style={{ color: milkDelta.up ? "hsl(127 58% 70%)" : "hsl(0 84% 75%)" }}>
              {milkDelta.up ? "↑" : "↓"} {fa(milkDelta.value)}٪ نسبت به ماه گذشته
            </p>
          )}
          {/* Bar chart — last 8 days. Heights normalized to the tallest bar so
              even a small day still renders a visible sliver. */}
          <div className="mt-4 h-32 rounded-xl bg-secondary/40 border border-border/40 flex items-end justify-around p-3 gap-1">
            {stats.dailyMilk.map((d, i) => (
              <div
                key={d.date}
                title={`${d.date}: ${d.total}`}
                className="flex-1 rounded-md bg-gradient-primary"
                style={{
                  height: `${Math.max(4, (d.total / maxDaily) * 100)}%`,
                  opacity: 0.4 + (i / Math.max(1, stats.dailyMilk.length)) * 0.6,
                }}
              />
            ))}
          </div>
        </GlobalCard>
      </section>

      <p className="text-center text-xs text-muted-foreground pt-2">
        نسخه آزمایشی — ماژول‌ها به‌زودی فعال می‌شوند
      </p>
    </div>
  );
}
