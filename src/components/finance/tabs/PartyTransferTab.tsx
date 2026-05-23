import { useEffect, useMemo, useState } from "react";
import { toastFinanceError } from "@/lib/financeErrors";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PartySelector } from "@/components/finance/selectors";
import { MoneyCell, JalaliDateCell, FinanceStatusBadge } from "@/components/finance/atoms";
import { createVoucher, sepidarSyncPlaceholder, parseMoney, partyName } from "@/lib/finance";
import { toast } from "sonner";
import { CheckCircle2, Plus, X, ArrowRight, FileCheck2, Filter } from "lucide-react";
// Unified Jalali UI / Gregorian-ISO value date picker.
import DatePicker from "@/components/DatePicker";

// List row shape for finance_party_transfers. We deliberately fetch a narrow
// set of columns to keep the query fast over the legacy import (≈207 rows).
interface PartyTransferRow {
  id: string;
  legacy_id: number | null;
  from_party_id: string | null;
  to_party_id: string | null;
  amount: number | null;
  transfer_datetime: string | null;
  title: string | null;
  status: string | null;
  voucher_id: string | null;
}

interface PartyRef {
  id: string; first_name: string | null; last_name: string | null;
  company_name: string | null; ownership_type: string | null;
}

export default function PartyTransferTab() {
  // Tab default = list of existing party transfers. Create form lives in a
  // modal opened from the primary action button.
  const [rows, setRows] = useState<PartyTransferRow[]>([]);
  const [parties, setParties] = useState<Record<string, PartyRef>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [openForm, setOpenForm] = useState(false);

  // -----------------------------------------------------------------------
  // Filter state — mirror of BankTransferTab. Date inputs flow Gregorian
  // ISO ("YYYY-MM-DD") out of the Jalali <DatePicker /> so we can compare
  // against the ISO-prefix of `transfer_datetime` (timestamptz). Amount
  // inputs are free-text Persian digits parsed by `parseMoney`.
  // -----------------------------------------------------------------------
  const [fromDate, setFromDate] = useState<string | null>(null);
  const [toDate, setToDate] = useState<string | null>(null);
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");

  useEffect(() => { void load(); }, []);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const [{ data, error }, partyRes] = await Promise.all([
        supabase
          .from("finance_party_transfers")
          .select("id,legacy_id,from_party_id,to_party_id,amount,transfer_datetime,title,status,voucher_id")
          .eq("is_deleted", false)
          .order("transfer_datetime", { ascending: false, nullsFirst: false })
          .limit(1000),
        supabase.from("finance_parties").select("id,first_name,last_name,company_name,ownership_type"),
      ]);
      if (error) throw error;
      setRows((data as PartyTransferRow[]) || []);
      const map: Record<string, PartyRef> = {};
      ((partyRes.data as PartyRef[]) || []).forEach((p) => (map[p.id] = p));
      setParties(map);
    } catch (e: unknown) {
      setLoadError(e instanceof Error ? e.message : "خطا در بارگذاری");
    } finally {
      setLoading(false);
    }
  }

  const nameOf = (id: string | null) => (id && parties[id] ? partyName(parties[id]) : "—");

  // -----------------------------------------------------------------------
  // Combined filter pipeline. Date filters compare against the ISO date
  // portion of `transfer_datetime` (kept Gregorian even though the user
  // picks Jalali). Amount filters apply to the single `amount` column.
  // All filters compose with AND.
  // -----------------------------------------------------------------------
  const filtered = useMemo(() => {
    const min = minAmount ? parseMoney(minAmount) : null;
    const max = maxAmount ? parseMoney(maxAmount) : null;
    return rows.filter((r) => {
      if (fromDate || toDate) {
        const iso = r.transfer_datetime ? r.transfer_datetime.slice(0, 10) : null;
        if (!iso) return false;
        if (fromDate && iso < fromDate) return false;
        if (toDate && iso > toDate) return false;
      }
      if (min != null || max != null) {
        const amt = Number(r.amount || 0);
        if (min != null && amt < min) return false;
        if (max != null && amt > max) return false;
      }
      return true;
    });
  }, [rows, fromDate, toDate, minAmount, maxAmount]);

  const hasFilter = !!(fromDate || toDate || minAmount || maxAmount);
  function clearFilters() {
    setFromDate(null); setToDate(null); setMinAmount(""); setMaxAmount("");
  }

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-bold">انتقال بین ذینفع</h2>
        <Button onClick={() => setOpenForm(true)}>
          <Plus className="w-4 h-4 ml-1" /> ثبت انتقال بین ذینفع
        </Button>
      </div>

      {/* Filter bar — date range + amount range. Always visible so the
          user can pre-set filters before the list finishes loading. */}
      <div className="rounded-xl border bg-card p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="inline-flex items-center gap-1 text-xs font-bold text-muted-foreground">
            <Filter className="w-3.5 h-3.5" /> فیلترها
          </span>
          {hasFilter && (
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={clearFilters}>
              پاک کردن فیلترها
            </Button>
          )}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className="space-y-1">
            <Label className="text-[11px]">از تاریخ</Label>
            <DatePicker value={fromDate} onChange={setFromDate} placeholder="تاریخ شروع" />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">تا تاریخ</Label>
            <DatePicker value={toDate} onChange={setToDate} placeholder="تاریخ پایان" />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">حداقل مبلغ</Label>
            <Input dir="ltr" inputMode="numeric" value={minAmount} onChange={(e) => setMinAmount(e.target.value)} placeholder="0" />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">حداکثر مبلغ</Label>
            <Input dir="ltr" inputMode="numeric" value={maxAmount} onChange={(e) => setMaxAmount(e.target.value)} placeholder="∞" />
          </div>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground py-8 text-center">در حال بارگذاری…</p>
      ) : loadError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 text-red-800 text-sm p-3">
          خطا در بارگذاری انتقال‌ها: {loadError}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          هنوز انتقالی بین ذینفعان ثبت نشده.
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          هیچ ردیفی با فیلترهای فعلی پیدا نشد.
        </div>
      ) : (
        <>
          <div className="text-[11px] text-muted-foreground">
            نمایش {filtered.length} از {rows.length} ردیف
          </div>
          <div className="overflow-x-auto rounded-xl border bg-card">
            <table className="w-full text-sm text-right" dir="rtl">
              <thead className="bg-muted/40 text-xs">
                <tr>
                  <th className="p-2 font-bold">کد</th>
                  <th className="p-2 font-bold">ذینفع مبدا</th>
                  <th className="p-2 font-bold">ذینفع مقصد</th>
                  <th className="p-2 font-bold">مبلغ</th>
                  <th className="p-2 font-bold">تاریخ</th>
                  <th className="p-2 font-bold">عنوان</th>
                  <th className="p-2 font-bold">وضعیت</th>
                  <th className="p-2 font-bold">سند</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} className="border-t hover:bg-muted/30">
                    <td className="p-2 font-mono text-xs">{r.legacy_id ?? r.id.slice(0, 8)}</td>
                    <td className="p-2">{nameOf(r.from_party_id)}</td>
                    <td className="p-2">
                      <span className="inline-flex items-center gap-1">
                        <ArrowRight className="w-3 h-3 text-muted-foreground" />
                        {nameOf(r.to_party_id)}
                      </span>
                    </td>
                    <td className="p-2"><MoneyCell value={r.amount} /></td>
                    <td className="p-2"><JalaliDateCell value={r.transfer_datetime} /></td>
                    <td className="p-2 max-w-[14rem] truncate" title={r.title || ""}>{r.title || "—"}</td>
                    <td className="p-2"><FinanceStatusBadge status={r.status} /></td>
                    <td className="p-2">
                      {r.voucher_id ? (
                        <span className="inline-flex items-center gap-1 text-emerald-700 text-xs font-bold">
                          <FileCheck2 className="w-3.5 h-3.5" /> صادر شده
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {openForm && (
        <PartyTransferFormDialog
          onClose={() => setOpenForm(false)}
          onDone={() => { setOpenForm(false); void load(); }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create form moved into a modal — logic unchanged from previous inline form.
// ---------------------------------------------------------------------------
function PartyTransferFormDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [fromParty, setFromParty] = useState<string | null>(null);
  const [toParty, setToParty] = useState<string | null>(null);
  // Gregorian ISO date ("YYYY-MM-DD"). The UI picker shows a Jalali calendar.
  const [date, setDate] = useState<string | null>(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (saving) return;
    if (!fromParty) return toast.error("ذینفع بستانکار را انتخاب کنید");
    if (!toParty) return toast.error("ذینفع بدهکار را انتخاب کنید");
    if (fromParty === toParty) return toast.error("ذینفع‌ها نمی‌توانند یکسان باشند");
    const amt = parseMoney(amount);
    if (amt <= 0) return toast.error("مبلغ نامعتبر");
    setSaving(true);
    try {
      const { data: pt, error } = await supabase
        .from("finance_party_transfers")
        .insert({
          from_party_id: fromParty,
          to_party_id: toParty,
          amount: amt,
          // Anchor at start of day (Tehran) so the timestamptz column stores
          // the same calendar day the user picked from the Jalali calendar.
          transfer_datetime: date ? new Date(`${date}T00:00:00+03:30`).toISOString() : new Date().toISOString(),
          title,
          description,
          status: "approved",
          approved_at: new Date().toISOString(),
        })
        .select("id").single();
      if (error || !pt) throw error || new Error("insert failed");

      const v = await createVoucher({
        voucher_type: "party_transfer",
        source_operation_type: "party_transfer",
        source_operation_id: pt.id,
        title: title || "انتقال بین ذینفع",
        description,
        items: [
          { party_id: toParty, account_type: "party", debit: amt, credit: 0, description: "ذینفع بدهکار" },
          { party_id: fromParty, account_type: "party", debit: 0, credit: amt, description: "ذینفع بستانکار" },
        ],
      });

      await supabase.from("finance_party_transfers").update({ voucher_id: v.id }).eq("id", pt.id);

      const [{ data: from }, { data: to }] = await Promise.all([
        supabase.from("finance_parties").select("balance").eq("id", fromParty).maybeSingle(),
        supabase.from("finance_parties").select("balance").eq("id", toParty).maybeSingle(),
      ]);
      await Promise.all([
        supabase.from("finance_parties").update({ balance: Number(from?.balance || 0) - amt }).eq("id", fromParty),
        supabase.from("finance_parties").update({ balance: Number(to?.balance || 0) + amt }).eq("id", toParty),
      ]);

      await sepidarSyncPlaceholder(v.id, "post_voucher");

      toast.success("انتقال ثبت و سند داخلی صادر شد");
      onDone();
    } catch (e: unknown) {
      toastFinanceError(toast, e);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-card rounded-t-2xl sm:rounded-2xl border shadow-lg w-full max-w-xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b flex items-center justify-between sticky top-0 bg-card z-10">
          <h3 className="font-bold">ثبت انتقال بین ذینفع</h3>
          <Button size="sm" variant="ghost" onClick={onClose}><X className="w-4 h-4" /></Button>
        </div>

        <div className="p-4 space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs">از ذینفع (بستانکار)</Label>
            <PartySelector value={fromParty} onChange={setFromParty} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">به ذینفع (بدهکار)</Label>
            <PartySelector value={toParty} onChange={setToParty} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label className="text-xs">تاریخ جابه‌جایی</Label>
              {/* Jalali UI, Gregorian "YYYY-MM-DD" value flows back into state. */}
              <DatePicker value={date} onChange={setDate} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">مبلغ</Label>
              <Input dir="ltr" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">بابت</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">توضیحات</Label>
            <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
        </div>

        <div className="p-4 border-t flex justify-end gap-2 sticky bottom-0 bg-card">
          <Button variant="outline" onClick={onClose}>انصراف</Button>
          <Button onClick={submit} disabled={saving}>
            <CheckCircle2 className="w-4 h-4 ml-1" /> ثبت و صدور سند
          </Button>
        </div>
      </div>
    </div>
  );
}
