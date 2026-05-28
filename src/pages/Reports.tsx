// Reports (گزارشات) — fertility legacy chart only. The finance
// "وضعیت ذینفعان" report has moved to /finance → tab "گزارش‌ها".
import FertilityLegacyChart from "@/components/reports/FertilityLegacyChart";

export default function Reports() {
  return (
    <div className="space-y-4" dir="rtl">
      <header className="flex items-center justify-between">
        <h1 className="text-xl sm:text-2xl font-bold text-foreground">گزارشات</h1>
      </header>
      <FertilityLegacyChart />
    </div>
  );
}
