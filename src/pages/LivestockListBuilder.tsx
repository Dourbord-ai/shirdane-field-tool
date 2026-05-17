// =============================================================================
// LivestockListBuilder.tsx
// -----------------------------------------------------------------------------
// "تولید لیست شخصی دام‌ها" — a custom livestock list builder for Damban.
//
// This page lets users compose filters against `public.cows`, generate a
// professional list, print/export to XLSX, and apply group actions
// (insemination, rinse, pregnancy test, vaccination) to the rows.
//
// Design rules followed:
//   • Single source of truth: the same query backs the on-screen table, the
//     print view, the XLSX export, and the group-action target list.
//   • Never write to cached cow columns (is_pregnancy, is_dry, last_*) —
//     fertility-event triggers + rebuild_cow_fertility_cache do that.
//   • All ID literals match the existing fertility_operations:
//        1 erotic   2 insemination   3,4,11,12 pregnancy tests
//        5 abortion 6 birth          7 dry  8 rinse  10 clean  13 sync
//   • RTL Persian UI, dark theme, semantic tokens only.
// =============================================================================

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { syncCowFertilityCache } from "@/lib/syncCowFertilityCache";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import {
  Beef, Filter, Printer, FileSpreadsheet, ChevronDown, ChevronUp, X,
  Loader2, CheckSquare, Square, Sparkles, Search, ArrowUpDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import JalaliDatePicker from "@/components/JalaliDatePicker";
import { JalaliDate, formatJalali, todayJalali } from "@/lib/jalali";
import { cn } from "@/lib/utils";
import { FERTILITY_STATUS_LABELS, PRESENCE_STATUS_LABELS } from "@/lib/livestock";
// Lifecycle classification helper — provides "وضعیت چرخه دام" derived from
// existing cow fields. We use it here both to render a column and to power
// the new lifecycle multi-select filter.
import {
  calculateLifecycleState,
  LIFECYCLE_LABELS,
  ALL_LIFECYCLE_STATES,
  type LifecycleState,
} from "@/lib/lifecycleState";

// -----------------------------------------------------------------------------
// Types and lookup row shapes — kept loose to mirror the actual cows columns.
// -----------------------------------------------------------------------------
type CowRow = {
  id: number;
  tag_number: string | null;
  earnumber: number | null;
  bodynumber: number | null;
  sex: number | null;
  sextype: string | null;
  date_of_birth: string | null;
  description: string | null;
  presence_status: number | null;
  existancestatus: number | null;
  last_type_id: number | null;
  last_location_id: number | null;
  last_status_id: number | null;
  is_pregnancy: boolean | null;
  is_dry: boolean | null;
  last_fertility_status: number | null;
  last_erotic_date: string | null;
  last_inoculation_date: string | null;
  last_pregnancy_date: string | null;
  last_birth_date: string | null;
  last_abortion_date: string | null;
  last_dry_date: string | null;
  last_rinse_date: string | null;
  last_clean_test_date: string | null;
  number_of_births: number | null;
  last_period: number | null;
};

type Lookup = { id: number; name: string | null };
type AppUser = { id: string; full_name: string | null; username: string };
type SpermRow = { id: number; code: string | null; name: string | null };

// -----------------------------------------------------------------------------
// Filter state shape. Each field is independent so users can mix freely.
// -----------------------------------------------------------------------------
type FilterState = {
  search: string;                              // tag/ear/body number
  sex: "" | "0" | "2";                          // 0=female, 2=male (matches insemination dialog)
  typeId: string;
  locationId: string;
  statusId: string;
  presenceStatus: string;                      // applied against `presence_status` OR `existancestatus`
  pregnancy: "" | "yes" | "no";
  dry: "" | "yes" | "no";
  fertilityStatusId: string;
  bornFrom: JalaliDate | null;
  bornTo: JalaliDate | null;
  minAgeMonths: string;
  maxAgeMonths: string;
  hasRecentHeatDays: string;                   // ≤ N days
  hasRecentInseminationDays: string;
  hasRecentAbortionDays: string;
  missingFertility: boolean;                   // last_fertility_status IS NULL
  incompleteData: boolean;                      // no DoB or no tag/ear
  // Multi-select over the calculated "وضعیت چرخه دام". Filtering happens
  // client-side after fetch because the state is derived, not stored.
  lifecycleStates: LifecycleState[];
  // operational presets that map onto multiple raw filters at query time
  preset: "" | "ready_insem" | "needs_preg_test" | "pregnant" | "dry_cows" | "milking_cows" | "recent_heat" | "no_fertility";
};

const EMPTY_FILTERS: FilterState = {
  search: "", sex: "", typeId: "", locationId: "", statusId: "",
  presenceStatus: "0",  // default: only in-herd animals, per spec safety rule
  pregnancy: "", dry: "", fertilityStatusId: "",
  bornFrom: null, bornTo: null, minAgeMonths: "", maxAgeMonths: "",
  hasRecentHeatDays: "", hasRecentInseminationDays: "", hasRecentAbortionDays: "",
  missingFertility: false, incompleteData: false,
  lifecycleStates: [],
  preset: "",
};

// -----------------------------------------------------------------------------
// Column definitions — single source for the on-screen table, print, XLSX.
// `accessor` receives the full row + lookup maps so labels can be resolved.
// -----------------------------------------------------------------------------
type ColumnDef = {
  key: string;
  label: string;                               // Persian header
  accessor: (r: CowRow, ctx: AccessorCtx) => string | number | null;
};
type AccessorCtx = {
  types: Map<number, string>;
  locations: Map<number, string>;
  statuses: Map<number, string>;
};

const tagLabel = (r: CowRow) =>
  r.tag_number || (r.earnumber ? String(r.earnumber) : "") ||
  (r.bodynumber ? String(r.bodynumber) : "") || `#${r.id}`;

const sexLabel = (r: CowRow) =>
  r.sex === 0 ? "ماده" : r.sex === 2 ? "نر" : r.sextype || "—";

const yesNo = (v: boolean | null, yes = "بله", no = "خیر") =>
  v == null ? "—" : v ? yes : no;

const ALL_COLUMNS: ColumnDef[] = [
  { key: "tag",        label: "شماره پلاک",        accessor: (r) => tagLabel(r) },
  { key: "sex",        label: "جنسیت",             accessor: (r) => sexLabel(r) },
  { key: "presence",   label: "وضعیت حضور",        accessor: (r) => PRESENCE_STATUS_LABELS[r.presence_status ?? r.existancestatus ?? -1] ?? "—" },
  { key: "milking",    label: "وضعیت دوشش",        accessor: (r) => yesNo(r.is_dry, "خشک", "دوشا") },
  { key: "pregnancy",  label: "وضعیت آبستنی",      accessor: (r) => yesNo(r.is_pregnancy, "آبستن", "غیر آبستن") },
  { key: "fertility",  label: "آخرین وضعیت باروری", accessor: (r) => FERTILITY_STATUS_LABELS[r.last_fertility_status ?? -1] ?? "—" },
  // Calculated lifecycle classification (e.g. "گاو دوشا", "تلیسه آبستن").
  // Pulled from the shared helper so the label matches every other surface.
  { key: "lifecycle",  label: "وضعیت چرخه دام",    accessor: (r) => calculateLifecycleState(r as any).label },
  { key: "erotic",     label: "آخرین فحلی",        accessor: (r) => r.last_erotic_date || "—" },
  { key: "inoc",       label: "آخرین تلقیح",       accessor: (r) => r.last_inoculation_date || "—" },
  { key: "pregTest",   label: "آخرین تست آبستنی",  accessor: (r) => r.last_pregnancy_date || "—" },
  { key: "birth",      label: "آخرین زایش",        accessor: (r) => r.last_birth_date || "—" },
  { key: "abortion",   label: "آخرین سقط",         accessor: (r) => r.last_abortion_date || "—" },
  { key: "dryDate",    label: "آخرین خشک کردن",    accessor: (r) => r.last_dry_date || "—" },
  { key: "location",   label: "بهاربند",           accessor: (r, c) => c.locations.get(r.last_location_id ?? -1) || "—" },
  { key: "type",       label: "نوع دام",            accessor: (r, c) => c.types.get(r.last_type_id ?? -1) || "—" },
  // optional/extra columns
  { key: "dob",        label: "تاریخ تولد",         accessor: (r) => r.date_of_birth || "—" },
  { key: "births",     label: "تعداد زایش",         accessor: (r) => r.number_of_births ?? "—" },
  { key: "period",     label: "دوره",               accessor: (r) => r.last_period ?? "—" },
  { key: "status",     label: "وضعیت سلامت",        accessor: (r, c) => c.statuses.get(r.last_status_id ?? -1) || "—" },
  { key: "desc",       label: "توضیحات",            accessor: (r) => r.description || "—" },
];

const DEFAULT_COLUMN_KEYS = [
  "tag","sex","presence","milking","pregnancy","fertility","erotic","inoc",
  "pregTest","birth","abortion","dryDate","location","type",
];

const SORT_OPTIONS = [
  { key: "tag",    label: "شماره پلاک" },
  { key: "dob",    label: "تاریخ تولد" },
  { key: "birth",  label: "آخرین زایش" },
  { key: "inoc",   label: "آخرین تلقیح" },
  { key: "erotic", label: "آخرین فحلی" },
  { key: "fert",   label: "آخرین وضعیت باروری" },
] as const;

// =============================================================================
// PRESET → filter overrides. Spec: "Pregnant" must be exactly
// sex=0 AND is_pregnancy=true AND presence_status=0.
// =============================================================================
function applyPreset(p: FilterState["preset"], f: FilterState): FilterState {
  switch (p) {
    case "pregnant":
      return { ...f, preset: p, sex: "0", pregnancy: "yes", presenceStatus: "0" };
    case "dry_cows":
      return { ...f, preset: p, sex: "0", dry: "yes", presenceStatus: "0" };
    case "milking_cows":
      return { ...f, preset: p, sex: "0", dry: "no", presenceStatus: "0" };
    case "ready_insem":
      // Open, milking, female, in-herd → candidates for insemination
      return { ...f, preset: p, sex: "0", pregnancy: "no", dry: "no", presenceStatus: "0" };
    case "needs_preg_test":
      // Inseminated within last 60 days, no positive yet
      return { ...f, preset: p, sex: "0", presenceStatus: "0", hasRecentInseminationDays: "60" };
    case "recent_heat":
      return { ...f, preset: p, sex: "0", presenceStatus: "0", hasRecentHeatDays: "30" };
    case "no_fertility":
      return { ...f, preset: p, sex: "0", presenceStatus: "0", missingFertility: true };
    default:
      return { ...f, preset: "" };
  }
}

// =============================================================================
// Page component
// =============================================================================
export default function LivestockListBuilder() {
  // ---- Lookups -------------------------------------------------------------
  const [types, setTypes] = useState<Lookup[]>([]);
  const [locations, setLocations] = useState<Lookup[]>([]);
  const [statuses, setStatuses] = useState<Lookup[]>([]);
  const [fertStatuses, setFertStatuses] = useState<Lookup[]>([]);
  const [lookupsLoading, setLookupsLoading] = useState(true);

  // ---- Filter state --------------------------------------------------------
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [columnKeys, setColumnKeys] = useState<string[]>(DEFAULT_COLUMN_KEYS);
  const [sortBy, setSortBy] = useState<(typeof SORT_OPTIONS)[number]["key"]>("tag");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  // ---- Results -------------------------------------------------------------
  const [rows, setRows] = useState<CowRow[] | null>(null);   // null = not generated yet
  const [generating, setGenerating] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  // ---- UI state: collapsible filter groups --------------------------------
  const [openGroup, setOpenGroup] = useState<string | null>("basic");

  // ---- Group-action dialog state ------------------------------------------
  const [actionKey, setActionKey] = useState<"" | "insemination" | "rinse" | "preg_test" | "vaccination">("");
  const [actionOpen, setActionOpen] = useState(false);

  // ---- Load lookups on mount ----------------------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Parallel reads — they're independent and small.
      const [t, l, s, fs] = await Promise.all([
        supabase.from("livestock_types").select("id, name").order("name"),
        supabase.from("livestock_locations").select("id, name").order("name"),
        supabase.from("livestock_statuses").select("id, name").order("name"),
        supabase.from("fertility_statuses").select("id, name").order("sort_order"),
      ]);
      if (cancelled) return;
      setTypes((t.data as Lookup[]) ?? []);
      setLocations((l.data as Lookup[]) ?? []);
      setStatuses((s.data as Lookup[]) ?? []);
      setFertStatuses((fs.data as Lookup[]) ?? []);
      setLookupsLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  // ---- Lookup maps for fast access in column accessors --------------------
  const ctx: AccessorCtx = useMemo(() => ({
    types: new Map(types.map((x) => [x.id, x.name || ""])),
    locations: new Map(locations.map((x) => [x.id, x.name || ""])),
    statuses: new Map(statuses.map((x) => [x.id, x.name || ""])),
  }), [types, locations, statuses]);

  // ---- Chips for active filters -------------------------------------------
  const activeChips = useMemo(() => {
    const chips: { key: string; label: string; clear: () => void }[] = [];
    const f = filters;
    const push = (key: string, label: string, clear: () => void) =>
      chips.push({ key, label, clear });

    if (f.search) push("search", `جستجو: ${f.search}`, () => setFilters({ ...f, search: "" }));
    if (f.sex) push("sex", `جنسیت: ${f.sex === "0" ? "ماده" : "نر"}`, () => setFilters({ ...f, sex: "" }));
    if (f.typeId) push("type", `نوع: ${ctx.types.get(+f.typeId)}`, () => setFilters({ ...f, typeId: "" }));
    if (f.locationId) push("loc", `بهاربند: ${ctx.locations.get(+f.locationId)}`, () => setFilters({ ...f, locationId: "" }));
    if (f.statusId) push("status", `سلامت: ${ctx.statuses.get(+f.statusId)}`, () => setFilters({ ...f, statusId: "" }));
    if (f.presenceStatus !== "") push("pres", `حضور: ${PRESENCE_STATUS_LABELS[+f.presenceStatus] ?? "—"}`, () => setFilters({ ...f, presenceStatus: "" }));
    if (f.pregnancy) push("preg", f.pregnancy === "yes" ? "آبستن" : "غیر آبستن", () => setFilters({ ...f, pregnancy: "" }));
    if (f.dry) push("dry", f.dry === "yes" ? "خشک" : "دوشا", () => setFilters({ ...f, dry: "" }));
    if (f.fertilityStatusId) push("fs", `باروری: ${FERTILITY_STATUS_LABELS[+f.fertilityStatusId]}`, () => setFilters({ ...f, fertilityStatusId: "" }));
    if (f.bornFrom) push("bf", `از تولد: ${formatJalali(f.bornFrom)}`, () => setFilters({ ...f, bornFrom: null }));
    if (f.bornTo) push("bt", `تا تولد: ${formatJalali(f.bornTo)}`, () => setFilters({ ...f, bornTo: null }));
    if (f.minAgeMonths) push("ma", `حداقل سن: ${f.minAgeMonths} ماه`, () => setFilters({ ...f, minAgeMonths: "" }));
    if (f.maxAgeMonths) push("mx", `حداکثر سن: ${f.maxAgeMonths} ماه`, () => setFilters({ ...f, maxAgeMonths: "" }));
    if (f.hasRecentHeatDays) push("rh", `فحلی اخیر ≤ ${f.hasRecentHeatDays} روز`, () => setFilters({ ...f, hasRecentHeatDays: "" }));
    if (f.hasRecentInseminationDays) push("ri", `تلقیح اخیر ≤ ${f.hasRecentInseminationDays} روز`, () => setFilters({ ...f, hasRecentInseminationDays: "" }));
    if (f.hasRecentAbortionDays) push("ra", `سقط اخیر ≤ ${f.hasRecentAbortionDays} روز`, () => setFilters({ ...f, hasRecentAbortionDays: "" }));
    if (f.missingFertility) push("mf", "بدون وضعیت باروری", () => setFilters({ ...f, missingFertility: false }));
    if (f.incompleteData) push("ic", "داده ناقص", () => setFilters({ ...f, incompleteData: false }));
    return chips;
  }, [filters, ctx]);

  // ---- Run query: identical for table/print/export/group-actions ----------
  async function generate() {
    setGenerating(true);
    setSelectedIds(new Set());
    try {
      // Build a Supabase query against `public.cows` only.
      let q = supabase.from("cows").select(
        "id,tag_number,earnumber,bodynumber,sex,sextype,date_of_birth,description," +
        "presence_status,existancestatus,last_type_id,last_location_id,last_status_id," +
        "is_pregnancy,is_dry,last_fertility_status,last_erotic_date,last_inoculation_date," +
        "last_pregnancy_date,last_birth_date,last_abortion_date,last_dry_date," +
        "last_rinse_date,last_clean_test_date,number_of_births,last_period"
      );

      const f = filters;
      // Basic equality filters
      if (f.sex !== "") q = q.eq("sex", +f.sex);
      if (f.typeId) q = q.eq("last_type_id", +f.typeId);
      if (f.locationId) q = q.eq("last_location_id", +f.locationId);
      if (f.statusId) q = q.eq("last_status_id", +f.statusId);
      if (f.presenceStatus !== "") {
        // Some rows use `presence_status`, others `existancestatus`. Match either.
        q = q.or(`presence_status.eq.${+f.presenceStatus},existancestatus.eq.${+f.presenceStatus}`);
      }
      if (f.pregnancy === "yes") q = q.eq("is_pregnancy", true);
      if (f.pregnancy === "no")  q = q.or("is_pregnancy.is.null,is_pregnancy.eq.false");
      if (f.dry === "yes") q = q.eq("is_dry", true);
      if (f.dry === "no")  q = q.or("is_dry.is.null,is_dry.eq.false");
      if (f.fertilityStatusId) q = q.eq("last_fertility_status", +f.fertilityStatusId);
      if (f.missingFertility)  q = q.is("last_fertility_status", null);

      // Recent-event windows — we filter client-side because event_date is a
      // Jalali string in this DB; the cached `last_*_date` columns are too.
      // The query still server-side filters by `.not("last_x_date", "is", null)`
      // when a window is requested to reduce payload.
      if (f.hasRecentHeatDays) q = q.not("last_erotic_date", "is", null);
      if (f.hasRecentInseminationDays) q = q.not("last_inoculation_date", "is", null);
      if (f.hasRecentAbortionDays) q = q.not("last_abortion_date", "is", null);

      // Server-side text search across tag/ear/body
      if (f.search.trim()) {
        const s = f.search.trim().replace(/[%,]/g, "");
        q = q.or(
          `tag_number.ilike.%${s}%,earnumber.eq.${/^\d+$/.test(s) ? +s : -1},bodynumber.eq.${/^\d+$/.test(s) ? +s : -1}`
        );
      }

      // Pull up to 5000 rows — well above per-screen needs, matches list view.
      const { data, error } = await q.limit(5000);
      if (error) throw error;

      let result = ((data ?? []) as unknown) as CowRow[];

      // ----- Client-side post-filters ------------------------------------
      const todayMs = Date.now();
      const monthsAgo = (n: number) => {
        const d = new Date(); d.setMonth(d.getMonth() - n); return d.getTime();
      };
      // Treat date_of_birth as ISO if parseable; otherwise skip age filters.
      if (f.minAgeMonths || f.maxAgeMonths) {
        const minMs = f.maxAgeMonths ? monthsAgo(+f.maxAgeMonths) : -Infinity;
        const maxMs = f.minAgeMonths ? monthsAgo(+f.minAgeMonths) : Infinity;
        result = result.filter((r) => {
          if (!r.date_of_birth) return false;
          const t = Date.parse(r.date_of_birth);
          if (isNaN(t)) return true; // Jalali strings — skip silently
          return t >= minMs && t <= maxMs;
        });
      }
      if (f.bornFrom || f.bornTo) {
        const fromS = f.bornFrom ? formatJalali(f.bornFrom) : null;
        const toS = f.bornTo ? formatJalali(f.bornTo) : null;
        result = result.filter((r) =>
          (!fromS || (r.date_of_birth ?? "") >= fromS) &&
          (!toS   || (r.date_of_birth ?? "") <= toS),
        );
      }
      if (f.incompleteData) {
        result = result.filter((r) =>
          !r.date_of_birth || (!r.tag_number && !r.earnumber && !r.bodynumber));
      }
      // Recency check on Jalali string dates is best-effort: compare prefixes.
      // We use the cached `last_*_date` already restricted server-side, then
      // measure days against today's Gregorian timestamp.
      const filterRecent = (col: keyof CowRow, days: string) => {
        if (!days) return;
        const cutoff = todayMs - (+days) * 86_400_000;
        result = result.filter((r) => {
          const v = r[col] as string | null;
          if (!v) return false;
          const t = Date.parse(v);
          return isNaN(t) ? true : t >= cutoff;
        });
      };
      filterRecent("last_erotic_date",       f.hasRecentHeatDays);
      filterRecent("last_inoculation_date",  f.hasRecentInseminationDays);
      filterRecent("last_abortion_date",     f.hasRecentAbortionDays);

      // ----- Sort --------------------------------------------------------
      const dir = sortDir === "asc" ? 1 : -1;
      const sortKey = sortBy;
      const sortFn: Record<string, (r: CowRow) => string | number> = {
        tag:    (r) => tagLabel(r),
        dob:    (r) => r.date_of_birth || "",
        birth:  (r) => r.last_birth_date || "",
        inoc:   (r) => r.last_inoculation_date || "",
        erotic: (r) => r.last_erotic_date || "",
        fert:   (r) => r.last_fertility_status ?? -1,
      };
      result.sort((a, b) => {
        const av = sortFn[sortKey](a), bv = sortFn[sortKey](b);
        return av > bv ? dir : av < bv ? -dir : 0;
      });

      setRows(result);
      toast.success(`${result.length} رکورد یافت شد`);
    } catch (e: any) {
      toast.error("خطا در تولید لیست: " + (e.message || e));
    } finally {
      setGenerating(false);
    }
  }

  // ---- Active columns + selected rows -------------------------------------
  const activeColumns = useMemo(
    () => columnKeys.map((k) => ALL_COLUMNS.find((c) => c.key === k)!).filter(Boolean),
    [columnKeys],
  );
  const visibleRows = rows ?? [];
  const targetRows = useMemo(
    () => selectedIds.size > 0 ? visibleRows.filter((r) => selectedIds.has(r.id)) : visibleRows,
    [visibleRows, selectedIds],
  );

  // ---- Export to XLSX ------------------------------------------------------
  function exportXlsx() {
    if (!rows || rows.length === 0) return toast.error("لیستی برای خروجی وجود ندارد");
    const data = rows.map((r) => {
      const obj: Record<string, any> = {};
      activeColumns.forEach((c) => { obj[c.label] = c.accessor(r, ctx); });
      return obj;
    });
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "لیست دام‌ها");
    const stamp = formatJalali(todayJalali()).replace(/\//g, "-");
    XLSX.writeFile(wb, `livestock-list-${stamp}.xlsx`);
  }

  // ---- Print: opens a new window with the same data ----------------------
  function printList() {
    if (!rows) return;
    const w = window.open("", "_blank", "width=1000,height=700");
    if (!w) return;
    const title = "لیست شخصی دام‌ها";
    const filtersSummary = activeChips.map((c) => c.label).join(" • ") || "بدون فیلتر اضافی";
    const dateStr = formatJalali(todayJalali());
    const head = activeColumns.map((c) => `<th>${c.label}</th>`).join("");
    const body = rows.map((r) => `<tr>${activeColumns.map((c) =>
      `<td>${c.accessor(r, ctx) ?? "—"}</td>`).join("")}</tr>`).join("");
    w.document.write(`<!doctype html><html dir="rtl" lang="fa"><head><meta charset="utf-8"/>
      <title>${title}</title>
      <style>
        @page { size: A4 landscape; margin: 12mm; }
        body { font-family: Vazirmatn, Tahoma, sans-serif; color: #000; }
        h1 { font-size: 18pt; margin: 0 0 6pt; }
        .meta { font-size: 10pt; color: #444; margin-bottom: 8pt; }
        table { width: 100%; border-collapse: collapse; font-size: 9pt; }
        th, td { border: 1px solid #333; padding: 4pt 6pt; text-align: right; }
        thead { background: #eee; }
      </style></head><body>
      <h1>${title}</h1>
      <div class="meta">تاریخ چاپ: ${dateStr} — تعداد: ${rows.length} — فیلترها: ${filtersSummary}</div>
      <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
      <script>window.onload=()=>window.print()</script>
      </body></html>`);
    w.document.close();
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <div dir="rtl" className="space-y-6 print:hidden">
      {/* Page header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-gradient-primary flex items-center justify-center glow-primary">
            <Beef className="w-6 h-6 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold text-foreground">تولید لیست شخصی دام‌ها</h1>
            <p className="text-sm text-muted-foreground">فیلترها را انتخاب کنید، لیست را بسازید، چاپ یا خروجی اکسل بگیرید و عملیات گروهی اعمال کنید.</p>
          </div>
        </div>
      </div>

      {/* ============== Filter section ================= */}
      <Card className="p-4 bg-card border-border space-y-4">
        {/* Presets */}
        <div>
          <div className="flex items-center gap-2 mb-2 text-sm font-bold text-foreground">
            <Sparkles className="w-4 h-4 text-primary" /> پیش‌فرض‌های سریع
          </div>
          <div className="flex flex-wrap gap-2">
            {[
              { key: "pregnant",        label: "آبستن" },
              { key: "milking_cows",    label: "دوشا" },
              { key: "dry_cows",        label: "خشک" },
              { key: "ready_insem",     label: "آماده تلقیح" },
              { key: "needs_preg_test", label: "نیازمند تست آبستنی" },
              { key: "recent_heat",     label: "فحل شده" },
              { key: "no_fertility",    label: "بدون وضعیت" },
            ].map((p) => (
              <Button key={p.key} size="sm"
                variant={filters.preset === p.key ? "default" : "outline"}
                onClick={() => setFilters(applyPreset(p.key as any, EMPTY_FILTERS))}>
                {p.label}
              </Button>
            ))}
            {filters.preset && (
              <Button size="sm" variant="ghost" onClick={() => setFilters(EMPTY_FILTERS)}>
                <X className="w-3.5 h-3.5 ml-1" /> پاک کردن
              </Button>
            )}
          </div>
        </div>

        {/* Active chips */}
        {activeChips.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
            {activeChips.map((c) => (
              <Badge key={c.key} variant="secondary" className="gap-1 cursor-pointer"
                onClick={c.clear}>
                {c.label} <X className="w-3 h-3" />
              </Badge>
            ))}
            <Button size="sm" variant="ghost" onClick={() => setFilters(EMPTY_FILTERS)}>
              پاک کردن همه
            </Button>
          </div>
        )}

        {/* Filter groups (collapsible) */}
        <FilterGroup title="اطلاعات پایه" id="basic" open={openGroup} onToggle={setOpenGroup}>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Field label="جستجو (پلاک/گوش/بدن)">
              <div className="relative">
                <Search className="w-4 h-4 absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input className="pr-8" value={filters.search}
                  onChange={(e) => setFilters({ ...filters, search: e.target.value })} />
              </div>
            </Field>
            <Field label="جنسیت">
              <Select value={filters.sex} onValueChange={(v) => setFilters({ ...filters, sex: v as any })} dir="rtl">
                <SelectTrigger><SelectValue placeholder="همه" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">ماده</SelectItem>
                  <SelectItem value="2">نر</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="نوع دام">
              <LookupSelect value={filters.typeId} onChange={(v) => setFilters({ ...filters, typeId: v })}
                items={types} placeholder="همه" />
            </Field>
            <Field label="بهاربند">
              <LookupSelect value={filters.locationId} onChange={(v) => setFilters({ ...filters, locationId: v })}
                items={locations} placeholder="همه" />
            </Field>
            <Field label="وضعیت سلامت">
              <LookupSelect value={filters.statusId} onChange={(v) => setFilters({ ...filters, statusId: v })}
                items={statuses} placeholder="همه" />
            </Field>
            <Field label="وضعیت حضور">
              <Select value={filters.presenceStatus} onValueChange={(v) => setFilters({ ...filters, presenceStatus: v })} dir="rtl">
                <SelectTrigger><SelectValue placeholder="همه" /></SelectTrigger>
                <SelectContent>
                  {Object.entries(PRESENCE_STATUS_LABELS).map(([k, l]) => (
                    <SelectItem key={k} value={k}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="تاریخ تولد از">
              <JalaliDatePicker value={filters.bornFrom} onChange={(d) => setFilters({ ...filters, bornFrom: d })} />
            </Field>
            <Field label="تاریخ تولد تا">
              <JalaliDatePicker value={filters.bornTo} onChange={(d) => setFilters({ ...filters, bornTo: d })} />
            </Field>
            <Field label="حداقل/حداکثر سن (ماه)">
              <div className="flex gap-2">
                <Input type="number" placeholder="حداقل" value={filters.minAgeMonths}
                  onChange={(e) => setFilters({ ...filters, minAgeMonths: e.target.value })} />
                <Input type="number" placeholder="حداکثر" value={filters.maxAgeMonths}
                  onChange={(e) => setFilters({ ...filters, maxAgeMonths: e.target.value })} />
              </div>
            </Field>
          </div>
        </FilterGroup>

        <FilterGroup title="باروری و وضعیت فیزیولوژیک" id="fert" open={openGroup} onToggle={setOpenGroup}>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Field label="آبستنی">
              <Select value={filters.pregnancy} onValueChange={(v) => setFilters({ ...filters, pregnancy: v as any })} dir="rtl">
                <SelectTrigger><SelectValue placeholder="همه" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="yes">آبستن</SelectItem>
                  <SelectItem value="no">غیر آبستن</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="وضعیت دوشش">
              <Select value={filters.dry} onValueChange={(v) => setFilters({ ...filters, dry: v as any })} dir="rtl">
                <SelectTrigger><SelectValue placeholder="همه" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="no">دوشا</SelectItem>
                  <SelectItem value="yes">خشک</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="آخرین وضعیت باروری">
              <Select value={filters.fertilityStatusId}
                onValueChange={(v) => setFilters({ ...filters, fertilityStatusId: v })} dir="rtl">
                <SelectTrigger><SelectValue placeholder="همه" /></SelectTrigger>
                <SelectContent>
                  {fertStatuses.map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>{s.name || `#${s.id}`}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="فحلی اخیر (روز اخیر)">
              <Input type="number" value={filters.hasRecentHeatDays}
                onChange={(e) => setFilters({ ...filters, hasRecentHeatDays: e.target.value })} />
            </Field>
            <Field label="تلقیح اخیر (روز اخیر)">
              <Input type="number" value={filters.hasRecentInseminationDays}
                onChange={(e) => setFilters({ ...filters, hasRecentInseminationDays: e.target.value })} />
            </Field>
            <Field label="سقط اخیر (روز اخیر)">
              <Input type="number" value={filters.hasRecentAbortionDays}
                onChange={(e) => setFilters({ ...filters, hasRecentAbortionDays: e.target.value })} />
            </Field>
            <div className="flex items-center gap-2">
              <Checkbox id="mf" checked={filters.missingFertility}
                onCheckedChange={(v) => setFilters({ ...filters, missingFertility: !!v })} />
              <Label htmlFor="mf" className="cursor-pointer">بدون وضعیت باروری</Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="ic" checked={filters.incompleteData}
                onCheckedChange={(v) => setFilters({ ...filters, incompleteData: !!v })} />
              <Label htmlFor="ic" className="cursor-pointer">داده ناقص</Label>
            </div>
          </div>
        </FilterGroup>

        <FilterGroup title="ستون‌ها و مرتب‌سازی" id="cols" open={openGroup} onToggle={setOpenGroup}>
          <div className="space-y-3">
            <div>
              <div className="text-xs text-muted-foreground mb-1.5">ستون‌های نمایش/خروجی</div>
              <div className="flex flex-wrap gap-2">
                {ALL_COLUMNS.map((c) => {
                  const on = columnKeys.includes(c.key);
                  return (
                    <Badge key={c.key} variant={on ? "default" : "outline"}
                      className="cursor-pointer"
                      onClick={() => setColumnKeys((prev) =>
                        on ? prev.filter((k) => k !== c.key) : [...prev, c.key])}>
                      {c.label}
                    </Badge>
                  );
                })}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="مرتب‌سازی بر اساس">
                <Select value={sortBy} onValueChange={(v) => setSortBy(v as any)} dir="rtl">
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SORT_OPTIONS.map((s) => (
                      <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="ترتیب">
                <Select value={sortDir} onValueChange={(v) => setSortDir(v as any)} dir="rtl">
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="asc">صعودی</SelectItem>
                    <SelectItem value="desc">نزولی</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>
          </div>
        </FilterGroup>

        {/* Generate */}
        <div className="flex justify-end gap-2 pt-2 border-t border-border">
          <Button variant="outline" onClick={() => setFilters(EMPTY_FILTERS)}>
            بازنشانی
          </Button>
          <Button onClick={generate} disabled={generating || lookupsLoading}
            className="bg-gradient-primary text-primary-foreground glow-primary">
            {generating && <Loader2 className="w-4 h-4 animate-spin ml-2" />}
            <Filter className="w-4 h-4 ml-2" /> تایید و تولید لیست
          </Button>
        </div>
      </Card>

      {/* ============== Results ================= */}
      {rows && (
        <Card className="p-4 bg-card border-border space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm">
              <span className="font-bold text-foreground">تعداد:</span>{" "}
              <span className="text-primary font-bold">{rows.length}</span>
              {selectedIds.size > 0 && (
                <span className="mr-3 text-muted-foreground">
                  انتخاب شده: <b className="text-foreground">{selectedIds.size}</b>
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={printList}>
                <Printer className="w-4 h-4 ml-2" /> چاپ
              </Button>
              <Button size="sm" variant="outline" onClick={exportXlsx}>
                <FileSpreadsheet className="w-4 h-4 ml-2" /> خروجی اکسل
              </Button>
            </div>
          </div>

          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-secondary/40">
                <tr>
                  <th className="p-2 w-10">
                    <Checkbox
                      checked={selectedIds.size === visibleRows.length && visibleRows.length > 0}
                      onCheckedChange={(v) => setSelectedIds(v
                        ? new Set(visibleRows.map((r) => r.id)) : new Set())}
                    />
                  </th>
                  {activeColumns.map((c) => (
                    <th key={c.key} className="p-2 text-right font-bold text-foreground whitespace-nowrap">
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleRows.length === 0 && (
                  <tr><td colSpan={activeColumns.length + 1} className="p-6 text-center text-muted-foreground">
                    موردی یافت نشد
                  </td></tr>
                )}
                {visibleRows.map((r) => (
                  <tr key={r.id} className="border-t border-border hover:bg-secondary/30">
                    <td className="p-2">
                      <Checkbox checked={selectedIds.has(r.id)}
                        onCheckedChange={(v) => {
                          const next = new Set(selectedIds);
                          v ? next.add(r.id) : next.delete(r.id);
                          setSelectedIds(next);
                        }} />
                    </td>
                    {activeColumns.map((c) => (
                      <td key={c.key} className="p-2 text-foreground whitespace-nowrap">
                        {c.accessor(r, ctx) ?? "—"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-2">
            {visibleRows.map((r) => (
              <div key={r.id} className="rounded-lg border border-border p-3 bg-background/40">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Checkbox checked={selectedIds.has(r.id)}
                      onCheckedChange={(v) => {
                        const next = new Set(selectedIds);
                        v ? next.add(r.id) : next.delete(r.id);
                        setSelectedIds(next);
                      }} />
                    <span className="font-bold text-foreground">{tagLabel(r)}</span>
                  </div>
                  <Badge variant="outline">{sexLabel(r)}</Badge>
                </div>
                <div className="grid grid-cols-2 gap-1 text-xs">
                  {activeColumns.filter((c) => c.key !== "tag" && c.key !== "sex").map((c) => (
                    <div key={c.key} className="flex justify-between gap-2">
                      <span className="text-muted-foreground">{c.label}:</span>
                      <span className="text-foreground text-end">{c.accessor(r, ctx) ?? "—"}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ============== Group actions ================= */}
      {rows && rows.length > 0 && (
        <Card className="p-4 bg-card border-primary/30 space-y-3">
          <div className="flex items-center gap-2 text-sm font-bold text-foreground">
            <CheckSquare className="w-4 h-4 text-primary" /> عملیات گروهی روی لیست
          </div>
          <p className="text-xs text-muted-foreground">
            اگر هیچ ردیفی انتخاب نکنید، عملیات روی <b>کل لیست</b> اعمال می‌شود. در غیر این صورت فقط روی <b>{selectedIds.size}</b> ردیف انتخاب‌شده اعمال می‌شود.
          </p>
          <div className="flex flex-wrap gap-2">
            {[
              { key: "insemination", label: "تلقیح" },
              { key: "rinse",        label: "شستشو" },
              { key: "preg_test",    label: "تست آبستنی" },
              { key: "vaccination",  label: "واکسیناسیون" },
            ].map((a) => (
              <Button key={a.key} size="sm" variant="outline"
                onClick={() => { setActionKey(a.key as any); setActionOpen(true); }}>
                {a.label}
              </Button>
            ))}
          </div>
        </Card>
      )}

      {/* Group action dialog */}
      {actionOpen && actionKey && (
        <GroupActionDialog
          actionKey={actionKey}
          rows={targetRows}
          onClose={() => { setActionOpen(false); setActionKey(""); }}
          onDone={async (affected) => {
            // After group fertility-event inserts, re-sync cache for each affected cow.
            // DB triggers do the heavy lift but we re-read to keep the UI cache fresh.
            for (const id of affected) await syncCowFertilityCache(id);
            setActionOpen(false); setActionKey("");
            generate(); // refresh the visible list with new cached fields
          }}
        />
      )}
    </div>
  );
}

// =============================================================================
// Tiny helper components
// =============================================================================
function FilterGroup({
  title, id, open, onToggle, children,
}: {
  title: string; id: string; open: string | null;
  onToggle: (v: string | null) => void; children: React.ReactNode;
}) {
  const isOpen = open === id;
  return (
    <div className="rounded-lg border border-border">
      <button type="button"
        className="w-full flex items-center justify-between p-3 text-sm font-bold text-foreground hover:bg-secondary/40"
        onClick={() => onToggle(isOpen ? null : id)}>
        <span>{title}</span>
        {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>
      {isOpen && <div className="p-3 border-t border-border">{children}</div>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function LookupSelect({
  value, onChange, items, placeholder,
}: {
  value: string; onChange: (v: string) => void;
  items: Lookup[]; placeholder: string;
}) {
  return (
    <Select value={value} onValueChange={onChange} dir="rtl">
      <SelectTrigger><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>
        {items.map((it) => (
          <SelectItem key={it.id} value={String(it.id)}>{it.name || `#${it.id}`}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// =============================================================================
// Group action dialog — handles all 4 actions in one form
// =============================================================================
function GroupActionDialog({
  actionKey, rows, onClose, onDone,
}: {
  actionKey: "insemination" | "rinse" | "preg_test" | "vaccination";
  rows: CowRow[];
  onClose: () => void;
  onDone: (affectedIds: number[]) => void;
}) {
  // ---- Shared form state -------------------------------------------------
  const [users, setUsers] = useState<AppUser[]>([]);
  const [sperms, setSperms] = useState<SpermRow[]>([]);
  const [date, setDate] = useState<JalaliDate | null>(todayJalali());
  const [time, setTime] = useState<string>("");
  const [operatorId, setOperatorId] = useState<string>("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Insemination-specific
  const [spermId, setSpermId] = useState<string>("");
  // Pregnancy test-specific
  const [testType, setTestType] = useState<"initial" | "final" | "extra" | "dry" | "">("");
  const [testResult, setTestResult] = useState<"positive" | "negative" | "suspicious" | "">("");
  // Rinse-specific
  const [reason, setReason] = useState("");
  // Vaccination-specific
  const [vaccineName, setVaccineName] = useState("");
  const [dose, setDose] = useState("");
  const [batch, setBatch] = useState("");
  const [nextReminder, setNextReminder] = useState<JalaliDate | null>(null);

  useEffect(() => {
    (async () => {
      const [u, s] = await Promise.all([
        supabase.from("app_users").select("id, full_name, username").eq("is_active", true).order("full_name"),
        actionKey === "insemination"
          ? supabase.from("sperms").select("id, code, name").order("name")
          : Promise.resolve({ data: [] } as any),
      ]);
      setUsers((u.data as AppUser[]) ?? []);
      setSperms((s.data as SpermRow[]) ?? []);
    })();
  }, [actionKey]);

  // ---- Compute target & skipped rows BEFORE insert (validation safety) ---
  const { valid, skipped } = useMemo(() => {
    const valid: CowRow[] = [];
    const skipped: { r: CowRow; reason: string }[] = [];
    rows.forEach((r) => {
      // Must be in-herd
      const presence = r.presence_status ?? r.existancestatus;
      if (presence !== 0) {
        skipped.push({ r, reason: "خارج از گله" }); return;
      }
      // Fertility actions are female-only
      if (actionKey !== "vaccination" && r.sex !== 0) {
        skipped.push({ r, reason: "نر — عملیات باروری مجاز نیست" }); return;
      }
      valid.push(r);
    });
    return { valid, skipped };
  }, [rows, actionKey]);

  const TITLES: Record<typeof actionKey, string> = {
    insemination: "تلقیح گروهی",
    rinse: "شستشوی گروهی",
    preg_test: "تست آبستنی گروهی",
    vaccination: "واکسیناسیون گروهی",
  };

  // ---- Form validation ---------------------------------------------------
  function validate(): string | null {
    if (!date) return "تاریخ را انتخاب کنید";
    if (actionKey !== "vaccination" && !time) return "ساعت را وارد کنید";
    if (!operatorId) return "اپراتور را انتخاب کنید";
    if (actionKey === "insemination" && !spermId) return "اسپرم را انتخاب کنید";
    if (actionKey === "preg_test" && !testType) return "نوع تست را انتخاب کنید";
    if (actionKey === "preg_test" && !testResult) return "نتیجه تست را انتخاب کنید";
    if (actionKey === "rinse" && !reason.trim()) return "علت شستشو را وارد کنید";
    if (actionKey === "vaccination" && !vaccineName.trim()) return "نام واکسن را وارد کنید";
    if (valid.length === 0) return "هیچ دامی برای اعمال عملیات وجود ندارد";
    return null;
  }

  // ---- Submit handler — opens confirm modal first -----------------------
  function handleSubmitClick() {
    const err = validate();
    if (err) return toast.error(err);
    setConfirmOpen(true);
  }

  // ---- Actual insert after confirmation ----------------------------------
  async function performInsert() {
    setSubmitting(true);
    const dateStr = formatJalali(date!);
    const eventDate = time ? `${dateStr} ${time}` : dateStr;
    const operator = users.find((u) => String(u.id) === operatorId);
    const operatorName = operator?.full_name ?? operator?.username ?? null;

    // -------------- VACCINATION → livestock_events ---------------------
    if (actionKey === "vaccination") {
      // We persist all vaccination fields inside `description` as JSON so we
      // don't need a schema migration. Existing livestock_events.event_type
      // = 'vaccination' acts as the discriminator.
      const meta = {
        vaccine_name: vaccineName,
        dose, batch,
        operator_name: operatorName,
        next_reminder: nextReminder ? formatJalali(nextReminder) : null,
        notes: description,
      };
      const payload = valid.map((r) => ({
        cow_id: r.id,
        event_type: "vaccination",
        event_date: dateStr,
        to_value: vaccineName,
        description: JSON.stringify(meta),
      }));
      const { error } = await supabase.from("livestock_events").insert(payload);
      setSubmitting(false);
      if (error) return toast.error("خطای ذخیره: " + error.message);
      toast.success(`واکسیناسیون برای ${valid.length} دام ثبت شد`);
      onDone(valid.map((r) => r.id));
      return;
    }

    // -------------- FERTILITY ACTIONS → livestock_fertility_events -----
    let operationId = 0;
    let eventType = "";
    let statusCode: number | null = null;
    let extraMeta: Record<string, any> = {};
    if (actionKey === "insemination") {
      operationId = 2; eventType = "insemination";
      const s = sperms.find((x) => String(x.id) === spermId);
      extraMeta = {
        insemination_type: "sperm",
        sperm_id: s?.id, sperm_label: s ? (s.code && s.name ? `${s.code} - ${s.name}` : s.code || s.name) : null,
      };
    } else if (actionKey === "rinse") {
      operationId = 8; eventType = "rinse";
      extraMeta = { rinse_reason: reason.trim() };
    } else if (actionKey === "preg_test") {
      const opMap = { initial: 3, final: 4, extra: 11, dry: 12 } as const;
      const codeMap: Record<string, Partial<Record<string, number>>> = {
        initial: { positive: 4, suspicious: 5, negative: 6 },
        final:   { positive: 8, negative: 7 },
        extra:   { positive: 18, negative: 17 },
        dry:     { positive: 20, negative: 19 },
      };
      operationId = opMap[testType as keyof typeof opMap];
      eventType = "pregnancy_test";
      statusCode = codeMap[testType][testResult] ?? null;
      if (statusCode == null) {
        setSubmitting(false);
        return toast.error("ترکیب نوع تست و نتیجه نامعتبر است");
      }
      extraMeta = {
        test_type: testType, result: testResult,
      };
    }

    // Build per-cow insert payloads. We bypass the per-event validation
    // function (checkFertilityOperation) here to keep the batch atomic —
    // skipped rows are already filtered above and the DB trigger
    // `livestock_fertility_events_rebuild_cache` rebuilds the cache.
    const payload = valid.map((r) => ({
      livestock_id: r.id,
      event_type: eventType,
      fertility_operation_id: operationId,
      event_date: eventDate,
      operator_user_id: null,
      operator_name: operatorName,
      notes: description || null,
      status_code: statusCode,
      fertility_status_id: statusCode,
      result: testResult ? (testResult === "positive" ? "مثبت" : testResult === "negative" ? "منفی" : "مشکوک") : null,
      legacy_table_name: "manual_batch",
      legacy_record_id: null,
      metadata: { ...extraMeta, time, operator_name: operatorName, source: "list_builder_batch" },
    }));

    const { error } = await supabase.from("livestock_fertility_events" as any).insert(payload);
    setSubmitting(false);
    if (error) return toast.error("خطای ذخیره: " + error.message);
    toast.success(`${TITLES[actionKey]} برای ${valid.length} دام ثبت شد`);
    onDone(valid.map((r) => r.id));
  }

  return (
    <Dialog open={true} onOpenChange={(v) => !v && onClose()}>
      <DialogContent dir="rtl" className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-right">{TITLES[actionKey]}</DialogTitle>
          <DialogDescription className="text-right">
            تعداد دام‌های قابل اعمال: <b className="text-primary">{valid.length}</b>
            {skipped.length > 0 && (
              <span className="text-destructive"> • رد شده: {skipped.length}</span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* Common: date/time/operator */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="تاریخ">
              <JalaliDatePicker value={date} onChange={setDate} />
            </Field>
            {actionKey !== "vaccination" && (
              <Field label="ساعت">
                <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} dir="ltr" />
              </Field>
            )}
          </div>
          <Field label="اپراتور / مسئول">
            <Select value={operatorId} onValueChange={setOperatorId} dir="rtl">
              <SelectTrigger><SelectValue placeholder="انتخاب کنید" /></SelectTrigger>
              <SelectContent>
                {users.map((u) => (
                  <SelectItem key={u.id} value={String(u.id)}>{u.full_name || u.username}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {/* Action-specific fields */}
          {actionKey === "insemination" && (
            <Field label="اسپرم">
              <Select value={spermId} onValueChange={setSpermId} dir="rtl">
                <SelectTrigger><SelectValue placeholder="انتخاب اسپرم" /></SelectTrigger>
                <SelectContent>
                  {sperms.map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>
                      {s.code && s.name ? `${s.code} - ${s.name}` : s.code || s.name || `#${s.id}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}

          {actionKey === "rinse" && (
            <Field label="علت شستشو">
              <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="مثلاً ترشحات غیرطبیعی" />
            </Field>
          )}

          {actionKey === "preg_test" && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="نوع تست">
                <Select value={testType} onValueChange={(v) => setTestType(v as any)} dir="rtl">
                  <SelectTrigger><SelectValue placeholder="انتخاب کنید" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="initial">تست اولیه</SelectItem>
                    <SelectItem value="final">تست نهایی</SelectItem>
                    <SelectItem value="extra">تست تکمیلی</SelectItem>
                    <SelectItem value="dry">تست خشکی</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="نتیجه">
                <Select value={testResult} onValueChange={(v) => setTestResult(v as any)} dir="rtl">
                  <SelectTrigger><SelectValue placeholder="انتخاب کنید" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="positive">مثبت</SelectItem>
                    <SelectItem value="negative">منفی</SelectItem>
                    <SelectItem value="suspicious">مشکوک</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>
          )}

          {actionKey === "vaccination" && (
            <>
              <Field label="نام واکسن"><Input value={vaccineName} onChange={(e) => setVaccineName(e.target.value)} /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="دوز"><Input value={dose} onChange={(e) => setDose(e.target.value)} /></Field>
                <Field label="شماره سری ساخت"><Input value={batch} onChange={(e) => setBatch(e.target.value)} /></Field>
              </div>
              <Field label="تاریخ یادآور بعدی (اختیاری)">
                <JalaliDatePicker value={nextReminder} onChange={setNextReminder} />
              </Field>
            </>
          )}

          <Field label="توضیحات">
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </Field>

          {/* Skipped rows report */}
          {skipped.length > 0 && (
            <div className="text-xs bg-destructive/10 border border-destructive/30 rounded p-2 max-h-32 overflow-y-auto">
              <div className="font-bold mb-1 text-destructive">ردیف‌های رد شده ({skipped.length}):</div>
              {skipped.slice(0, 20).map((s) => (
                <div key={s.r.id}>• {tagLabel(s.r)} — {s.reason}</div>
              ))}
              {skipped.length > 20 && <div>...</div>}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>انصراف</Button>
          <Button onClick={handleSubmitClick} disabled={submitting} className="bg-gradient-primary text-primary-foreground">
            ادامه و تایید
          </Button>
        </DialogFooter>
      </DialogContent>

      {/* Confirmation dialog */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent dir="rtl" className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-right">تایید عملیات گروهی</DialogTitle>
            <DialogDescription className="text-right">
              آیا مطمئن هستید می‌خواهید <b>{TITLES[actionKey]}</b> را برای <b className="text-primary">{valid.length}</b> دام ثبت کنید؟
              این عملیات قابل بازگشت نیست.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={submitting}>خیر</Button>
            <Button onClick={() => { setConfirmOpen(false); performInsert(); }}
              disabled={submitting} className="bg-gradient-primary text-primary-foreground">
              {submitting && <Loader2 className="w-4 h-4 animate-spin ml-2" />}
              بله، ثبت کن
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}
