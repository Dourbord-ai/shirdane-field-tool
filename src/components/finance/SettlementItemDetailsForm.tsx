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
// Task 1: import digit normalizer so a Persian/Arabic-keyed national id is
// stored in ASCII form (matches what validateDetails expects).
import { toEnDigits } from "@/lib/digits";
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
// Phase 6B: reuse the helpers from Phase 6A so masking / labelling stays
// consistent with the party-profile bank-accounts tab. We only import the
// pure helpers (no React) — the picker UI lives inline in this file.
import {
  ACCOUNT_TYPE_LABEL_FA as PARTY_ACCOUNT_TYPE_LABEL_FA,
  maskAccountValue,
  type PartyAccount,
} from "@/lib/finance/partyAccounts";
import { Star, ShieldAlert } from "lucide-react";

interface Props {
  paymentMethod: string;
  value: SettlementItemDetails;
  onChange: (next: SettlementItemDetails) => void;
  // Phase 6B: needed for bank_transfer to fetch this party's verified
  // accounts. Optional so other call-sites (e.g. older items without a
  // party_id selected yet) keep compiling — when missing the picker hides
  // its "registered account" mode and falls back to manual-only entry.
  partyId?: string | null;
}


// Tiny helper: produce a copy with one key changed. Keeps the parent's
// immutability contract intact without forcing every callsite to spread.
function patch<T extends object>(prev: T, key: string, v: unknown): T {
  return { ...prev, [key]: v } as T;
}

