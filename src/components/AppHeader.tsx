import { ArrowRight, User } from "lucide-react";
import { useNavigate, useLocation } from "react-router-dom";

export default function AppHeader() {
  const navigate = useNavigate();
  const location = useLocation();
  const isRoot = location.pathname === "/" || location.pathname === "/dashboard";

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

      {/* Center: brand */}
      <h1 className="text-lg font-bold text-primary select-none">شیردانه</h1>

      {/* Left side: back */}
      {!isRoot ? (
        <button
          onClick={() => navigate(-1)}
          className="touch-target flex items-center justify-center rounded-full text-muted-foreground active:bg-secondary transition-colors"
          aria-label="بازگشت"
        >
          <ArrowRight className="w-6 h-6" />
        </button>
      ) : (
        <div className="w-11" /> /* spacer */
      )}
    </header>
  );
}
