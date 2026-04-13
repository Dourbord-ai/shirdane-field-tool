import { ArrowLeft, User } from "lucide-react";
import { useNavigate, useLocation } from "react-router-dom";

export default function AppHeader() {
  const navigate = useNavigate();
  const location = useLocation();
  const isDashboard = location.pathname === "/" || location.pathname === "/dashboard";

  return (
    <header className="fixed top-0 inset-x-0 z-50 h-14 bg-card border-b border-border flex items-center justify-between px-4 shadow-sm">
      {/* Right side: profile */}
      <button
        onClick={() => navigate("/profile")}
        className="touch-target flex items-center justify-center rounded-full text-muted-foreground active:bg-secondary transition-colors"
        aria-label="پروفایل"
      >
        <User className="w-6 h-6" />
      </button>

      {/* Center: brand — tapping navigates to dashboard */}
      <button
        onClick={() => navigate("/dashboard")}
        className="text-lg font-bold text-primary select-none active:opacity-70 transition-opacity"
      >
        شیردانه
      </button>

      {/* Left side: back button — always visible except on dashboard */}
      {isDashboard ? (
        <button
          onClick={() => {
            localStorage.removeItem("shirdaneh_session");
            navigate("/login");
          }}
          className="touch-target flex items-center justify-center rounded-full border border-border text-muted-foreground active:bg-secondary transition-all duration-200 hover:shadow-[0_2px_12px_-2px_hsl(142_50%_36%/0.2)] hover:border-primary/20"
          aria-label="خروج"
        >
          <ArrowLeft className="w-6 h-6" />
        </button>
      ) : (
        <button
          onClick={() => navigate(-1)}
          className="touch-target flex items-center justify-center rounded-full border border-border text-muted-foreground active:bg-secondary transition-all duration-200 hover:shadow-[0_2px_12px_-2px_hsl(142_50%_36%/0.2)] hover:border-primary/20"
          aria-label="بازگشت"
        >
          <ArrowLeft className="w-6 h-6" />
        </button>
      )}
    </header>
  );
}
