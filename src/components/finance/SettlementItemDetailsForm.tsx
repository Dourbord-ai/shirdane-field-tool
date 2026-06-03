/**
 * Phase 5 — per-item, method-specific details form.
 *
 * Rendered INSIDE the new-request dialog under each item row. It branches on
 * `paymentMethod` and exposes only the inputs relevant to that method. Every
 * change is propagated back via `onChange(nextDetails)`; the parent stores
 * the object on the item and ships it inside the `details` jsonb on submit.
 *
 * Intentionally NOT here:
 *   - any persistence (parent owns the state and the RPC call)
 *   - any external API (CardInfo / Verify-Account) — deferred
 *   - check_number capture — deferred to execution phase
 */

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import ShamsiDatePicker from "@/components/ShamsiDatePicker";
import { jalaliToGregorianDate, gregorianDateToJalali } from "@/lib/dateUtils";
import {
  ACCOUNT_IDENTIFIER_TYPES,
  ACCOUNT_IDENTIFIER_TYPE_LABELS_FA,
  TRANSFER_TYPES,
  TRANSFER_TYPE_LABELS_FA,
  type SettlementItemDetails,
} from "@/lib/finance/settlementItemDetails";

interface Props {
  paymentMethod: string;
  value: SettlementItemDetails;
  onChange: (next: SettlementItemDetails) => void;
}

// Tiny helper: produce a copy with one key changed. Keeps the parent's
// immutability contract intact without forcing every callsite to spread.
function patch<T extends object>(prev: T, key: string, v: unknown): T {
  return { ...prev, [key]: v } as T;
}

