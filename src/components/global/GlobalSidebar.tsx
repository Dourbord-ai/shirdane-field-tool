import { NavLink, useLocation } from "react-router-dom";
import {
  LayoutDashboard, ClipboardList, Beef, Milk, BarChart3, Wallet, Users,
  Award, HeartPulse, Settings, ShoppingCart, Receipt, ListFilter, Droplet,
} from "lucide-react";
import { cn } from "@/lib/utils";

const items = [
  { title: "داشبورد",       icon: LayoutDashboard, to: "/dashboard" },
  { title: "دام‌ها",         icon: Beef,            to: "/livestock" },
  { title: "لیست شخصی دام‌ها", icon: ListFilter,    to: "/livestock/list-builder" },
  { title: "قبوض شیر",       icon: Milk,            to: "/receipts/milk" },
  { title: "قبوض آزمایشگاه", icon: Receipt,         to: "/receipts/lab" },
  { title: "خرید و فروش",    icon: ShoppingCart,    to: "/invoices" },
  { title: "باروری",         icon: HeartPulse,      to: "/fertility/operations" },
  { title: "گزارش‌ها",       icon: BarChart3,       to: "/reports" },
  { title: "امور مالی",      icon: Wallet,          to: "/finance" },
  { title: "منابع انسانی",   icon: Users,           to: "/hr" },
  { title: "مدارک",          icon: Award,           to: "/certificates" },
];

export default function GlobalSidebar() {
  const { pathname } = useLocation();
  return (
    <aside className="hidden lg:flex fixed inset-y-0 right-0 w-64 z-40 flex-col glass border-l border-border/60 px-4 py-5">
      {/* Brand */}
      <div className="flex items-center gap-3 px-2 mb-6">
        <div className="w-11 h-11 rounded-2xl flex items-center justify-center bg-gradient-primary glow-primary">
          <Beef className="w-6 h-6 text-primary-foreground" />
        </div>
        <div>
          <h1 className="text-lg font-extrabold text-foreground leading-tight">دامبان</h1>
          <p className="text-[11px] text-muted-foreground">مدیریت دامداری</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto scrollbar-hide space-y-1">
        {items.map((it) => {
          const active = pathname === it.to || pathname.startsWith(it.to + "/");
          return (
            <NavLink
              key={it.title + it.to}
              to={it.to}
              className={cn(
                "flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-bold transition-all",
                active
                  ? "bg-gradient-primary text-primary-foreground shadow-[0_8px_24px_-8px_hsl(127_58%_58%/0.5)]"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary/60",
              )}
            >
              <it.icon className="w-5 h-5 shrink-0" />
              <span>{it.title}</span>
            </NavLink>
          );
        })}
      </nav>

      <NavLink
        to="/settings"
        className="mt-3 flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-bold text-muted-foreground hover:text-foreground hover:bg-secondary/60"
      >
        <Settings className="w-5 h-5" />
        <span>تنظیمات</span>
      </NavLink>
    </aside>
  );
}
