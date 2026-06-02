import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { partyName, formatMoney, formatJalaliDateTime } from "@/lib/finance";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface Bank { id: string; title: string | null; bank_name: string | null; account_number: string | null }
interface Party {
  id: string; ownership_type: string | null; first_name: string | null;
  last_name: string | null; company_name: string | null; national_code: string | null;
}
interface Tx {
  id: string; bank_id: string | null; transaction_datetime: string | null;
  transaction_type: string | null; deposit_amount: number | null; withdraw_amount: number | null;
  description: string | null; reference_number: string | null; assignment_status: string | null;
}

export function BankSelector({
  value,
  onChange,
  placeholder = "انتخاب بانک",
  className,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  placeholder?: string;
  className?: string;
}) {
  const [banks, setBanks] = useState<Bank[]>([]);
  useEffect(() => {
    supabase
      .from("finance_banks")
      .select("id,title,bank_name,account_number")
      .eq("is_deleted", false)
      .eq("is_active", true)
      .order("title")
      .then(({ data }) => setBanks((data as Bank[]) || []));
  }, []);
  return (
    <select
      value={value || ""}
      onChange={(e) => onChange(e.target.value || null)}
      className={cn(
        "h-10 w-full rounded-md border border-input bg-background px-3 text-sm",
        className,
      )}
    >
      <option value="">{placeholder}</option>
      {banks.map((b) => (
        <option key={b.id} value={b.id}>
          {b.title || b.bank_name || b.account_number || b.id.slice(0, 6)}
        </option>
      ))}
    </select>
  );
}

