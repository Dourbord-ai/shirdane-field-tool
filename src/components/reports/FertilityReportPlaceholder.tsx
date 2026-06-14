import { HeartPulse, Construction } from "lucide-react";
import FertilityBreadcrumb from "./FertilityBreadcrumb";

interface FertilityReportPlaceholderProps {
  pageTitle: string;
}

/**
 * Placeholder page for fertility reports that are not yet implemented.
 * Displays a consistent "در حال توسعه" message with the fertility icon.
 */
export default function FertilityReportPlaceholder({ pageTitle }: FertilityReportPlaceholderProps) {
  return (
    <div className="space-y-5 py-4" dir="rtl">
      <FertilityBreadcrumb currentPage={pageTitle} />

      <header>
        <h1 className="text-xl sm:text-2xl font-bold text-foreground flex items-center gap-2">
          <HeartPulse className="w-6 h-6 text-primary" />
          {pageTitle}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          گزارش باروری — در حال توسعه
        </p>
      </header>

      <div className="rounded-2xl border border-border bg-card p-12 flex flex-col items-center justify-center text-center gap-4">
        <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
          <Construction className="w-8 h-8 text-primary" />
        </div>
        <h2 className="text-lg font-bold text-foreground">در حال توسعه</h2>
        <p className="text-sm text-muted-foreground max-w-md">
          این گزارش در حال پیاده‌سازی است. به زودی در دسترس خواهد بود.
        </p>
      </div>
    </div>
  );
}
