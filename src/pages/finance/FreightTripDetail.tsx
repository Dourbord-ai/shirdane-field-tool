// ---------------------------------------------------------------------------
// Task 6 — Freight Trip detail page.
//
// Read-mostly view that shows:
//   - The trip header + status pill
//   - The allocation table (live recompute against stored inputs)
//   - Actions:
//       * "تخصیص و ثبت هزینه‌ها"  — runs allocator + materializes the
//         per-invoice factor_related_costs rows. Idempotent.
//       * "ویرایش"                — back to the editor page.
//       * "ثبت درخواست تسویه"     — ONLY entry point for freight_trip
//         settlement sources (per Task 6 revision). Implementation
//         delegates to a future helper; here it just bumps status and
//         shows a toast so the workflow is visible end-to-end.
//       * "لغو سرویس"             — soft-cancels + detaches everything.
//
// Lifecycle gates are enforced by disabling buttons rather than hiding
// them, so operators always see WHY an action isn't available.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { toast } from "sonner";
import { Pencil, PlayCircle, ReceiptText, XCircle, ArrowRight, ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";

import {
  allocateTrip,
  cancelTrip,
  FREIGHT_TRIP_STATUS_LABEL,
  getFreightTripWithInvoices,
  type FreightTrip,
  type FreightTripInvoice,
} from "@/lib/finance/freightTrips";
import { allocate } from "@/lib/finance/freightAllocation";
import FreightTripSettlementDialog from "@/components/finance/FreightTripSettlementDialog";

interface InvoiceLite {
  id: string;
  invoice_number: string | null;
  payable_amount: number | null;
  total_amount: number | null;
}

export default function FreightTripDetail() {
  const { id: tripId } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [trip, setTrip] = useState<FreightTrip | null>(null);
  const [links, setLinks] = useState<FreightTripInvoice[]>([]);
  const [invoices, setInvoices] = useState<Map<string, InvoiceLite>>(new Map());
  const [busy, setBusy] = useState(false);

  // Stable reload — used by every action so the table reflects post-action
  // state without us hand-merging diffs.
  const reload = useCallback(async () => {
    if (!tripId) return;
    const { trip, invoices: links } = await getFreightTripWithInvoices(tripId);
    setTrip(trip);
    setLinks(links);
    if (links.length) {
      const { data } = await supabase
        .from("factors")
        .select("id, invoice_number, payable_amount, total_amount")
        .in("id", links.map((l) => l.factor_id));
      setInvoices(new Map(((data as InvoiceLite[]) ?? []).map((f) => [f.id, f])));
    } else {
      setInvoices(new Map());
    }
  }, [tripId]);

  useEffect(() => { reload(); }, [reload]);

  if (!trip) return <div className="p-4 text-sm text-muted-foreground">در حال بارگیری...</div>;

  // Live preview computed off the stored link inputs. After "تخصیص" the
  // stored allocated_amount column will match this preview, but BEFORE
  // allocate this lets the operator see what will happen.
  const preview = allocate(
    trip.total_amount,
    trip.allocation_method,
    links.map((l) => ({
      key: l.id,
      cargo_weight_kg: l.cargo_weight_kg,
      invoice_payable_amount: Number(invoices.get(l.factor_id)?.payable_amount ?? invoices.get(l.factor_id)?.total_amount ?? 0),
      manual_share_amount: l.manual_share_amount,
    })),
  );

  // Lifecycle gates.
  const canEdit = trip.status === "draft" || trip.status === "allocated";
  const canAllocate = canEdit && links.length > 0;
  // Settlement create requires: allocated status, needs payment, has a
  // driver party, positive amount, AND no prior request is already linked.
  const canCreateSettlement =
    trip.status === "allocated" &&
    trip.payment_required &&
    !!trip.driver_party_id &&
    Number(trip.total_amount) > 0 &&
    !trip.settlement_request_id;
  // Once a request exists, expose the "view" action regardless of status
  // so operators can always navigate to it (even after settled/cancelled).
  const hasLinkedRequest = !!trip.settlement_request_id;
  const canCancel = trip.status !== "settled";

  const handleAllocate = async () => {
    if (!tripId) return;
    setBusy(true);
    try {
      const res = await allocateTrip(tripId);
      if (!res.ok) {
        toast.error(res.message || "تخصیص ناموفق بود");
      } else {
        toast.success("تخصیص انجام شد و هزینه‌های مرتبط ثبت گردید");
        await reload();
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Task 7 — open the settlement dialog. Actual RPC submission +
  // status flip happens inside submitFreightTripSettlement, which the
  // dialog calls. The manual `markTripSettlementCreated` shortcut from
  // Task 6 has been removed: status can only flip via real RPC success.
  const [settlementOpen, setSettlementOpen] = useState(false);
  const handleOpenSettlement = () => setSettlementOpen(true);
  const handleSettlementSubmitted = async (_requestId: string) => {
    // Reload so the link badge + view-request action appear and the
    // status pill flips to "درخواست تسویه ثبت شد".
    await reload();
  };

  // Navigate to the payment-requests tab. We don't deep-link to the
  // individual request because the existing UI is a tab-based list, not
  // a per-request route — operators filter by request title there.
  const handleViewRequest = () => navigate("/finance?tab=payment-requests");

  const handleCancel = async () => {
    if (!tripId) return;
    if (!confirm("از لغو این سرویس و حذف هزینه‌های مرتبط مطمئن هستید؟")) return;
    setBusy(true);
    try {
      await cancelTrip(tripId);
      toast.success("سرویس لغو شد");
      navigate("/finance/freight-trips");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-4 space-y-4">
      <header className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <Link to="/finance/freight-trips" className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
            <ArrowRight className="w-3.5 h-3.5" />
            بازگشت به لیست سرویس‌ها
          </Link>
          <h1 className="text-h1 font-bold mt-1 flex items-center gap-2">
            سرویس حمل {trip.trip_code || trip.id.slice(0, 8)}
            <Badge variant={trip.status === "cancelled" ? "destructive" : "secondary"}>
              {FREIGHT_TRIP_STATUS_LABEL[trip.status]}
            </Badge>
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" disabled={!canEdit} onClick={() => navigate(`/finance/freight-trips/${tripId}/edit`)}>
            <Pencil className="w-4 h-4 ml-1" />
            ویرایش
          </Button>
          <Button size="sm" disabled={!canAllocate || busy} onClick={handleAllocate}>
            <PlayCircle className="w-4 h-4 ml-1" />
            تخصیص و ثبت هزینه‌ها
          </Button>
          <Button size="sm" disabled={!canCreateSettlement || busy} onClick={handleOpenSettlement}>
            <ReceiptText className="w-4 h-4 ml-1" />
            ثبت درخواست تسویه کرایه سفر
          </Button>
          {hasLinkedRequest && (
            <Button size="sm" variant="outline" onClick={handleViewRequest}>
              <ExternalLink className="w-4 h-4 ml-1" />
              مشاهده درخواست تسویه
            </Button>
          )}
          <Button size="sm" variant="destructive" disabled={!canCancel || busy} onClick={handleCancel}>
            <XCircle className="w-4 h-4 ml-1" />
            لغو سرویس
          </Button>
        </div>
      </header>

      {/* Header info card */}
      <section className="rounded-lg border border-border p-3 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
        <KV label="تاریخ" value={new Date(trip.trip_date).toISOString().slice(0, 10)} />
        <KV label="پلاک" value={trip.vehicle_plate || "—"} />
        <KV label="نوع وسیله" value={trip.vehicle_type || "—"} />
        <KV label="مسیر" value={`${trip.origin_text || "—"} ← ${trip.destination_text || "—"}`} />
        <KV label="فاصله" value={trip.route_distance_km != null ? `${Number(trip.route_distance_km).toLocaleString("fa-IR")} کم` : "—"} />
        <KV label="مبلغ کل" value={`${Number(trip.total_amount).toLocaleString("fa-IR")} ریال`} />
        <KV label="روش تخصیص" value={trip.allocation_method === "by_weight" ? "وزنی" : trip.allocation_method === "manual" ? "دستی" : "مبلغی"} />
        <KV label="نیازمند پرداخت" value={trip.payment_required ? "بله" : "خیر"} />
        {trip.notes && <KV label="توضیح" value={trip.notes} />}
      </section>

      {/* Allocation table */}
      <section className="rounded-lg border border-border p-3 space-y-2">
        <h2 className="text-sm font-bold">جدول تخصیص ({links.length} فاکتور)</h2>
        {links.length === 0 ? (
          <p className="text-xs text-muted-foreground">هیچ فاکتوری متصل نیست.</p>
        ) : (
          <div className="rounded-md border border-border overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-muted/40">
                <tr>
                  <th className="p-2 text-right">شماره فاکتور</th>
                  <th className="p-2 text-right">مبلغ پرداختی</th>
                  <th className="p-2 text-right">وزن (کیلوگرم)</th>
                  <th className="p-2 text-right">درصد</th>
                  <th className="p-2 text-right">سهم ذخیره‌شده</th>
                  <th className="p-2 text-right">سهم پیش‌نمایش</th>
                </tr>
              </thead>
              <tbody>
                {links.map((l, i) => {
                  const r = preview.results[i];
                  const inv = invoices.get(l.factor_id);
                  return (
                    <tr key={l.id} className="border-t border-border">
                      <td className="p-2 font-mono">
                        <Link to={`/invoices`} className="hover:underline">
                          {inv?.invoice_number || l.factor_id.slice(0, 8)}
                        </Link>
                      </td>
                      <td className="p-2">{Number(inv?.payable_amount ?? inv?.total_amount ?? 0).toLocaleString("fa-IR")}</td>
                      <td className="p-2">{l.cargo_weight_kg != null ? Number(l.cargo_weight_kg).toLocaleString("fa-IR") : "—"}</td>
                      <td className="p-2">{r ? `${r.percentage.toLocaleString("fa-IR")}٪` : "—"}</td>
                      <td className="p-2 font-medium">{Number(l.allocated_amount).toLocaleString("fa-IR")} ریال</td>
                      <td className="p-2">{r ? r.allocated_amount.toLocaleString("fa-IR") : "—"} ریال</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="bg-muted/30">
                <tr>
                  <td colSpan={4} className="p-2 text-left font-bold">جمع</td>
                  <td className="p-2 font-bold">{links.reduce((a, l) => a + Number(l.allocated_amount || 0), 0).toLocaleString("fa-IR")} ریال</td>
                  <td className="p-2 font-bold">{preview.report.allocated.toLocaleString("fa-IR")} ریال</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        {preview.report.hasError && (
          <div className="text-xs rounded-md p-2 bg-destructive/10 border border-destructive/40 text-destructive">
            ⚠ {preview.report.errorMessage}
          </div>
        )}
      </section>

      {/* Task 7 — Freight Trip settlement dialog. Mounted unconditionally
          so it can fade out cleanly; visibility is driven by state. */}
      <FreightTripSettlementDialog
        open={settlementOpen}
        onOpenChange={setSettlementOpen}
        trip={trip}
        invoiceLinks={links}
        invoiceMap={invoices}
        onSubmitted={handleSettlementSubmitted}
      />
    </div>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground font-medium">{value}</span>
    </div>
  );
}
