import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Label } from "@/components/ui/label";
import SearchableSelect from "@/components/SearchableSelect";
import { useCows, useFertilityOperations, useFertilityStatuses, cowLabel } from "@/hooks/useFertilityRefs";
import { PREGNANCY_STATE_BADGE, MILKING_STATE_BADGE } from "@/lib/fertilityRefs";

interface FertilityEvent {
  id: string;
  livestock_id: number;
  fertility_operation_id: number | null;
  event_type: string;
  event_date: string | null;
  event_time: string | null;
  fertility_status_id: number | null;
  notes: string | null;
  is_cancelled: boolean;
  result_code: string | null;
  created_at: string;
}

export default function FertilityTimeline() {
  const { data: cows = [] } = useCows();
  const { data: ops = [] } = useFertilityOperations();
  const { data: statuses = [] } = useFertilityStatuses();
  const [cowId, setCowId] = useState<string>("");

  const cowOptions = useMemo(
    () => cows.map((c) => ({ value: String(c.id), label: cowLabel(c) })),
    [cows]
  );

  const { data: events = [], isLoading } = useQuery({
    queryKey: ["livestock_fertility_events", cowId],
    enabled: !!cowId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("livestock_fertility_events")
        .select("id, livestock_id, fertility_operation_id, event_type, event_date, event_time, fertility_status_id, notes, is_cancelled, result_code, created_at")
        .eq("livestock_id", Number(cowId))
        .order("event_date", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as FertilityEvent[];
    },
  });

  return (
    <div className="py-6 space-y-4 animate-fade-in" dir="rtl">
      <h1 className="text-heading text-foreground">تایم‌لاین باروری دام</h1>

      <div className="rounded-xl bg-card border border-border p-4 space-y-2">
        <Label>انتخاب دام</Label>
        <SearchableSelect options={cowOptions} value={cowId} onChange={setCowId} placeholder="جستجو و انتخاب دام..." />
      </div>

      {!cowId ? (
        <div className="rounded-xl bg-card border border-border p-8 text-center text-muted-foreground">
          ابتدا یک دام انتخاب کنید
        </div>
      ) : isLoading ? (
        <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
      ) : events.length === 0 ? (
        <div className="rounded-xl bg-card border border-border p-8 text-center text-muted-foreground">
          رویدادی برای این دام ثبت نشده است
        </div>
      ) : (
        <div className="space-y-3">
          {events.map((e) => {
            const op = ops.find((o) => o.id === e.fertility_operation_id);
            const st = statuses.find((s) => s.id === e.fertility_status_id);
            const preg = st ? PREGNANCY_STATE_BADGE[st.pregnancy_state] : null;
            const milk = st ? MILKING_STATE_BADGE[st.milking_state] : null;
            return (
              <div key={e.id} className={`rounded-xl bg-card border p-4 ${e.is_cancelled ? "border-destructive/30 opacity-70" : "border-border"}`}>
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-body-lg font-bold text-foreground">{op?.name || e.event_type}</h3>
                    {st && (
                      <span className="text-xs px-2 py-0.5 rounded-full border" style={{ borderColor: st.color, color: st.color }}>
                        {st.name}
                      </span>
                    )}
                    {preg && preg.label !== "نامشخص" && (
                      <span className={`text-xs px-2 py-0.5 rounded-full border ${preg.cls}`}>{preg.label}</span>
                    )}
                    {milk && milk.label !== "نامشخص" && (
                      <span className={`text-xs px-2 py-0.5 rounded-full border ${milk.cls}`}>{milk.label}</span>
                    )}
                    {e.is_cancelled && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-destructive/10 text-destructive border border-destructive/30">لغو شده</span>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {e.event_date || "—"} {e.event_time ? `• ${e.event_time}` : ""}
                  </span>
                </div>
                {e.result_code && <p className="text-xs text-muted-foreground mt-1">کد نتیجه: {e.result_code}</p>}
                {e.notes && <p className="text-sm text-foreground mt-2 leading-relaxed">{e.notes}</p>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
