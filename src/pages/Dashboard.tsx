import { getSession } from "@/lib/auth";
import { BarChart3, ClipboardList, Package, ShoppingCart } from "lucide-react";

const modules = [
  { title: "خرید و فروش", icon: ShoppingCart, description: "ثبت و پیگیری فاکتورها" },
  { title: "مدیریت دام", icon: ClipboardList, description: "ثبت و پیگیری اطلاعات دام‌ها" },
  { title: "انبار و تغذیه", icon: Package, description: "مدیریت خوراک و موجودی انبار" },
  { title: "گزارشات", icon: BarChart3, description: "آمار و گزارش‌های عملکرد" },
];

export default function Dashboard() {
  const { user } = getSession();

  return (
    <div className="py-6 space-y-6 animate-fade-in">
      {/* Welcome */}
      <div className="rounded-xl bg-primary/5 border border-primary/10 p-5">
        <p className="text-body text-muted-foreground">سلام 👋</p>
        <h2 className="text-heading text-foreground mt-1">{user?.name || "کاربر"}</h2>
        <p className="text-body text-muted-foreground mt-1">به شیردانه خوش آمدید</p>
      </div>

      {/* Module Cards */}
      <div className="space-y-3">
        {modules.map((mod) => (
          <button
            key={mod.title}
            className="w-full touch-target rounded-xl bg-card border border-border p-5 flex items-center gap-4 active:bg-secondary transition-colors text-right"
          >
            <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <mod.icon className="w-6 h-6 text-primary" />
            </div>
            <div className="min-w-0">
              <h3 className="text-body-lg font-bold text-foreground">{mod.title}</h3>
              <p className="text-sm text-muted-foreground mt-0.5">{mod.description}</p>
            </div>
          </button>
        ))}
      </div>

      {/* Placeholder note */}
      <p className="text-center text-sm text-muted-foreground pt-4">
        نسخه آزمایشی — ماژول‌ها به‌زودی فعال می‌شوند
      </p>
    </div>
  );
}
