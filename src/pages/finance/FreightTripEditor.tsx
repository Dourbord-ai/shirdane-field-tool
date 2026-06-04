// ---------------------------------------------------------------------------
// Task 6 — Freight Trip editor (new + edit).
//
// One page that:
//   1) Collects trip header (driver, vehicle, route, total, method)
//   2) Lets the operator pick invoices (search by number/party)
//   3) For each picked invoice, captures weight or manual share
//   4) Shows a LIVE allocation preview (weight • % • Rial)
//   5) On save:
//        - new   → createTripDraft → navigate to detail
//        - edit  → replaceTripInvoices + updateTripHeader → reload
//
// The detail page is where the operator clicks "تخصیص" to materialize the
// per-invoice cost rows; this page only stores the inputs.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Plus, Save, Trash2, Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";

import { PartySelector } from "@/components/finance/selectors";
import { allocate, ALLOCATION_METHOD_LABEL, type AllocationMethod } from "@/lib/finance/freightAllocation";
import {
  createTripDraft,
  getFreightTripWithInvoices,
  replaceTripInvoices,
  updateTripHeader,
  type FreightTripInvoiceDraft,
} from "@/lib/finance/freightTrips";

// Local row shape used by the picker — mirrors the columns we display.
interface PickerInvoice {
  id: string;
  invoice_number: string | null;
  invoice_date: string | null;
  payable_amount: number | null;
  total_amount: number | null;
  finance_party_id: string | null;
}

// What we hold for each invoice once the operator has added it to the trip.
interface DraftLink {
  factor_id: string;
  invoice_number: string | null;
  payable_amount: number;
  cargo_weight_kg: number | "";
  manual_share_amount: number | "";
}

