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

type Props = {
  livestockId: number;
  latestStatus: number | null;
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
  { key: "sync", label: "همزمان‌سازی فحلی" },
];

function EventCard({ e }: { e: FertilityEvent }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-1.5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className={`text-[11px] px-2 py-0.5 rounded-full border ${eventBadgeClass(e.event_type)}`}>
          {fertilityEventLabel(e.event_type)}
        </span>
        <span className="text-xs text-muted-foreground">{formatEventDate(e.event_date)}</span>
      </div>
      {e.result && <p className="text-sm text-foreground break-words">{e.result}</p>}
      {e.notes && <p className="text-xs text-muted-foreground break-words">{e.notes}</p>}
      {e.operator_name && (
        <p className="text-[11px] text-muted-foreground">اپراتور: {e.operator_name}</p>
      )}
      {e.legacy_table_name && (
        <p className="text-[10px] text-muted-foreground/70">
          منبع: {e.legacy_table_name}
          {e.legacy_record_id != null && <> #{e.legacy_record_id}</>}
        </p>
      )}
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

function EventList({ events, emptyText }: { events: FertilityEvent[]; emptyText: string }) {
  if (events.length === 0) return <EmptyList text={emptyText} />;
  return (
    <div className="space-y-2">
      {events.map((e) => (
        <EventCard key={e.id} e={e} />
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
      { key: "sync", label: "ثبت همزمان‌سازی فحلی" },
    ],
  },
];

export default function FertilitySection({ livestockId, latestStatus }: Props) {
  const { toast } = useToast();
  const [events, setEvents] = useState<FertilityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [heatOpen, setHeatOpen] = useState(false);
  const [rinseOpen, setRinseOpen] = useState(false);
  const [cleanTestOpen, setCleanTestOpen] = useState(false);
  const [pregnancyTestOpen, setPregnancyTestOpen] = useState(false);
  const [inseminationOpen, setInseminationOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [activeTab, setActiveTab] = useState("summary");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const { data } = await supabase
        .from("livestock_fertility_events" as any)
        .select("*")
        .eq("livestock_id", livestockId)
        .order("event_date", { ascending: false })
        .order("created_at", { ascending: false });
      if (!cancelled) {
        setEvents(((data as any[]) ?? []) as FertilityEvent[]);
        setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [livestockId, reloadKey]);

  const byType = useMemo(() => {
    const map: Record<string, FertilityEvent[]> = {};
    for (const e of events) {
      const t = e.event_type;
      (map[t] ||= []).push(e);
    }
    return map;
  }, [events]);

  const latestStatusEvent = useMemo(
    () => events.find((e) => e.event_type === "fertility_status") ?? null,
    [events],
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
        onSuccess={() => setReloadKey((k) => k + 1)}
      />
      <RinseRegistrationDialog
        open={rinseOpen}
        onOpenChange={setRinseOpen}
        livestockId={livestockId}
        onSuccess={() => setReloadKey((k) => k + 1)}
      />
      <CleanTestRegistrationDialog
        open={cleanTestOpen}
        onOpenChange={setCleanTestOpen}
        livestockId={livestockId}
        onSuccess={() => setReloadKey((k) => k + 1)}
      />
      <InseminationRegistrationDialog
        open={inseminationOpen}
        onOpenChange={setInseminationOpen}
        livestockId={livestockId}
        onSuccess={() => setReloadKey((k) => k + 1)}
      />
      <PregnancyTestRegistrationDialog
        open={pregnancyTestOpen}
        onOpenChange={setPregnancyTestOpen}
        livestockId={livestockId}
        onSuccess={() => setReloadKey((k) => k + 1)}
      />

      {loading ? (
        <div className="flex items-center justify-center py-8 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      ) : (
        <Tabs value={activeTab} onValueChange={setActiveTab} dir="rtl">
          {/* Mobile: Select dropdown */}
          <div className="md:hidden">
            <label className="text-xs text-muted-foreground mb-1 block">نمایش رویدادها</label>
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

          {/* Desktop/tablet: tabs */}
          <div className="hidden md:block overflow-x-auto -mx-1 px-1">
            <TabsList className="flex w-max gap-1 bg-muted/50">
              {TAB_DEFS.map((t) => (
                <TabsTrigger key={t.key} value={t.key} className="text-xs whitespace-nowrap">
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          {/* Summary */}
          <TabsContent value="summary" className="space-y-3">
            {events.length === 0 ? (
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
                    مجموع رویدادها: {events.length.toLocaleString("fa-IR")}
                  </span>
                  <span className="text-[11px] px-2 py-1 rounded-full border bg-secondary text-secondary-foreground border-border">
                    آخرین رویداد: {formatEventDate(events[0]?.event_date)}
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
            <EventList events={events} emptyText="رویدادی ثبت نشده است" />
          </TabsContent>

          {/* Per-type */}
          <TabsContent value="heat">
            <EventList events={byType.heat ?? []} emptyText="رویداد فحلی ثبت نشده است" />
          </TabsContent>
          <TabsContent value="insemination">
            <EventList events={byType.insemination ?? []} emptyText="تلقیحی ثبت نشده است" />
          </TabsContent>
          <TabsContent value="pregnancy_test">
            <EventList
              events={byType.pregnancy_test ?? []}
              emptyText="تست آبستنی ثبت نشده است"
            />
          </TabsContent>

          <TabsContent value="calving_abortion">
            <EventList
              events={[...(byType.calving ?? []), ...(byType.abortion ?? [])].sort((a, b) =>
                (b.event_date ?? "").localeCompare(a.event_date ?? ""),
              )}
              emptyText="رویداد زایش یا سقط ثبت نشده است"
            />
          </TabsContent>

          <TabsContent value="dry_off">
            <EventList events={byType.dry_off ?? []} emptyText="خشک کردنی ثبت نشده است" />
          </TabsContent>
          <TabsContent value="prescription">
            <EventList events={byType.prescription ?? []} emptyText="نسخه/درمانی ثبت نشده است" />
          </TabsContent>

          <TabsContent value="rinse_clean">
            <EventList
              events={[...(byType.rinse ?? []), ...(byType.clean_test ?? [])].sort((a, b) =>
                (b.event_date ?? "").localeCompare(a.event_date ?? ""),
              )}
              emptyText="شستشو یا کلین تستی ثبت نشده است"
            />
          </TabsContent>

          <TabsContent value="sync">
            <EventList
              events={[
                ...(byType.synchronization ?? []),
                ...(byType.sync_detail ?? []),
              ].sort((a, b) => (b.event_date ?? "").localeCompare(a.event_date ?? ""))}
              emptyText="برنامه همزمان‌سازی ثبت نشده است"
            />
          </TabsContent>
        </Tabs>
      )}
    </section>
  );
}
