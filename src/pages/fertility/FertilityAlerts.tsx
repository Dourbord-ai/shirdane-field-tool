import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import SearchableSelect from "@/components/SearchableSelect";
import ShamsiDatePicker from "@/components/ShamsiDatePicker";
import { toast } from "sonner";
import { useCows, useFertilityOperations, cowLabel } from "@/hooks/useFertilityRefs";
import { ALERT_STATUS_LABEL } from "@/lib/fertilityRefs";

interface Alert {
  id: string;
  cow_id: number;
  fertility_operation_id: number | null;
  workflow_id: string | null;
  rule_id: string | null;
  title: string;
  description: string | null;
  status: string;
  alert_date: string;
  expires_at: string | null;
  created_at: string;
}

export default function FertilityAlerts() {
  const qc = useQueryClient();
  const { data: cows = [] } = useCows();
  const { data: ops = [] } = useFertilityOperations();
  const [statusFilter, setStatusFilter] = useState<string>("open");
  const [cowId, setCowId] = useState<string>("");
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");

  const cowOptions = useMemo(
    () => [{ value: "", label: "همه دام‌ها" }, ...cows.map((c) => ({ value: String(c.id), label: cowLabel(c) }))],
    [cows]
  );

  const { data: alerts = [], isLoading } = useQuery({
    queryKey: ["breeding_alerts", statusFilter, cowId, fromDate, toDate],
    queryFn: async () => {
      let q = supabase.from("breeding_alerts").select("*").order("alert_date", { ascending: false }).limit(500);
      if (statusFilter !== "all") q = q.eq("status", statusFilter);
      if (cowId) q = q.eq("cow_id", Number(cowId));
      if (fromDate) q = q.gte("alert_date", fromDate);
      if (toDate) q = q.lte("alert_date", toDate);
      const { data, error } = await q;
      if (error) throw error;
      return data as Alert[];
    },
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase.from("breeding_alerts").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["breeding_alerts"] });
      toast.success("وضعیت هشدار به‌روزرسانی شد");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cowName = (id: number) => {
    const c = cows.find((x) => x.id === id);
    return c ? cowLabel(c) : `#${id}`;
  };

  return (
    <div className="py-6 space-y-4 animate-fade-in" dir="rtl">
      <h1 className="text-heading text-foreground">هشدارهای باروری</h1>

      <div className="rounded-xl bg-card border border-border p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div>
          <Label>وضعیت</Label>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">همه</SelectItem>
              {Object.entries(ALERT_STATUS_LABEL).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>دام</Label>
          <SearchableSelect options={cowOptions} value={cowId} onChange={setCowId} placeholder="همه دام‌ها" />
        </div>
        <div>
          <Label>از تاریخ</Label>
          <ShamsiDatePicker value={fromDate} onChange={setFromDate} placeholder="—" />
        </div>
        <div>
          <Label>تا تاریخ</Label>
          <ShamsiDatePicker value={toDate} onChange={setToDate} placeholder="—" />
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
      ) : alerts.length === 0 ? (
        <div className="rounded-xl bg-card border border-border p-8 text-center text-muted-foreground">
          هشداری با این فیلترها یافت نشد
        </div>
      ) : (
        <div className="space-y-3">
          {alerts.map((a) => {
            const op = ops.find((o) => o.id === a.fertility_operation_id);
            return (
              <div key={a.id} className="rounded-xl bg-card border border-border p-4">
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-body-lg font-bold text-foreground">{a.title}</h3>
                    <span className={statusBadge(a.status)}>{ALERT_STATUS_LABEL[a.status] || a.status}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">{cowName(a.cow_id)}</span>
                    {op && <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border">{op.name}</span>}
                  </div>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {new Date(a.alert_date).toLocaleDateString("fa-IR")}
                  </span>
                </div>
                {a.description && <p className="text-sm text-muted-foreground mt-2 leading-relaxed">{a.description}</p>}
                {a.status === "open" && (
                  <div className="flex gap-2 mt-3">
                    <Button size="sm" variant="outline" className="gap-1" onClick={() => updateStatus.mutate({ id: a.id, status: "done" })}>
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" /> انجام شد
                    </Button>
                    <Button size="sm" variant="outline" className="gap-1" onClick={() => updateStatus.mutate({ id: a.id, status: "cancelled" })}>
                      <XCircle className="w-4 h-4 text-destructive" /> لغو
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function statusBadge(s: string) {
  const base = "text-xs px-2 py-0.5 rounded-full border ";
  switch (s) {
    case "open": return base + "bg-amber-50 text-amber-700 border-amber-200";
    case "done": return base + "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "cancelled": return base + "bg-muted text-muted-foreground border-border";
    case "expired": return base + "bg-rose-50 text-rose-700 border-rose-200";
    default: return base + "bg-muted text-muted-foreground border-border";
  }
}
