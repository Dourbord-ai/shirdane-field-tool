import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";

interface Props {
  cowId: number;
  table: "cow_types" | "cow_statuses" | "cow_locations" | "cow_syncs";
  refColumn: "type_id" | "status_id" | "location_id" | "sync_type_id";
  refTable: "livestock_types" | "livestock_statuses" | "livestock_locations" | "sync_types";
  emptyText?: string;
}

export default function CowHistoryTab({ cowId, table, refColumn, refTable, emptyText }: Props) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data } = await (supabase as any)
        .from(table)
        .select(`id, event_date, created_at, ${refColumn}, ref:${refTable}(name)`)
        .eq("cow_id", cowId)
        .eq("is_deleted", false)
        .order("event_date", { ascending: false })
        .limit(500);
      setRows(data ?? []);
      setLoading(false);
    })();
  }, [cowId, table, refColumn, refTable]);

  if (loading) {
    return (
      <div className="flex justify-center py-8 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    );
  }
  if (rows.length === 0) {
    return <p className="text-center text-sm text-muted-foreground py-6">{emptyText ?? "رکوردی ثبت نشده است"}</p>;
  }
  return (
    <ol className="relative border-r border-border pr-4 space-y-3">
      {rows.map((r) => (
        <li key={r.id} className="relative">
          <span className="absolute -right-[21px] top-1.5 w-2.5 h-2.5 rounded-full bg-primary" />
          <div className="text-sm">
            <p className="font-medium text-foreground">{r.ref?.name ?? "—"}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              تاریخ: {r.event_date ?? new Date(r.created_at).toLocaleDateString("fa-IR")}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
