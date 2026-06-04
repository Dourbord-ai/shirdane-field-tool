// ---------------------------------------------------------------------------
// Task 7 — Freight Trip Settlement dialog.
//
// Single-purpose dialog launched from FreightTripDetail. Wraps the existing
// SettlementSourceCard so the operator gets the SAME payment-row editor
// they already use on the invoice form (payment count, methods, dates,
// details, priority, requirement radio). No new card UI — that's
// intentional: any future change to the invoice source card propagates
// here for free.
//
// Flow:
//   1. On open, fetch the driver party label for the source header.
//   2. Build the initial single-source state via buildInitialFreightTripSource.
//   3. Operator edits → live validation list shown beneath the card.
//   4. "ثبت درخواست تسویه" → submitFreightTripSettlement (RPC + link-back).
//   5. On success → close, callback parent to refresh and toast.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, ReceiptText } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import SettlementSourceCard from "@/components/invoices/sections/SettlementSourceCard";
import { supabase } from "@/integrations/supabase/client";

import type { SettlementSource } from "@/lib/finance/invoiceSettlementBuilder";
import {
  buildInitialFreightTripSource,
  submitFreightTripSettlement,
  validateFreightTripSettlement,
} from "@/lib/finance/freightTripSettlement";
import type { FreightTrip, FreightTripInvoice } from "@/lib/finance/freightTrips";

interface InvoiceLite {
  id: string;
  invoice_number: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trip: FreightTrip;
  invoiceLinks: FreightTripInvoice[];
  /** Map of factor_id → lite invoice info, for the allocation summary. */
  invoiceMap: Map<string, InvoiceLite>;
  /** Fired after a successful submit; parent should reload the trip. */
  onSubmitted: (requestId: string) => void;
}

export default function FreightTripSettlementDialog({
  open,
  onOpenChange,
  trip,
  invoiceLinks,
  invoiceMap,
  onSubmitted,
}: Props) {
  // ----- driver party label (snapshot) -------------------------------------
  // We fetch the party label on open so the card header shows "راننده: …".
  // It's a cosmetic snapshot — the actual party_id on the source drives
  // the RPC payload.
  const [partyLabel, setPartyLabel] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!open || !trip.driver_party_id) { setPartyLabel(null); return; }
    (async () => {
      const { data } = await supabase
        .from("finance_parties")
        .select("display_name, full_name")
        .eq("id", trip.driver_party_id!)
        .maybeSingle();
      if (cancelled) return;
      const row = data as { display_name: string | null; full_name: string | null } | null;
      setPartyLabel(row?.display_name || row?.full_name || null);
    })();
    return () => { cancelled = true; };
  }, [open, trip.driver_party_id]);

  // ----- source state ------------------------------------------------------
  // We rebuild the seed source whenever the dialog opens. Closing and
  // reopening always starts fresh — that's intentional, the operator
  // hasn't committed anything until they press submit.
  const [source, setSource] = useState<SettlementSource | null>(null);

  useEffect(() => {
    if (open) setSource(buildInitialFreightTripSource(trip, partyLabel));
    else setSource(null);
  }, [open, trip, partyLabel]);

  // ----- validation --------------------------------------------------------
  // Memoised so the button enabled-state and error list use the same data.
  const errors = useMemo(
    () => (source ? validateFreightTripSettlement(trip, source) : []),
    [trip, source],
  );

  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!source) return;
    setSubmitting(true);
    try {
      const requestId = await submitFreightTripSettlement(trip, source);
      toast.success("درخواست تسویه کرایه سفر با موفقیت ثبت شد");
      onSubmitted(requestId);
      onOpenChange(false);
    } catch (e) {
      // Surface the multi-line validation message as-is.
      toast.error((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  // ----- render ------------------------------------------------------------
  const tripCode = trip.trip_code || trip.id.slice(0, 8);
  // Sum of stored allocated amounts — what was already written into
  // factor_related_costs for the linked invoices. Shown read-only so the
  // operator can sanity-check that the settlement total matches.
  const allocatedSum = invoiceLinks.reduce((a, l) => a + Number(l.allocated_amount || 0), 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>ثبت درخواست تسویه کرایه سفر {tripCode}</DialogTitle>
          <DialogDescription>
            یک درخواست تسویه برای راننده / شرکت حمل ایجاد می‌شود.
            تخصیص بین فاکتورها قبلاً انجام شده و این مرحله صرفاً
            یک درخواست پرداخت جمعی ایجاد می‌کند.
          </DialogDescription>
        </DialogHeader>

        {/* Trip + allocation summary (read-only). Gives the operator
            context before they configure payments. */}
        <section className="rounded-md border border-border p-3 text-xs space-y-2 bg-background/40">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <KV label="مسیر" value={`${trip.origin_text || "—"} ← ${trip.destination_text || "—"}`} />
            <KV label="راننده / شرکت" value={partyLabel || (trip.driver_party_id ? "—" : "(مشخص نشده)")} />
            <KV label="مبلغ کل کرایه" value={`${Number(trip.total_amount).toLocaleString("fa-IR")} ریال`} />
          </div>

          <div>
            <div className="text-muted-foreground mb-1">تخصیص بین فاکتورها ({invoiceLinks.length}):</div>
            <ul className="space-y-0.5">
              {invoiceLinks.map((l) => {
                const inv = invoiceMap.get(l.factor_id);
                return (
                  <li key={l.id} className="flex justify-between gap-2">
                    <span className="font-mono">{inv?.invoice_number || l.factor_id.slice(0, 8)}</span>
                    <span>{Number(l.allocated_amount).toLocaleString("fa-IR")} ریال</span>
                  </li>
                );
              })}
              <li className="flex justify-between gap-2 border-t border-border pt-1 font-bold">
                <span>جمع تخصیص ذخیره‌شده</span>
                <span>{allocatedSum.toLocaleString("fa-IR")} ریال</span>
              </li>
            </ul>
          </div>
        </section>

        {/* The actual editor — reuses the invoice-form source card. */}
        {source && (
          <SettlementSourceCard
            source={source}
            errors={errors}
            onPatch={(patch) => setSource((prev) => (prev ? { ...prev, ...patch } : prev))}
          />
        )}

        {/* Trip-level errors (those without payment_index). The card
            renders payment-level errors inline. */}
        {errors.filter((e) => e.payment_index === undefined).length === 0 && errors.length === 0 && (
          <p className="text-[11px] text-muted-foreground">آماده ثبت.</p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            انصراف
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={submitting || errors.length > 0}
            title={errors.length > 0 ? "ابتدا خطاهای اعتبارسنجی را برطرف کنید" : ""}
          >
            {submitting ? (
              <Loader2 className="w-4 h-4 ml-1 animate-spin" />
            ) : (
              <ReceiptText className="w-4 h-4 ml-1" />
            )}
            ثبت درخواست تسویه
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
