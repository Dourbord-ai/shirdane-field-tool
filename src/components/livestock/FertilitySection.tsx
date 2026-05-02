import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import HeatRegistrationDialog from "./HeatRegistrationDialog";
import RinseRegistrationDialog from "./RinseRegistrationDialog";
import CleanTestRegistrationDialog from "./CleanTestRegistrationDialog";

type Props = {
  livestockId: number;
  latestStatus: number | null;
};

const TAB_DEFS: { key: string; label: string; type?: string }[] = [
  { key: "summary", label: "خلاصه" },
  { key: "all", label: "تاریخچه کامل" },
  { key: "heat", label: "فحلی", type: "heat" },
  { key: "insemination", label: "تلقیح", type: "insemination" },
  { key: "pregnancy_test", label: "تست آبستنی", type: "pregnancy_test" },
  { key: "calving_abortion", label: "زایش و سقط" },
  { key: "dry_off", label: "خشک کردن", type: "dry_off" },
  { key: "prescription", label: "درمان / نسخه", type: "prescription" },
  { key: "rinse_clean", label: "شستشو و کلین تست" },
  { key: "sync", label: "همزمان‌سازی فحلی" },
];

function EventCard({ e }: { e: FertilityEvent }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className={`text-[11px] px-2 py-0.5 rounded-full border ${eventBadgeClass(e.event_type)}`}>
          {fertilityEventLabel(e.event_type)}
        </span>
        <span className="text-xs text-muted-foreground">{formatEventDate(e.event_date)}</span>
      </div>
      {e.result && <p className="text-sm text-foreground">{e.result}</p>}
      {e.notes && <p className="text-xs text-muted-foreground">{e.notes}</p>}
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

export default function FertilitySection({ livestockId, latestStatus }: Props) {
  const [events, setEvents] = useState<FertilityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [heatOpen, setHeatOpen] = useState(false);
  const [rinseOpen, setRinseOpen] = useState(false);
  const [cleanTestOpen, setCleanTestOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

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

  return (
    <section className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-body-lg font-bold text-foreground flex items-center gap-2">
          <Activity className="w-4 h-4 text-primary" />
          وضعیت باروری و رویدادها
        </h2>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => setHeatOpen(true)} className="gap-1">
            <Plus className="w-4 h-4" />
            ثبت فحلی
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setRinseOpen(true)}
            className="gap-1"
          >
            <Plus className="w-4 h-4" />
            ثبت شستشو
          </Button>
        </div>
      </div>

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


      {loading ? (
        <div className="flex items-center justify-center py-8 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      ) : (
        <Tabs defaultValue="summary" dir="rtl">
          <div className="overflow-x-auto -mx-1 px-1">
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
                <div className="grid grid-cols-2 gap-2">
                  {Object.entries(FERTILITY_EVENT_LABELS).map(([type, label]) => (
                    <div
                      key={type}
                      className="rounded-md border border-border bg-background p-2 text-center"
                    >
                      <p className="text-[11px] text-muted-foreground">{label}</p>
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

          {/* Combined: calving + abortion */}
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

          {/* Combined: rinse + clean test */}
          <TabsContent value="rinse_clean">
            <EventList
              events={[...(byType.rinse ?? []), ...(byType.clean_test ?? [])].sort((a, b) =>
                (b.event_date ?? "").localeCompare(a.event_date ?? ""),
              )}
              emptyText="شستشو یا کلین تستی ثبت نشده است"
            />
          </TabsContent>

          {/* Combined: sync + sync details */}
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
