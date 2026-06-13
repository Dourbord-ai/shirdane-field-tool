// Reports (گزارشات) — tabs: فحلی (legacy fertility chart) + رکورد شیر.
import { useState } from "react";
import { cn } from "@/lib/utils";
import { Activity, Milk } from "lucide-react";
import FertilityLegacyChart from "@/components/reports/FertilityLegacyChart";
import MilkRecordsReport from "@/components/reports/MilkRecordsReport";

const TABS = [
  { key: "fertility", label: "فحلی", icon: Activity },
  { key: "milk", label: "رکورد شیر", icon: Milk },
];

export default function Reports() {
  const [tab, setTab] = useState<string>("fertility");
  return (
    <div className="space-y-4" dir="rtl">
      <header className="flex items-center justify-between">
        <h1 className="text-xl sm:text-2xl font-bold text-foreground">گزارشات</h1>
      </header>

      <div className="overflow-x-auto -mx-3 px-3 pb-1">
        <div className="inline-flex gap-1 p-1 rounded-xl bg-muted/40 border min-w-full">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                "shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-bold transition-all whitespace-nowrap",
                tab === t.key
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <t.icon className="w-4 h-4" />
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === "fertility" && <FertilityLegacyChart />}
      {tab === "milk" && <MilkRecordsReport />}
    </div>
  );
}
