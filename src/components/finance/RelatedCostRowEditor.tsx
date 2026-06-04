// ---------------------------------------------------------------------------
// Phase 7 — Related-cost row editor dialog.
//
// One row at a time: add or edit. Reuses the existing PartySelector so the
// counterparty/driver/provider comes from the same finance_parties table
// the rest of the app uses (party_id stays the source of truth). When the
// operator can't find a party, a "ایجاد راننده جدید" shortcut opens a tiny
// inline dialog that creates a minimal finance_parties row — we do NOT
// create a separate driver table.
//
// Task 4 addition — for FREIGHT rows only, an «اطلاعات مسیر» section is
// rendered with origin/destination (FK to geo_locations + optional custom
// text override), distance/duration, source flag, vehicle type, cargo
// weight, and a disabled "محاسبه با مسیریاب" button reserved for the future
// routing-API integration. Origin and destination are HARD-REQUIRED for
// freight; the form blocks save until both are set.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, Save, X, MapPin, Route as RouteIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import { supabase } from "@/integrations/supabase/client";
import { PartySelector } from "@/components/finance/selectors";
import {
  COST_CATEGORIES,
  COST_CATEGORY_LABEL,
  COST_TYPES_BY_CATEGORY,
  COST_TYPE_LABEL,
  type CostCategory,
  type RelatedCost,
  type RelatedCostInput,
  upsertRelatedCost,
} from "@/lib/finance/relatedCosts";
import {
  createGeoLocation,
  listGeoLocations,
  type GeoLocation,
} from "@/lib/finance/geoLocations";
// Task 5 — informational freight metrics. Pure client-side derivation; we
// import only the calculator + the standardized fallback string so this
// component never holds its own copy of the formula.
import {
  computeFreightMetrics,
  formatPerUnit,
  INSUFFICIENT_FREIGHT_DATA,
} from "@/lib/finance/freightMetrics";

// ---------------------------------------------------------------------------
// Component props
// ---------------------------------------------------------------------------

interface Props {
  /**
   * In "db" mode (default) the editor writes directly to factor_related_costs
   * on save — used by the post-save RelatedCostsSection.
   *
   * In "draft" mode it skips the DB call and instead emits the assembled
   * RelatedCostInput via `onDraftSave` so the parent (MixedInvoiceForm) can
   * hold the row in local state until the parent factor is saved. The
   * `factorId` in draft mode is intentionally a sentinel ("__draft__") and
   * is replaced with the real id at batch-insert time.
   */
  mode?: "db" | "draft";
  factorId: string;
  /** When editing an existing row, pass it here. Add-mode if undefined. */
  initial?: RelatedCost;
  /** Seed values for the quick-add buttons (e.g. {category: "freight", type:"driver"}). */
  seed?: { cost_category?: CostCategory; cost_type?: string };
  onClose: () => void;
  /** Fired in db-mode after a successful upsert. */
  onSaved?: () => void;
  /** Fired in draft-mode with the assembled input payload (no DB call). */
  onDraftSave?: (input: RelatedCostInput) => void;
}

// Minimal driver-create payload — kept small on purpose; the operator can
// open the full Parties tab to fill out the rest later.
interface QuickDriverInput {
  first_name: string;
  last_name: string;
  national_code: string;
  mobile: string;
}

const EMPTY_DRIVER: QuickDriverInput = {
  first_name: "",
  last_name: "",
  national_code: "",
  mobile: "",
};

