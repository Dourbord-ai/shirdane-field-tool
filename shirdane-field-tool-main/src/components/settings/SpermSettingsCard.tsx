// SpermSettingsCard
// -----------------
// Settings card that lists every sperm row from the `sperms` table and lets the
// operator flip its `is_active` flag on/off. Inactive sperms are hidden from the
// regular sperm selection dropdowns throughout the app (insemination, list builder,
// new invoice), but remain visible here so they can be re-activated at any time.
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, FlaskConical, Search } from "lucide-react";
import { toast } from "@/hooks/use-toast";

// Local shape — we only need the columns relevant to settings/listing.
type SpermRow = {
  id: number;
  name: string | null;
  code: string | null;
  is_active: boolean;
};

// Tab filter for the list: all / active / inactive.
type Filter = "all" | "active" | "inactive";

export default function SpermSettingsCard() {
  // List of sperms loaded from supabase.
  const [rows, setRows] = useState<SpermRow[]>([]);
  // Loading flag for initial fetch.
  const [loading, setLoading] = useState(true);
  // Active filter tab.
  const [filter, setFilter] = useState<Filter>("all");
  // Free-text search by name/code.
  const [q, setQ] = useState("");
  // Track which row ids are currently being toggled (to disable the switch).
  const [pending, setPending] = useState<Set<number>>(new Set());

  // Initial load — we fetch ALL sperms regardless of is_active because this
  // settings card is the place where users manage activation state.
  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("sperms")
        .select("id, name, code, is_active")
        .order("name", { ascending: true })
        .limit(2000);
      if (error) {
        toast({ title: "خطا در بارگذاری اسپرم‌ها", description: error.message, variant: "destructive" });
      } else {
        setRows((data ?? []) as SpermRow[]);
      }
      setLoading(false);
    })();
  }, []);

  // Toggle is_active for a single sperm and update local state optimistically.
  async function toggle(row: SpermRow, next: boolean) {
    // Mark this row as pending so the switch is disabled briefly.
    setPending((s) => new Set(s).add(row.id));
    // Optimistic UI update.
    setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, is_active: next } : r)));

    const { error } = await supabase
      .from("sperms")
      .update({ is_active: next })
      .eq("id", row.id);

    if (error) {
      // Revert on failure.
      setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, is_active: !next } : r)));
      toast({ title: "ذخیره نشد", description: error.message, variant: "destructive" });
    } else {
      toast({
        title: next ? "اسپرم فعال شد" : "اسپرم غیرفعال شد",
        description: row.name ?? row.code ?? `#${row.id}`,
      });
    }

    // Clear pending flag.
    setPending((s) => {
      const n = new Set(s);
      n.delete(row.id);
      return n;
    });
  }

  // Derived: filtered + searched rows for rendering.
  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === "active" && !r.is_active) return false;
      if (filter === "inactive" && r.is_active) return false;
      if (!needle) return true;
      return (
        (r.name ?? "").toLowerCase().includes(needle) ||
        (r.code ?? "").toLowerCase().includes(needle)
      );
    });
  }, [rows, filter, q]);

  // Counters shown on the filter chips.
  const counts = useMemo(
    () => ({
      all: rows.length,
      active: rows.filter((r) => r.is_active).length,
      inactive: rows.filter((r) => !r.is_active).length,
    }),
    [rows],
  );

  // Tab definitions for the filter row.
  const tabs: { key: Filter; label: string; count: number }[] = [
    { key: "all", label: "همه", count: counts.all },
    { key: "active", label: "فعال", count: counts.active },
    { key: "inactive", label: "غیر فعال", count: counts.inactive },
  ];

  return (
    <section className="rounded-2xl border border-border bg-card overflow-hidden">
      {/* Card header: icon + title + short description */}
      <header className="flex items-start gap-3 p-4 border-b border-border bg-gradient-to-l from-primary/10 to-transparent">
        <div className="w-10 h-10 rounded-xl bg-primary/15 text-primary flex items-center justify-center shrink-0">
          <FlaskConical className="w-5 h-5" />
        </div>
        <div className="flex-1">
          <h2 className="text-base font-bold text-foreground">تنظیمات اسپرم</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            فقط اسپرم‌های «فعال» در فهرست‌های انتخاب اسپرم در سراسر برنامه نمایش داده می‌شوند.
          </p>
        </div>
      </header>

      {/* Filter chips + search */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 border-b border-border">
        <div className="flex flex-wrap gap-1.5">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setFilter(t.key)}
              className={
                "px-3 py-1.5 rounded-full text-xs font-bold border transition-colors " +
                (filter === t.key
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-secondary/40 text-muted-foreground border-transparent hover:text-foreground")
              }
            >
              {t.label}
              <span className="opacity-70 mr-1">({t.count})</span>
            </button>
          ))}
        </div>
        <div className="relative w-full sm:w-64">
          <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="جستجو در نام یا کد..."
            className="pr-9"
          />
        </div>
      </div>

      {/* List body */}
      {loading ? (
        <div className="flex items-center justify-center py-10 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      ) : visible.length === 0 ? (
        <p className="text-center text-muted-foreground py-8 text-sm">موردی یافت نشد</p>
      ) : (
        <ul className="divide-y divide-border max-h-[60vh] overflow-y-auto">
          {visible.map((r) => {
            const isPending = pending.has(r.id);
            return (
              <li
                key={r.id}
                className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-secondary/30 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm text-foreground truncate">
                      {r.name ?? `#${r.id}`}
                    </span>
                    {/* Status badge mirrors the switch state for quick scanning */}
                    <Badge
                      variant={r.is_active ? "default" : "secondary"}
                      className={r.is_active ? "" : "opacity-60"}
                    >
                      {r.is_active ? "فعال" : "غیر فعال"}
                    </Badge>
                  </div>
                  {r.code && (
                    <div className="text-xs text-muted-foreground mt-0.5">کد: {r.code}</div>
                  )}
                </div>
                {/* The actual toggle — disabled while the update is in flight */}
                <Switch
                  checked={r.is_active}
                  disabled={isPending}
                  onCheckedChange={(v) => toggle(r, v)}
                />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
