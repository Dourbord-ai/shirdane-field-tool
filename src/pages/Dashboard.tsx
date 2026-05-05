import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { getSession } from "@/lib/auth";
import { BarChart3, ClipboardList, Package, Plus, ShoppingCart, Receipt, Milk, FlaskConical, Users, Award, HeartPulse, Settings, List, PlusCircle, Activity, Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import InvoiceNotifications from "@/components/InvoiceNotifications";

const modules = [
  { title: "خرید و فروش", icon: ShoppingCart, description: "ثبت و پیگیری فاکتورها", key: "sales" },
  { title: "قبوض", icon: Receipt, description: "قبض شیر و نتایج آزمایشگاه", key: "receipts" },
  { title: "مدیریت دام", icon: ClipboardList, description: "ثبت و پیگیری اطلاعات دام‌ها", key: "livestock" },
  { title: "انبار و تغذیه", icon: Package, description: "مدیریت خوراک و موجودی انبار", key: "storage" },
  { title: "گزارشات", icon: BarChart3, description: "آمار و گزارش‌های عملکرد", key: "reports" },
  { title: "منابع انسانی", icon: Users, description: "حضور و غیاب و درخواست‌ها", key: "hr" },
  { title: "مدارک و مجوزها", icon: Award, description: "مدیریت گواهینامه‌ها و پروانه‌ها", key: "certificates" },
  { title: "مدیریت باروری", icon: HeartPulse, description: "ورکفلو، قواعد، عملیات و هشدارهای باروری", key: "fertility", adminOnly: true },
];

const fertilityItems = [
  { title: "ورکفلو باروری", route: "/fertility/workflows", icon: Settings },
  { title: "تعریف قواعد", route: "/fertility/rules", icon: List },
  { title: "ثبت عملیات باروری", route: "/fertility/operations", icon: PlusCircle },
  { title: "تایم‌لاین باروری دام", route: "/fertility/timeline", icon: Activity },
  { title: "هشدارهای باروری", route: "/fertility/alerts", icon: Bell },
  { title: "انواع فحلی", route: "/fertility/erotic-types", icon: Settings },
];

export default function Dashboard() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = getSession();
  const isAdmin = !!user && ((user as { isSuperAdmin?: boolean }).isSuperAdmin || (user as { role?: string }).role === "admin" || (user as { role?: string }).role === "super_admin");
  const visibleModules = modules.filter((m) => !(m as { adminOnly?: boolean }).adminOnly || isAdmin);
  const [expandedModule, setExpandedModule] = useState<string | null>(null);

  return (
    <div className="py-6 space-y-6 animate-fade-in">
      {/* Welcome */}
      <div className="rounded-xl bg-primary/5 border border-primary/10 p-5 transition-shadow duration-200 hover:shadow-[0_4px_20px_-4px_hsl(142_50%_36%/0.2)]">
        <p className="text-body text-muted-foreground">سلام 👋</p>
        <h2 className="text-heading text-foreground mt-1">{user?.name || "کاربر"}</h2>
        <p className="text-body text-muted-foreground mt-1">به شیردانه خوش آمدید</p>
      </div>

      {/* Invoice Notifications */}
      <InvoiceNotifications />

      {/* Module Cards */}
      <div className="space-y-3">
        {visibleModules.map((mod) => (
          <div key={mod.key}>
            <button
              onClick={() => setExpandedModule(expandedModule === mod.key ? null : mod.key)}
              className="w-full touch-target rounded-xl bg-card border border-border p-5 flex items-center gap-4 active:bg-secondary transition-all duration-200 text-right hover:shadow-[0_4px_20px_-4px_hsl(142_50%_36%/0.25)] hover:border-primary/20"
            >
              <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <mod.icon className="w-6 h-6 text-primary" />
              </div>
              <div className="min-w-0">
                <h3 className="text-body-lg font-bold text-foreground">{mod.title}</h3>
                <p className="text-sm text-muted-foreground mt-0.5">{mod.description}</p>
              </div>
            </button>

            {/* New Invoice button - shown when خرید و فروش is tapped */}
            {mod.key === "sales" && expandedModule === "sales" && (
              <div className="space-y-2 mt-2 animate-fade-in">
                <Button
                  onClick={() => navigate("/invoices/new")}
                  className="w-full touch-target rounded-xl gap-2 text-body font-bold transition-all duration-200 hover:shadow-[0_4px_20px_-4px_hsl(142_50%_36%/0.3)]"
                  size="lg"
                >
                  <Plus className="w-5 h-5" />
                  ثبت فاکتور جدید
                </Button>
                <Button
                  onClick={() => navigate("/invoices")}
                  className="w-full touch-target rounded-xl gap-2 text-body font-bold transition-all duration-200 hover:shadow-[0_4px_20px_-4px_hsl(142_50%_36%/0.3)]"
                  size="lg"
                >
                  <ClipboardList className="w-5 h-5" />
                  فاکتورها
                </Button>
              </div>
            )}

            {/* Receipts sub-cards - shown when قبوض is tapped */}
            {mod.key === "receipts" && expandedModule === "receipts" && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2 animate-fade-in">
                <button
                  onClick={() => navigate("/receipts/milk")}
                  className="touch-target rounded-xl bg-gradient-to-br from-blue-50 to-white border border-blue-200/60 p-4 flex flex-col items-start gap-2 text-right transition-all duration-200 hover:shadow-[0_4px_20px_-4px_hsl(210_80%_50%/0.25)] hover:border-blue-300 active:scale-[0.98]"
                  aria-label="قبض شیر"
                >
                  <div className="w-11 h-11 rounded-lg bg-blue-100 flex items-center justify-center">
                    <Milk className="w-5 h-5 text-blue-600" />
                  </div>
                  <div className="min-w-0">
                    <h4 className="text-body font-bold text-foreground">قبض شیر</h4>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                      صورت حساب فروش شیر کارخانه
                    </p>
                  </div>
                </button>

                <button
                  onClick={() => navigate("/receipts/lab")}
                  className="touch-target rounded-xl bg-gradient-to-br from-amber-50 to-white border border-amber-200/60 p-4 flex flex-col items-start gap-2 text-right transition-all duration-200 hover:shadow-[0_4px_20px_-4px_hsl(38_90%_50%/0.25)] hover:border-amber-300 active:scale-[0.98]"
                  aria-label="نتایج آزمایشگاه"
                >
                  <div className="w-11 h-11 rounded-lg bg-amber-100 flex items-center justify-center">
                    <FlaskConical className="w-5 h-5 text-amber-600" />
                  </div>
                  <div className="min-w-0">
                    <h4 className="text-body font-bold text-foreground">نتایج آزمایشگاه</h4>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                      مشاهده نتایج آزمون‌های شیر
                    </p>
                  </div>
                </button>
              </div>
            )}

            {mod.key === "hr" && expandedModule === "hr" && (
              <div className="mt-2 animate-fade-in">
                <Button
                  onClick={() => navigate("/hr")}
                  className="w-full touch-target rounded-xl gap-2 text-body font-bold"
                  size="lg"
                >
                  <Users className="w-5 h-5" />
                  ورود به منابع انسانی
                </Button>
              </div>
            )}

            {mod.key === "certificates" && expandedModule === "certificates" && (
              <div className="mt-2 animate-fade-in">
                <Button
                  onClick={() => navigate("/certificates")}
                  className="w-full touch-target rounded-xl gap-2 text-body font-bold"
                  size="lg"
                >
                  <Award className="w-5 h-5" />
                  مشاهده مدارک و مجوزها
                </Button>
              </div>
            )}

            {/* Fertility management — admin only */}
            {mod.key === "fertility" && expandedModule === "fertility" && (
              <div className="space-y-2 mt-2 animate-fade-in">
                {fertilityItems.map((item) => {
                  const active = location.pathname === item.route;
                  return (
                    <Button
                      key={item.route}
                      onClick={() => navigate(item.route)}
                      variant={active ? "default" : "outline"}
                      className={`w-full touch-target rounded-xl gap-2 text-body font-bold justify-start transition-all duration-200 hover:shadow-[0_4px_20px_-4px_hsl(142_50%_36%/0.3)] ${active ? "ring-2 ring-primary/40" : ""}`}
                      size="lg"
                    >
                      <item.icon className="w-5 h-5" />
                      {item.title}
                    </Button>
                  );
                })}
              </div>
            )}

            {/* Livestock management — direct navigation */}
            {mod.key === "livestock" && expandedModule === "livestock" && (
              <div className="mt-2 animate-fade-in">
                <Button
                  onClick={() => navigate("/livestock")}
                  className="w-full touch-target rounded-xl gap-2 text-body font-bold transition-all duration-200 hover:shadow-[0_4px_20px_-4px_hsl(142_50%_36%/0.3)]"
                  size="lg"
                >
                  <ClipboardList className="w-5 h-5" />
                  مشاهده لیست دام‌ها
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Placeholder note */}
      <p className="text-center text-sm text-muted-foreground pt-4">
        نسخه آزمایشی — ماژول‌ها به‌زودی فعال می‌شوند
      </p>
    </div>
  );
}