export default function SettlementItemDetailsForm({ paymentMethod, value, onChange }: Props) {
  // Local lookups for selectors. We fetch once per mounted form; the dialog
  // remounts on each row addition so this is cheap enough.
  const [banks, setBanks] = useState<{ id: string; title: string | null; bank_name: string | null }[]>([]);
  const [checkbooks, setCheckbooks] = useState<{ id: string; title: string | null; bank_id: string | null }[]>([]);
  const [parties, setParties] = useState<{ id: string; first_name: string | null; last_name: string | null; company_name: string | null }[]>([]);

  useEffect(() => {
    if (paymentMethod === "check") {
      void supabase
        .from("finance_banks")
        .select("id,title,bank_name")
        .eq("is_deleted", false)
        .then(({ data }) => setBanks(data || []));
      void supabase
        .from("finance_checkbooks")
        .select("id,title,bank_id,is_active")
        .eq("is_active", true)
        .then(({ data }) => setCheckbooks((data as never[]) || []));

    }
    if (paymentMethod === "barter") {
      // Lightweight party list for the barter counterparty picker. We cap to
      // 200 rows; an autocomplete is overkill until UX feedback demands it.
      void supabase
        .from("finance_parties")
        .select("id,first_name,last_name,company_name")
        .eq("is_deleted", false)
        .limit(200)
        .then(({ data }) => setParties((data as never[]) || []));
    }
  }, [paymentMethod]);

  // -------- BANK TRANSFER --------------------------------------------------
  if (paymentMethod === "bank_transfer") {
    const d = value as Record<string, string | undefined>;
    return (
      <div className="rounded-md border border-border bg-muted/20 p-2 space-y-2">
        <div className="text-[11px] font-bold text-muted-foreground">جزئیات انتقال بانکی</div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-[11px]">نام صاحب حساب اعلام‌شده <span className="text-destructive">*</span></Label>
            <Input value={d.declared_account_owner_name || ""} onChange={(e) => onChange(patch(value, "declared_account_owner_name", e.target.value))} />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">نوع شناسه حساب <span className="text-destructive">*</span></Label>
            <select
              value={d.account_identifier_type || ""}
              onChange={(e) => onChange(patch(value, "account_identifier_type", e.target.value))}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">انتخاب کنید…</option>
              {ACCOUNT_IDENTIFIER_TYPES.map((t) => (
                <option key={t} value={t}>{ACCOUNT_IDENTIFIER_TYPE_LABELS_FA[t]}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">شماره حساب/کارت/شبا <span className="text-destructive">*</span></Label>
            <Input dir="ltr" value={d.account_identifier_value || ""} onChange={(e) => onChange(patch(value, "account_identifier_value", e.target.value))} />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">نام بانک مقصد</Label>
            <Input value={d.destination_bank_name || ""} onChange={(e) => onChange(patch(value, "destination_bank_name", e.target.value))} />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">نوع انتقال <span className="text-destructive">*</span></Label>
            <select
              value={d.transfer_type || ""}
              onChange={(e) => onChange(patch(value, "transfer_type", e.target.value))}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">انتخاب کنید…</option>
              {TRANSFER_TYPES.map((t) => (
                <option key={t} value={t}>{TRANSFER_TYPE_LABELS_FA[t]}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-[11px]">یادداشت پرداخت</Label>
          <Textarea rows={2} value={d.payment_note || ""} onChange={(e) => onChange(patch(value, "payment_note", e.target.value))} />
        </div>
      </div>
    );
  }

  // -------- CHECK ----------------------------------------------------------
  if (paymentMethod === "check") {
    const d = value as Record<string, string | undefined>;
    return (
      <div className="rounded-md border border-border bg-muted/20 p-2 space-y-2">
        <div className="text-[11px] font-bold text-muted-foreground">جزئیات چک</div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-[11px]">نام دریافت‌کننده چک <span className="text-destructive">*</span></Label>
            <Input value={d.payee_name || ""} onChange={(e) => onChange(patch(value, "payee_name", e.target.value))} />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">بابت <span className="text-destructive">*</span></Label>
            <Input value={d.check_reason || ""} onChange={(e) => onChange(patch(value, "check_reason", e.target.value))} />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">بانک پیشنهادی</Label>
            <select
              value={d.suggested_bank_id || ""}
              onChange={(e) => {
                // Snapshot the bank name alongside the id so the read view
                // doesn't need a second query to render a Persian summary.
                const bank = banks.find((b) => b.id === e.target.value);
                onChange({
                  ...value,
                  suggested_bank_id: e.target.value,
                  suggested_bank_name: bank ? (bank.title || bank.bank_name || "") : "",
                  // Clear an unrelated checkbook selection when the bank changes.
                  suggested_checkbook_id: "",
                } as SettlementItemDetails);
              }}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">— بدون انتخاب —</option>
              {banks.map((b) => (
                <option key={b.id} value={b.id}>{b.title || b.bank_name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">دسته‌چک پیشنهادی</Label>
            <select
              value={d.suggested_checkbook_id || ""}
              onChange={(e) => onChange(patch(value, "suggested_checkbook_id", e.target.value))}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              disabled={!d.suggested_bank_id}
            >
              <option value="">— بدون انتخاب —</option>
              {checkbooks
                .filter((cb) => !d.suggested_bank_id || cb.bank_id === d.suggested_bank_id)
                .map((cb) => (
                  <option key={cb.id} value={cb.id}>{cb.series_label || cb.id.slice(0, 8)}</option>
                ))}
            </select>
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-[11px]">توضیحات چک</Label>
          <Textarea rows={2} value={d.check_description || ""} onChange={(e) => onChange(patch(value, "check_description", e.target.value))} />
        </div>
        <p className="text-[10px] text-muted-foreground">
          شماره چک در مرحله صدور ثبت می‌شود، نه در مرحله درخواست.
        </p>
      </div>
    );
  }

  // -------- CASHBOX --------------------------------------------------------
  if (paymentMethod === "cashbox") {
    const d = value as Record<string, string | undefined>;
    // No `finance_cashboxes` table yet, so we accept a free-text name. When a
    // real cashbox table arrives the input below can swap to a <select>.
    return (
      <div className="rounded-md border border-border bg-muted/20 p-2 space-y-2">
        <div className="text-[11px] font-bold text-muted-foreground">جزئیات پرداخت نقدی (صندوق)</div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-[11px]">نام صندوق <span className="text-destructive">*</span></Label>
            <Input
              placeholder="مثلاً صندوق دفتر مرکزی"
              value={d.cashbox_name || ""}
              onChange={(e) => onChange(patch(value, "cashbox_name", e.target.value))}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">نام دریافت‌کننده <span className="text-destructive">*</span></Label>
            <Input value={d.recipient_name || ""} onChange={(e) => onChange(patch(value, "recipient_name", e.target.value))} />
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-[11px]">یادداشت پرداخت نقدی</Label>
          <Textarea rows={2} value={d.cash_payment_note || ""} onChange={(e) => onChange(patch(value, "cash_payment_note", e.target.value))} />
        </div>
      </div>
    );
  }

  // -------- DEFERRED -------------------------------------------------------
  if (paymentMethod === "deferred") {
    const d = value as Record<string, string | undefined>;
    return (
      <div className="rounded-md border border-border bg-muted/20 p-2 space-y-2">
        <div className="text-[11px] font-bold text-muted-foreground">جزئیات تسویه بعدی</div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-[11px]">تاریخ پیگیری <span className="text-destructive">*</span></Label>
            {/* User picks Jalali; we store Gregorian ISO so it matches every
                other date column in the DB. The picker round-trip mirrors the
                due_date handling in PRDialog. */}
            <ShamsiDatePicker
              value={gregorianDateToJalali(d.follow_up_date || "") || ""}
              onChange={(jalali) =>
                onChange(patch(value, "follow_up_date", jalaliToGregorianDate(jalali) || ""))
              }
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">دلیل تعویق <span className="text-destructive">*</span></Label>
            <Input value={d.defer_reason || ""} onChange={(e) => onChange(patch(value, "defer_reason", e.target.value))} />
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-[11px]">یادداشت تعویق</Label>
          <Textarea rows={2} value={d.defer_note || ""} onChange={(e) => onChange(patch(value, "defer_note", e.target.value))} />
        </div>
      </div>
    );
  }

  // -------- BARTER ---------------------------------------------------------
  if (paymentMethod === "barter") {
    const d = value as Record<string, string | undefined>;
    const partyLabel = (p: { first_name: string | null; last_name: string | null; company_name: string | null }) =>
      p.company_name || [p.first_name, p.last_name].filter(Boolean).join(" ") || "—";
    return (
      <div className="rounded-md border border-border bg-muted/20 p-2 space-y-2">
        <div className="text-[11px] font-bold text-muted-foreground">جزئیات پایاپای</div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-[11px]">طرف مقابل (طرف‌حساب)</Label>
            <select
              value={d.counterparty_party_id || ""}
              onChange={(e) => {
                const p = parties.find((x) => x.id === e.target.value);
                onChange({
                  ...value,
                  counterparty_party_id: e.target.value,
                  // Snapshot name for the read view.
                  counterparty_name: p ? partyLabel(p) : d.counterparty_name || "",
                } as SettlementItemDetails);
              }}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">— انتخاب از طرف‌حساب‌ها —</option>
              {parties.map((p) => (
                <option key={p.id} value={p.id}>{partyLabel(p)}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">یا نام طرف مقابل</Label>
            <Input
              placeholder="در صورت نبود در لیست"
              value={d.counterparty_name || ""}
              onChange={(e) => onChange(patch(value, "counterparty_name", e.target.value))}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">نوع پایاپای <span className="text-destructive">*</span></Label>
            <Input
              placeholder="مثلاً تهاتر علوفه با خدمات حمل"
              value={d.barter_type || ""}
              onChange={(e) => onChange(patch(value, "barter_type", e.target.value))}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">سند مرجع</Label>
            <Input value={d.reference_document || ""} onChange={(e) => onChange(patch(value, "reference_document", e.target.value))} />
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-[11px]">یادداشت پایاپای</Label>
          <Textarea rows={2} value={d.barter_note || ""} onChange={(e) => onChange(patch(value, "barter_note", e.target.value))} />
        </div>
      </div>
    );
  }

  // Unknown / empty method: render nothing (the parent gates by requiring a
  // method before submit, but during typing the form may be transiently empty).
  return null;
}
