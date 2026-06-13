// Reports (گزارشات) page — hosts the fertility legacy chart for now.
// Kept thin so we can add more report modules later without touching the chart.
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
