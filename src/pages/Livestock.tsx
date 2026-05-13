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
import {
  QUICK_CHIPS,
  applyFilters,
  getOption,
  presenceIdFromStatus,
  fertilityIdFromStatus,
} from "@/lib/livestockFilters";
import { toEnDigits } from "@/lib/digits";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, SlidersHorizontal, Loader2, ChevronLeft, X } from "lucide-react";
import kpiCowHerd from "@/assets/kpi-cow-herd.png";
import kpiCowMilking from "@/assets/kpi-cow-milking.png";
import kpiCowPregnant from "@/assets/kpi-cow-pregnant.png";
import kpiMilkCan from "@/assets/kpi-milk-can.png";
import { cowImageFor } from "@/lib/cowImage";

const PAGE_SIZE = 10;

type Cow = {
  id: number;
  tag_number: string | null;
  earnumber: number | null;
  bodynumber: number | null;
  sextype: string | null;
  sex: number | null;
  existancestatus: number | null;
  is_dry: boolean | null;
  last_fertility_status: number | null;
  created_at: string;
};

import { IN_HERD_OR_STRING as IN_HERD_OR } from "@/lib/cowPresence";

export default function Livestock() {
  const navigate = useNavigate();
  const [cows, setCows] = useState<Cow[]>([]);
  const [totals, setTotals] = useState<{ total: number; in_herd: number; wet: number; dry: number; pregnant: number; inseminated: number; fresh: number }>(
    { total: 0, in_herd: 0, wet: 0, dry: 0, pregnant: 0, inseminated: 0, fresh: 0 }
  );
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);

  // search (debounced)
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setSearch(toEnDigits(searchInput).trim()), 250);
    return () => clearTimeout(t);
  }, [searchInput]);

  // -------- Unified filter state --------
  // Single source of truth: a Set of filter ids (e.g. "presence:in_herd").
  // Both quick chips and advanced dropdowns write into this set.
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(["presence:in_herd"]),
  );
  const [showAdvanced, setShowAdvanced] = useState(false);

  const selectedKey = useMemo(() => Array.from(selected).sort().join("|"), [selected]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Advanced single-select dropdown helpers: replace any existing id in the
  // same category so the dropdown always reflects exactly one choice.
  const setSingleInCategory = (prefix: string, id: string | null) => {
    setSelected((prev) => {
      const next = new Set(Array.from(prev).filter((x) => !x.startsWith(prefix)));
      if (id) next.add(id);
      return next;
    });
  };

  const presenceFilter = useMemo(() => {
    const id = Array.from(selected).find((x) => x.startsWith("presence:"));
    return id ? id.split(":")[1] : "all";
  }, [selectedKey]);

  const fertilityFilter = useMemo(() => {
    const id = Array.from(selected).find((x) => x.startsWith("fertility:"));
    return id ? id.split(":")[1] : "all";
  }, [selectedKey]);

  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // KPI counts — treat NULL presence_status as "in herd"
  useEffect(() => {
    let cancelled = false;
    async function loadKpis() {
      const head = (q: any) => q.select("id", { count: "exact", head: true });
      // IMPORTANT: these queries must match the rules used by the main
      // Dashboard (src/pages/Dashboard.tsx) so the KPI numbers shown on both
      // pages are identical:
      //   - "موجود گله" → existancestatus IS NULL OR = 0 (IN_HERD_OR)
      //   - female      → sex = 0 (canonical, not sextype text)
      //   - pregnant    → is_pregnancy = true (boolean cache, not status id)
      //   - milking/dry → is_dry = false / true
      const [t, h, w, d, p, ins, fr] = await Promise.all([
        head(supabase.from("cows")),
        head(supabase.from("cows")).or(IN_HERD_OR),
        head(supabase.from("cows")).or(IN_HERD_OR).eq("sex", 0).eq("is_dry", false),
        head(supabase.from("cows")).or(IN_HERD_OR).eq("sex", 0).eq("is_dry", true),
        head(supabase.from("cows")).or(IN_HERD_OR).eq("sex", 0).eq("is_pregnancy", true),
        head(supabase.from("cows")).or(IN_HERD_OR).eq("sex", 0).eq("last_fertility_status", 3),
        head(supabase.from("cows")).or(IN_HERD_OR).eq("sex", 0).eq("last_fertility_status", 12),
      ]);
      if (cancelled) return;
      setTotals({
        total: t.count ?? 0,
        in_herd: h.count ?? 0,
        wet: w.count ?? 0,
        dry: d.count ?? 0,
        pregnant: p.count ?? 0,
        inseminated: ins.count ?? 0,
        fresh: fr.count ?? 0,
      });
    }
    loadKpis();
    return () => { cancelled = true; };
  }, []);

  // Reset paging when filters change
  useEffect(() => {
    setCows([]);
    setPage(0);
    setHasMore(true);
  }, [search, selectedKey]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!hasMore && page > 0) return;
      setLoading(true);
      let q = supabase
        .from("cows")
        .select(
          "id,tag_number,earnumber,bodynumber,sextype,sex,existancestatus,is_dry,last_fertility_status,created_at",
        )
        .order("created_at", { ascending: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

      if (search) {
        const n = Number(search);
        q = q.or(
          `tag_number.ilike.%${search}%,earnumber.eq.${Number.isFinite(n) ? n : 0},bodynumber.eq.${Number.isFinite(n) ? n : 0}`,
        );
      }

      // Single shared filter pipeline — used by both quick chips and advanced
      q = applyFilters(q, selected);

      const { data, error } = await q;
      if (cancelled) return;
      if (error) { console.error(error); setLoading(false); return; }
      const rows = (data ?? []) as Cow[];
      setCows((prev) => (page === 0 ? rows : [...prev, ...rows]));
      setHasMore(rows.length === PAGE_SIZE);
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [page, search, selectedKey, hasMore]);

  // Manual pagination — no auto infinite scroll (improves LCP).
  // The sentinel is kept for layout but only triggers when explicitly intersected
  // after the user clicks "Load more". We removed the IntersectionObserver entirely.

  const kpis = useMemo(() => ([
    { id: "presence:in_herd", label: "موجود در گله", value: totals.in_herd,  image: kpiCowHerd,     accent: "hsl(127 58% 58%)" },
    { id: "milking:wet",      label: "گاوهای دوشا",  value: totals.wet,      image: kpiCowMilking,  accent: "hsl(217 91% 60%)" },
    { id: "milking:dry",      label: "گاوهای خشک",   value: totals.dry,      image: kpiMilkCan,     accent: "hsl(38 92% 55%)" },
    { id: "fertility:8",      label: "گاوهای آبستن", value: totals.pregnant, image: kpiCowPregnant, accent: "hsl(258 90% 66%)" },
  ]), [totals]);

  const selectedList = useMemo(
    () => Array.from(selected).map((id) => ({ id, opt: getOption(id) })).filter((x) => x.opt),
    [selectedKey],
  );

  const clearAll = () => setSelected(new Set());

  return (
    <div className="livestock-surface -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 py-4 space-y-4 animate-fade-in min-h-[calc(100vh-3.5rem)]">
      {/* Header */}
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h1 className="text-heading text-foreground">مدیریت دام</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            مجموع: <span className="tabular-nums font-semibold text-foreground">{totals.total.toLocaleString("fa-IR")}</span>
          </p>
        </div>
      </div>

      {/* KPI strip — image-rich enterprise tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
        {kpis.map((k) => {
          const active = selected.has(k.id);
          return (
            <button
              key={k.id}
              onClick={() => toggle(k.id)}
              className={`kpi-tile group ${active ? "ring-2 ring-primary/40 border-primary/40" : ""}`}
              style={active ? { boxShadow: `0 14px 40px -12px ${k.accent}` } : undefined}
            >
              <div className="flex items-start justify-between gap-2 relative z-10">
                <div className="min-w-0 flex-1 text-right">
                  <span className="kpi-label">{k.label}</span>
                  <div className="kpi-value mt-1">{(k.value ?? 0).toLocaleString("fa-IR")}</div>
                </div>
                <img
                  src={k.image}
                  alt=""
                  loading="lazy"
                  className="w-14 h-14 sm:w-16 sm:h-16 object-contain shrink-0 -my-1 -mr-1 drop-shadow-[0_6px_18px_rgba(0,0,0,0.4)]"
                />
              </div>
            </button>
          );
        })}
      </div>

      {/* Sticky search */}
      <div className="sticky top-14 z-20 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 py-2 backdrop-blur bg-background/80 border-b border-border/50">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <Input
              inputMode="search"
              placeholder="جستجوی فوری با شماره پلاک..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="pr-9 pl-9 h-11 rounded-full bg-card"
            />
            {searchInput && (
              <button
                onClick={() => setSearchInput("")}
                className="absolute left-2 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-muted"
                aria-label="پاک کردن"
              >
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            )}
          </div>
          <Button
            variant={showAdvanced ? "default" : "outline"}
            size="icon"
            className="rounded-full h-11 w-11 shrink-0"
            onClick={() => setShowAdvanced((v) => !v)}
            aria-label="فیلترهای پیشرفته"
          >
            <SlidersHorizontal className="w-4 h-4" />
          </Button>
        </div>

        {/* Multi-select shortcut chips — horizontally scrollable on mobile */}
        <div
          className="chips-scroller"
          dir="rtl"
          role="listbox"
          aria-label="فیلترهای سریع"
        >
          {QUICK_CHIPS.map((f) => {
            const active = selected.has(f.id);
            return (
              <button
                key={f.id}
                onClick={() => toggle(f.id)}
                aria-pressed={active}
                role="option"
                aria-selected={active}
                className={`${active ? "chip-active" : "chip-default"} whitespace-nowrap`}
              >
                {f.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Selected filter summary */}
      {selectedList.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">فیلترهای فعال:</span>
          {selectedList.map(({ id, opt }) => (
            <button
              key={id}
              onClick={() => toggle(id)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary/10 text-primary border border-primary/20 text-xs hover:bg-primary/15"
            >
              {opt!.label}
              <X className="w-3 h-3" />
            </button>
          ))}
          <button
            onClick={clearAll}
            className="text-xs text-muted-foreground hover:text-destructive underline-offset-2 hover:underline mr-1"
          >
            پاک کردن همه فیلترها
          </button>
        </div>
      )}

      {/* Advanced (collapsible, compact) */}
      {showAdvanced && (
        <div className="rounded-2xl border border-border bg-card p-3 grid grid-cols-1 sm:grid-cols-2 gap-3 animate-fade-in">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">وضعیت حضور</label>
            <Select
              value={presenceFilter}
              onValueChange={(v) =>
                setSingleInCategory("presence:", v === "all" ? null : presenceIdFromStatus(v))
              }
            >
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
            <label className="text-xs text-muted-foreground mb-1 block">آخرین وضعیت باروری</label>
            <Select
              value={fertilityFilter}
              onValueChange={(v) =>
                setSingleInCategory("fertility:", v === "all" ? null : fertilityIdFromStatus(v))
              }
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">همه</SelectItem>
                {Object.entries(FERTILITY_STATUS_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {/* Cow grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 sm:gap-3">
        {cows.map((c) => {
          const female = isFemale(c.sextype, c.sex);
          const tag = c.tag_number || c.earnumber || c.bodynumber || "—";
          return (
            <button
              key={c.id}
              onClick={() => navigate(`/livestock/${c.id}`)}
              className="cow-card group"
            >
              <div className="flex items-start gap-3">
                <img
                  src={cowImageFor(c)}
                  alt=""
                  loading="lazy"
                  width={64}
                  height={64}
                  className="w-16 h-16 rounded-xl object-cover shrink-0 border border-border/60 shadow-md"
                />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="cow-tag text-base">{tag}</span>
                    <span className="text-xs text-muted-foreground">
                      {c.sextype || (c.sex === 0 ? "ماده" : c.sex === 1 ? "نر" : "—")}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <span className={`text-xs px-2 py-0.5 rounded-full border ${presenceBadgeClass(c.existancestatus ?? 0)}`}>
                      {presenceLabel(c.existancestatus ?? 0)}
                    </span>
                    {female && (
                      <span className="text-xs px-2 py-0.5 rounded-full border"
                      style={c.is_dry
                        ? { color: "hsl(38 92% 70%)", borderColor: "hsl(38 92% 55% / 0.35)", background: "hsl(38 92% 55% / 0.12)" }
                        : { color: "hsl(217 91% 75%)", borderColor: "hsl(217 91% 60% / 0.35)", background: "hsl(217 91% 60% / 0.12)" }}
                      >
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
                <ChevronLeft className="w-5 h-5 text-muted-foreground shrink-0 mt-1 group-hover:text-primary transition-colors" />
              </div>
            </button>
          );
        })}

        {loading && (
          <div className="col-span-full flex items-center justify-center py-6 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        )}

        {!loading && cows.length === 0 && (
          <div className="col-span-full text-center py-12 text-muted-foreground text-sm">
            دامی با این فیلترها یافت نشد
          </div>
        )}

        <div ref={sentinelRef} className="col-span-full h-2" />
        {!loading && hasMore && cows.length > 0 && (
          <div className="col-span-full flex justify-center py-3">
            <Button
              variant="outline"
              onClick={() => setPage((p) => p + 1)}
              className="rounded-full px-6"
            >
              نمایش بیشتر
            </Button>
          </div>
        )}
        {!hasMore && cows.length > 0 && (
          <p className="col-span-full text-center text-xs text-muted-foreground py-2">پایان لیست</p>
        )}
      </div>
    </div>
  );
}
