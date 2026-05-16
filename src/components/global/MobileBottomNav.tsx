import { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  LayoutDashboard, Beef, Plus, BarChart3, Grid3x3,
  Milk, Receipt, ShoppingCart, HeartPulse, Wallet, Users, Award, Settings,
} from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

// Primary 5-slot bottom bar. The 5th slot ("بیشتر") opens a full sheet
// listing every section, so the user can reach pages that don't fit in the
// bar (mirrors the desktop GlobalSidebar list).
const primary = [
  { title: "داشبورد",  icon: LayoutDashboard, to: "/dashboard" },
  { title: "گزارش‌ها", icon: BarChart3,       to: "/dashboard" },
  { title: "افزودن",   icon: Plus,            to: "/milk-record/quick", isFab: true },
  { title: "دام‌ها",   icon: Beef,            to: "/livestock" },
];

// Full menu shown inside the "بیشتر" sheet — keep in sync with GlobalSidebar.
const allItems = [
  { title: "داشبورد",        icon: LayoutDashboard, to: "/dashboard" },
  { title: "دام‌ها",          icon: Beef,            to: "/livestock" },
  { title: "قبوض شیر",        icon: Milk,            to: "/receipts/milk" },
  { title: "قبوض آزمایشگاه",  icon: Receipt,         to: "/receipts/lab" },
  { title: "خرید و فروش",     icon: ShoppingCart,    to: "/invoices" },
  { title: "باروری",          icon: HeartPulse,      to: "/fertility/operations" },
  { title: "گزارش‌ها",        icon: BarChart3,       to: "/dashboard" },
  { title: "امور مالی",       icon: Wallet,          to: "/finance" },
  { title: "منابع انسانی",    icon: Users,           to: "/hr" },
  { title: "مدارک",           icon: Award,           to: "/certificates" },
  { title: "تنظیمات",         icon: Settings,        to: "/dashboard" },
];

export default function MobileBottomNav() {
  const { pathname } = useLocation();
  // Controlled Sheet so we can auto-close on navigation tap.
  const [open, setOpen] = useState(false);

  return (
    <nav
      className="lg:hidden fixed bottom-0 inset-x-0 z-40 glass border-t border-border/60 px-2 pt-2 pb-[max(env(safe-area-inset-bottom),0.5rem)]"
      aria-label="منوی پایین"
    >
      <div className="flex items-end justify-between max-w-md mx-auto">
        {primary.map((it) => {
          const active = pathname === it.to;
          if (it.isFab) {
            return (
              <NavLink key={it.title} to={it.to} className="-mt-6 flex flex-col items-center">
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

        {/* "بیشتر" — opens a bottom sheet with the full nav, instead of just
            routing to dashboard. This is what the user expects on mobile. */}
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <button
              type="button"
              className="flex-1 flex flex-col items-center gap-1 py-2 rounded-xl text-[11px] font-bold text-muted-foreground active:text-foreground"
              aria-label="منوی بیشتر"
            >
              <Grid3x3 className="w-5 h-5" />
              <span>بیشتر</span>
            </button>
          </SheetTrigger>
          <SheetContent
            side="bottom"
            className="rounded-t-2xl bg-card border-t border-border/60 max-h-[80vh] overflow-y-auto"
          >
            <SheetHeader>
              <SheetTitle className="text-right text-foreground">همه بخش‌ها</SheetTitle>
            </SheetHeader>
            <div className="grid grid-cols-3 gap-3 mt-4 pb-6">
              {allItems.map((it) => {
                const active = pathname === it.to || pathname.startsWith(it.to + "/");
                return (
                  <NavLink
                    key={it.title + it.to}
                    to={it.to}
                    onClick={() => setOpen(false)}
                    className={cn(
                      "flex flex-col items-center justify-center gap-2 p-3 rounded-2xl border text-xs font-bold transition",
                      active
                        ? "bg-gradient-primary text-primary-foreground border-transparent glow-primary"
                        : "bg-secondary/40 text-foreground border-border/60 active:bg-secondary",
                    )}
                  >
                    <it.icon className="w-6 h-6" />
                    <span className="text-center leading-tight">{it.title}</span>
                  </NavLink>
                );
              })}
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </nav>
  );
}