export default function FreightTripEditor() {
  const { id: tripId } = useParams<{ id?: string }>();
  const editing = !!tripId;
  const navigate = useNavigate();

  // ------------------ trip header state ------------------
  const [trip_code, setTripCode] = useState<string>("");
  const [trip_date, setTripDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [driver_party_id, setDriverPartyId] = useState<string | null>(null);
  const [vehicle_plate, setVehiclePlate] = useState<string>("");
  const [vehicle_type, setVehicleType] = useState<string>("");
  const [origin_text, setOriginText] = useState<string>("");
  const [destination_text, setDestinationText] = useState<string>("");
  const [route_distance_km, setRouteDistanceKm] = useState<number | "">("");
  const [total_amount, setTotalAmount] = useState<number | "">("");
  const [allocation_method, setAllocationMethod] = useState<AllocationMethod>("by_weight");
  const [payment_required, setPaymentRequired] = useState<boolean>(true);
  const [notes, setNotes] = useState<string>("");

  // ------------------ link rows ------------------
  const [links, setLinks] = useState<DraftLink[]>([]);

  // ------------------ invoice picker ------------------
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const [pickerRows, setPickerRows] = useState<PickerInvoice[]>([]);

  // ------------------ initial load when editing ------------------
  useEffect(() => {
    if (!tripId) return;
    let cancelled = false;
    getFreightTripWithInvoices(tripId).then(async ({ trip, invoices }) => {
      if (cancelled) return;
      setTripCode(trip.trip_code ?? "");
      setTripDate(trip.trip_date.slice(0, 10));
      setDriverPartyId(trip.driver_party_id);
      setVehiclePlate(trip.vehicle_plate ?? "");
      setVehicleType(trip.vehicle_type ?? "");
      setOriginText(trip.origin_text ?? "");
      setDestinationText(trip.destination_text ?? "");
      setRouteDistanceKm(trip.route_distance_km ?? "");
      setTotalAmount(Number(trip.total_amount) || "");
      setAllocationMethod(trip.allocation_method);
      setPaymentRequired(trip.payment_required);
      setNotes(trip.notes ?? "");

      // Hydrate links with invoice numbers + payable amounts.
      if (invoices.length) {
        const factorIds = invoices.map((i) => i.factor_id);
        const { data: facs } = await supabase
          .from("factors")
          .select("id, invoice_number, payable_amount, total_amount")
          .in("id", factorIds);
        const byId = new Map(
          ((facs as { id: string; invoice_number: string | null; payable_amount: number | null; total_amount: number | null }[]) ?? [])
            .map((f) => [f.id, f]),
        );
        setLinks(
          invoices.map((l) => {
            const fac = byId.get(l.factor_id);
            return {
              factor_id: l.factor_id,
              invoice_number: fac?.invoice_number ?? null,
              payable_amount: Number(fac?.payable_amount ?? fac?.total_amount ?? 0),
              cargo_weight_kg: l.cargo_weight_kg ?? "",
              manual_share_amount: l.manual_share_amount ?? "",
            };
          }),
        );
      }
    });
    return () => { cancelled = true; };
  }, [tripId]);

  // ------------------ invoice picker fetch ------------------
  useEffect(() => {
    if (!pickerOpen) return;
    let cancelled = false;
    const q = pickerQuery.trim();
    let query = supabase
      .from("factors")
      .select("id, invoice_number, invoice_date, payable_amount, total_amount, finance_party_id")
      .eq("is_deleted", false)
      .order("invoice_date", { ascending: false })
      .limit(50);
    if (q) {
      // Match invoice number (most common search). Could be extended later
      // to also search by party name via a join.
      query = query.ilike("invoice_number", `%${q}%`);
    }
    query.then(({ data }) => {
      if (!cancelled) setPickerRows((data as PickerInvoice[]) ?? []);
    });
    return () => { cancelled = true; };
  }, [pickerOpen, pickerQuery]);

  // ------------------ live allocation preview ------------------
  const preview = useMemo(() => {
    return allocate(
      Number(total_amount) || 0,
      allocation_method,
      links.map((l) => ({
        key: l.factor_id,
        cargo_weight_kg: l.cargo_weight_kg === "" ? 0 : Number(l.cargo_weight_kg),
        invoice_payable_amount: l.payable_amount,
        manual_share_amount: l.manual_share_amount === "" ? 0 : Number(l.manual_share_amount),
      })),
    );
  }, [total_amount, allocation_method, links]);

  // ------------------ handlers ------------------
  const addInvoice = (inv: PickerInvoice) => {
    if (links.find((l) => l.factor_id === inv.id)) {
      toast.error("این فاکتور قبلاً اضافه شده است");
      return;
    }
    setLinks((arr) => [
      ...arr,
      {
        factor_id: inv.id,
        invoice_number: inv.invoice_number,
        payable_amount: Number(inv.payable_amount ?? inv.total_amount ?? 0),
        cargo_weight_kg: "",
        manual_share_amount: "",
      },
    ]);
    setPickerOpen(false);
    setPickerQuery("");
  };

  const removeInvoice = (factor_id: string) => {
    setLinks((arr) => arr.filter((l) => l.factor_id !== factor_id));
  };

  const handleSave = async () => {
    if (!driver_party_id) return toast.error("راننده را انتخاب کنید");
    if (!total_amount || Number(total_amount) <= 0) return toast.error("مبلغ کل باید بزرگ‌تر از صفر باشد");
    if (links.length === 0) return toast.error("حداقل یک فاکتور انتخاب کنید");

    const draft = {
      trip_code: trip_code || null,
      trip_date: new Date(trip_date).toISOString(),
      driver_party_id,
      vehicle_plate: vehicle_plate || null,
      vehicle_type: vehicle_type || null,
      origin_location_id: null,
      destination_location_id: null,
      origin_text: origin_text || null,
      destination_text: destination_text || null,
      route_distance_km: route_distance_km === "" ? null : Number(route_distance_km),
      total_amount: Number(total_amount),
      allocation_method,
      payment_required,
      notes: notes || null,
    };

    const invoiceDrafts: FreightTripInvoiceDraft[] = links.map((l) => ({
      factor_id: l.factor_id,
      cargo_weight_kg: l.cargo_weight_kg === "" ? null : Number(l.cargo_weight_kg),
      manual_share_amount: l.manual_share_amount === "" ? null : Number(l.manual_share_amount),
    }));

    try {
      if (editing && tripId) {
        await updateTripHeader(tripId, draft);
        await replaceTripInvoices(tripId, invoiceDrafts);
        toast.success("سرویس به‌روزرسانی شد");
        navigate(`/finance/freight-trips/${tripId}`);
      } else {
        const newId = await createTripDraft(draft, invoiceDrafts);
        toast.success("سرویس ایجاد شد");
        navigate(`/finance/freight-trips/${newId}`);
      }
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="p-4 space-y-4">
      <header className="flex items-center justify-between">
        <h1 className="text-h1 font-bold">{editing ? "ویرایش سرویس حمل" : "سرویس حمل جدید"}</h1>
        <Button onClick={handleSave}>
          <Save className="w-4 h-4 ml-1" />
          ذخیره
        </Button>
      </header>

      {/* ============== Header section ============== */}
      <section className="rounded-lg border border-border p-3 space-y-3">
        <h2 className="text-sm font-bold">اطلاعات سرویس</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <Label>کد سرویس</Label>
            <Input value={trip_code} onChange={(e) => setTripCode(e.target.value)} placeholder="مثلاً T-1404-0007" />
          </div>
          <div>
            <Label>تاریخ سرویس</Label>
            <Input type="date" value={trip_date} onChange={(e) => setTripDate(e.target.value)} />
          </div>
          <div>
            <Label>راننده <span className="text-destructive">*</span></Label>
            <PartySelector value={driver_party_id} onChange={(id) => setDriverPartyId(id)} placeholder="انتخاب راننده" />
          </div>
          <div>
            <Label>پلاک</Label>
            <Input value={vehicle_plate} onChange={(e) => setVehiclePlate(e.target.value)} />
          </div>
          <div>
            <Label>نوع وسیله</Label>
            <Input value={vehicle_type} onChange={(e) => setVehicleType(e.target.value)} placeholder="کامیون / نیسان / ..." />
          </div>
          <div>
            <Label>فاصله مسیر (کم)</Label>
            <Input type="number" inputMode="numeric" value={route_distance_km} onChange={(e) => setRouteDistanceKm(e.target.value === "" ? "" : Number(e.target.value))} />
          </div>
          <div>
            <Label>مبدأ</Label>
            <Input value={origin_text} onChange={(e) => setOriginText(e.target.value)} placeholder="مثلاً شیراز" />
          </div>
          <div>
            <Label>مقصد</Label>
            <Input value={destination_text} onChange={(e) => setDestinationText(e.target.value)} placeholder="مثلاً سعادت‌شهر" />
          </div>
          <div>
            <Label>مبلغ کل (ریال) <span className="text-destructive">*</span></Label>
            <Input type="number" inputMode="numeric" value={total_amount} onChange={(e) => setTotalAmount(e.target.value === "" ? "" : Number(e.target.value))} />
          </div>
        </div>

        <div>
          <Label>توضیح</Label>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </div>

        <div className="flex items-start justify-between gap-3 rounded-lg border border-border p-3">
          <div>
            <p className="text-sm font-medium">نیازمند پرداخت به راننده</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {payment_required
                ? "یک تعهد تسویه برای کل مبلغ سرویس ایجاد می‌شود."
                : "فقط در هزینه تمام‌شده فاکتورها اعمال می‌شود، تسویه‌ای ایجاد نمی‌گردد."}
            </p>
          </div>
          <Switch checked={payment_required} onCheckedChange={setPaymentRequired} />
        </div>
      </section>

      {/* ============== Allocation method ============== */}
      <section className="rounded-lg border border-border p-3 space-y-2">
        <h2 className="text-sm font-bold">روش تخصیص</h2>
        <div className="flex flex-wrap gap-2">
          {(["by_weight", "by_invoice_amount", "manual"] as AllocationMethod[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setAllocationMethod(m)}
              className={`px-3 py-1.5 rounded-md border text-xs transition-colors ${
                allocation_method === m
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background border-border text-foreground hover:bg-secondary"
              }`}
            >
              {ALLOCATION_METHOD_LABEL[m]}
            </button>
          ))}
        </div>
      </section>

      {/* ============== Invoices + preview ============== */}
      <section className="rounded-lg border border-border p-3 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold">فاکتورهای مرتبط ({links.length})</h2>
          <Button variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
            <Plus className="w-4 h-4 ml-1" />
            افزودن فاکتور
          </Button>
        </div>

        {links.length === 0 ? (
          <p className="text-xs text-muted-foreground">هیچ فاکتوری انتخاب نشده.</p>
        ) : (
          <div className="rounded-md border border-border overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-muted/40">
                <tr>
                  <th className="p-2 text-right">شماره فاکتور</th>
                  <th className="p-2 text-right">مبلغ پرداختی</th>
                  <th className="p-2 text-right">وزن (کیلوگرم)</th>
                  {allocation_method === "manual" && <th className="p-2 text-right">سهم دستی (ریال)</th>}
                  <th className="p-2 text-right">درصد</th>
                  <th className="p-2 text-right">سهم تخصیصی</th>
                  <th className="p-2"></th>
                </tr>
              </thead>
              <tbody>
                {links.map((l, i) => {
                  const r = preview.results[i];
                  return (
                    <tr key={l.factor_id} className="border-t border-border">
                      <td className="p-2 font-mono">{l.invoice_number || "—"}</td>
                      <td className="p-2">{l.payable_amount.toLocaleString("fa-IR")}</td>
                      <td className="p-2">
                        <Input
                          type="number"
                          inputMode="numeric"
                          value={l.cargo_weight_kg}
                          onChange={(e) => {
                            const v = e.target.value === "" ? "" : Number(e.target.value);
                            setLinks((arr) => arr.map((x) => (x.factor_id === l.factor_id ? { ...x, cargo_weight_kg: v } : x)));
                          }}
                          className="h-8 text-xs"
                          disabled={allocation_method !== "by_weight"}
                        />
                      </td>
                      {allocation_method === "manual" && (
                        <td className="p-2">
                          <Input
                            type="number"
                            inputMode="numeric"
                            value={l.manual_share_amount}
                            onChange={(e) => {
                              const v = e.target.value === "" ? "" : Number(e.target.value);
                              setLinks((arr) => arr.map((x) => (x.factor_id === l.factor_id ? { ...x, manual_share_amount: v } : x)));
                            }}
                            className="h-8 text-xs"
                          />
                        </td>
                      )}
                      <td className="p-2 font-medium">{r ? `${r.percentage.toLocaleString("fa-IR")}٪` : "—"}</td>
                      <td className="p-2 font-medium">{r ? r.allocated_amount.toLocaleString("fa-IR") : "—"} ریال</td>
                      <td className="p-2 text-left">
                        <button
                          onClick={() => removeInvoice(l.factor_id)}
                          className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="bg-muted/30 text-xs">
                <tr>
                  <td colSpan={allocation_method === "manual" ? 5 : 4} className="p-2 text-left font-bold">جمع</td>
                  <td className="p-2 font-bold">{preview.report.allocated.toLocaleString("fa-IR")} ریال</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {/* Status strip — green when sum matches total, amber otherwise. */}
        {links.length > 0 && (
          <div className={`text-xs rounded-md p-2 border ${
            preview.report.hasError
              ? "bg-destructive/10 border-destructive/40 text-destructive"
              : "bg-primary/10 border-primary/30 text-primary"
          }`}>
            {preview.report.hasError
              ? `⚠ ${preview.report.errorMessage}`
              : `✓ تخصیص دقیق — مجموع برابر با مبلغ کل (${preview.report.total.toLocaleString("fa-IR")} ریال)`}
          </div>
        )}
      </section>

      {/* ============== Invoice picker modal ============== */}
      {pickerOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setPickerOpen(false)}>
          <div className="bg-card rounded-xl border shadow-lg w-full max-w-lg max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="p-3 border-b border-border flex items-center justify-between">
              <h3 className="font-bold">انتخاب فاکتور</h3>
              <button onClick={() => setPickerOpen(false)}><X className="w-5 h-5" /></button>
            </div>
            <div className="p-3 border-b border-border">
              <div className="flex items-center gap-2">
                <Search className="w-4 h-4 text-muted-foreground" />
                <Input value={pickerQuery} onChange={(e) => setPickerQuery(e.target.value)} placeholder="جستجو با شماره فاکتور" autoFocus />
              </div>
            </div>
            <div className="overflow-y-auto p-2 flex-1">
              {pickerRows.length === 0 ? (
                <p className="text-xs text-muted-foreground p-3">موردی یافت نشد.</p>
              ) : (
                pickerRows.map((inv) => (
                  <button
                    key={inv.id}
                    className="w-full text-right p-2 hover:bg-secondary rounded-md flex items-center justify-between"
                    onClick={() => addInvoice(inv)}
                  >
                    <span className="font-mono text-xs">{inv.invoice_number || inv.id.slice(0, 8)}</span>
                    <span className="text-xs text-muted-foreground">
                      {inv.invoice_date?.slice(0, 10)} · {Number(inv.payable_amount ?? inv.total_amount ?? 0).toLocaleString("fa-IR")} ریال
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
