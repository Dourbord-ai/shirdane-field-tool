// =============================================================================
// FertilityActionList.tsx  —  route: /reports/fertility/action-list
// -----------------------------------------------------------------------------
// «گاوهای نیازمند اقدام تولیدمثلی» — daily operational worklist that the
// reproduction team uses to plan inseminations, pregnancy tests, vet visits
// and sync protocol steps.
//
// Data flow:
//   1) Load cows (female + present) and the full fertility-event history.
//   2) Load latest active cow_sync per cow.
//   3) Load thresholds (single row) and livestock_locations (group proxy).
//   4) For each cow run classifyCow() → assigns ONE section + computes
//      every display column.
//   5) Render KPI cards + 9 collapsible section tables, filtered by the
//      top toolbar.
// =============================================================================

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Settings as SettingsIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatShamsi } from "@/lib/dateDisplay";
import {
  DEFAULT_FERTILITY_THRESHOLDS,
  useFertilityThresholds,
} from "@/hooks/useFertilityThresholds";
import {
  classifyCow,
  computeKPIs,
  SECTION_LABELS,
  SECTION_PRIORITY,
  type ActionListRow,
  type ActionSection,
  type CowRow,
  type CowSyncRow,
} from "@/lib/fertility/actionList";
import type { FertilityEvent } from "@/lib/fertility";
import FertilityBreadcrumb from "@/components/reports/FertilityBreadcrumb";

