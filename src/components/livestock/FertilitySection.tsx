import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  FERTILITY_EVENT_LABELS,
  FertilityEvent,
  deriveEventPeople,
  eventBadgeClass,
  fertilityEventLabel,
  formatEventDate,
} from "@/lib/fertility";
import { fertilityLabel } from "@/lib/livestock";
import { Loader2, Activity, History, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import HeatRegistrationDialog from "./HeatRegistrationDialog";
import RinseRegistrationDialog from "./RinseRegistrationDialog";
import CleanTestRegistrationDialog from "./CleanTestRegistrationDialog";
import PregnancyTestRegistrationDialog from "./PregnancyTestRegistrationDialog";
import InseminationRegistrationDialog from "./InseminationRegistrationDialog";
import AbortionRegistrationDialog from "./AbortionRegistrationDialog";
import CalvingRegistrationDialog from "./CalvingRegistrationDialog";
import CreateCalvesFromCalvingDialog from "./CreateCalvesFromCalvingDialog";
import CancelFertilityEventDialog from "./CancelFertilityEventDialog";
import EditFertilityEventDialog from "./EditFertilityEventDialog";
import { Switch } from "@/components/ui/switch";
import { Baby, Pencil, Ban } from "lucide-react";
// New: derived timeline + summary used by per-tab headers and row enrichment.
// All math centralised in src/lib/fertility/* so dialogs/cards/tabs share logic.
import { useFertilitySummary } from "@/hooks/useFertilitySummary";
import TabInsightHeader, { type InsightTab } from "./fertility-tabs/TabInsightHeader";
import type { EnrichedEvent } from "@/lib/fertility/fertilityTimeline";
import { formatShamsi } from "@/lib/dateDisplay";
import { useLegacyUserNames } from "@/hooks/useLegacyUserNames";

type Props = {
  livestockId: number;
  latestStatus: number | null;
  onOperationSaved?: () => void;
};

const TAB_DEFS: { key: string; label: string }[] = [
  { key: "summary", label: "خلاصه" },
  { key: "all", label: "تاریخچه کامل" },
  { key: "heat", label: "فحلی" },
  { key: "insemination", label: "تلقیح" },
  { key: "pregnancy_test", label: "تست آبستنی" },
  { key: "calving_abortion", label: "زایش و سقط" },
  { key: "dry_off", label: "خشک کردن" },
  { key: "prescription", label: "درمان / نسخه" },
  { key: "rinse_clean", label: "شستشو و کلین تست" },
  { key: "sync", label: "پروتکل همزمان‌سازی" },
];

// EnrichmentChip — tiny labelled tag rendered under an event card to surface
// derived row-level facts (AI #, gap from previous, outcome, linked AI, etc).
function EnrichmentChip({ label, value, tone = "default" }: { label: string; value: React.ReactNode; tone?: "default" | "info" | "warn" | "danger" | "success" }) {
  const toneClass =
    tone === "info" ? "bg-sky-500/10 text-sky-400 border-sky-500/30"
    : tone === "warn" ? "bg-amber-500/10 text-amber-400 border-amber-500/30"
    : tone === "danger" ? "bg-destructive/10 text-destructive border-destructive/30"
    : tone === "success" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
    : "bg-muted text-muted-foreground border-border";
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border ${toneClass}`}>
      <span className="opacity-80">{label}:</span>
      <span className="font-bold">{value ?? "—"}</span>
    </span>
  );
}

// Render per-row enrichment chips for a single event, based on its derived
// EnrichedEvent from the FertilityTimeline. Each event type surfaces a
// different subset of facts per the spec.
function renderEnrichment(ee: EnrichedEvent | undefined): React.ReactNode {
  if (!ee) return null;
  const chips: React.ReactNode[] = [];
  const t = ee.event.event_type;
  if (t === "insemination") {
    if (ee.aiNumberInCycle) chips.push(<EnrichmentChip key="n" label="تلقیح #" value={`${ee.aiNumberInCycle}`} />);
    if (ee.daysFromPrevAI != null) chips.push(<EnrichmentChip key="g" label="فاصله از قبلی" value={`${ee.daysFromPrevAI} روز`} />);
    if (ee.aiOutcome) {
      const map: Record<string, { label: string; tone: any }> = {
        pregnant: { label: "منجر به آبستنی", tone: "success" },
        failed: { label: "ناموفق", tone: "danger" },
        unknown: { label: "نامشخص", tone: "default" },
      };
      const m = map[ee.aiOutcome];
      chips.push(<EnrichmentChip key="o" label="نتیجه" value={m.label} tone={m.tone} />);
    }
  }
  if (t === "pregnancy_test") {
    if (ee.daysAfterLinkedAI != null) chips.push(<EnrichmentChip key="d" label="بعد از تلقیح" value={`${ee.daysAfterLinkedAI} روز`} />);
    if (ee.pregTestTiming) {
      const map: Record<string, { label: string; tone: any }> = {
        early: { label: "زودهنگام", tone: "warn" },
        standard: { label: "استاندارد", tone: "success" },
        late: { label: "دیرهنگام", tone: "warn" },
        unknown: { label: "نامشخص", tone: "default" },
      };
      const m = map[ee.pregTestTiming];
      chips.push(<EnrichmentChip key="t" label="اعتبار" value={m.label} tone={m.tone} />);
    }
    if (ee.linkedInseminationDate) chips.push(<EnrichmentChip key="ai" label="تلقیح مرتبط" value={formatShamsi(ee.linkedInseminationDate)} tone="info" />);
    if (ee.abortionFollowed) chips.push(<EnrichmentChip key="ab" label="بعد از این" value="سقط ثبت شد" tone="danger" />);
  }
  if (t === "calving") {
    if (ee.daysAfterLinkedAI != null) chips.push(<EnrichmentChip key="g" label="طول آبستنی" value={`${ee.daysAfterLinkedAI} روز`} />);
    if (ee.linkedInseminationDate) chips.push(<EnrichmentChip key="ai" label="تلقیح منجر به زایش" value={formatShamsi(ee.linkedInseminationDate)} tone="success" />);
  }
  if (t === "abortion") {
    if (ee.daysAfterLinkedAI != null) chips.push(<EnrichmentChip key="g" label="سن آبستنی" value={`${ee.daysAfterLinkedAI} روز`} />);
    if (ee.abortionClass) {
      const map: Record<string, { label: string; tone: any }> = {
        early: { label: "زودرس", tone: "warn" },
        mid: { label: "میان‌دوره", tone: "default" },
        late: { label: "دیررس", tone: "danger" },
        unknown: { label: "نامشخص", tone: "default" },
      };
      const m = map[ee.abortionClass];
      chips.push(<EnrichmentChip key="c" label="نوع" value={m.label} tone={m.tone} />);
    }
    if (ee.linkedInseminationDate) chips.push(<EnrichmentChip key="ai" label="تلقیح مرتبط" value={formatShamsi(ee.linkedInseminationDate)} tone="info" />);
  }
  if (t === "heat") {
    if (ee.heatNumberInCycle) chips.push(<EnrichmentChip key="n" label="فحلی #" value={`${ee.heatNumberInCycle}`} />);
    if (ee.daysFromPrevHeat != null) chips.push(<EnrichmentChip key="g" label="فاصله از قبلی" value={`${ee.daysFromPrevHeat} روز`} />);
    if (ee.heatCycleClass && ee.heatCycleClass !== "unknown") {
      chips.push(<EnrichmentChip key="c" label="سیکل" value={ee.heatCycleClass === "normal" ? "طبیعی" : "غیرطبیعی"} tone={ee.heatCycleClass === "normal" ? "success" : "warn"} />);
    }
    if (ee.daysToNextAI != null) chips.push(<EnrichmentChip key="ai" label="تا تلقیح بعدی" value={`${ee.daysToNextAI} روز`} />);
  }
  if (chips.length === 0) return null;
  return <div className="flex flex-wrap gap-1 pt-1">{chips}</div>;
}

function EventCard({
  e,
  enrichment,
  onCreateCalves,
  onEdit,
  onCancel,
  // Optional resolver for legacy numeric user IDs → real names. When omitted,
  // raw values are shown (so the component still works in isolation).
  resolveUserName,
}: {
  e: FertilityEvent;
  enrichment?: EnrichedEvent;
  onCreateCalves?: (e: FertilityEvent) => void;
  onEdit?: (e: FertilityEvent) => void;
  onCancel?: (e: FertilityEvent) => void;
  resolveUserName?: (v: number | string | null | undefined) => string | null;
}) {
  const calves = (e.metadata as any)?.calves as any[] | undefined;
  const hasCalves = e.event_type === "calving" && Array.isArray(calves) && calves.length > 0;
  const allCreated = hasCalves && calves!.every((c) => c?.created_cow_id);
  const cancelled = !!e.is_cancelled;
  const isLegacyReadOnly = !!e.legacy_table_name && e.legacy_table_name !== "manual";
  return (
    <div
      className={`rounded-lg border border-border bg-card p-3 space-y-1.5 ${
        cancelled ? "opacity-60" : ""
      }`}
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={`text-[11px] px-2 py-0.5 rounded-full border ${eventBadgeClass(e.event_type)}`}>
            {fertilityEventLabel(e.event_type)}
          </span>
          {cancelled && (
            <span className="text-[11px] px-2 py-0.5 rounded-full border bg-destructive/10 text-destructive border-destructive/20">
              لغو شده
            </span>
          )}
        </div>
        <span className="text-xs text-muted-foreground">{formatEventDate(e.event_date)}</span>
      </div>
      {e.result && <p className={`text-sm break-words ${cancelled ? "line-through text-muted-foreground" : "text-foreground"}`}>{e.result}</p>}
      {/* Show structured pregnancy/result codes when present (esp. pregnancy_test rows). */}
      {((e as any).result_code != null || (e as any).status_code != null) && (
        <div className="flex flex-wrap gap-1.5">
          {(e as any).result_code != null && (
            <span className="text-[10px] px-1.5 py-0.5 rounded border bg-muted text-muted-foreground">
              کد نتیجه: {String((e as any).result_code)}
            </span>
          )}
          {(e as any).status_code != null && (
            <span className="text-[10px] px-1.5 py-0.5 rounded border bg-muted text-muted-foreground">
              وضعیت: {fertilityLabel((e as any).status_code)}
            </span>
          )}
        </div>
      )}
      {e.notes && <p className="text-xs text-muted-foreground break-words">{e.notes}</p>}
      {(() => {
        // Derive { operator, doctor } from the event using the shared helper so
        // pregnancy_test rows (which historically stored the vet in operator_name)
        // get split into a dedicated «دامپزشک» line without breaking other types.
        const { operator_name, doctor_name } = deriveEventPeople(e, resolveUserName);
        return (
          <>
            {operator_name && (
              <p className="text-[11px] text-muted-foreground">اپراتور: {operator_name}</p>
            )}
            {doctor_name && (
              <p className="text-[11px] text-muted-foreground">دامپزشک: {doctor_name}</p>
            )}
          </>
        );
      })()}
      {e.legacy_table_name && (
        <p className="text-[10px] text-muted-foreground/70">
          منبع: {e.legacy_table_name}
          {e.legacy_record_id != null && <> #{e.legacy_record_id}</>}
        </p>
      )}
      {cancelled && e.cancel_reason && (
        <p className="text-[11px] text-destructive">دلیل لغو: {e.cancel_reason}</p>
      )}
      {hasCalves && onCreateCalves && !cancelled && (
        <Button
          type="button"
          size="sm"
          variant={allCreated ? "outline" : "default"}
          className="w-full gap-1 mt-1"
          onClick={() => onCreateCalves(e)}
        >
          <Baby className="w-4 h-4" />
          {allCreated ? "مشاهده گوساله‌های ایجادشده" : "ایجاد دام از اطلاعات گوساله‌ها"}
        </Button>
      )}
      {!cancelled && (onEdit || onCancel) && (
        <div className="flex gap-2 pt-1">
          {onEdit && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="flex-1 gap-1 h-8"
              onClick={() => onEdit(e)}
              disabled={isLegacyReadOnly}
              title={isLegacyReadOnly ? "رویداد وارداتی قابل ویرایش نیست" : undefined}
            >
              <Pencil className="w-3.5 h-3.5" />
              ویرایش
            </Button>
          )}
          {onCancel && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="flex-1 gap-1 h-8 text-destructive hover:bg-destructive/5"
              onClick={() => onCancel(e)}
            >
              <Ban className="w-3.5 h-3.5" />
              لغو عملیات
            </Button>
          )}
        </div>
      )}
      {/* Per-row enrichment chips derived from the FertilityTimeline.
          Only renders when the parent passed an `enrichment` prop and the
          calculation actually produced one. Cancelled rows are excluded
          from the timeline so they'll always be undefined here. */}
      {!cancelled && renderEnrichment(enrichment)}
    </div>
  );
}

function EmptyList({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center text-center py-8 text-muted-foreground">
      <History className="w-8 h-8 mb-2 opacity-50" />
      <p className="text-sm">{text}</p>
    </div>
  );
}

function EventList({
  events,
  emptyText,
  enrichmentMap,
  onCreateCalves,
  onEdit,
  onCancel,
  resolveUserName,
}: {
  events: FertilityEvent[];
  emptyText: string;
  // Optional id → EnrichedEvent map. When provided, each card renders extra
  // derived chips (AI #, outcome, linked AI, etc).
  enrichmentMap?: Map<string, EnrichedEvent>;
  onCreateCalves?: (e: FertilityEvent) => void;
  onEdit?: (e: FertilityEvent) => void;
  onCancel?: (e: FertilityEvent) => void;
  // Threaded through to EventCard so operator/vet IDs become real names.
  resolveUserName?: (v: number | string | null | undefined) => string | null;
}) {
  if (events.length === 0) return <EmptyList text={emptyText} />;
  return (
    <div className="space-y-2">
      {events.map((e) => (
        <EventCard
          key={e.id}
          e={e}
          enrichment={enrichmentMap?.get(e.id)}
          onCreateCalves={onCreateCalves}
          onEdit={onEdit}
          onCancel={onCancel}
          resolveUserName={resolveUserName}
        />
      ))}
    </div>
  );
}

type ActionKey =
  | "heat"
  | "insemination"
  | "pregnancy_test"
  | "calving"
  | "abortion"
  | "dry_off"
  | "rinse"
  | "clean_test"
  | "prescription"
  | "sync";

const ACTION_GROUPS: { title: string; actions: { key: ActionKey; label: string }[] }[] = [
  {
    title: "عملیات اصلی",
    actions: [
      { key: "heat", label: "ثبت فحلی" },
      { key: "insemination", label: "ثبت تلقیح" },
      { key: "pregnancy_test", label: "ثبت تست آبستنی" },
    ],
  },
  {
    title: "زایش و خروج از چرخه",
    actions: [
      { key: "calving", label: "ثبت زایش" },
      { key: "abortion", label: "ثبت سقط" },
      { key: "dry_off", label: "ثبت خشک کردن" },
    ],
  },
  {
    title: "درمان و اقدامات تکمیلی",
    actions: [
      { key: "rinse", label: "ثبت شستشو" },
      { key: "clean_test", label: "ثبت کلین تست" },
      { key: "prescription", label: "ثبت درمان / نسخه" },
      { key: "sync", label: "شروع پروتکل همزمان‌سازی" },
    ],
  },
];

export default function FertilitySection({ livestockId, latestStatus, onOperationSaved }: Props) {
  const { toast } = useToast();
  const [events, setEvents] = useState<FertilityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [heatOpen, setHeatOpen] = useState(false);
  const [rinseOpen, setRinseOpen] = useState(false);
  const [cleanTestOpen, setCleanTestOpen] = useState(false);
  const [pregnancyTestOpen, setPregnancyTestOpen] = useState(false);
  const [inseminationOpen, setInseminationOpen] = useState(false);
  const [abortionOpen, setAbortionOpen] = useState(false);
  const [calvingOpen, setCalvingOpen] = useState(false);
  const [calvesReviewEvent, setCalvesReviewEvent] = useState<FertilityEvent | null>(null);
  const [editEvent, setEditEvent] = useState<FertilityEvent | null>(null);
  const [cancelEvent, setCancelEvent] = useState<FertilityEvent | null>(null);
  const [showCancelled, setShowCancelled] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [activeTab, setActiveTab] = useState("summary");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      // Pull all reproductive events for this cow from the canonical fertility table
      // (NOT public.livestock_events — that table holds non-fertility records).
      const { data, error } = await supabase
        .from("livestock_fertility_events" as any)
        .select("*")
        .eq("livestock_id", livestockId)
        .order("event_date", { ascending: false })
        .order("event_time", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false });
      if (error) {
        console.error("[FertilitySection] load error", error);
      }
      // Normalize legacy/alias event_type names so timeline renders consistently.
      // DB historically stores both `pregnancy_test` and `pregnancy_check` for the same concept.
      const normalized = ((data as any[]) ?? []).map((row) => ({
        ...row,
        event_type: row.event_type === "pregnancy_check" ? "pregnancy_test" : row.event_type,
      })) as FertilityEvent[];
      // Temporary diagnostic logging — verifies pregnancy_check / pregnancy_test rows arrive.
      console.log("[FertilitySection] livestock_id=", livestockId, "events:", normalized);
      console.log(
        "[FertilitySection] pregnancy events:",
        normalized.filter((e) => e.event_type === "pregnancy_test"),
      );
      if (!cancelled) {
        setEvents(normalized);
        setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [livestockId, reloadKey]);

  const visibleEvents = useMemo(
    () => (showCancelled ? events : events.filter((e) => !e.is_cancelled)),
    [events, showCancelled],
  );

  const byType = useMemo(() => {
    const map: Record<string, FertilityEvent[]> = {};
    for (const e of visibleEvents) {
      const t = e.event_type;
      (map[t] ||= []).push(e);
    }
    return map;
  }, [visibleEvents]);

  // Derived summary + timeline for this cow (single hook; realtime; memoised).
  // We use it to (a) render TabInsightHeader chips above each operation tab,
  // and (b) build an id→EnrichedEvent map so EventCard can show per-row
  // derived facts (AI #, outcome, linked AI, etc).
  const { summary, timeline } = useFertilitySummary(livestockId);
  const enrichmentMap = useMemo(() => {
    const m = new Map<string, EnrichedEvent>();
    for (const ee of timeline.all) m.set(ee.event.id, ee);
    return m;
  }, [timeline]);

  const latestStatusEvent = useMemo(
    () => visibleEvents.find((e) => e.event_type === "fertility_status") ?? null,
    [visibleEvents],
  );

  function handleAction(key: ActionKey) {
    setActionsOpen(false);
    switch (key) {
      case "heat":
        setHeatOpen(true);
        break;
      case "insemination":
        setInseminationOpen(true);
        break;
      case "rinse":
        setRinseOpen(true);
        break;
      case "clean_test":
        setCleanTestOpen(true);
        break;
      case "pregnancy_test":
        setPregnancyTestOpen(true);
        break;
      case "abortion":
        setAbortionOpen(true);
        break;
      case "calving":
        setCalvingOpen(true);
        break;
      default:
        toast({
          title: "به‌زودی",
          description: "این عملیات هنوز در دسترس نیست.",
        });
    }
  }

  return (
    <section className="rounded-xl border border-border bg-card p-3 sm:p-4 space-y-3 overflow-hidden">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-body-lg font-bold text-foreground flex items-center gap-2 min-w-0">
          <Activity className="w-4 h-4 text-primary shrink-0" />
          <span className="truncate">وضعیت باروری و رویدادها</span>
        </h2>
        <Button size="sm" onClick={() => setActionsOpen(true)} className="gap-1 shrink-0">
          <Plus className="w-4 h-4" />
          ثبت عملیات باروری
        </Button>
      </div>

      <Sheet open={actionsOpen} onOpenChange={setActionsOpen}>
        <SheetContent side="bottom" className="rounded-t-2xl max-h-[85vh] overflow-y-auto" dir="rtl">
          <SheetHeader className="text-right">
            <SheetTitle>ثبت عملیات باروری</SheetTitle>
          </SheetHeader>
          <div className="mt-4 space-y-5">
            {ACTION_GROUPS.map((group) => (
              <div key={group.title} className="space-y-2">
                <h3 className="text-xs font-bold text-muted-foreground">{group.title}</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {group.actions.map((a) => (
                    <Button
                      key={a.key}
                      variant="outline"
                      className="justify-start gap-2 h-11"
                      onClick={() => handleAction(a.key)}
                    >
                      <Plus className="w-4 h-4 text-primary" />
                      {a.label}
                    </Button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </SheetContent>
      </Sheet>

      <HeatRegistrationDialog
        open={heatOpen}
        onOpenChange={setHeatOpen}
        livestockId={livestockId}
        onSuccess={() => { setReloadKey((k) => k + 1); onOperationSaved?.(); }}
      />
      <RinseRegistrationDialog
        open={rinseOpen}
        onOpenChange={setRinseOpen}
        livestockId={livestockId}
        onSuccess={() => { setReloadKey((k) => k + 1); onOperationSaved?.(); }}
      />
      <CleanTestRegistrationDialog
        open={cleanTestOpen}
        onOpenChange={setCleanTestOpen}
        livestockId={livestockId}
        onSuccess={() => { setReloadKey((k) => k + 1); onOperationSaved?.(); }}
      />
      <InseminationRegistrationDialog
        open={inseminationOpen}
        onOpenChange={setInseminationOpen}
        livestockId={livestockId}
        onSuccess={() => { setReloadKey((k) => k + 1); onOperationSaved?.(); }}
      />
      <PregnancyTestRegistrationDialog
        open={pregnancyTestOpen}
        onOpenChange={setPregnancyTestOpen}
        livestockId={livestockId}
        onSuccess={() => { setReloadKey((k) => k + 1); onOperationSaved?.(); }}
      />
      <AbortionRegistrationDialog
        open={abortionOpen}
        onOpenChange={setAbortionOpen}
        livestockId={livestockId}
        onSuccess={() => { setReloadKey((k) => k + 1); onOperationSaved?.(); }}
      />
      <CalvingRegistrationDialog
        open={calvingOpen}
        onOpenChange={setCalvingOpen}
        livestockId={livestockId}
        onSuccess={() => { setReloadKey((k) => k + 1); onOperationSaved?.(); }}
      />
      <CreateCalvesFromCalvingDialog
        open={!!calvesReviewEvent}
        onOpenChange={(o) => !o && setCalvesReviewEvent(null)}
        event={calvesReviewEvent}
        motherCowId={livestockId}
        onSuccess={() => { setReloadKey((k) => k + 1); onOperationSaved?.(); }}
      />
      <EditFertilityEventDialog
        open={!!editEvent}
        onOpenChange={(o) => !o && setEditEvent(null)}
        event={editEvent}
        onSuccess={() => { setReloadKey((k) => k + 1); onOperationSaved?.(); }}
      />
      <CancelFertilityEventDialog
        open={!!cancelEvent}
        onOpenChange={(o) => !o && setCancelEvent(null)}
        event={cancelEvent}
        onSuccess={() => { setReloadKey((k) => k + 1); onOperationSaved?.(); }}
      />

      <div className="flex items-center justify-end gap-2 text-xs">
        <Switch
          id="show-cancelled-fertility"
          checked={showCancelled}
          onCheckedChange={setShowCancelled}
        />
        <label htmlFor="show-cancelled-fertility" className="text-muted-foreground cursor-pointer">
          نمایش عملیات لغو شده
        </label>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      ) : (
        <Tabs value={activeTab} onValueChange={setActiveTab} dir="rtl">
          {/* Mobile: Select dropdown */}
          <div className="md:hidden">
            <label className="text-xs text-muted-foreground mb-1 block">نمایش بخش باروری</label>
            <Select value={activeTab} onValueChange={setActiveTab}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TAB_DEFS.map((t) => (
                  <SelectItem key={t.key} value={t.key}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Desktop/tablet: wrapping tabs (no horizontal scroll) */}
          <div className="hidden md:block">
            <TabsList className="flex flex-wrap h-auto w-full gap-1 bg-muted/50 p-1 justify-start">
              {TAB_DEFS.map((t) => (
                <TabsTrigger
                  key={t.key}
                  value={t.key}
                  className="text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm"
                >
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          {/* Summary */}
          <TabsContent value="summary" className="space-y-3">
            {visibleEvents.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border bg-muted/30 p-6 text-center">
                <History className="w-8 h-8 mx-auto mb-2 opacity-50 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  هنوز رویداد باروری برای این دام ثبت یا همگام‌سازی نشده است.
                </p>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap gap-2">
                  <span className="text-[11px] px-2 py-1 rounded-full border bg-primary/10 text-primary border-primary/20 font-bold">
                    مجموع رویدادها: {visibleEvents.length.toLocaleString("fa-IR")}
                  </span>
                  <span className="text-[11px] px-2 py-1 rounded-full border bg-secondary text-secondary-foreground border-border">
                    آخرین رویداد: {formatEventDate(visibleEvents[0]?.event_date)}
                  </span>
                  <span className="text-[11px] px-2 py-1 rounded-full border bg-accent text-accent-foreground border-border">
                    وضعیت: {fertilityLabel(latestStatus)}
                  </span>
                </div>
                <div className="rounded-lg bg-primary/5 border border-primary/10 p-3">
                  <p className="text-xs text-muted-foreground">آخرین وضعیت باروری</p>
                  <p className="text-base font-bold text-foreground mt-1">
                    {fertilityLabel(latestStatus)}
                  </p>
                  {latestStatusEvent?.event_date && (
                    <p className="text-xs text-muted-foreground mt-1">
                      تاریخ ثبت: {formatEventDate(latestStatusEvent.event_date)}
                    </p>
                  )}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {Object.entries(FERTILITY_EVENT_LABELS).map(([type, label]) => (
                    <div
                      key={type}
                      className="rounded-md border border-border bg-background p-2 text-center"
                    >
                      <p className="text-[11px] text-muted-foreground truncate">{label}</p>
                      <p className="text-sm font-bold text-foreground">
                        {(byType[type]?.length ?? 0).toLocaleString("fa-IR")}
                      </p>
                    </div>
                  ))}
                </div>
              </>
            )}
          </TabsContent>

          {/* Full timeline */}
          <TabsContent value="all">
            <EventList
              events={visibleEvents}
              emptyText="رویدادی ثبت نشده است"
              onCreateCalves={setCalvesReviewEvent}
              onEdit={setEditEvent}
              onCancel={setCancelEvent}
            />
          </TabsContent>

          {/* Per-type tabs — each one shows the relevant TabInsightHeader chips
              above the list and enrichment chips on each card via enrichmentMap. */}
          <TabsContent value="heat">
            <TabInsightHeader tab="heat" summary={summary} />
            <EventList
              events={byType.heat ?? []}
              emptyText="رویداد فحلی ثبت نشده است"
              enrichmentMap={enrichmentMap}
              onEdit={setEditEvent}
              onCancel={setCancelEvent}
            />
          </TabsContent>
          <TabsContent value="insemination">
            <TabInsightHeader tab="insemination" summary={summary} />
            <EventList
              events={byType.insemination ?? []}
              emptyText="تلقیحی ثبت نشده است"
              enrichmentMap={enrichmentMap}
              onEdit={setEditEvent}
              onCancel={setCancelEvent}
            />
          </TabsContent>
          <TabsContent value="pregnancy_test">
            <TabInsightHeader tab="pregnancy_test" summary={summary} />
            <EventList
              events={byType.pregnancy_test ?? []}
              emptyText="تست آبستنی ثبت نشده است"
              enrichmentMap={enrichmentMap}
              onEdit={setEditEvent}
              onCancel={setCancelEvent}
            />
          </TabsContent>

          <TabsContent value="calving_abortion">
            {/* Show calving header — most of these tabs land on a زایش flow first;
                سقط chips overlap mostly so this is the right default. */}
            <TabInsightHeader tab="calving" summary={summary} />
            <EventList
              events={[...(byType.calving ?? []), ...(byType.abortion ?? [])].sort((a, b) =>
                (b.event_date ?? "").localeCompare(a.event_date ?? ""),
              )}
              emptyText="رویداد زایش یا سقط ثبت نشده است"
              enrichmentMap={enrichmentMap}
              onCreateCalves={setCalvesReviewEvent}
              onEdit={setEditEvent}
              onCancel={setCancelEvent}
            />
          </TabsContent>

          <TabsContent value="dry_off">
            <TabInsightHeader tab="dry_off" summary={summary} />
            <EventList
              events={byType.dry_off ?? []}
              emptyText="خشک کردنی ثبت نشده است"
              enrichmentMap={enrichmentMap}
              onEdit={setEditEvent}
              onCancel={setCancelEvent}
            />
          </TabsContent>
          <TabsContent value="prescription">
            <EventList
              events={byType.prescription ?? []}
              emptyText="نسخه/درمانی ثبت نشده است"
              onEdit={setEditEvent}
              onCancel={setCancelEvent}
            />
          </TabsContent>

          <TabsContent value="rinse_clean">
            <EventList
              events={[...(byType.rinse ?? []), ...(byType.clean_test ?? [])].sort((a, b) =>
                (b.event_date ?? "").localeCompare(a.event_date ?? ""),
              )}
              emptyText="شستشو یا کلین تستی ثبت نشده است"
              onEdit={setEditEvent}
              onCancel={setCancelEvent}
            />
          </TabsContent>

          <TabsContent value="sync">
            <EventList
              events={[
                ...(byType.synchronization ?? []),
                ...(byType.sync_detail ?? []),
              ].sort((a, b) => (b.event_date ?? "").localeCompare(a.event_date ?? ""))}
              emptyText="برنامه همزمان‌سازی ثبت نشده است"
              onEdit={setEditEvent}
              onCancel={setCancelEvent}
            />
          </TabsContent>
        </Tabs>
      )}
    </section>
  );
}
