import { useEffect, useMemo, useState } from "react";
import { toastFinanceError } from "@/lib/financeErrors";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { TransactionSelector, PartySelector } from "@/components/finance/selectors";
import { MoneyCell, JalaliDateCell, FinanceStatusBadge } from "@/components/finance/atoms";
import { createVoucher, sepidarSyncPlaceholder, parseMoney, formatMoney, type VoucherItemInput } from "@/lib/finance";
import { toast } from "sonner";
import { CheckCircle2, Plus, X, ArrowRight, FileCheck2, Filter } from "lucide-react";
// Unified Jalali-UI / Gregorian-ISO value picker. We use this for the
// filter inputs so the user always sees a Persian calendar while the
// underlying date comparisons happen on Gregorian ISO strings — matching
// what `transfer_datetime` (timestamptz) actually stores in the DB.
import DatePicker from "@/components/DatePicker";
// Phase 4 — generic rollback button used in the row actions column.
import { RollbackButton } from "@/components/finance/RollbackConfirmDialog";
// React-router hook: we read `?transferId=` from the URL so the deep-link
// from the bank-transactions AssignmentDetailsDialog can auto-open a
// read-only detail panel here. Kept self-contained so the create form below
// is unaffected.
import { useSearchParams } from "react-router-dom";
// Reused read-only detail panel. We mount it with `hideNavButton` so the
// "go to related tab" button doesn't render a self-referential link.
import AssignmentDetailsDialog from "@/components/finance/AssignmentDetailsDialog";

interface SelectedTx {
  id: string; bank_id: string | null; deposit_amount: number | null;
  withdraw_amount: number | null; transaction_datetime: string | null;
}

// Row shape for the bank-transfer LIST view. We keep this narrow on purpose —
// the create form has its own state.
interface BankTransferRow {
  id: string;
  legacy_id: number | null;
  from_bank_id: string | null;
  to_bank_id: string | null;
  from_amount: number | null;
  to_amount: number | null;
  transfer_datetime: string | null;
  status: string | null;
  voucher_id: string | null;
  description: string | null;
}

interface BankRef { id: string; title: string | null; bank_name: string | null }

