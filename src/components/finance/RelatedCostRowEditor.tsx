// ---------------------------------------------------------------------------
// Phase 7 — Related-cost row editor dialog.
//
// One row at a time: add or edit. Reuses the existing PartySelector so the
// counterparty/driver/provider comes from the same finance_parties table
// the rest of the app uses (party_id stays the source of truth). When the
// operator can't find a party, a "ایجاد راننده جدید" shortcut opens a tiny
// inline dialog that creates a minimal finance_parties row — we do NOT
// create a separate driver table.
// ---------------------------------------------------------------------------

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Save, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";

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

  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (saving) return;
    if (!amount || amount <= 0) return toast.error("مبلغ باید بزرگ‌تر از صفر باشد");
    setSaving(true);
    try {
      // Build the input payload — identical shape for db + draft modes so the
      // draft can be replayed unchanged into `insertManyRelatedCosts` after
      // the parent factor lands.
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
      </div>
    </div>
  );
}
