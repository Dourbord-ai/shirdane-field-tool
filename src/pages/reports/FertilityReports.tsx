import { Link, useLocation } from "react-router-dom";
import { HeartPulse, ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

interface ReportItem {
  label: string;
  path: string;
  active: boolean;
}

const REPORTS: ReportItem[] = [
  { label: "گاوهای نیازمند اقدام تولیدمثلی", path: "/reports/fertility/action-list", active: true },
  { label: "داشبورد باروری", path: "/reports/fertility/dashboard", active: false },
  { label: "عملکرد باروری گله", path: "/reports/fertility/herd-performance", active: true },
  { label: "عملکرد اسپرم", path: "/reports/fertility/semen-performance", active: false },
  { label: "عملکرد تلقیح‌کنندگان", path: "/reports/fertility/technician-performance", active: false },
  { label: "پروتکل‌های همزمانی", path: "/reports/fertility/synchronization-protocols", active: false },
  { label: "هزینه آبستنی", path: "/reports/fertility/pregnancy-cost", active: false },
  { label: "سقط و تلفات آبستنی", path: "/reports/fertility/pregnancy-loss", active: false },
  { label: "گاوهای تازه‌زا", path: "/reports/fertility/fresh-cows", active: false },
  { label: "تحلیل اقتصادی تولیدمثل", path: "/reports/fertility/economic-analysis", active: false },
];

export default function FertilityReports() {
  const location = useLocation();

  return (
    <div className="space-y-5 py-4" dir="rtl">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to="/reports">گزارشات</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>باروری</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <header>
        <h1 className="text-xl sm:text-2xl font-bold text-foreground flex items-center gap-2">
          <HeartPulse className="w-6 h-6 text-primary" />
          گزارشات باروری
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          تمام گزارش‌های مرتبط با تولیدمثل و مدیریت باروری گله
        </p>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {REPORTS.map((r) => {
          const isActive = location.pathname === r.path;
          // Explicit Active / Coming Soon status chip shown on every report row.
          const Badge = r.active ? (
            <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-primary/15 text-primary">
              فعال
            </span>
          ) : (
            <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-muted text-muted-foreground">
              به زودی
            </span>
          );

          return r.active ? (
            <Link
              key={r.path}
              to={r.path}
              className={cn(
                "group flex items-center justify-between rounded-2xl border px-5 py-4 transition-all",
                isActive
                  ? "border-primary/50 bg-primary/5"
                  : "border-border bg-card hover:border-primary/30 hover:bg-primary/5",
              )}
            >
              <span className="text-sm font-bold text-foreground">{r.label}</span>
              <div className="flex items-center gap-3">
                {Badge}
                <ArrowLeft className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
              </div>
            </Link>
          ) : (
            <div
              key={r.path}
              className="flex items-center justify-between rounded-2xl border border-border bg-card/60 px-5 py-4 opacity-80"
            >
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-bold text-foreground">{r.label}</span>
                <span className="text-[11px] text-muted-foreground">در حال توسعه</span>
              </div>
              {Badge}
            </div>
          );
        })}
      </div>
    </div>
  );
}
