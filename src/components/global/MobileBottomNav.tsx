import { NavLink, useLocation } from "react-router-dom";
import { LayoutDashboard, Beef, Plus, BarChart3, Grid3x3 } from "lucide-react";
import { cn } from "@/lib/utils";

const items = [
  { title: "داشبورد",  icon: LayoutDashboard, to: "/dashboard" },
  { title: "گزارش‌ها", icon: BarChart3,       to: "/dashboard" },
  { title: "افزودن",    icon: Plus,            to: "/milk-record/quick", isFab: true },
  { title: "دام‌ها",    icon: Beef,            to: "/livestock" },
  { title: "بیشتر",     icon: Grid3x3,         to: "/dashboard" },
];

export default function MobileBottomNav() {
  const { pathname } = useLocation();
  return (
    <nav
      className="lg:hidden fixed bottom-0 inset-x-0 z-40 glass border-t border-border/60 px-2 pt-2 pb-[max(env(safe-area-inset-bottom),0.5rem)]"
      aria-label="منوی پایین"
    >
      <div className="flex items-end justify-between max-w-md mx-auto">
        {items.map((it) => {
          const active = pathname === it.to;
          if (it.isFab) {
            return (
              <NavLink
                key={it.title}
                to={it.to}
                className="-mt-6 flex flex-col items-center"
              >
                <span className="w-14 h-14 rounded-2xl bg-gradient-primary flex items-center justify-center glow-primary border-4 border-background">
                  <it.icon className="w-7 h-7 text-primary-foreground" />
                </span>
                <span className="text-[10px] mt-1 font-bold text-foreground">{it.title}</span>
              </NavLink>
            );
          }
          return (
            <NavLink
              key={it.title + it.to}
              to={it.to}
              className={cn(
                "flex-1 flex flex-col items-center gap-1 py-2 rounded-xl text-[11px] font-bold transition",
                active ? "text-primary" : "text-muted-foreground active:text-foreground",
              )}
            >
              <it.icon className="w-5 h-5" />
              <span>{it.title}</span>
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}