export function PartySelector({
  value,
  onChange,
  placeholder = "انتخاب ذینفع",
}: {
  value: string | null;
  onChange: (id: string | null, party?: Party) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [parties, setParties] = useState<Party[]>([]);
  const [selected, setSelected] = useState<Party | null>(null);
  const [q, setQ] = useState("");
  useEffect(() => {
    supabase
      .from("finance_parties")
      .select("id,ownership_type,first_name,last_name,company_name,national_code")
      .eq("is_deleted", false)
      .order("created_at", { ascending: false })
      .limit(500)
      .then(({ data }) => setParties((data as Party[]) || []));
  }, []);
  useEffect(() => {
    if (value && !selected) {
      const found = parties.find((p) => p.id === value);
      if (found) setSelected(found);
    }
    if (!value) setSelected(null);
  }, [value, parties, selected]);

  const filtered = parties.filter((p) => {
    if (!q) return true;
    const s = `${partyName(p)} ${p.national_code || ""}`.toLowerCase();
    return s.includes(q.toLowerCase());
  });

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-right flex items-center justify-between"
      >
        <span className={selected ? "" : "text-muted-foreground"}>
          {selected ? partyName(selected) : placeholder}
        </span>
        {selected && (
          <X
            className="w-4 h-4 text-muted-foreground"
            onClick={(e) => {
              e.stopPropagation();
              setSelected(null);
              onChange(null);
            }}
          />
        )}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
          <div className="bg-card rounded-xl border shadow-lg w-full max-w-md max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b">
              <div className="flex items-center gap-2">
                <Search className="w-4 h-4 text-muted-foreground" />
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="جستجو نام / کد ملی" autoFocus />
              </div>
            </div>
            <div className="overflow-y-auto p-2 flex-1">
              {filtered.map((p) => (
                <button
                  key={p.id}
                  className="w-full text-right p-3 hover:bg-secondary rounded-lg flex flex-col gap-0.5"
                  onClick={() => {
                    setSelected(p);
                    onChange(p.id, p);
                    setOpen(false);
                  }}
                >
                  <span className="font-bold">{partyName(p)}</span>
                  <span className="text-xs text-muted-foreground">{p.national_code || "بدون کد ملی"}</span>
                </button>
              ))}
              {filtered.length === 0 && (
                <p className="text-center text-sm text-muted-foreground py-8">ذینفعی یافت نشد</p>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function TransactionSelector({
  value,
  onChange,
  filter,
  placeholder = "انتخاب تراکنش",
}: {
  value: string | null;
  onChange: (id: string | null, tx?: Tx) => void;
  filter?: { transaction_type?: "deposit" | "withdraw"; bank_id?: string | null; assignment_status?: string };
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [txs, setTxs] = useState<Tx[]>([]);
  const [banks, setBanks] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Tx | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    // Defense-in-depth: we always exclude any transaction that already has
    // an ACTIVE payment allocation or receive identification, in addition
    // to relying on `finance_bank_transactions.assignment_status`. The DB
    // unique partial indexes + the BEFORE INSERT/UPDATE triggers on both
    // tables are the authoritative protection against reuse; this client
    // filter only ensures the UI never offers a transaction that would be
    // rejected anyway.
    void (async () => {
      const [{ data: usedAllocs }, { data: usedIds }] = await Promise.all([
        supabase
          .from("finance_payment_allocations")
          .select("bank_transaction_id")
          .eq("is_deleted", false)
          .not("status", "in", "(cancelled,rejected)"),
        supabase
          .from("finance_receive_identifications")
          .select("bank_transaction_id")
          .eq("is_deleted", false)
          .not("status", "in", "(cancelled,rejected)"),
      ]);
      const usedSet = new Set<string>();
      ((usedAllocs as { bank_transaction_id: string | null }[]) || []).forEach((r) => {
        if (r.bank_transaction_id) usedSet.add(r.bank_transaction_id);
      });
      ((usedIds as { bank_transaction_id: string | null }[]) || []).forEach((r) => {
        if (r.bank_transaction_id) usedSet.add(r.bank_transaction_id);
      });

      let q = supabase
        .from("finance_bank_transactions")
        .select("id,bank_id,transaction_datetime,transaction_type,deposit_amount,withdraw_amount,description,reference_number,assignment_status")
        .eq("is_deleted", false)
        .order("transaction_datetime", { ascending: false })
        .limit(500);
      if (filter?.transaction_type) q = q.eq("transaction_type", filter.transaction_type);
      if (filter?.bank_id) q = q.eq("bank_id", filter.bank_id);
      q = q.eq("assignment_status", filter?.assignment_status || "unassigned");
      const { data } = await q;
      // Final client-side scrub so reused transactions never appear in the
      // picker even if `assignment_status` ever drifts out of sync.
      const rows = ((data as Tx[]) || []).filter((t) => !usedSet.has(t.id));
      setTxs(rows);
    })();

    supabase
      .from("finance_banks")
      .select("id,title,bank_name")
      .then(({ data }) => {
        const m: Record<string, string> = {};
        ((data as { id: string; title: string | null; bank_name: string | null }[]) || []).forEach(
          (b) => (m[b.id] = b.title || b.bank_name || ""),
        );
        setBanks(m);
      });
  }, [filter?.transaction_type, filter?.bank_id, filter?.assignment_status]);

  useEffect(() => {
    if (value && !selected) {
      supabase
        .from("finance_bank_transactions")
        .select("id,bank_id,transaction_datetime,transaction_type,deposit_amount,withdraw_amount,description,reference_number,assignment_status")
        .eq("id", value)
        .maybeSingle()
        .then(({ data }) => data && setSelected(data as Tx));
    }
    if (!value) setSelected(null);
  }, [value, selected]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="h-auto min-h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-right"
      >
        {selected ? (
          <div className="flex flex-col gap-0.5">
            <div className="flex justify-between gap-2">
              <span className="font-bold">{banks[selected.bank_id || ""] || "—"}</span>
              <span className="font-bold tabular-nums">
                {formatMoney(selected.deposit_amount || selected.withdraw_amount)}
              </span>
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{formatJalaliDateTime(selected.transaction_datetime)}</span>
              <span>{selected.reference_number || "—"}</span>
            </div>
          </div>
        ) : (
          <span className="text-muted-foreground">{placeholder}</span>
        )}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
          <div className="bg-card rounded-xl border shadow-lg w-full max-w-2xl max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b flex items-center justify-between">
              <h3 className="font-bold">{placeholder}</h3>
              <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
                <X className="w-4 h-4" />
              </Button>
            </div>
            <div className="overflow-y-auto p-2 flex-1">
              {txs.length === 0 && (
                <p className="text-center text-sm text-muted-foreground py-8">رسیدی یافت نشد</p>
              )}
              {txs.map((t) => (
                <button
                  key={t.id}
                  className="w-full text-right p-3 hover:bg-secondary rounded-lg flex flex-col gap-1 border-b border-border"
                  onClick={() => {
                    setSelected(t);
                    onChange(t.id, t);
                    setOpen(false);
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold">{banks[t.bank_id || ""] || "—"}</span>
                    <span className="font-bold tabular-nums text-emerald-700">
                      {formatMoney(t.deposit_amount || t.withdraw_amount)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{formatJalaliDateTime(t.transaction_datetime)}</span>
                    <span>{t.reference_number || "بدون مرجع"}</span>
                  </div>
                  {t.description && <p className="text-xs text-muted-foreground line-clamp-1">{t.description}</p>}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
