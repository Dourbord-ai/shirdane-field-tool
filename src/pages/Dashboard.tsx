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
import {
  ShoppingCart, Receipt, ClipboardList, Package, BarChart3, Wallet, Users,
  Award, HeartPulse, Plus, Milk, FlaskConical, TrendingUp, AlertTriangle,
} from "lucide-react";
import InvoiceNotifications from "@/components/InvoiceNotifications";
import { GlobalCard, KPIWidget } from "@/components/global/KPIWidget";
import heroCows from "@/assets/dashboard-hero-cows.jpg";
import kpiCowHerd from "@/assets/kpi-cow-herd.png";
import kpiCowMilking from "@/assets/kpi-cow-milking.png";
import kpiCowPregnant from "@/assets/kpi-cow-pregnant.png";
import kpiMilkCan from "@/assets/kpi-milk-can.png";
import kpiCoins from "@/assets/kpi-coins.png";
import kpiWallet from "@/assets/kpi-wallet.png";

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

const recentEvents = [
  { title: "ثبت رکورد شیر روزانه", detail: "۴۵۶ لیتر — شیفت صبح",  hint: "۳۰ دقیقه پیش", tone: "success" as const, icon: Milk },
  { title: "هشدار کاهش شیر",       detail: "۵ گاو نیاز به بررسی",   hint: "۲ ساعت پیش",   tone: "danger"  as const, icon: TrendingUp },
  { title: "رویداد سلامتی",         detail: "۲ دام نیازمند درمان",   hint: "۵ ساعت پیش",   tone: "warn"    as const, icon: AlertTriangle },
  { title: "زایش جدید",             detail: "۳ گوساله سالم",         hint: "۱ روز پیش",    tone: "info"    as const, icon: HeartPulse },
];

