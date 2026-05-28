// Reports (گزارشات) page — hosts the fertility legacy chart and the
// finance "وضعیت ذینفعان" read-only report. Kept thin so we can keep
// adding report modules without touching individual ones.
import FertilityLegacyChart from "@/components/reports/FertilityLegacyChart";
import BeneficiariesStatusReport from "@/components/reports/BeneficiariesStatusReport";

export default function Reports() {
  return (
    <div className="space-y-4" dir="rtl">
      <header className="flex items-center justify-between">
        <h1 className="text-xl sm:text-2xl font-bold text-foreground">گزارشات</h1>
      </header>
      {/* Beneficiaries status — finance party balances & approved payment
          requests. Read-only; never mutates balance values. */}
      <BeneficiariesStatusReport />
      <FertilityLegacyChart />
    </div>
  );
}