export default function SettlementItemDetailsForm({ paymentMethod, value, onChange, partyId }: Props) {
  // Local lookups for selectors. We fetch once per mounted form; the dialog
  // remounts on each row addition so this is cheap enough.
  const [banks, setBanks] = useState<{ id: string; title: string | null; bank_name: string | null }[]>([]);
  const [checkbooks, setCheckbooks] = useState<{ id: string; title: string | null; bank_id: string | null }[]>([]);
  const [parties, setParties] = useState<{ id: string; first_name: string | null; last_name: string | null; company_name: string | null }[]>([]);
  // Phase 6B: verified accounts for THIS party. We refetch whenever the
  // partyId changes so switching the item's party reloads the picker.
  const [verifiedAccounts, setVerifiedAccounts] = useState<PartyAccount[]>([]);
  const [accountsLoaded, setAccountsLoaded] = useState(false);

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

  // Phase 6B: load this party's verified bank accounts for the picker.
  // Filters mirror the spec exactly:
  //   - same party
  //   - is_active = true
  //   - is_deleted = false
  //   - verification_status = 'verified'   ← critical: only verified rows
  // We never load 'pending'/'mismatch'/'invalid' rows so the picker can
  // never accidentally select an unverified account.
  useEffect(() => {
    if (paymentMethod !== "bank_transfer" || !partyId) {
      setVerifiedAccounts([]);
      setAccountsLoaded(false);
      return;
    }
    let cancelled = false;
    void supabase
      .from("finance_party_accounts")
      .select("*")
      .eq("party_id", partyId)
      .eq("is_active", true)
      .eq("is_deleted", false)
      .eq("verification_status", "verified")
      .order("is_default", { ascending: false })
      .order("updated_at", { ascending: false })
      .then(({ data }) => {
        if (cancelled) return;
        setVerifiedAccounts((data as PartyAccount[]) || []);
        setAccountsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [paymentMethod, partyId]);



  // -------- BANK TRANSFER --------------------------------------------------
  if (paymentMethod === "bank_transfer") {
    const d = value as Record<string, string | undefined>;
    // Phase 6B: derive the active "mode" from the snapshot itself instead of
    // a separate state variable. When `party_account_id` is set we render
    // the registered-account view; otherwise the manual fields. This means
    // re-opening an existing item always renders the right mode without
    // extra wiring.
    const mode: "registered" | "manual" = d.party_account_id ? "registered" : "manual";

    // Switching mode: clearing the snapshot is the only way out of
    // "registered" mode. We wipe every field the picker had filled so the
    // manual form starts blank, while preserving transfer_type & note that
    // the user might want to keep.
    const switchToManual = () => {
      onChange({
        ...value,
        party_account_id: undefined,
        account_verification_status: undefined,
        verified_at: undefined,
        declared_account_owner_name: "",
        account_identifier_type: undefined,
        account_identifier_value: "",
        destination_bank_name: "",
      } as SettlementItemDetails);
    };

    // Picking a verified account: snapshot every identifying field straight
    // into `details` so the historical payload is self-contained — future
    // edits to the party-account row don't mutate this item's history.
    const pickAccount = (acct: PartyAccount) => {
      onChange({
        ...value,
        party_account_id: acct.id,
        declared_account_owner_name:
          acct.verified_owner_name || acct.declared_owner_name,
        account_identifier_type: acct.account_type,
        account_identifier_value: acct.account_value,
        destination_bank_name: acct.verified_bank_name || "",
        account_verification_status: "verified",
        verified_at: acct.verified_at || undefined,
      } as SettlementItemDetails);
    };

    return (
      <div className="rounded-md border border-border bg-muted/20 p-2 space-y-2">
        <div className="text-[11px] font-bold text-muted-foreground">جزئیات انتقال بانکی</div>

        {/* Mode chooser — only meaningful when we know which party owns the
            item. Without partyId there's nothing to fetch, so we silently
            render manual-only. */}
        {partyId && (
          <div className="flex items-center gap-2 text-[11px]">
            <span className="text-muted-foreground">حساب مقصد:</span>
            <label className="flex items-center gap-1 cursor-pointer">
              <input
                type="radio"
                name={`bt-mode-${partyId}`}
                checked={mode === "registered"}
                onChange={() => {
                  // Auto-select the default account (or first) if available.
                  const auto = verifiedAccounts[0];
                  if (auto) pickAccount(auto);
                }}
                disabled={accountsLoaded && verifiedAccounts.length === 0}
              />
              <span>انتخاب از حساب‌های ثبت‌شدهٔ ذینفع</span>
            </label>
            <label className="flex items-center gap-1 cursor-pointer">
              <input
                type="radio"
                name={`bt-mode-${partyId}`}
                checked={mode === "manual"}
                onChange={switchToManual}
              />
              <span>ورود دستی</span>
            </label>
          </div>
        )}

        {/* ---- REGISTERED-ACCOUNT MODE ---- */}
        {mode === "registered" && partyId && (
          <div className="space-y-2">
            {/* Empty state: the user selected the registered mode but the
                party has no verified accounts. Per spec, we explain how to
                fix it instead of silently failing. */}
            {accountsLoaded && verifiedAccounts.length === 0 && (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-amber-700 dark:text-amber-400 text-[11px] flex items-start gap-1.5">
                <ShieldAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>
                  برای این ذینفع حساب تأییدشده‌ای ثبت نشده است. از پروفایل ذینفع
                  حساب را اضافه و استعلام کنید یا از ورود دستی استفاده کنید.
                </span>
              </div>
            )}

            {verifiedAccounts.length > 0 && (
              <>
                <Label className="text-[11px]">حساب مقصد <span className="text-destructive">*</span></Label>
                <select
                  // We store the chosen id in details; the value control here
                  // is derived from the snapshot so React renders the right
                  // option after mount/edit.
                  value={d.party_account_id || ""}
                  onChange={(e) => {
                    const acct = verifiedAccounts.find((a) => a.id === e.target.value);
                    if (acct) pickAccount(acct);
                  }}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">انتخاب کنید…</option>
                  {verifiedAccounts.map((a) => {
                    // Rich label per spec:
                    //   بانک ملت — کارت شخصی — 6037-99**-****-1234 — حسن رضایی ⭐ پیش‌فرض
                    const bank = a.verified_bank_name || "—";
                    const title = a.account_title || PARTY_ACCOUNT_TYPE_LABEL_FA[a.account_type];
                    const masked = maskAccountValue(a.account_type, a.account_value);
                    const owner = a.verified_owner_name || a.declared_owner_name;
                    const star = a.is_default ? " ⭐ پیش‌فرض" : "";
                    return (
                      <option key={a.id} value={a.id}>
                        {`${bank} — ${title} — ${masked} — ${owner}${star}`}
                      </option>
                    );
                  })}
                </select>

                {/* Read-only snapshot card so the user can see what was
                    selected without re-opening the dropdown. */}
                {d.party_account_id && (
                  <div className="rounded-md border border-primary/30 bg-primary/5 p-2 text-[11px] space-y-0.5">
                    <div className="flex items-center gap-1.5">
                      {(() => {
                        const a = verifiedAccounts.find((x) => x.id === d.party_account_id);
                        if (!a) return <span className="text-muted-foreground">—</span>;
                        return (
                          <>
                            <span className="font-bold">{a.verified_bank_name || PARTY_ACCOUNT_TYPE_LABEL_FA[a.account_type]}</span>
                            <span className="text-muted-foreground">·</span>
                            <span dir="ltr" className="font-mono">{maskAccountValue(a.account_type, a.account_value)}</span>
                            <span className="text-muted-foreground">·</span>
                            <span>{a.verified_owner_name || a.declared_owner_name}</span>
                            {a.is_default && (
                              <span className="ml-auto inline-flex items-center gap-0.5 text-primary font-bold">
                                <Star className="w-3 h-3" /> پیش‌فرض
                              </span>
                            )}
                          </>
                        );
                      })()}
                    </div>
                    <p className="text-muted-foreground">
                      حساب از پروفایل ذینفع انتخاب شد و نیازی به استعلام مجدد نیست.
                    </p>
                  </div>
                )}
              </>
            )}

            {/* transfer_type remains REQUIRED in both modes. */}
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

            <div className="space-y-1">
              <Label className="text-[11px]">یادداشت پرداخت</Label>
              <Textarea rows={2} value={d.payment_note || ""} onChange={(e) => onChange(patch(value, "payment_note", e.target.value))} />
            </div>
          </div>
        )}

        {/* ---- MANUAL MODE (Phase 5 fields untouched) ---- */}
        {mode === "manual" && (
          <>
            {/* Per spec: explicit notice that manual entries are not yet
                tied to a saved account and that verification will become
                mandatory in a later phase. */}
            <div className="rounded-md border border-border bg-background p-2 text-[10px] text-muted-foreground">
              ورود دستی فعلاً بدون اتصال به حساب ذخیره‌شده است و در فاز بعدی نیازمند استعلام خواهد شد.
            </div>
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
          </>
        )}
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
                  <option key={cb.id} value={cb.id}>{cb.title || cb.id.slice(0, 8)}</option>
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
