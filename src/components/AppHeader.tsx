import { useEffect, useState, FormEvent } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { ArrowLeft, Bell, Search, User, CloudSun, Calendar, Menu, Plus, X } from "lucide-react";
import { getSession } from "@/lib/auth";
import { toEnDigits } from "@/lib/digits";

/**
 * Header-level search box.
 * Behavior mirrors the on-page Livestock search:
 *   - User types a tag/ear/body number (we normalize Persian → English digits).
 *   - On submit (Enter) or on the clear button, we navigate to
 *     /livestock?q=<query>. The Livestock page reads ?q= and runs the exact
 *     same Supabase query it would for a locally-typed search.
 * We deliberately do NOT debounce-navigate while typing — that would push
 * a new history entry on every keystroke. The user explicitly submits.
 */
function HeaderSearchBox() {
  const navigate = useNavigate();
  const location = useLocation();
  // Local controlled input so typing feels instant; we don't read from the URL
  // here because the user may be on any page when they start typing.
  const [value, setValue] = useState("");

  // Submit handler — normalize digits, then navigate to /livestock with ?q=.
  // If the query is empty, just go to /livestock (no filter applied).
  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const q = toEnDigits(value).trim();
    const target = q ? `/livestock?q=${encodeURIComponent(q)}` : "/livestock";
    navigate(target);
  };

  // When the user navigates away from /livestock (or clears the URL),
  // keep the header input in sync with whatever Livestock currently shows
  // so the two search surfaces never disagree visually.
  useEffect(() => {
    if (location.pathname.startsWith("/livestock")) {
      const params = new URLSearchParams(location.search);
      setValue(params.get("q") ?? "");
    }
  }, [location.pathname, location.search]);

  return (
    <form
      onSubmit={submit}
      className="hidden lg:flex flex-1 max-w-md items-center gap-2 rounded-xl bg-secondary/60 border border-border/60 px-3 py-2"
    >
      <Search className="w-4 h-4 text-muted-foreground" />
      <input
        dir="rtl"
        inputMode="search"
        placeholder="جستجوی دام با شماره پلاک..."
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="flex-1 bg-transparent outline-none text-sm text-foreground placeholder:text-muted-foreground"
      />
      {value && (
        <button
          type="button"
          onClick={() => {
            // Clear the input AND clear the filter on the Livestock page
            // so the result list resets to the unfiltered view.
            setValue("");
            navigate("/livestock");
          }}
          className="p-0.5 rounded-full hover:bg-muted/50"
          aria-label="پاک کردن"
        >
          <X className="w-3.5 h-3.5 text-muted-foreground" />
        </button>
      )}
    </form>
  );
}


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

      {/* Desktop search — mirrors the on-page Livestock search.
          Submitting (Enter) or typing+debounce navigates to /livestock?q=<query>
          so the result list is the same one the user gets from the Livestock page. */}
      <HeaderSearchBox />


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
