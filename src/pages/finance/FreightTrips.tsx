// ---------------------------------------------------------------------------
// Task 6 — Freight Trips list page.
//
// Read-only overview of all non-deleted trips with their status, driver,
// route, total amount, and link count. New trips are created via the
// "+ سرویس جدید" button which routes to the editor page.
// ---------------------------------------------------------------------------

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Truck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  listFreightTrips,
  FREIGHT_TRIP_STATUS_LABEL,
  type FreightTrip,
  type FreightTripStatus,
} from "@/lib/finance/freightTrips";

// Small helper — variant per status keeps the status pill visually distinct
// without us redefining the badge color palette.
const STATUS_VARIANT: Record<FreightTripStatus, "default" | "secondary" | "outline" | "destructive"> = {
  draft: "outline",
  allocated: "secondary",
  settlement_created: "default",
  settled: "default",
  cancelled: "destructive",
};

export default function FreightTrips() {
  const [trips, setTrips] = useState<FreightTrip[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listFreightTrips()
      .then((rows) => { if (!cancelled) setTrips(rows); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="p-4 space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-h1 font-bold text-foreground flex items-center gap-2">
            <Truck className="w-5 h-5" />
            سرویس‌های حمل چندفاکتوری
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            یک کرایه حمل، چند فاکتور — تخصیص خودکار سهم هر فاکتور
          </p>
        </div>
        <Link to="/finance/freight-trips/new">
          <Button>
            <Plus className="w-4 h-4 ml-1" />
            سرویس جدید
          </Button>
        </Link>
      </header>

      {loading ? (
        <p className="text-sm text-muted-foreground">در حال بارگیری...</p>
      ) : trips.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          هنوز سرویس حملی ثبت نشده است.
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs">
              <tr>
                <th className="p-2 text-right">کد</th>
                <th className="p-2 text-right">تاریخ</th>
                <th className="p-2 text-right">مسیر</th>
                <th className="p-2 text-right">مبلغ کل</th>
                <th className="p-2 text-right">روش تخصیص</th>
                <th className="p-2 text-right">وضعیت</th>
                <th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {trips.map((t) => (
                <tr key={t.id} className="border-t border-border hover:bg-muted/20">
                  <td className="p-2 font-mono text-xs">{t.trip_code || "—"}</td>
                  <td className="p-2 text-xs">{new Date(t.trip_date).toISOString().slice(0, 10)}</td>
                  <td className="p-2 text-xs text-muted-foreground">
                    {(t.origin_text || "—") + " ← " + (t.destination_text || "—")}
                    {t.route_distance_km != null && (
                      <span> · {Number(t.route_distance_km).toLocaleString("fa-IR")} کم</span>
                    )}
                  </td>
                  <td className="p-2">{Number(t.total_amount).toLocaleString("fa-IR")} ریال</td>
                  <td className="p-2 text-xs">
                    {t.allocation_method === "by_weight"
                      ? "وزنی"
                      : t.allocation_method === "manual"
                      ? "دستی"
                      : "مبلغی"}
                  </td>
                  <td className="p-2">
                    <Badge variant={STATUS_VARIANT[t.status]}>
                      {FREIGHT_TRIP_STATUS_LABEL[t.status]}
                    </Badge>
                  </td>
                  <td className="p-2 text-left">
                    <Link to={`/finance/freight-trips/${t.id}`}>
                      <Button variant="ghost" size="sm">جزئیات</Button>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
