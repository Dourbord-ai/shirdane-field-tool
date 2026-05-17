// Settings page
// -------------
// Container for all global settings cards. Currently hosts the sperm settings
// card; designed as a responsive grid so future settings cards (e.g. sync,
// alerts, calendar) can be added without restructuring.
import SpermSettingsCard from "@/components/settings/SpermSettingsCard";

export default function Settings() {
  return (
    <div className="py-6 space-y-6">
      {/* Page heading */}
      <header>
        <h1 className="text-2xl font-extrabold text-foreground">تنظیمات</h1>
        <p className="text-sm text-muted-foreground mt-1">
          مدیریت داده‌های مرجع و رفتار عمومی برنامه
        </p>
      </header>

      {/* Grid of setting cards — single column on mobile, two on larger screens */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SpermSettingsCard />
      </div>
    </div>
  );
}
