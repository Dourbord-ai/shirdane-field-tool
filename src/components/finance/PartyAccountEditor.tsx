// ============================================================================
// PartyAccountEditor — add/edit dialog for a single finance_party_accounts row
// ----------------------------------------------------------------------------
// Embeds the existing AccountVerifyButton (no new verification service) and
// persists the verification outcome alongside the user-entered metadata.
// ============================================================================

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { X, AlertTriangle, Loader2 } from "lucide-react";
import AccountVerifyButton, { type MatchStatus } from "@/components/AccountVerifyButton";
import {
  ACCOUNT_TYPE_LABEL_FA,
  accountTypeToVerifyMethod,
  findDuplicateAccountsAcrossParties,
  isAccountValueValid,
  matchStatusToVerification,
  normalizeAccountValue,
  type DuplicateAccountHit,
  type PartyAccount,
  type PartyAccountType,
} from "@/lib/finance/partyAccounts";

interface Props {
  // Owning party — required because we always scope creates to a party.
  partyId: string;
  // When editing, the existing row; null/undefined → create mode.
  account?: PartyAccount | null;
  onClose: () => void;
  // Called after a successful save so the list refreshes.
  onSaved: () => void | Promise<void>;
}

export default function PartyAccountEditor({
  partyId,
  account,
  onClose,
  onSaved,
}: Props) {
  // ----- Local form state -------------------------------------------------
  // We keep account_type / value / title / declared owner as their own pieces
  // of state instead of one big object — easier to wire each input and
  // simpler diffing when persisting.
  const [accountType, setAccountType] = useState<PartyAccountType>(
    account?.account_type ?? "card",
  );
  // Raw (un-normalised) value while the user is typing — we normalise on
  // blur/save so the input is friendly to paste.
  const [rawValue, setRawValue] = useState<string>(account?.account_value ?? "");
  const [accountTitle, setAccountTitle] = useState<string>(account?.account_title ?? "");
  const [declaredOwner, setDeclaredOwner] = useState<string>(account?.declared_owner_name ?? "");
  const [isDefault, setIsDefault] = useState<boolean>(account?.is_default ?? false);

  // ----- Verification state shared with AccountVerifyButton --------------
  // We mirror AccountVerifyButton's match status so we can both block save
  // on hard mismatch and snapshot the right verification_status into the DB.
  const [matchStatus, setMatchStatus] = useState<MatchStatus>(null);

  // ----- Cross-party duplicate detection ---------------------------------
  // Advisory list of other parties already owning the same value.
  const [duplicates, setDuplicates] = useState<DuplicateAccountHit[]>([]);

  const [saving, setSaving] = useState(false);

  // Memoised canonical form — recomputed any time the user edits value/type.
  const normalized = useMemo(
    () => normalizeAccountValue(accountType, rawValue),
    [accountType, rawValue],
  );

  const valueValid = isAccountValueValid(accountType, normalized);

  // Re-run duplicate check whenever the canonical value changes and looks
  // valid. Debounced via a short timer to avoid spamming the RPC while the
  // user is still typing.
  useEffect(() => {
    if (!valueValid) {
      setDuplicates([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      const hits = await findDuplicateAccountsAcrossParties(
        accountType,
        normalized,
        partyId,
      );
      if (!cancelled) setDuplicates(hits);
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [valueValid, accountType, normalized, partyId]);

  // ----- Save -----------------------------------------------------------
  async function handleSave() {
    // Basic guards — we duplicate the validity check here in case the user
    // smashes Enter before the button disables.
    if (!declaredOwner.trim()) {
      toast.error("نام صاحب حساب اعلام‌شده الزامی است");
      return;
    }
    if (!valueValid) {
      toast.error("شماره حساب وارد شده معتبر نیست");
      return;
    }
    // Hard mismatch from verify-account → refuse to save. This protects
    // settlement flows in Phase 6B which will only allow verified rows.
    if (matchStatus === "mismatch") {
      toast.error("نام مغایر است؛ لطفاً قبل از ذخیره اصلاح کنید");
      return;
    }

    setSaving(true);

    // Build the patch we want to persist. We only set verification_status
    // when the verify button has actually produced a result — otherwise we
    // keep the row in 'pending' (default) which Phase 6B will treat as
    // "not selectable".
    const verificationPatch =
      matchStatus !== null
        ? {
            // Map AccountVerifyButton's match → our enum.
            verification_status: matchStatusToVerification(matchStatus),
            // We intentionally do NOT overwrite verified_owner_name /
            // verified_bank_name here — AccountVerifyButton itself doesn't
            // expose the parsed response. The user's "use this name" button
            // pulls the name into declaredOwner so the persisted record at
            // least reflects what the bank returned.
            verified_at: new Date().toISOString(),
          }
        : {};

    // The default-account toggle requires us to first clear any other
    // default for this party. We do that as a separate UPDATE so the
    // partial-unique index doesn't reject our INSERT/UPDATE.
    if (isDefault) {
      const { error: clearErr } = await supabase
        .from("finance_party_accounts")
        .update({ is_default: false })
        .eq("party_id", partyId)
        .neq("id", account?.id ?? "00000000-0000-0000-0000-000000000000");
      if (clearErr) {
        toast.error("خطا در ثبت پیش‌فرض");
        setSaving(false);
        return;
      }
    }

    const payload = {
      party_id: partyId,
      account_type: accountType,
      account_value: normalized,
      account_title: accountTitle.trim() || null,
      declared_owner_name: declaredOwner.trim(),
      is_default: isDefault,
      ...verificationPatch,
    };

    const { error } = account?.id
      ? await supabase
          .from("finance_party_accounts")
          .update(payload)
          .eq("id", account.id)
      : await supabase.from("finance_party_accounts").insert(payload);

    setSaving(false);
    if (error) {
      // Likely a unique-violation on (party_id, account_type, account_value).
      toast.error(error.message);
      return;
    }
    toast.success(account?.id ? "حساب به‌روزرسانی شد" : "حساب ثبت شد");
    await onSaved();
    onClose();
  }

  return (
    // Modal pattern matches existing PartyDetailDrawer — fixed overlay +
    // right-aligned card so it feels native on RTL.
    <div
      className="fixed inset-0 z-[60] bg-black/40 flex justify-end"
      onClick={onClose}
    >
      <div
        className="bg-card border-l shadow-lg w-full max-w-md h-full overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b flex items-center justify-between sticky top-0 bg-card z-10">
          <h3 className="font-bold">
            {account?.id ? "ویرایش حساب بانکی" : "افزودن حساب بانکی"}
          </h3>
          <Button size="icon" variant="ghost" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>

        <div className="p-4 space-y-4">
          {/* Account type — radios so the user sees all three at once. */}
          <div className="space-y-1.5">
            <Label className="text-xs">نوع حساب</Label>
            <div className="grid grid-cols-3 gap-2">
              {(Object.keys(ACCOUNT_TYPE_LABEL_FA) as PartyAccountType[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setAccountType(t)}
                  className={`rounded-xl border px-3 py-2 text-sm transition-colors ${
                    accountType === t
                      ? "border-primary bg-primary/10 text-primary font-bold"
                      : "border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {ACCOUNT_TYPE_LABEL_FA[t]}
                </button>
              ))}
            </div>
          </div>

          {/* Account value — left-to-right because it's always digits. */}
          <div className="space-y-1.5">
            <Label className="text-xs">شماره {ACCOUNT_TYPE_LABEL_FA[accountType]}</Label>
            <Input
              dir="ltr"
              value={rawValue}
              onChange={(e) => setRawValue(e.target.value)}
              placeholder={
                accountType === "card"
                  ? "6037-9911-2345-6789"
                  : accountType === "sheba"
                  ? "IR82 0540 1234 5678 9012 3456 78"
                  : "0123-456789-001"
              }
            />
            {rawValue && !valueValid && (
              <p className="text-[11px] text-destructive">
                قالب شماره {ACCOUNT_TYPE_LABEL_FA[accountType]} معتبر نیست.
              </p>
            )}
          </div>

          {/* Title — optional human nickname; helps when one party has many
              accounts. */}
          <div className="space-y-1.5">
            <Label className="text-xs">عنوان حساب (اختیاری)</Label>
            <Input
              value={accountTitle}
              onChange={(e) => setAccountTitle(e.target.value)}
              placeholder="مثال: حساب جاری بانک ملت"
            />
          </div>

          {/* Cross-party duplicate warning — advisory, never blocks save. */}
          {duplicates.length > 0 && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-amber-700 dark:text-amber-400 text-xs space-y-1">
              <div className="flex items-center gap-1.5 font-bold">
                <AlertTriangle className="w-3.5 h-3.5" />
                این شماره قبلاً برای ذینفع‌های دیگری ثبت شده است:
              </div>
              <ul className="list-disc pr-5 space-y-0.5">
                {duplicates.map((d) => (
                  <li key={d.account_id}>
                    {d.party_full_name || "(بدون نام)"} —{" "}
                    {d.verified_owner_name || d.declared_owner_name || "—"}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Verify block — reuses the existing component AS-IS. We pass the
              account_value through the mapping helper. Note: declaredOwner
              acts as both "declared name" persistence and the live-compare
              input for AccountVerifyButton, which is exactly the UX we want. */}
          <div className="rounded-xl border p-3 space-y-2">
            <p className="text-xs text-muted-foreground">
              برای ثبت رسمی حساب، استعلام بانک الزامی است.
            </p>
            <AccountVerifyButton
              type={accountTypeToVerifyMethod(accountType)}
              number={normalized}
              accountHolderName={declaredOwner}
              onAccountHolderNameChange={setDeclaredOwner}
              nameLabel="نام صاحب حساب اعلام‌شده"
              namePlaceholder="نام و نام خانوادگی..."
              onMatchStatusChange={setMatchStatus}
            />
          </div>

          {/* Default flag — toggles handled at save time so we can clear any
              previous default in the same transaction-like flow. */}
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={isDefault}
              onChange={(e) => setIsDefault(e.target.checked)}
              className="rounded"
            />
            <span>ثبت به عنوان حساب پیش‌فرض ذینفع</span>
          </label>
        </div>

        <div className="p-4 border-t flex justify-end gap-2 sticky bottom-0 bg-card">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            انصراف
          </Button>
          <Button onClick={handleSave} disabled={saving || !valueValid}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "ذخیره"}
          </Button>
        </div>
      </div>
    </div>
  );
}