export default function BankTransferTab() {
  // --- List state ----------------------------------------------------------
  // Default view = list. The user explicitly asked the create form to be
  // opened only via a primary button so legacy imported rows (≈325 records)
  // are visible immediately.
  const [rows, setRows] = useState<BankTransferRow[]>([]);
  const [banks, setBanks] = useState<Record<string, BankRef>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [openForm, setOpenForm] = useState(false);

  // -----------------------------------------------------------------------
  // Filter state.
  // Date filters are Gregorian ISO ("YYYY-MM-DD") flowing out of the Jalali
  // <DatePicker /> so we can compare directly against the ISO prefix of
  // `transfer_datetime` (timestamptz). Amount filters are free-text Persian
  // digits parsed via `parseMoney`.
  // -----------------------------------------------------------------------
  const [fromDate, setFromDate] = useState<string | null>(null);
  const [toDate, setToDate] = useState<string | null>(null);
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");

  // -----------------------------------------------------------------------
  // Deep-link consumer — `?transferId=<uuid>` arriving from the
  // bank-transactions AssignmentDetailsDialog ("رفتن به تب مرتبط" → new
  // browser tab). We open AssignmentDetailsDialog as a read-only detail
  // panel for that transfer. If the id isn't resolvable, the dialog itself
  // surfaces the "رکورد ... یافت نشد" message.
  // -----------------------------------------------------------------------
  const [searchParams, setSearchParams] = useSearchParams();
  const [deepLinkTransferId, setDeepLinkTransferId] = useState<string | null>(null);
  useEffect(() => {
    const id = searchParams.get("transferId");
    if (!id) return;
    setDeepLinkTransferId(id);
    // Strip the param so re-renders / refreshes don't re-open the dialog.
    const p = new URLSearchParams(searchParams);
    p.delete("transferId");
    setSearchParams(p, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { void load(); }, []);


  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      // Pull a generous page; the table currently holds at most a few hundred
      // legacy rows so a single query is fine. If volume grows we should
      // introduce pagination.
      const [{ data, error }, banksRes] = await Promise.all([
        supabase
          .from("finance_bank_transfers")
          .select("id,legacy_id,from_bank_id,to_bank_id,from_amount,to_amount,transfer_datetime,status,voucher_id,description")
          .eq("is_deleted", false)
          .order("transfer_datetime", { ascending: false, nullsFirst: false })
          .limit(1000),
        supabase.from("finance_banks").select("id,title,bank_name"),
      ]);
      if (error) throw error;
      setRows((data as BankTransferRow[]) || []);
      const map: Record<string, BankRef> = {};
      ((banksRes.data as BankRef[]) || []).forEach((b) => (map[b.id] = b));
      setBanks(map);
    } catch (e: unknown) {
      setLoadError(e instanceof Error ? e.message : "خطا در بارگذاری");
    } finally {
      setLoading(false);
    }
  }

  const bankLabel = (id: string | null) => {
    if (!id) return "—";
    const b = banks[id];
    return b?.title || b?.bank_name || id.slice(0, 8);
  };

  // -----------------------------------------------------------------------
  // Combined filter pipeline. Date filters compare against the ISO date
  // portion of `transfer_datetime` (i.e. "YYYY-MM-DD"), which keeps the
  // comparison Gregorian even though the user picked Jalali in the UI.
  // Amount filters apply to BOTH from_amount and to_amount because a row
  // can legitimately have asymmetric values (fees / FX). We accept the row
  // if EITHER side falls inside the [min, max] window.
  // All filters compose with AND so the user can stack them freely.
  // -----------------------------------------------------------------------
  const filtered = useMemo(() => {
    const min = minAmount ? parseMoney(minAmount) : null;
    const max = maxAmount ? parseMoney(maxAmount) : null;
    return rows.filter((r) => {
      // Date range — null fields are excluded as soon as ANY date filter is set.
      if (fromDate || toDate) {
        const iso = r.transfer_datetime ? r.transfer_datetime.slice(0, 10) : null;
        if (!iso) return false;
        if (fromDate && iso < fromDate) return false;
        if (toDate && iso > toDate) return false;
      }
      // Amount range — compare against the larger of from/to side, which is
      // the value the user actually sees on the row for "this much moved".
      if (min != null || max != null) {
        const candidate = Math.max(Number(r.from_amount || 0), Number(r.to_amount || 0));
        if (min != null && candidate < min) return false;
        if (max != null && candidate > max) return false;
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
        <h2 className="text-lg font-bold">انتقال بین بانکی</h2>
        <Button onClick={() => setOpenForm(true)}>
          <Plus className="w-4 h-4 ml-1" /> ثبت انتقال بین بانکی
        </Button>
      </div>

      {/* -------------------------------------------------------------
          Filter bar — date range + amount range. We keep the bar
          rendered even when the list is loading so the user can pre-set
          their filters; the memoised pipeline applies as soon as data
          arrives.
          ------------------------------------------------------------- */}
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
          هنوز انتقالی ثبت نشده — برای شروع روی «ثبت انتقال بین بانکی» بزنید.
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
                  <th className="p-2 font-bold">بانک مبدا</th>
                  <th className="p-2 font-bold">بانک مقصد</th>
                  <th className="p-2 font-bold">مبلغ مبدا</th>
                  <th className="p-2 font-bold">مبلغ مقصد</th>
                  <th className="p-2 font-bold">تاریخ انتقال</th>
                  <th className="p-2 font-bold">وضعیت</th>
                  <th className="p-2 font-bold">سند</th>
                  <th className="p-2 font-bold">اقدام</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} className="border-t hover:bg-muted/30">
                    <td className="p-2 font-mono text-xs">{r.legacy_id ?? r.id.slice(0, 8)}</td>
                    <td className="p-2">{bankLabel(r.from_bank_id)}</td>
                    <td className="p-2">
                      <span className="inline-flex items-center gap-1">
                        <ArrowRight className="w-3 h-3 text-muted-foreground" />
                        {bankLabel(r.to_bank_id)}
                      </span>
                    </td>
                    <td className="p-2"><MoneyCell value={r.from_amount} /></td>
                    <td className="p-2"><MoneyCell value={r.to_amount} positive /></td>
                    <td className="p-2"><JalaliDateCell value={r.transfer_datetime} /></td>
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
                    {/* Phase 4 rollback action — only enabled for transfers that
                        already created a voucher AND aren't already cancelled. */}
                    <td className="p-2">
                      {r.voucher_id && r.status !== "cancelled" && r.status !== "rolled_back" && (
                        <RollbackButton
                          entityType="bank_transfer"
                          entityId={r.id}
                          metadata={{
                            operationLabel: "انتقال بانکی",
                            amount: r.from_amount ?? r.to_amount,
                            bankLabel: `${bankLabel(r.from_bank_id)} ← ${bankLabel(r.to_bank_id)}`,
                            sepidarVoucherId: r.voucher_id,
                          }}
                          onSuccess={() => void load()}
                        />
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
        <BankTransferFormDialog
          onClose={() => setOpenForm(false)}
          onDone={() => { setOpenForm(false); void load(); }}
        />
      )}
      {/* Deep-link detail panel — opened when arriving from a bank
          transaction whose assignment points at a bank_transfer record.
          `hideNavButton` prevents a circular "back to related tab" link. */}
      <AssignmentDetailsDialog
        open={!!deepLinkTransferId}
        onClose={() => setDeepLinkTransferId(null)}
        operationType={deepLinkTransferId ? "bank_transfer" : null}
        operationId={deepLinkTransferId}
        hideNavButton
        onRollbackSuccess={() => { setDeepLinkTransferId(null); void load(); }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create form — extracted into a modal so the tab can default to the list
// view. The logic is unchanged from the previous inline form.
// ---------------------------------------------------------------------------
function BankTransferFormDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [fromId, setFromId] = useState<string | null>(null);
  const [fromTx, setFromTx] = useState<SelectedTx | null>(null);
  const [toId, setToId] = useState<string | null>(null);
  const [toTx, setToTx] = useState<SelectedTx | null>(null);
  const [hasFee, setHasFee] = useState(false);
  const [feeAmount, setFeeAmount] = useState("");
  const [feeParty, setFeeParty] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  const fromAmount = fromTx?.withdraw_amount || 0;
  const toAmount = toTx?.deposit_amount || 0;
  const computedFee = hasFee ? parseMoney(feeAmount) : 0;
  const diff = Number(fromAmount) - Number(toAmount);
  const valid = !!fromTx && !!toTx && Math.abs(diff - computedFee) < 0.01;

  async function submit() {
    if (saving) return;
    if (!fromTx || !toTx || !fromId || !toId) return toast.error("هر دو رسید را انتخاب کنید");
    if (!fromTx.bank_id || !toTx.bank_id) return toast.error("بانک نامعتبر");
    if (fromTx.bank_id === toTx.bank_id) return toast.error("بانک مبدا و مقصد یکسان است");
    if (!valid) return toast.error("اختلاف مبلغ با کارمزد نمی‌خواند");
    setSaving(true);
    try {
      const { data: tr, error } = await supabase
        .from("finance_bank_transfers")
        .insert({
          from_bank_id: fromTx.bank_id,
          to_bank_id: toTx.bank_id,
          from_transaction_id: fromId,
          to_transaction_id: toId,
          from_amount: fromAmount,
          to_amount: toAmount,
          transfer_datetime: fromTx.transaction_datetime,
          has_fee: hasFee,
          fee_amount: computedFee,
          fee_party_id: hasFee ? feeParty : null,
          description,
          status: "approved",
          approved_at: new Date().toISOString(),
        })
        .select("id").single();
      if (error || !tr) throw error || new Error("insert failed");

      await supabase.from("finance_bank_transactions").update({
        assignment_status: "assigning",
        assigned_operation_type: "bank_transfer",
        assigned_operation_id: tr.id,
      }).in("id", [fromId, toId]);

      const items: VoucherItemInput[] = [
        { bank_id: toTx.bank_id, account_type: "bank", debit: toAmount, credit: 0, description: "بانک مقصد" },
        { bank_id: fromTx.bank_id, account_type: "bank", debit: 0, credit: fromAmount, description: "بانک مبدا" },
      ];
      if (hasFee && computedFee > 0) {
        items.push({
          party_id: feeParty,
          account_type: feeParty ? "party" : "expense",
          debit: computedFee,
          credit: 0,
          description: "کارمزد انتقال",
        });
      }
      const v = await createVoucher({
        voucher_type: "bank_transfer",
        source_operation_type: "bank_transfer",
        source_operation_id: tr.id,
        title: "انتقال بین بانکی",
        description,
        items,
      });

      await supabase.from("finance_bank_transfers").update({ voucher_id: v.id }).eq("id", tr.id);
      await sepidarSyncPlaceholder(v.id, "post_voucher");

      await supabase.from("finance_bank_transactions").update({
        assignment_status: "assigned",
      }).in("id", [fromId, toId]);

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
      <div className="bg-card rounded-t-2xl sm:rounded-2xl border shadow-lg w-full max-w-2xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b flex items-center justify-between sticky top-0 bg-card z-10">
          <h3 className="font-bold">ثبت انتقال بین بانکی</h3>
          <Button size="sm" variant="ghost" onClick={onClose}><X className="w-4 h-4" /></Button>
        </div>

        <div className="p-4 space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs">۱) رسید بانک مبدا (برداشت)</Label>
            <TransactionSelector value={fromId} onChange={(id, t) => { setFromId(id); setFromTx(t || null); }} filter={{ transaction_type: "withdraw", assignment_status: "unassigned" }} placeholder="انتخاب برداشت" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">۲) رسید بانک مقصد (واریز)</Label>
            <TransactionSelector value={toId} onChange={(id, t) => { setToId(id); setToTx(t || null); }} filter={{ transaction_type: "deposit", assignment_status: "unassigned" }} placeholder="انتخاب واریز" />
          </div>

          {fromTx && toTx && (
            <div className="rounded-lg bg-muted/30 p-3 text-sm space-y-1">
              <div className="flex justify-between"><span>برداشت مبدا</span><span className="font-bold tabular-nums">{formatMoney(fromAmount)}</span></div>
              <div className="flex justify-between"><span>واریز مقصد</span><span className="font-bold tabular-nums">{formatMoney(toAmount)}</span></div>
              <div className="flex justify-between"><span>اختلاف</span><span className="font-bold tabular-nums">{formatMoney(diff)}</span></div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setHasFee(false)} className={`h-10 rounded-md border text-sm font-bold ${!hasFee ? "bg-primary text-primary-foreground border-primary" : "bg-background"}`}>بدون کارمزد</button>
            <button type="button" onClick={() => setHasFee(true)} className={`h-10 rounded-md border text-sm font-bold ${hasFee ? "bg-primary text-primary-foreground border-primary" : "bg-background"}`}>دارای کارمزد</button>
          </div>

          {hasFee && (
            <>
              <div className="space-y-1.5">
                <Label className="text-xs">مبلغ کارمزد</Label>
                <Input dir="ltr" inputMode="numeric" value={feeAmount} onChange={(e) => setFeeAmount(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">محل کارمزد (ذینفع)</Label>
                <PartySelector value={feeParty} onChange={setFeeParty} placeholder="در صورت خالی بودن، حساب هزینه" />
              </div>
            </>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs">توضیحات</Label>
            <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
        </div>

        <div className="p-4 border-t flex justify-end gap-2 sticky bottom-0 bg-card">
          <Button variant="outline" onClick={onClose}>انصراف</Button>
          <Button onClick={submit} disabled={saving || !valid}>
            <CheckCircle2 className="w-4 h-4 ml-1" /> ثبت و صدور سند
          </Button>
        </div>
      </div>
    </div>
  );
}
