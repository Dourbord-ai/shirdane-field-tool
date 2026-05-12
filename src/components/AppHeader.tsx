import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { ArrowLeft, Bell, Search, User, CloudSun, Calendar, Menu, Plus } from "lucide-react";
import { getSession } from "@/lib/auth";

function shamsiNow(): { date: string; time: string } {
  try {
    const d = new Date();
    const date = new Intl.DateTimeFormat("fa-IR", {
      day: "numeric", month: "long", year: "numeric",
    }).format(d);
    const time = new Intl.DateTimeFormat("fa-IR", {
      hour: "2-digit", minute: "2-digit",
    }).format(d);
    return { date, time };
  } catch {
    return { date: "", time: "" };
  }
}

export default function AppHeader() {
  const navigate = useNavigate();
  const location = useLocation();
  const isDashboard = location.pathname === "/" || location.pathname === "/dashboard";
  const [now, setNow] = useState(shamsiNow());
  const { user } = getSession();

  useEffect(() => {
    const t = setInterval(() => setNow(shamsiNow()), 30_000);
    return () => clearInterval(t);
  }, []);

  if (location.pathname.startsWith("/milk-record/quick")) return null;

  return (
    <header
      className="fixed top-0 inset-x-0 z-50 h-16 glass flex items-center gap-2 px-3 sm:px-4 lg:pr-[17rem]"
      style={{ height: "var(--header-height)" }}
    >
      {/* Mobile brand / back */}
      <div className="flex items-center gap-2 lg:hidden">
        {isDashboard ? (
          <button
            onClick={() => navigate("/dashboard")}
            className="touch-target flex items-center justify-center rounded-xl text-muted-foreground active:bg-secondary"
            aria-label="منو"
          >
            <Menu className="w-6 h-6" />
          </button>
        ) : (
          <button
            onClick={() => navigate(-1)}
            className="touch-target flex items-center justify-center rounded-xl text-muted-foreground active:bg-secondary"
            aria-label="بازگشت"
          >
            <ArrowLeft className="w-6 h-6" />
          </button>
        )}
        <div className="flex flex-col leading-tight">
          <span className="text-base font-extrabold text-foreground">دامبان</span>
          <span className="text-[10px] text-muted-foreground">مدیریت دامداری</span>
        </div>
      </div>

      {/* Desktop search */}
      <div className="hidden lg:flex flex-1 max-w-md items-center gap-2 rounded-xl bg-secondary/60 border border-border/60 px-3 py-2">
        <Search className="w-4 h-4 text-muted-foreground" />
        <input
          dir="rtl"
          placeholder="جستجو..."
          className="flex-1 bg-transparent outline-none text-sm text-foreground placeholder:text-muted-foreground"
        />
      </div>

      <div className="flex-1 lg:hidden" />

      {/* Right cluster: quick milk record, weather, date, bell, profile */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => navigate("/milk-record/quick")}
          className="hidden sm:inline-flex items-center gap-1.5 rounded-xl bg-gradient-primary glow-primary px-3 py-2 text-primary-foreground text-xs font-bold active:scale-[0.98]"
          aria-label="ثبت رکورد شیر"
        >
          <Plus className="w-4 h-4" />
          <span>ثبت رکورد شیر</span>
        </button>
        <button
          onClick={() => navigate("/milk-record/quick")}
          className="sm:hidden touch-target flex items-center justify-center rounded-xl bg-gradient-primary glow-primary text-primary-foreground"
          aria-label="ثبت رکورد شیر"
        >
          <Plus className="w-5 h-5" />
        </button>
        <div className="hidden sm:flex items-center gap-2 rounded-xl glass px-3 py-2">
          <CloudSun className="w-5 h-5 text-tone-warn" style={{ color: "hsl(38 92% 65%)" }} />
          <div className="text-right leading-tight">
            <div className="text-sm font-bold text-foreground">۲۸°C</div>
            <div className="text-[10px] text-muted-foreground">نیمه ابری</div>
          </div>
        </div>

        <div className="hidden md:flex items-center gap-2 rounded-xl glass px-3 py-2">
          <Calendar className="w-5 h-5 text-primary" />
          <div className="text-right leading-tight">
            <div className="text-sm font-bold text-foreground">{now.date}</div>
            <div className="text-[10px] text-muted-foreground">{now.time}</div>
          </div>
        </div>

        <button
          onClick={() => navigate("/dashboard")}
          className="relative touch-target flex items-center justify-center rounded-xl glass"
          aria-label="اعلان‌ها"
        >
          <Bell className="w-5 h-5 text-foreground" />
          <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground flex items-center justify-center">
            ۵
          </span>
        </button>

        <button
          onClick={() => {
            if (isDashboard) {
              localStorage.removeItem("shirdaneh_session");
              navigate("/login");
            } else navigate("/dashboard");
          }}
          className="touch-target flex items-center justify-center rounded-full bg-gradient-primary glow-primary"
          aria-label={user?.name || "پروفایل"}
        >
          <User className="w-5 h-5 text-primary-foreground" />
        </button>
      </div>
    </header>
  );
}
