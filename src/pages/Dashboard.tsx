import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { getSession } from "@/lib/auth";
import { BarChart3, ClipboardList, Package, Plus, ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";

const modules = [
  { title: "خرید و فروش", icon: ShoppingCart, description: "ثبت و پیگیری فاکتورها", key: "sales" },
  { title: "مدیریت دام", icon: ClipboardList, description: "ثبت و پیگیری اطلاعات دام‌ها", key: "livestock" },
  { title: "انبار و تغذیه", icon: Package, description: "مدیریت خوراک و موجودی انبار", key: "storage" },
  { title: "گزارشات", icon: BarChart3, description: "آمار و گزارش‌های عملکرد", key: "reports" },
];

export default function Dashboard() {
  const navigate = useNavigate();
  const { user } = getSession();
  const [expandedModule, setExpandedModule] = useState<string | null>(null);

  return (
    <div className="py-6 space-y-6 animate-fade-in">
      {/* Welcome */}
      <div className="rounded-xl bg-primary/5 border border-primary/10 p-5 transition-shadow duration-200 hover:shadow-[0_4px_20px_-4px_hsl(142_50%_36%/0.2)]">
        <p className="text-body text-muted-foreground">سلام 👋</p>
        <h2 className="text-heading text-foreground mt-1">{user?.name || "کاربر"}</h2>
        <p className="text-body text-muted-foreground mt-1">به شیردانه خوش آمدید</p>
      </div>

      {/* Module Cards */}
      <div className="space-y-3">
        {modules.map((mod) => (
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
                  variant="secondary"
                  className="w-full touch-target rounded-xl gap-2 text-body font-bold bg-primary/10 text-primary border border-primary/20 transition-all duration-200 hover:bg-primary/15 hover:shadow-[0_2px_12px_-2px_hsl(142_50%_36%/0.2)] hover:border-primary/30"
                  size="lg"
                >
                  <ClipboardList className="w-5 h-5" />
                  فاکتورها
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
