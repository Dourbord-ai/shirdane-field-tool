import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import {
  PRESENCE_STATUS_LABELS,
  FERTILITY_STATUS_LABELS,
  presenceLabel,
  fertilityLabel,
  presenceBadgeClass,
  isFemale,
  dryLabel,
} from "@/lib/livestock";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, Filter, Loader2, ChevronLeft } from "lucide-react";

const PAGE_SIZE = 50;

type Cow = {
  id: number;
  tag_number: string | null;
  earnumber: number | null;
  bodynumber: number | null;
  sextype: string | null;
  sex: number | null;
  presence_status: number | null;
  is_dry: boolean | null;
  last_fertility_status: number | null;
  created_at: string;
};

export default function Livestock() {
  const navigate = useNavigate();
  const [cows, setCows] = useState<Cow[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);

  // filters
  const [search, setSearch] = useState("");
  const [presenceFilter, setPresenceFilter] = useState<string>("all"); // all | 0..4
  const [onlyInHerd, setOnlyInHerd] = useState(false);
  const [dryFilter, setDryFilter] = useState<string>("all"); // all | dry | wet
  const [fertilityFilter, setFertilityFilter] = useState<string>("all");
  const [sexFilter, setSexFilter] = useState<string>("all"); // all | female | male
  const [showFilters, setShowFilters] = useState(false);

  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Reset & fetch when filters change
  useEffect(() => {
    setCows([]);
    setPage(0);
    setHasMore(true);
  }, [search, presenceFilter, onlyInHerd, dryFilter, fertilityFilter]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!hasMore && page > 0) return;
      setLoading(true);
      let q = supabase
        .from("cows")
        .select(
          "id,tag_number,earnumber,bodynumber,sextype,sex,presence_status,is_dry,last_fertility_status,created_at",
        )
        .order("created_at", { ascending: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

      if (search.trim()) {
        const s = search.trim();
        // tag_number is text; earnumber/bodynumber are numeric — best effort search
        q = q.or(
          `tag_number.ilike.%${s}%,earnumber.eq.${Number(s) || 0},bodynumber.eq.${Number(s) || 0}`,
        );
      }
      if (onlyInHerd) {
        q = q.eq("presence_status", 0);
      } else if (presenceFilter !== "all") {
        q = q.eq("presence_status", Number(presenceFilter));
      }
      if (dryFilter === "dry") q = q.eq("is_dry", true).eq("sextype", "ماده");
      if (dryFilter === "wet") q = q.eq("is_dry", false).eq("sextype", "ماده");
      if (fertilityFilter !== "all") {
        q = q.eq("last_fertility_status", Number(fertilityFilter)).eq("sextype", "ماده");
      }

      const { data, error } = await q;
      if (cancelled) return;
      if (error) {
        console.error(error);
        setLoading(false);
        return;
      }
      const rows = (data ?? []) as Cow[];
      setCows((prev) => (page === 0 ? rows : [...prev, ...rows]));
      setHasMore(rows.length === PAGE_SIZE);
      setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [page, search, presenceFilter, onlyInHerd, dryFilter, fertilityFilter, hasMore]);

  // Infinite scroll
  useEffect(() => {
    if (!sentinelRef.current) return;
    const el = sentinelRef.current;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !loading && hasMore) {
          setPage((p) => p + 1);
        }
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [loading, hasMore]);

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (presenceFilter !== "all") n++;
    if (onlyInHerd) n++;
    if (dryFilter !== "all") n++;
    if (fertilityFilter !== "all") n++;
    return n;
  }, [presenceFilter, onlyInHerd, dryFilter, fertilityFilter]);

  return (
    <div className="py-4 space-y-4 animate-fade-in">
      <div>
        <h1 className="text-heading text-foreground">مدیریت دام</h1>
        <p className="text-sm text-muted-foreground mt-1">لیست دام‌ها — برای جزئیات روی هر دام بزنید</p>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          inputMode="search"
          placeholder="جستجو با شماره پلاک"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pr-9"
        />
      </div>

      {/* Quick toggle + filter button */}
      <div className="flex items-center gap-2">
        <Button
          variant={onlyInHerd ? "default" : "outline"}
          size="sm"
          onClick={() => setOnlyInHerd((v) => !v)}
          className="rounded-full"
        >
          فقط موجود در گله
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowFilters((v) => !v)}
          className="rounded-full gap-1"
        >
          <Filter className="w-4 h-4" />
          فیلترها
          {activeFilterCount > 0 && (
            <span className="bg-primary text-primary-foreground text-xs rounded-full px-1.5">
              {activeFilterCount}
            </span>
          )}
        </Button>
      </div>

      {showFilters && (
        <div className="rounded-xl border border-border bg-card p-3 space-y-3 animate-fade-in">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">وضعیت حضور</label>
            <Select value={presenceFilter} onValueChange={setPresenceFilter}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">همه</SelectItem>
                {Object.entries(PRESENCE_STATUS_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">وضعیت دوشش (فقط ماده)</label>
            <Select value={dryFilter} onValueChange={setDryFilter}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">همه</SelectItem>
                <SelectItem value="wet">فقط دوشا</SelectItem>
                <SelectItem value="dry">فقط خشک</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">آخرین وضعیت باروری (فقط ماده)</label>
            <Select value={fertilityFilter} onValueChange={setFertilityFilter}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">همه</SelectItem>
                {Object.entries(FERTILITY_STATUS_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {activeFilterCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setPresenceFilter("all");
                setOnlyInHerd(false);
                setDryFilter("all");
                setFertilityFilter("all");
              }}
              className="w-full"
            >
              پاک کردن فیلترها
            </Button>
          )}
        </div>
      )}

      {/* List */}
      <div className="space-y-2">
        {cows.map((c) => {
          const female = isFemale(c.sextype, c.sex);
          const tag = c.tag_number || c.earnumber || c.bodynumber || "—";
          return (
            <button
              key={c.id}
              onClick={() => navigate(`/livestock/${c.id}`)}
              className="w-full text-right rounded-xl border border-border bg-card p-4 active:bg-secondary transition-all hover:shadow-[0_4px_20px_-4px_hsl(142_50%_36%/0.15)] hover:border-primary/20"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-body-lg font-bold text-foreground">#{tag}</span>
                    <span className="text-xs text-muted-foreground">
                      {c.sextype || (c.sex === 0 ? "ماده" : c.sex === 1 ? "نر" : "—")}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <span className={`text-xs px-2 py-0.5 rounded-full border ${presenceBadgeClass(c.presence_status)}`}>
                      {presenceLabel(c.presence_status)}
                    </span>
                    {female && (
                      <span className="text-xs px-2 py-0.5 rounded-full border bg-secondary text-secondary-foreground border-border">
                        {dryLabel(c.is_dry)}
                      </span>
                    )}
                    {female && c.last_fertility_status != null && (
                      <span className="text-xs px-2 py-0.5 rounded-full border bg-muted text-muted-foreground border-border">
                        {fertilityLabel(c.last_fertility_status)}
                      </span>
                    )}
                  </div>
                </div>
                <ChevronLeft className="w-5 h-5 text-muted-foreground shrink-0 mt-1" />
              </div>
            </button>
          );
        })}

        {loading && (
          <div className="flex items-center justify-center py-6 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        )}

        {!loading && cows.length === 0 && (
          <div className="text-center py-12 text-muted-foreground text-sm">
            دامی با این فیلترها یافت نشد
          </div>
        )}

        <div ref={sentinelRef} className="h-6" />
        {!hasMore && cows.length > 0 && (
          <p className="text-center text-xs text-muted-foreground py-2">پایان لیست</p>
        )}
      </div>
    </div>
  );
}