export default function RelatedCostRowEditor({ mode = "db", factorId, initial, seed, onClose, onSaved, onDraftSave }: Props) {
  // -------------------------------------------------------------------------
  // Form state — initialized from the row when editing, or from the seed
  // when adding. We keep the state shape close to RelatedCostInput so the
  // submit handler is a single Object.spread.
  // -------------------------------------------------------------------------
  const [cost_category, setCategory] = useState<CostCategory>(
    initial?.cost_category ?? seed?.cost_category ?? "misc",
  );
  const [cost_type, setType] = useState<string>(
    initial?.cost_type ?? seed?.cost_type ?? COST_TYPES_BY_CATEGORY[cost_category][0] ?? "misc",
  );
  const [amount, setAmount] = useState<number>(initial?.amount ?? 0);
  const [party_id, setPartyId] = useState<string | null>(initial?.party_id ?? null);
  const [description, setDescription] = useState<string>(initial?.description ?? "");
  const [source_document_number, setDoc] = useState<string>(initial?.source_document_number ?? "");
  const [payment_required, setPaymentRequired] = useState<boolean>(initial?.payment_required ?? true);
  const [attachment_path, setAttachment] = useState<string>(initial?.attachment_path ?? "");
  const [vehicle_plate, setPlate] = useState<string>(initial?.vehicle_plate ?? "");
  const [driver_name, setDriverName] = useState<string>(initial?.driver_name ?? "");
  // cost_date as a string (YYYY-MM-DDTHH:mm) for the datetime-local input.
  // PG accepts ISO via supabase-js. When editing, slice the timestamptz.
  const [cost_date, setCostDate] = useState<string>(
    initial?.cost_date ? initial.cost_date.slice(0, 16) : new Date().toISOString().slice(0, 16),
  );

  // ---------- Task 4 — freight route state ----------
  // Each value defaults from the initial row (edit mode) or stays empty.
  // We keep them in independent state slices rather than a single object
  // so individual inputs re-render cheaply.
  const [origin_location_id, setOriginLocationId] = useState<string | null>(initial?.origin_location_id ?? null);
  const [destination_location_id, setDestinationLocationId] = useState<string | null>(initial?.destination_location_id ?? null);
  const [origin_text, setOriginText] = useState<string>(initial?.origin_text ?? "");
  const [destination_text, setDestinationText] = useState<string>(initial?.destination_text ?? "");
  const [route_distance_km, setRouteDistanceKm] = useState<number | "">(
    initial?.route_distance_km ?? "",
  );
  const [route_duration_minutes, setRouteDurationMinutes] = useState<number | "">(
    initial?.route_duration_minutes ?? "",
  );
  // route_source defaults to "manual" for new freight rows so the dashboard
  // can later distinguish operator-typed numbers from estimates/API results.
  const [route_source, setRouteSource] = useState<"manual" | "estimated" | "api">(
    (initial?.route_source as "manual" | "estimated" | "api" | null) ?? "manual",
  );
  const [route_note, setRouteNote] = useState<string>(initial?.route_note ?? "");
  const [vehicle_type, setVehicleType] = useState<string>(initial?.vehicle_type ?? "");
  const [cargo_weight, setCargoWeight] = useState<number | "">(initial?.cargo_weight ?? "");

  // ---------- Geo-location dictionary ----------
  // We fetch once when the dialog mounts. List is short (a handful of
  // locations) so a single fetch is fine. Loading state lets us disable
  // the dropdowns until data arrives, avoiding a flash of "no options".
  const [geoLocations, setGeoLocations] = useState<GeoLocation[]>([]);
  const [geoLoading, setGeoLoading] = useState(false);
  // Quick-create sub-dialog state for new geo_locations. Same UX pattern as
  // the existing driver quick-create — minimal name/province/city.
  const [geoCreateFor, setGeoCreateFor] = useState<"origin" | "destination" | null>(null);
  const [geoDraftName, setGeoDraftName] = useState("");
  const [geoDraftProvince, setGeoDraftProvince] = useState("");
  const [geoDraftCity, setGeoDraftCity] = useState("");
  const [creatingGeo, setCreatingGeo] = useState(false);

  // -------------------------------------------------------------------------
  // Quick-create driver dialog state
  // -------------------------------------------------------------------------
  const [driverOpen, setDriverOpen] = useState(false);
  const [driverDraft, setDriverDraft] = useState<QuickDriverInput>(EMPTY_DRIVER);
  const [creatingDriver, setCreatingDriver] = useState(false);

  // Keep cost_type valid when the operator switches category — if the
  // current type isn't a known sub-type of the new category, reset it.
  useEffect(() => {
    const allowed = COST_TYPES_BY_CATEGORY[cost_category];
    if (!allowed.includes(cost_type)) setType(allowed[0] ?? "misc");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cost_category]);

  // The freight-only fields are conditionally shown to keep the form short
  // for the (much more common) non-freight rows.
  const showFreightFields = cost_category === "freight";

  // Only fetch geo_locations when we actually need them — i.e. the operator
  // is on a freight row. Avoids a wasted network call for the 80% case.
  useEffect(() => {
    if (!showFreightFields) return;
    let cancelled = false;
    setGeoLoading(true);
    listGeoLocations()
      .then((rows) => { if (!cancelled) setGeoLocations(rows); })
      .catch((e) => {
        if (!cancelled) toast.error(e instanceof Error ? e.message : "خطا در بارگذاری مکان‌ها");
      })
      .finally(() => { if (!cancelled) setGeoLoading(false); });
    return () => { cancelled = true; };
  }, [showFreightFields]);

  // Memoize the options so the <select> doesn't re-create option nodes
  // on every keystroke in other fields.
  const geoOptions = useMemo(
    () => geoLocations.map((g) => ({
      value: g.id,
      // Build a compact label: "name — city, province" with parts omitted gracefully.
      label: [g.name, [g.city, g.province].filter(Boolean).join("، ")].filter(Boolean).join(" — "),
    })),
    [geoLocations],
  );

  const [saving, setSaving] = useState(false);

  // -------------------------------------------------------------------------
  // Quick-create geo_location handler. Used by the «+ افزودن» button next to
  // each of the origin/destination dropdowns. After insert we append the new
  // row to local state and auto-select it for the role that triggered it.
  // -------------------------------------------------------------------------
  async function createGeo() {
    if (creatingGeo || !geoCreateFor) return;
    const name = geoDraftName.trim();
    if (!name) return toast.error("نام مکان لازم است");
    setCreatingGeo(true);
    try {
      const row = await createGeoLocation({
        name,
        province: geoDraftProvince || null,
        city: geoDraftCity || null,
      });
      // Insert into local list (sorted by name for visual consistency with list endpoint).
      setGeoLocations((prev) => [...prev, row].sort((a, b) => a.name.localeCompare(b.name, "fa")));
      // Auto-select for the side that opened the dialog.
      if (geoCreateFor === "origin") setOriginLocationId(row.id);
      else setDestinationLocationId(row.id);
      // Reset + close.
      setGeoDraftName("");
      setGeoDraftProvince("");
      setGeoDraftCity("");
      setGeoCreateFor(null);
      toast.success("مکان ثبت شد");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "خطا در ایجاد مکان");
    } finally {
      setCreatingGeo(false);
    }
  }

  async function handleSave() {
    if (saving) return;
    if (!amount || amount <= 0) return toast.error("مبلغ باید بزرگ‌تر از صفر باشد");

    // Task 4 — hard validation for freight rows: origin AND destination are
    // ALWAYS required (regardless of whether a waybill exists). Custom text
    // overrides do NOT substitute for the FK — operators must pick (or
    // create) a real geo_location so future analytics can aggregate routes.
    if (showFreightFields) {
      if (!origin_location_id) return toast.error("برای هزینه حمل، انتخاب مبدأ الزامی است");
      if (!destination_location_id) return toast.error("برای هزینه حمل، انتخاب مقصد الزامی است");
      // Distance, when provided, must be positive — a 0 km route is nonsense.
      if (route_distance_km !== "" && Number(route_distance_km) <= 0) {
        return toast.error("فاصله باید بزرگ‌تر از صفر باشد");
      }
      // Duration, when provided, must be positive integer.
      if (route_duration_minutes !== "" && Number(route_duration_minutes) <= 0) {
        return toast.error("مدت تقریبی باید بزرگ‌تر از صفر باشد");
      }
      // Cargo weight, when provided, must be positive.
      if (cargo_weight !== "" && Number(cargo_weight) <= 0) {
        return toast.error("وزن بار باید بزرگ‌تر از صفر باشد");
      }
      // route_source = "api" is blocked client-side — the radio is disabled,
      // but we double-check here in case state was mutated some other way.
      if (route_source === "api") {
        return toast.error("منبع API هنوز فعال نیست");
      }
    }

    setSaving(true);
    try {
      // Build the input payload — identical shape for db + draft modes so the
      // draft can be replayed unchanged into `insertManyRelatedCosts` after
      // the parent factor lands.
      // For non-freight rows we explicitly NULL every route field so a
      // category switch (freight → misc, say) doesn't leave stale values
      // hanging around.
      const payload: RelatedCostInput = {
        id: initial?.id,
        factor_id: factorId,
        cost_category,
        cost_type,
        amount: Number(amount),
        party_id: party_id || null,
        description: description || null,
        source_document_number: source_document_number || null,
        payment_required,
        attachment_path: attachment_path || null,
        vehicle_plate: showFreightFields ? (vehicle_plate || null) : null,
        driver_name: showFreightFields ? (driver_name || null) : null,
        cost_date: new Date(cost_date).toISOString(),

        // ---- Task 4 freight route fields ----
        origin_location_id: showFreightFields ? origin_location_id : null,
        destination_location_id: showFreightFields ? destination_location_id : null,
        origin_text: showFreightFields ? (origin_text || null) : null,
        destination_text: showFreightFields ? (destination_text || null) : null,
        route_distance_km: showFreightFields && route_distance_km !== ""
          ? Number(route_distance_km)
          : null,
        route_duration_minutes: showFreightFields && route_duration_minutes !== ""
          ? Number(route_duration_minutes)
          : null,
        route_source: showFreightFields ? route_source : null,
        route_note: showFreightFields ? (route_note || null) : null,
        // API-related provenance is left null today; populated in a later phase
        // when the real routing service is wired up.
        route_api_provider: null,
        route_api_response: null,
        route_checked_at: null,
        route_checked_by: null,
        vehicle_type: showFreightFields ? (vehicle_type || null) : null,
        cargo_weight: showFreightFields && cargo_weight !== ""
          ? Number(cargo_weight)
          : null,
      };

      if (mode === "draft") {
        // Draft path: hand the assembled payload back to the parent. The
        // parent decides when (and if) it ever reaches the DB.
        onDraftSave?.(payload);
        toast.success(initial ? "هزینه به‌روزرسانی شد" : "هزینه به فاکتور اضافه شد");
        onClose();
        return;
      }

      await upsertRelatedCost(payload);
      toast.success(initial ? "هزینه ویرایش شد" : "هزینه ثبت شد");
      onSaved?.();
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "خطا در ذخیره";
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  // -------------------------------------------------------------------------
  // Quick driver create — minimal finance_parties insert mirroring the
  // pattern used by PartiesTab.save() (pending_approval / not_synced).
  // We deliberately do NOT bring up the full PartiesTab dialog here to keep
  // the flow inside the cost editor; the operator can edit the new party
  // later from the Parties tab for full Sepidar / KYC fields.
  // -------------------------------------------------------------------------
  async function createDriver() {
    if (creatingDriver) return;
    const { first_name, last_name, national_code, mobile } = driverDraft;
    if (!first_name && !last_name) return toast.error("نام راننده را وارد کنید");
    setCreatingDriver(true);
    try {
      const { data, error } = await supabase
        .from("finance_parties")
        .insert({
          ownership_type: "individual",
          nationality: "iranian",
          first_name: first_name || null,
          last_name: last_name || null,
          national_code: national_code || null,
          mobile: mobile || null,
          status: "active",
          approval_status: "pending_approval",
          sepidar_sync_status: "not_synced",
          // We reuse `description` to mark this party as a driver origin;
          // no separate party kind exists, so this is the lightest tag.
          description: "ایجادشده از مسیر هزینه حمل فاکتور",
        })
        .select("id")
        .single();
      if (error) throw error;
      const newId = (data as { id: string }).id;
      setPartyId(newId);
      // Reflect the typed name as the convenience driver_name field too,
      // so the cost row reads nicely even before the party is reloaded.
      const full = [first_name, last_name].filter(Boolean).join(" ").trim();
      if (full) setDriverName(full);
      setDriverOpen(false);
      setDriverDraft(EMPTY_DRIVER);
      toast.success("راننده ثبت شد — در انتظار تایید");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "خطا در ایجاد راننده";
      toast.error(msg);
    } finally {
      setCreatingDriver(false);
    }
  }

  // -------------------------------------------------------------------------
  // Render — modal-style dialog. Keeps the form on a single scrollable card
  // so it works on both desktop and mobile (the tab already lives inside
  // an RTL layout, so we don't need to set dir here).
  // -------------------------------------------------------------------------
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-card rounded-xl border shadow-lg w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h3 className="font-bold text-foreground">
            {initial ? "ویرایش هزینه وابسته" : "افزودن هزینه وابسته"}
          </h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          {/* Category + Type — paired dropdowns. */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>دسته</Label>
              <select
                value={cost_category}
                onChange={(e) => setCategory(e.target.value as CostCategory)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {COST_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{COST_CATEGORY_LABEL[c]}</option>
                ))}
              </select>
            </div>
            <div>
              <Label>نوع</Label>
              <select
                value={cost_type}
                onChange={(e) => setType(e.target.value)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {COST_TYPES_BY_CATEGORY[cost_category].map((t) => (
                  <option key={t} value={t}>{COST_TYPE_LABEL[t] ?? t}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Amount + cost date */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>مبلغ (ریال)</Label>
              <Input
                type="number"
                inputMode="numeric"
                value={amount || ""}
                onChange={(e) => setAmount(Number(e.target.value))}
              />
            </div>
            <div>
              <Label>تاریخ هزینه</Label>
              <Input
                type="datetime-local"
                value={cost_date}
                onChange={(e) => setCostDate(e.target.value)}
              />
            </div>
          </div>

          {/* Party — single source of truth for who gets paid */}
          <div>
            <Label>طرف‌حساب</Label>
            <PartySelector value={party_id} onChange={(id) => setPartyId(id)} />
            <div className="mt-1 flex items-center justify-end">
              <button
                type="button"
                onClick={() => setDriverOpen(true)}
                className="text-xs text-primary hover:underline"
              >
                + ایجاد راننده جدید
              </button>
            </div>
          </div>

          {/* Document + description */}
          <div>
            <Label>شماره سند / بارنامه</Label>
            <Input value={source_document_number} onChange={(e) => setDoc(e.target.value)} />
          </div>

          <div>
            <Label>توضیحات</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>

          {/* Freight-only fields */}
          {showFreightFields && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>پلاک خودرو</Label>
                <Input value={vehicle_plate} onChange={(e) => setPlate(e.target.value)} />
              </div>
              <div>
                <Label>نام راننده (نمایشی)</Label>
                <Input value={driver_name} onChange={(e) => setDriverName(e.target.value)} />
              </div>
            </div>
          )}

          {/* ===================== Task 4 — Route section ===================== */}
          {/* Only rendered for freight rows; collapsed inside a bordered block
              with a header so it visually reads as one cohesive group. */}
          {showFreightFields && (
            <div className="rounded-lg border border-border bg-background/40 p-3 space-y-3">
              <div className="flex items-center gap-2">
                <RouteIcon className="w-4 h-4 text-primary" />
                <h4 className="text-sm font-bold text-foreground">اطلاعات مسیر</h4>
                <span className="text-[10px] text-muted-foreground mr-auto">
                  مبدأ و مقصد برای هزینه حمل الزامی است
                </span>
              </div>

              {/* Origin + Destination — paired dropdowns, each with a quick-
                  create shortcut. We use a native <select> for the geo dropdown
                  to stay consistent with the cost category select above and to
                  avoid pulling in heavier comboboxes. */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label className="flex items-center gap-1">
                    <MapPin className="w-3 h-3" /> مبدأ <span className="text-destructive">*</span>
                  </Label>
                  <select
                    value={origin_location_id ?? ""}
                    onChange={(e) => setOriginLocationId(e.target.value || null)}
                    disabled={geoLoading}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="">{geoLoading ? "در حال بارگذاری..." : "— انتخاب کنید —"}</option>
                    {geoOptions.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <Input
                      value={origin_text}
                      onChange={(e) => setOriginText(e.target.value)}
                      placeholder="متن سفارشی (اختیاری)"
                      className="h-8 text-xs"
                    />
                    <button
                      type="button"
                      onClick={() => setGeoCreateFor("origin")}
                      className="text-xs text-primary hover:underline whitespace-nowrap"
                    >
                      + افزودن
                    </button>
                  </div>
                </div>

                <div>
                  <Label className="flex items-center gap-1">
                    <MapPin className="w-3 h-3" /> مقصد <span className="text-destructive">*</span>
                  </Label>
                  <select
                    value={destination_location_id ?? ""}
                    onChange={(e) => setDestinationLocationId(e.target.value || null)}
                    disabled={geoLoading}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="">{geoLoading ? "در حال بارگذاری..." : "— انتخاب کنید —"}</option>
                    {geoOptions.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <Input
                      value={destination_text}
                      onChange={(e) => setDestinationText(e.target.value)}
                      placeholder="متن سفارشی (اختیاری)"
                      className="h-8 text-xs"
                    />
                    <button
                      type="button"
                      onClick={() => setGeoCreateFor("destination")}
                      className="text-xs text-primary hover:underline whitespace-nowrap"
                    >
                      + افزودن
                    </button>
                  </div>
                </div>
              </div>

              {/* Distance + duration */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label>فاصله تقریبی (کیلومتر)</Label>
                  <Input
                    type="number"
                    inputMode="numeric"
                    value={route_distance_km === "" ? "" : route_distance_km}
                    onChange={(e) => setRouteDistanceKm(e.target.value === "" ? "" : Number(e.target.value))}
                  />
                </div>
                <div>
                  <Label>مدت تقریبی (دقیقه)</Label>
                  <Input
                    type="number"
                    inputMode="numeric"
                    value={route_duration_minutes === "" ? "" : route_duration_minutes}
                    onChange={(e) => setRouteDurationMinutes(e.target.value === "" ? "" : Number(e.target.value))}
                  />
                </div>
              </div>

              {/* Vehicle type + cargo weight — for future cost-per-km analytics. */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label>نوع وسیله نقلیه</Label>
                  <Input
                    value={vehicle_type}
                    onChange={(e) => setVehicleType(e.target.value)}
                    placeholder="مثلاً: کامیون ۱۰ چرخ، نیسان"
                  />
                </div>
                <div>
                  <Label>وزن بار (کیلوگرم)</Label>
                  <Input
                    type="number"
                    inputMode="numeric"
                    value={cargo_weight === "" ? "" : cargo_weight}
                    onChange={(e) => setCargoWeight(e.target.value === "" ? "" : Number(e.target.value))}
                  />
                </div>
              </div>

              {/* ============== Task 5 — Reference metrics (read-only) ===============
                  Derived live from amount + distance + cargo weight. Pure
                  client-side; we recompute on every render so the operator
                  sees the numbers update as they edit any of the three
                  inputs. NOTHING here validates or blocks save — it's an
                  informational sanity check only. When data is missing we
                  fall back to the standardized Persian string. */}
              {(() => {
                const m = computeFreightMetrics({ amount, route_distance_km, cargo_weight });
                return (
                  <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-bold text-foreground">شاخص‌های مرجع</p>
                      <span className="text-[10px] text-muted-foreground">
                        فقط جهت اطلاع — مسدودکننده‌ی ثبت نیست
                      </span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                      <div className="flex flex-col">
                        <span className="text-muted-foreground">هزینه/کیلومتر</span>
                        <span className={m.cost_per_km === null ? "text-muted-foreground" : "text-foreground font-medium"}>
                          {m.cost_per_km === null ? INSUFFICIENT_FREIGHT_DATA : formatPerUnit(m.cost_per_km, "کیلومتر")}
                        </span>
                      </div>
                      <div className="flex flex-col">
                        <span className="text-muted-foreground">هزینه/کیلوگرم</span>
                        <span className={m.cost_per_kg === null ? "text-muted-foreground" : "text-foreground font-medium"}>
                          {m.cost_per_kg === null ? INSUFFICIENT_FREIGHT_DATA : formatPerUnit(m.cost_per_kg, "کیلوگرم")}
                        </span>
                      </div>
                      <div className="flex flex-col">
                        <span className="text-muted-foreground">هزینه/تن</span>
                        <span className={m.cost_per_ton === null ? "text-muted-foreground" : "text-foreground font-medium"}>
                          {m.cost_per_ton === null ? INSUFFICIENT_FREIGHT_DATA : formatPerUnit(m.cost_per_ton, "تن")}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })()}



              {/* Route source — three radio-style buttons. "api" is intentionally
                  disabled with a "به‌زودی" badge per the Task 4 brief. */}
              <div>
                <Label>منبع فاصله</Label>
                <div className="mt-1 flex flex-wrap gap-2">
                  {([
                    { v: "manual",    label: "دستی" },
                    { v: "estimated", label: "تخمینی" },
                  ] as const).map((opt) => (
                    <button
                      key={opt.v}
                      type="button"
                      onClick={() => setRouteSource(opt.v)}
                      className={`px-3 py-1.5 rounded-md border text-xs transition-colors ${
                        route_source === opt.v
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-background border-border text-foreground hover:bg-secondary"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                  {/* The API option is rendered but disabled — visible to set
                      operator expectations that this will be a future capability. */}
                  <button
                    type="button"
                    disabled
                    className="px-3 py-1.5 rounded-md border text-xs bg-muted/40 border-border text-muted-foreground cursor-not-allowed inline-flex items-center gap-1"
                    title="در فاز بعدی فعال می‌شود"
                  >
                    از مسیریاب
                    <span className="px-1 py-0.5 rounded bg-muted text-[9px] font-bold">به‌زودی</span>
                  </button>
                </div>
              </div>

              {/* Route note */}
              <div>
                <Label>توضیح مسیر</Label>
                <Textarea
                  value={route_note}
                  onChange={(e) => setRouteNote(e.target.value)}
                  rows={2}
                  placeholder="اختیاری — مثل: مسیر فرعی، عوارضی، ترافیک"
                />
              </div>

              {/* Disabled router CTA per brief. We wrap it in a Tooltip so the
                  operator gets a clear explanation on hover instead of a silent
                  unresponsive button. */}
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    {/* span needed because disabled buttons don't fire mouse events
                        used by the tooltip on some browsers. */}
                    <span className="inline-block">
                      <Button type="button" variant="outline" size="sm" disabled>
                        <RouteIcon className="w-4 h-4 ml-1" />
                        محاسبه فاصله با مسیریاب
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    این قابلیت در فاز بعدی فعال می‌شود و فاصله جاده‌ای را از سرویس مسیریاب دریافت می‌کند.
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          )}
          {/* =================== /Task 4 — Route section ===================== */}

          {/* Attachment — for now we store the path string only; full file
              upload pipeline is a follow-up phase. */}
          <div>
            <Label>پیوست (مسیر فایل)</Label>
            <Input
              value={attachment_path}
              onChange={(e) => setAttachment(e.target.value)}
              placeholder="اختیاری"
            />
          </div>

          {/* Payment-required toggle with explicit help text so the operator
              understands the downstream consequence (cost-price only vs.
              eligible for settlement-item generation). */}
          <div className="flex items-start justify-between gap-3 rounded-lg border border-border p-3">
            <div>
              <p className="text-sm font-medium text-foreground">نیازمند پرداخت</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {payment_required
                  ? "در هزینه تمام‌شده محاسبه می‌شود و قابلیت تولید آیتم تسویه دارد."
                  : "فقط در هزینه تمام‌شده محاسبه می‌شود، آیتم تسویه ایجاد نمی‌شود."}
              </p>
            </div>
            <Switch checked={payment_required} onCheckedChange={setPaymentRequired} />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 p-4 border-t border-border">
          <Button variant="ghost" onClick={onClose}>انصراف</Button>
          <Button onClick={handleSave} disabled={saving}>
            <Save className="w-4 h-4 ml-1" />
            {saving ? "در حال ذخیره..." : "ذخیره"}
          </Button>
        </div>

        {/* Quick driver dialog — nested modal. Kept inline to avoid a third
            component file for what is effectively a 4-field form. */}
        {driverOpen && (
          <div
            className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4"
            onClick={() => setDriverOpen(false)}
          >
            <div
              className="bg-card rounded-xl border shadow-lg w-full max-w-sm"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between p-4 border-b border-border">
                <h4 className="font-bold text-foreground">ایجاد راننده جدید</h4>
                <button onClick={() => setDriverOpen(false)} className="text-muted-foreground hover:text-foreground">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-4 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label>نام</Label>
                    <Input
                      value={driverDraft.first_name}
                      onChange={(e) => setDriverDraft((d) => ({ ...d, first_name: e.target.value }))}
                    />
                  </div>
                  <div>
                    <Label>نام خانوادگی</Label>
                    <Input
                      value={driverDraft.last_name}
                      onChange={(e) => setDriverDraft((d) => ({ ...d, last_name: e.target.value }))}
                    />
                  </div>
                </div>
                <div>
                  <Label>کد ملی</Label>
                  <Input
                    value={driverDraft.national_code}
                    onChange={(e) => setDriverDraft((d) => ({ ...d, national_code: e.target.value }))}
                  />
                </div>
                <div>
                  <Label>موبایل</Label>
                  <Input
                    value={driverDraft.mobile}
                    onChange={(e) => setDriverDraft((d) => ({ ...d, mobile: e.target.value }))}
                  />
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 p-4 border-t border-border">
                <Button variant="ghost" onClick={() => setDriverOpen(false)}>انصراف</Button>
                <Button onClick={createDriver} disabled={creatingDriver}>
                  <Plus className="w-4 h-4 ml-1" />
                  {creatingDriver ? "در حال ثبت..." : "ثبت راننده"}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Quick geo-location create dialog — same pattern as the driver one
            above. Title + which side it auto-selects depends on `geoCreateFor`. */}
        {geoCreateFor && (
          <div
            className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4"
            onClick={() => setGeoCreateFor(null)}
          >
            <div
              className="bg-card rounded-xl border shadow-lg w-full max-w-sm"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between p-4 border-b border-border">
                <h4 className="font-bold text-foreground">
                  افزودن {geoCreateFor === "origin" ? "مبدأ" : "مقصد"} جدید
                </h4>
                <button onClick={() => setGeoCreateFor(null)} className="text-muted-foreground hover:text-foreground">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-4 space-y-2">
                <div>
                  <Label>نام مکان <span className="text-destructive">*</span></Label>
                  <Input
                    value={geoDraftName}
                    onChange={(e) => setGeoDraftName(e.target.value)}
                    placeholder="مثلاً: گاوداری دامبان"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label>استان</Label>
                    <Input value={geoDraftProvince} onChange={(e) => setGeoDraftProvince(e.target.value)} />
                  </div>
                  <div>
                    <Label>شهر</Label>
                    <Input value={geoDraftCity} onChange={(e) => setGeoDraftCity(e.target.value)} />
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 p-4 border-t border-border">
                <Button variant="ghost" onClick={() => setGeoCreateFor(null)}>انصراف</Button>
                <Button onClick={createGeo} disabled={creatingGeo}>
                  <Plus className="w-4 h-4 ml-1" />
                  {creatingGeo ? "در حال ثبت..." : "ثبت مکان"}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