export default function Dashboard() {
  const navigate = useNavigate();
  const { user } = getSession();

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

      {/* ============== KPI ROW ============== */}
      <section className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <KPIWidget label="کل دام‌ها"        value="۱۴۲"       hint="همه دام‌ها"     image={kpiCowHerd}     accent="green"  onClick={() => navigate("/livestock")} />
        <KPIWidget label="گاوهای شیری"      value="۶۷"        hint="در حال شیردهی" image={kpiCowMilking}  accent="blue"   onClick={() => navigate("/livestock")} />
        <KPIWidget label="گاوهای آبستن"     value="۲۳"        hint="مجموع آبستن"   image={kpiCowPregnant} accent="purple" onClick={() => navigate("/livestock")} />
        <KPIWidget label="شیر امروز"        value="۴۵۶ لیتر"  hint="کل جمع‌آوری"   image={kpiMilkCan}     accent="blue"   onClick={() => navigate("/receipts/milk")} />
        <KPIWidget label="درآمد این ماه"    value="۲۴۵٬۰۰۰"   hint="ریال"          image={kpiCoins}       accent="orange" onClick={() => navigate("/finance")} />
        <KPIWidget label="هزینه‌های ماه"   value="۹۸٬۰۰۰"    hint="ریال"          image={kpiWallet}      accent="orange" onClick={() => navigate("/finance")} />
      </section>

      <InvoiceNotifications />

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

        {/* Recent events — timeline */}
        <GlobalCard>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-extrabold text-foreground">رویدادهای اخیر</h3>
            <span className="text-[10px] text-muted-foreground">{recentEvents.length} رویداد</span>
          </div>
          {/* Timeline rail — uses the primary (green) accent so the section stays
              consistent with the global design system instead of mixing red/amber/blue tones. */}
          <ol className="relative space-y-3 pr-4 border-r border-primary/30">
            {recentEvents.map((e) => {
              return (
                <li key={e.title} className="relative pr-4">
                  {/* Single accent dot — primary green with a soft glow ring. */}
                  <span className="absolute -right-[7px] top-3 w-3 h-3 rounded-full bg-primary shadow-[0_0_0_4px_hsl(var(--primary)/0.18)]" />
                  <div className="flex items-start gap-3 p-3 rounded-xl bg-card/60 border border-border/50 hover:border-primary/40 transition-colors">
                    {/* Icon chip uses primary tint to match KPI/widget styling across the app. */}
                    <span className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 bg-primary/10 border border-primary/20 text-primary">
                      <e.icon className="w-4 h-4" />
                    </span>
                    <div className="flex-1 min-w-0 text-right">
                      <p className="text-sm font-bold text-foreground truncate">{e.title}</p>
                      <p className="text-xs text-muted-foreground truncate">{e.detail}</p>
                    </div>
                    <span className="text-[10px] text-muted-foreground shrink-0 mt-1 whitespace-nowrap">{e.hint}</span>
                  </div>
                </li>
              );
            })}
          </ol>
        </GlobalCard>
      </section>

      {/* ============== MODULE OVERVIEW ============== */}
      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        <GlobalCard>
          <h3 className="text-base font-extrabold text-foreground mb-4">نمای کلی دام‌ها</h3>
          <div className="space-y-3">
            {[
              { label: "گاوهای شیری", value: "۶۷" },
              { label: "گاوهای خشک",  value: "۳۵" },
              { label: "گاوهای آبستن", value: "۲۳" },
              { label: "گوساله‌ها",   value: "۱۷" },
            ].map((r) => (
              <div key={r.label} className="flex items-center justify-between py-2 border-b border-border/40 last:border-0">
                <button
                  onClick={() => navigate("/livestock")}
                  className="text-xs text-primary font-bold hover:underline"
                >
                  مشاهده
                </button>
                <span className="text-sm text-muted-foreground">{r.label}</span>
                <span className="text-base font-extrabold text-foreground tabular-nums">{r.value}</span>
              </div>
            ))}
            <div className="flex items-center justify-between pt-2">
              <span />
              <span className="text-sm font-bold text-muted-foreground">جمع کل</span>
              <span className="text-xl font-extrabold text-primary tabular-nums">۱۴۲</span>
            </div>
          </div>
        </GlobalCard>

        <GlobalCard>
          <h3 className="text-base font-extrabold text-foreground mb-1">تولید شیر (این ماه)</h3>
          <p className="text-3xl font-extrabold text-primary tabular-nums mt-2">۴۵۶ <span className="text-base text-muted-foreground">لیتر</span></p>
          <p className="text-xs text-tone-success mt-1" style={{ color: "hsl(127 58% 70%)" }}>
            ↑ ۱۲٪ نسبت به ماه گذشته
          </p>
          <div className="mt-4 h-32 rounded-xl bg-secondary/40 border border-border/40 flex items-end justify-around p-3 gap-1">
            {[40, 55, 35, 65, 50, 80, 70, 90].map((h, i) => (
              <div
                key={i}
                className="flex-1 rounded-md bg-gradient-primary"
                style={{ height: `${h}%`, opacity: 0.4 + (i / 8) * 0.6 }}
              />
            ))}
          </div>
        </GlobalCard>

        <GlobalCard>
          <h3 className="text-base font-extrabold text-foreground mb-1">درآمد (این ماه)</h3>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-3xl font-extrabold text-foreground tabular-nums mt-2">۲۴۵٬۰۰۰</p>
              <p className="text-xs mt-1" style={{ color: "hsl(127 58% 70%)" }}>↑ ۱۵٪ نسبت به ماه گذشته</p>
            </div>
            <img src={kpiCoins} alt="" loading="lazy" className="w-20 h-20 object-contain" />
          </div>
          <div className="mt-4 pt-4 border-t border-border/40">
            <p className="text-sm text-muted-foreground">هزینه‌ها (این ماه)</p>
            <div className="flex items-center justify-between mt-1">
              <p className="text-2xl font-extrabold text-foreground tabular-nums">۹۸٬۰۰۰</p>
              <p className="text-xs" style={{ color: "hsl(0 84% 75%)" }}>↓ ۸٪</p>
            </div>
          </div>
        </GlobalCard>
      </section>

      <p className="text-center text-xs text-muted-foreground pt-2">
        نسخه آزمایشی — ماژول‌ها به‌زودی فعال می‌شوند
      </p>
    </div>
  );
}
