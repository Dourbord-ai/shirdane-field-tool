// ============================================================================
// PartyAccountsTab — section embedded in PartyDetailDrawer that lists,
// adds, edits, disables and re-orders a party's bank accounts.
// ----------------------------------------------------------------------------
// All mutations go through supabase directly; verification is performed in
// the editor via the shared AccountVerifyButton.
// ============================================================================

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Plus,
  Pencil,
  Star,
  StarOff,
  Power,
  PowerOff,
  BadgeCheck,
  ShieldAlert,
  ShieldQuestion,
  RefreshCcw,
} from "lucide-react";
import PartyAccountEditor from "@/components/finance/PartyAccountEditor";
import {
  ACCOUNT_TYPE_LABEL_FA,
  VERIFICATION_LABEL_FA,
  maskAccountValue,
  type PartyAccount,
  type PartyAccountVerificationStatus,
} from "@/lib/finance/partyAccounts";

interface Props {
  // Owning party id; the parent drawer always has this.
  partyId: string;
}

export default function PartyAccountsTab({ partyId }: Props) {
  // List of accounts for this party — refreshed after every mutation.
  const [accounts, setAccounts] = useState<PartyAccount[]>([]);
  const [loading, setLoading] = useState(true);
  // Editor state: null → closed; "new" → create; object → edit that row.
  const [editing, setEditing] = useState<PartyAccount | "new" | null>(null);

  // Wrapped in useCallback so we can pass it as a stable prop to the editor.
  const load = useCallback(async () => {
    setLoading(true);
    // Default order: defaults first, then most-recently-updated.
    const { data, error } = await supabase
      .from("finance_party_accounts")
      .select("*")
      .eq("party_id", partyId)
      .eq("is_deleted", false)
      .order("is_default", { ascending: false })
      .order("is_active", { ascending: false })
      .order("updated_at", { ascending: false });
    setLoading(false);
    if (error) {
      toast.error("بارگذاری حساب‌ها ناموفق بود");
      return;
    }
    setAccounts((data ?? []) as PartyAccount[]);
  }, [partyId]);

  useEffect(() => {
    void load();
  }, [load]);

  // ----- Mutations -------------------------------------------------------
  // Each helper updates the row and reloads. Errors surface via toast and
  // we don't optimistically mutate state — the dataset is small enough that
  // an extra round-trip is fine and avoids drift.

  async function setDefault(id: string) {
    // Clear any other default first; the partial unique index would otherwise
    // reject the second default row.
    await supabase
      .from("finance_party_accounts")
      .update({ is_default: false })
      .eq("party_id", partyId)
      .neq("id", id);
    const { error } = await supabase
      .from("finance_party_accounts")
      .update({ is_default: true, is_active: true })
      .eq("id", id);
    if (error) return toast.error("ثبت پیش‌فرض ناموفق بود");
    toast.success("به عنوان پیش‌فرض ثبت شد");
    await load();
  }

  async function toggleActive(row: PartyAccount) {
    // The DB trigger blocks deactivating a default; we mirror that here so
    // the toast is friendly instead of an SQL error.
    if (row.is_default && row.is_active) {
      toast.error("ابتدا حساب دیگری را پیش‌فرض کنید سپس این را غیرفعال نمایید");
      return;
    }
    const { error } = await supabase
      .from("finance_party_accounts")
      .update({ is_active: !row.is_active })
      .eq("id", row.id);
    if (error) return toast.error("تغییر وضعیت ناموفق بود");
    await load();
  }

  // ----- Render ----------------------------------------------------------

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          حساب‌های ثبت‌شده برای این ذینفع (کارت، شبا، شماره حساب).
        </p>
        <Button size="sm" onClick={() => setEditing("new")}>
          <Plus className="w-4 h-4 ml-1" /> افزودن حساب
        </Button>
      </div>

      {loading && (
        <div className="text-xs text-muted-foreground py-6 text-center">
          در حال بارگذاری...
        </div>
      )}

      {!loading && accounts.length === 0 && (
        <div className="rounded-xl border border-dashed p-6 text-center text-xs text-muted-foreground">
          هنوز حسابی برای این ذینفع ثبت نشده است.
        </div>
      )}

      <ul className="space-y-2">
        {accounts.map((a) => (
          <AccountRow
            key={a.id}
            account={a}
            onEdit={() => setEditing(a)}
            onSetDefault={() => setDefault(a.id)}
            onToggleActive={() => toggleActive(a)}
          />
        ))}
      </ul>

      {editing !== null && (
        <PartyAccountEditor
          partyId={partyId}
          account={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={load}
        />
      )}
    </div>
  );
}

