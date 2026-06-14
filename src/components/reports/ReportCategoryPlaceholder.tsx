import { Link } from "react-router-dom";
import { Construction } from "lucide-react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

// Generic placeholder page for report categories that are not yet implemented.
// Mirrors the look of FertilityReportPlaceholder but is used at the category
// (hub-level) instead of a specific report.
interface Props {
  categoryTitle: string;
}

export default function ReportCategoryPlaceholder({ categoryTitle }: Props) {
  return (
    <div className="space-y-5 py-4" dir="rtl">
      {/* Breadcrumb keeps users oriented: گزارشات > [Category] */}
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to="/reports">گزارشات</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{categoryTitle}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <header>
        <h1 className="text-xl sm:text-2xl font-bold text-foreground">{categoryTitle}</h1>
        <p className="text-sm text-muted-foreground mt-1">دسته‌بندی گزارش‌ها — در حال توسعه</p>
      </header>

      <div className="rounded-2xl border border-border bg-card p-12 flex flex-col items-center justify-center text-center gap-4">
        <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
          <Construction className="w-8 h-8 text-primary" />
        </div>
        <h2 className="text-lg font-bold text-foreground">به زودی</h2>
        <p className="text-sm text-muted-foreground max-w-md">
          این دسته از گزارش‌ها در فازهای بعدی پیاده‌سازی خواهد شد.
        </p>
      </div>
    </div>
  );
}
