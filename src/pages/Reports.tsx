// Reports (گزارشات) — central hub linking to every report category.
// Categories are aligned with the long-term reporting architecture; only
// Fertility and Milk Production have active content for now. Other categories
// route to a placeholder page until their reports are implemented.
import { Link, useSearchParams } from "react-router-dom";
import {
  HeartPulse, Milk, Stethoscope, Users2, Leaf, Dna,
  Wallet, Baby, Building2, LineChart, ArrowLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";
import MilkRecordsReport from "@/components/reports/MilkRecordsReport";

// Each category card describes one branch of the reporting tree.
// `active` controls the "Coming Soon" badge and styling.
interface ReportCategory {
  label: string;
  description: string;
  to: string;
  icon: React.ElementType;
  accent: string;
  active: boolean;
}

const CATEGORIES: ReportCategory[] = [
  { label: "باروری", description: "تولیدمثل، تلقیح، آبستنی و عملکرد باروری", to: "/reports/fertility", icon: HeartPulse, accent: "text-primary", active: true },
  { label: "تولید شیر", description: "گزارش‌های روزانه و دوره‌ای تولید شیر", to: "/reports?tab=milk", icon: Milk, accent: "text-tone-info", active: true },
  { label: "سلامت و دامپزشکی", description: "بیماری‌ها، درمان‌ها و مراقبت‌های دامپزشکی", to: "/reports/health", icon: Stethoscope, accent: "text-muted-foreground", active: false },
  { label: "گله و جمعیت", description: "ساختار گله، ترکیب و تغییرات جمعیتی", to: "/reports/herd", icon: Users2, accent: "text-muted-foreground", active: false },
  { label: "تغذیه", description: "جیره‌نویسی، مصرف خوراک و بهره‌وری تغذیه", to: "/reports/nutrition", icon: Leaf, accent: "text-muted-foreground", active: false },
  { label: "ژنتیک و اصلاح نژاد", description: "شجره، ارزش‌های اصلاحی و برنامه‌های اصلاح نژاد", to: "/reports/genetics", icon: Dna, accent: "text-muted-foreground", active: false },
  { label: "اقتصاد و مالی", description: "تحلیل‌های مالی، درآمد و هزینه‌های دامداری", to: "/reports/economics", icon: Wallet, accent: "text-muted-foreground", active: false },
  { label: "مدیریت گوساله و تلیسه", description: "رشد، سلامت و آماده‌سازی گوساله‌ها و تلیسه‌ها", to: "/reports/calf-heifer", icon: Baby, accent: "text-muted-foreground", active: false },
  { label: "مدیریت تأسیسات", description: "وضعیت سالن‌ها، تجهیزات و امکانات دامداری", to: "/reports/facility", icon: Building2, accent: "text-muted-foreground", active: false },
  { label: "شاخص‌های کلیدی مدیریتی", description: "KPI های اجرایی و داشبورد مدیریت ارشد", to: "/reports/executive-kpis", icon: LineChart, accent: "text-muted-foreground", active: false },
];

export default function Reports() {
  const [searchParams] = useSearchParams();

  // Preserve legacy direct access to the milk-records report via query param.
  if (searchParams.get("tab") === "milk") {
    return <MilkRecordsReport />;
  }

  return (
    <div className="space-y-5 py-4" dir="rtl">
      <header>
        <h1 className="text-xl sm:text-2xl font-bold text-foreground">گزارشات</h1>
        <p className="text-sm text-muted-foreground mt-1">
          دسترسی به تمام گزارش‌های عملیاتی و مدیریتی دامداری
        </p>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {CATEGORIES.map((cat) => (
          <Link
            key={cat.label}
            to={cat.to}
            className={cn(
              "group flex flex-col gap-3 rounded-2xl border p-5 transition-all",
              cat.active
                ? "border-border bg-card hover:border-primary/30 hover:bg-primary/5"
                : "border-border bg-card/60 hover:border-border hover:bg-card/80",
            )}
          >
            <div className="flex items-center justify-between">
              <cat.icon className={cn("w-8 h-8", cat.accent)} />
              {/* Status badge: Active vs Coming Soon — gives users a clear
                  signal about which categories already have content. */}
              {cat.active ? (
                <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-primary/15 text-primary">
                  فعال
                </span>
              ) : (
                <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-muted text-muted-foreground">
                  به زودی
                </span>
              )}
            </div>
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="text-base font-bold text-foreground">{cat.label}</h2>
                <p className="text-sm text-muted-foreground mt-1">{cat.description}</p>
              </div>
              <ArrowLeft className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors mt-1 shrink-0" />
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
