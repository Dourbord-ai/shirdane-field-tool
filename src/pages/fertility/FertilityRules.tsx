import { List } from "lucide-react";

export default function FertilityRules() {
  return (
    <div className="py-6 space-y-4 animate-fade-in" dir="rtl">
      <div className="rounded-xl bg-card border border-border p-6 flex items-center gap-4">
        <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
          <List className="w-6 h-6 text-primary" />
        </div>
        <div>
          <h1 className="text-heading text-foreground">تعریف قواعد</h1>
          <p className="text-sm text-muted-foreground mt-1">به‌زودی فعال می‌شود</p>
        </div>
      </div>
    </div>
  );
}