// -----------------------------------------------------------------------------
// Supabase has a 1000-row default response limit. We paginate fertility events
// in 1000-row chunks (sorted by id) until the page returns less than the page
// size. Cows / syncs / locations comfortably fit in a single page.
// -----------------------------------------------------------------------------
async function fetchAllEvents(): Promise<FertilityEvent[]> {
  const PAGE = 1000;
  let from = 0;
  const all: FertilityEvent[] = [];
  // Keep paging until we hit a short page (last page).
  while (true) {
    const { data, error } = await supabase
      .from("livestock_fertility_events")
      .select(
        "id, livestock_id, event_type, event_date, status_code, result, result_code, operator_user_id, operator_name, notes, metadata, legacy_table_name, legacy_record_id, created_at, is_cancelled, fertility_operation_id, erotic_type_id, event_time",
      )
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as unknown as FertilityEvent[];
    all.push(...rows);
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

// One paged query keeps memory predictable.
async function fetchCows(): Promise<CowRow[]> {
  const PAGE = 1000;
  let from = 0;
  const all: CowRow[] = [];
  while (true) {
      .select(
        "id, bodynumber, earnumber, tag_number, sex, sextype, existancestatus, presence_status, is_dry, is_pregnancy, number_of_births, date_of_birth, last_birth_date, last_pregnancy_date, last_abortion_date, last_fertility_status, last_location_id, last_sync_date",
      )
      .eq("sex", 0)
      .or("existancestatus.is.null,existancestatus.eq.0")
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as unknown as CowRow[];
    all.push(...rows);
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

async function fetchActiveSyncs(): Promise<CowSyncRow[]> {
  // Active = not deleted, status not 'stopped'. We pull every record then
  // pick the most recent per cow client-side (volume here is small).
  const { data, error } = await supabase
    .from("cow_syncs")
    .select("id, cow_id, sync_type_id, event_date, status, is_deleted")
    .or("is_deleted.is.null,is_deleted.eq.false")
    .order("event_date", { ascending: false })
    .limit(1000);
  if (error) throw error;
  return (data ?? []) as unknown as CowSyncRow[];
}

async function fetchLocations(): Promise<{ id: number; name: string | null }[]> {
  const { data, error } = await supabase
    .from("livestock_locations")
    .select("id, name")
    .or("is_deleted.is.null,is_deleted.eq.false")
    .order("name", { ascending: true })
    .limit(1000);
  if (error) throw error;
  return (data ?? []) as { id: number; name: string | null }[];
}

// -----------------------------------------------------------------------------
// KPI card — small, dark-mode friendly box with a label and a big number.
// -----------------------------------------------------------------------------
function KpiCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number | string;
  accent?: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card px-4 py-3">
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      <div className={`text-2xl font-extrabold ${accent ?? "text-foreground"}`}>
        {value}
      </div>
    </div>
  );
}

export default function FertilityActionList() {
  // ---- Data fetching --------------------------------------------------------
  const { data: thresholds = DEFAULT_FERTILITY_THRESHOLDS } = useFertilityThresholds();
  const cowsQ = useQuery({ queryKey: ["fertility_action_list", "cows"], queryFn: fetchCows });
  const eventsQ = useQuery({
    queryKey: ["fertility_action_list", "events"],
    queryFn: fetchAllEvents,
  });
  const syncsQ = useQuery({
    queryKey: ["fertility_action_list", "syncs"],
    queryFn: fetchActiveSyncs,
  });
  const locsQ = useQuery({
    queryKey: ["fertility_action_list", "locations"],
    queryFn: fetchLocations,
  });

  const isLoading = cowsQ.isLoading || eventsQ.isLoading || syncsQ.isLoading || locsQ.isLoading;
  const error = cowsQ.error || eventsQ.error || syncsQ.error || locsQ.error;

  // ---- Filter state ---------------------------------------------------------
  const [groupFilter, setGroupFilter] = useState<string>("all"); // last_location_id proxy
  const [parityFilter, setParityFilter] = useState<string>("all"); // heifer / multi
  const [statusFilter, setStatusFilter] = useState<string>("all"); // open/pregnant/dry
  const [search, setSearch] = useState<string>("");

  // ---- Build rows (memoized so re-renders don't recompute everything) -------
  const rows = useMemo<ActionListRow[]>(() => {
    if (!cowsQ.data || !eventsQ.data || !syncsQ.data || !locsQ.data) return [];

    // Index events by cow.
    const eventsByCow = new Map<number, FertilityEvent[]>();
    for (const e of eventsQ.data) {
      const arr = eventsByCow.get(e.livestock_id) ?? [];
      arr.push(e);
      eventsByCow.set(e.livestock_id, arr);
    }
    // Pick latest sync per cow (the fetch is already sorted desc by event_date).
    const latestSyncByCow = new Map<number, CowSyncRow>();
    for (const s of syncsQ.data) {
      if (!latestSyncByCow.has(s.cow_id)) latestSyncByCow.set(s.cow_id, s);
    }
    // Location name index.
    const locName = new Map<number, string>();
    for (const l of locsQ.data) if (l.name) locName.set(l.id, l.name);

    // Classify each cow.
    const out: ActionListRow[] = [];
    for (const cow of cowsQ.data) {
      const events = eventsByCow.get(cow.id) ?? [];
      const syncRecord = latestSyncByCow.get(cow.id) ?? null;
      const groupLabel = cow.last_location_id ? locName.get(cow.last_location_id) ?? null : null;
      out.push(
        classifyCow({
          cow,
          events,
          syncRecord,
          thresholds,
          groupLabel,
        }),
      );
    }
    return out;
  }, [cowsQ.data, eventsQ.data, syncsQ.data, locsQ.data, thresholds]);

  // ---- Apply filters --------------------------------------------------------
  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      if (groupFilter !== "all" && String(r.cow.last_location_id ?? "") !== groupFilter) return false;
      if (parityFilter === "heifer" && (r.parity ?? 0) > 0) return false;
      if (parityFilter === "multi" && (r.parity ?? 0) === 0) return false;
      if (statusFilter !== "all" && r.pregnancyStatus !== statusFilter) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        if (!r.cowLabel.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [rows, groupFilter, parityFilter, statusFilter, search]);

  // ---- KPIs (computed from filtered rows so they always match the view) ----
  const kpis = useMemo(() => computeKPIs(filteredRows), [filteredRows]);

  // Group rows by section for rendering.
  const rowsBySection = useMemo(() => {
    const map = new Map<ActionSection, ActionListRow[]>();
    for (const r of filteredRows) {
      if (r.section === "none") continue;
      const arr = map.get(r.section) ?? [];
      arr.push(r);
      map.set(r.section, arr);
    }
    return map;
  }, [filteredRows]);

  // Render -------------------------------------------------------------------
  return (
    <div className="space-y-5 py-4" dir="rtl">
      <FertilityBreadcrumb currentPage="گاوهای نیازمند اقدام تولیدمثلی" />

      {/* Header */}
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-foreground">
            گاوهای نیازمند اقدام تولیدمثلی
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            لیست عملیاتی روزانه برای برنامه‌ریزی تلقیح، تست، ویزیت و همزمان‌سازی.
          </p>
        </div>
        <Button asChild variant="outline" size="sm" className="gap-2">
          <Link to="/settings/fertility">
            <SettingsIcon className="w-4 h-4" />
            تنظیمات آستانه‌ها
          </Link>
        </Button>
      </header>

      {/* KPI cards — Average Open Days included as required */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <KpiCard label="Ready For Breeding" value={kpis.readyForBreeding} accent="text-primary" />
        <KpiCard label="Pregnancy Check Due" value={kpis.pregnancyCheckDue} />
        <KpiCard label="Recheck Due" value={kpis.recheckDue} />
        <KpiCard label="Vet Visit Required" value={kpis.vetVisitRequired} accent="text-destructive" />
        <KpiCard label="High Risk Open" value={kpis.highRiskOpen} accent="text-destructive" />
        <KpiCard label="Close To Calving" value={kpis.closeToCalving} accent="text-primary" />
        <KpiCard label="Synchronization Due" value={kpis.syncDue} />
        <KpiCard label="Repeat Breeders" value={kpis.repeatBreeders} accent="text-amber-400" />
        <KpiCard label="Chronic Breeders" value={kpis.chronicBreeders} accent="text-destructive" />
        <KpiCard label="Average Open Days" value={kpis.averageOpenDays ?? "—"} />
      </div>

      {/* Filters */}
      <div className="rounded-2xl border border-border bg-card p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">گروه (موقت: مکان)</Label>
          <Select value={groupFilter} onValueChange={setGroupFilter}>
            <SelectTrigger><SelectValue placeholder="همه" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">همه گروه‌ها</SelectItem>
              {(locsQ.data ?? []).map((l) => (
                <SelectItem key={l.id} value={String(l.id)}>
                  {l.name ?? `#${l.id}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">شکم زایش</Label>
          <Select value={parityFilter} onValueChange={setParityFilter}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">همه</SelectItem>
              <SelectItem value="heifer">تلیسه</SelectItem>
              <SelectItem value="multi">چندشکم</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">وضعیت آبستنی</Label>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">همه</SelectItem>
              <SelectItem value="open">باز</SelectItem>
              <SelectItem value="pregnant">آبستن</SelectItem>
              <SelectItem value="dry">خشک</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">جستجو شماره</Label>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="بدنه / گوش / تگ"
            className="text-right"
          />
        </div>
      </div>

      {/* Loading / Error states */}
      {error ? (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/10 text-destructive p-4 text-sm">
          خطا در بارگذاری داده‌ها: {(error as Error).message}
        </div>
      ) : isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          در حال محاسبه…
        </div>
      ) : (
        // -------------------------------------------------------------------
        // Sections rendered in the approved priority order, mutually exclusive.
        // -------------------------------------------------------------------
        <div className="space-y-5">
          {SECTION_PRIORITY.map((section) => {
            const sectionRows = rowsBySection.get(section) ?? [];
            if (sectionRows.length === 0) return null;
            return (
              <SectionTable
                key={section}
                title={SECTION_LABELS[section]}
                rows={sectionRows}
              />
            );
          })}
          {filteredRows.every((r) => r.section === "none") && (
            <div className="rounded-2xl border border-border bg-card p-8 text-center text-muted-foreground">
              با فیلترهای فعلی، هیچ دامی نیازمند اقدام نیست. ✅
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// SectionTable — collapsed table per worklist section. Columns match the
// approved final spec (incl. Open Days, Current Cycle #, Reproductive Cost
// To Date — the cost column renders "—" until a cost ledger lands).
// -----------------------------------------------------------------------------
function SectionTable({ title, rows }: { title: string; rows: ActionListRow[] }) {
  return (
    <section className="rounded-2xl border border-border bg-card overflow-hidden">
      <header className="px-4 py-3 border-b border-border flex items-center justify-between">
        <h2 className="text-base font-bold text-foreground">{title}</h2>
        <Badge variant="secondary">{rows.length}</Badge>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 text-muted-foreground">
            <tr>
              <th className="text-right px-3 py-2 font-medium">دام</th>
              <th className="text-right px-3 py-2 font-medium">شکم</th>
              <th className="text-right px-3 py-2 font-medium">سیکل فعلی</th>
              <th className="text-right px-3 py-2 font-medium">DIM</th>
              <th className="text-right px-3 py-2 font-medium">Open Days</th>
              <th className="text-right px-3 py-2 font-medium">وضعیت</th>
              <th className="text-right px-3 py-2 font-medium">آخرین فحلی</th>
              <th className="text-right px-3 py-2 font-medium">روز از فحلی</th>
              <th className="text-right px-3 py-2 font-medium">آخرین تلقیح</th>
              <th className="text-right px-3 py-2 font-medium">روز از تلقیح</th>
              <th className="text-right px-3 py-2 font-medium">تلقیح‌ها (سیکل)</th>
              <th className="text-right px-3 py-2 font-medium">فحلی‌ها (سیکل)</th>
              <th className="text-right px-3 py-2 font-medium">تست آبستنی</th>
              <th className="text-right px-3 py-2 font-medium">شستشو</th>
              <th className="text-right px-3 py-2 font-medium">ویزیت</th>
              <th className="text-right px-3 py-2 font-medium">گروه</th>
              <th className="text-right px-3 py-2 font-medium">دامپزشک</th>
              <th className="text-right px-3 py-2 font-medium">تکنسین</th>
              <th className="text-right px-3 py-2 font-medium">هزینه تولیدمثلی</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.cow.id}
                className="border-t border-border hover:bg-muted/20 transition-colors"
              >
                <td className="px-3 py-2">
                  <Link
                    to={`/livestock/${r.cow.id}`}
                    className="text-primary hover:underline"
                  >
                    {r.cowLabel}
                  </Link>
                </td>
                <td className="px-3 py-2">{r.parity ?? "—"}</td>
                <td className="px-3 py-2">{r.currentCycleNumber}</td>
                <td className="px-3 py-2">{r.dim ?? "—"}</td>
                <td className="px-3 py-2">{r.openDays ?? "—"}</td>
                <td className="px-3 py-2">{statusLabel(r.pregnancyStatus)}</td>
                <td className="px-3 py-2">{fmt(r.lastHeatDate)}</td>
                <td className="px-3 py-2">{r.daysSinceLastHeat ?? "—"}</td>
                <td className="px-3 py-2">{fmt(r.lastServiceDate)}</td>
                <td className="px-3 py-2">{r.daysSinceLastService ?? "—"}</td>
                <td className="px-3 py-2">{r.servicesInCycle}</td>
                <td className="px-3 py-2">{r.heatsInCycle}</td>
                <td className="px-3 py-2">{r.pregnancyTestCount}</td>
                <td className="px-3 py-2">{r.uterineFlushCount}</td>
                <td className="px-3 py-2">{r.reproductiveVisitCount}</td>
                <td className="px-3 py-2">{r.groupLabel ?? "—"}</td>
                <td className="px-3 py-2">{r.assignedVet ?? "—"}</td>
                <td className="px-3 py-2">{r.assignedTechnician ?? "—"}</td>
                <td className="px-3 py-2">
                  {r.reproductiveCostToDate == null ? "—" : r.reproductiveCostToDate}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function fmt(d: Date | null): string {
  return d ? formatShamsi(d) : "—";
}

function statusLabel(s: ActionListRow["pregnancyStatus"]): string {
  switch (s) {
    case "open": return "باز";
    case "pregnant": return "آبستن";
    case "dry": return "خشک";
    default: return "—";
  }
}