// ----- Single row card ----------------------------------------------------

function AccountRow({
  account,
  onEdit,
  onSetDefault,
  onToggleActive,
}: {
  account: PartyAccount;
  onEdit: () => void;
  onSetDefault: () => void;
  onToggleActive: () => void;
}) {
  return (
    <li
      className={`rounded-xl border p-3 space-y-2 transition-colors ${
        account.is_active ? "bg-card" : "bg-muted/30 opacity-70"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          {/* Title + type label + default badge */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
              {ACCOUNT_TYPE_LABEL_FA[account.account_type]}
            </span>
            {account.account_title && (
              <span className="font-bold text-sm truncate">
                {account.account_title}
              </span>
            )}
            {account.is_default && (
              <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-primary/15 text-primary font-bold">
                <Star className="w-3 h-3" /> پیش‌فرض
              </span>
            )}
            {!account.is_active && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-400 font-bold">
                غیرفعال
              </span>
            )}
          </div>

          {/* Masked value — LTR because it's digits. */}
          <p dir="ltr" className="font-mono text-sm tracking-wider">
            {maskAccountValue(account.account_type, account.account_value)}
          </p>

          {/* Owner / bank / verified date */}
          <div className="text-xs text-muted-foreground space-y-0.5">
            <div>
              <span className="text-foreground/80">صاحب حساب: </span>
              {account.verified_owner_name || account.declared_owner_name}
            </div>
            {account.verified_bank_name && (
              <div>
                <span className="text-foreground/80">بانک: </span>
                {account.verified_bank_name}
              </div>
            )}
            {account.verified_at && (
              <div>
                <span className="text-foreground/80">تاریخ استعلام: </span>
                {new Date(account.verified_at).toLocaleString("fa-IR")}
              </div>
            )}
          </div>

          {/* Verification badge */}
          <VerificationBadge status={account.verification_status} />
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-1 shrink-0">
          <Button size="icon" variant="ghost" onClick={onEdit} title="ویرایش / استعلام مجدد">
            <Pencil className="w-4 h-4" />
          </Button>
          {!account.is_default && account.is_active && (
            <Button size="icon" variant="ghost" onClick={onSetDefault} title="ثبت به عنوان پیش‌فرض">
              <StarOff className="w-4 h-4" />
            </Button>
          )}
          <Button
            size="icon"
            variant="ghost"
            onClick={onToggleActive}
            title={account.is_active ? "غیرفعال کردن" : "فعال کردن"}
          >
            {account.is_active ? <PowerOff className="w-4 h-4" /> : <Power className="w-4 h-4" />}
          </Button>
        </div>
      </div>
    </li>
  );
}

// Small visual cue for verification state — colour & icon picked per status.
function VerificationBadge({ status }: { status: PartyAccountVerificationStatus }) {
  const cfg: Record<PartyAccountVerificationStatus, { cls: string; Icon: typeof BadgeCheck }> = {
    verified: { cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400", Icon: BadgeCheck },
    pending: { cls: "bg-muted text-muted-foreground", Icon: RefreshCcw },
    mismatch: { cls: "bg-destructive/15 text-destructive", Icon: ShieldAlert },
    invalid: { cls: "bg-destructive/15 text-destructive", Icon: ShieldAlert },
    unknown: { cls: "bg-muted text-muted-foreground", Icon: ShieldQuestion },
  };
  const { cls, Icon } = cfg[status];
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-bold ${cls}`}>
      <Icon className="w-3 h-3" />
      {VERIFICATION_LABEL_FA[status]}
    </span>
  );
}
