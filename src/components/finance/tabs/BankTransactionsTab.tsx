import { useEffect, useMemo, useState } from "react";
import { toastFinanceError } from "@/lib/financeErrors";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MoneyCell, JalaliDateCell, FinanceStatusBadge } from "@/components/finance/atoms";
import { BankSelector } from "@/components/finance/selectors";
import { parseMoney, recalculateBankUnassignedBalances } from "@/lib/finance";
// Phase 4 wiring: run the auto-identification pipeline right after each
// imported row lands in the DB. The helper is intentionally side-effect
// driven (writes audit log + identifier rows itself) so the import code
// only needs to feed it the persisted bank_transaction_id.
import {
  autoIdentifyTransaction,
  emptyAutoIdentifySummary,
  bumpSummary,
  type AutoIdentifySummary,
} from "@/lib/autoIdentify";
import { legacyBankLabel } from "@/lib/legacyBanks";
import { NewReceiveIdDialog } from "@/components/finance/tabs/ReceiveIdentificationTab";
import { Plus, Upload, Download, X, Trash2, FileText, AlertTriangle, ArrowDownToLine, ArrowUpFromLine, ArrowLeftRight, Link2 } from "lucide-react";
import { toast } from "sonner";
// Unified Jalali UI / Gregorian-ISO value date picker — see src/components/DatePicker.tsx
import DatePicker from "@/components/DatePicker";

interface Tx {
  id: string;
  bank_id: string | null;
  transaction_datetime: string | null;
  transaction_type: string | null;
  deposit_amount: number | null;
  withdraw_amount: number | null;
  amount: number | null;
  balance_after: number | null;
  description: string | null;
  document_number: string | null;
  reference_number: string | null;
  tracking_number: string | null;
  card_number: string | null;
  source_type: string | null;
  assignment_status: string | null;
  assigned_operation_type: string | null;
  assigned_operation_id: string | null;
  raw_data: unknown;
  // Path inside the `finance-imports` Storage bucket where the original
  // Excel/CSV file was archived at import-time. Null for manual rows or
  // legacy rows imported before archival was wired up.
  imported_file_path: string | null;
  original_file_name: string | null;
  imported_file_name: string | null;
}

interface BankRef { id: string; title: string | null; bank_name: string | null }

// Per-transaction identifier extracted from the description during import.
// Used to render the "card / IBAN / account" + verified-owner chips on each row.
interface IdentRow {
  match_type: number;            // 1=account, 2=card, 3=IBAN (per bankpartyaccountinfos convention)
  raw_value: string | null;
  normalized_value: string | null;
  verified_owner_name: string | null;
  verified_bank_name: string | null;
}

// Light-weight projection of the receive identification linked to a tx —
// only the fields we need to drive badges & the auto-state filter.
interface ReceiveMeta {
  id: string;
  party_id: string | null;
  status: string | null;
  auto_identified: boolean | null;
  identification_source: string | null;
  sepidar_sync_status: string | null;
  voucher_id: string | null;
}

// Auto-identification state derived for filter chips & badge rendering.
type AutoState = "auto_identified" | "manual" | "needs_review" | "no_identifier" | "sepidar_failed";

// Pure helper so the table row, the mobile card, and the chip filter all
// agree on the per-transaction state.
function deriveAutoState(t: Tx, idents: IdentRow[] | undefined, ri: ReceiveMeta | undefined): AutoState {
  // Sepidar failure trumps everything else — operator needs to see it first.
  if (ri?.sepidar_sync_status === "failed") return "sepidar_failed";
  if (ri) return ri.auto_identified ? "auto_identified" : "manual";
  if (idents && idents.length > 0) return "needs_review";
  return "no_identifier";
}

const MATCH_TYPE_LABEL: Record<number, string> = { 1: "حساب", 2: "کارت", 3: "شبا" };

export default function BankTransactionsTab({ initialBankId }: { initialBankId?: string }) {
  const [txs, setTxs] = useState<Tx[]>([]);
  const [banks, setBanks] = useState<Record<string, BankRef>>({});
  const [filterBank, setFilterBank] = useState<string | null>(initialBankId || null);
  const [filterType, setFilterType] = useState<string>("");
  const [filterAssign, setFilterAssign] = useState<string>("");
  const [filterDescr, setFilterDescr] = useState("");
  // Transaction-date range (Gregorian ISO from the Jalali DatePicker).
  // These filter on `transaction_datetime` (the real banking date),
  // NOT on `created_at` (when the row was inserted into our DB).
  const [filterFromDate, setFilterFromDate] = useState<string | null>(null);
  const [filterToDate, setFilterToDate] = useState<string | null>(null);
  // Amount range filters — applied client-side over deposit OR withdraw amount
  // so a single range covers both directions of the transaction.
  const [filterMinAmount, setFilterMinAmount] = useState("");
  const [filterMaxAmount, setFilterMaxAmount] = useState("");
  const [openManual, setOpenManual] = useState(false);
  const [openExcel, setOpenExcel] = useState(false);
  const [openRaw, setOpenRaw] = useState<Tx | null>(null);
  const [openReceiveId, setOpenReceiveId] = useState<Tx | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.from("finance_banks").select("id,title,bank_name").then(({ data }) => {
      const m: Record<string, BankRef> = {};
      (data as BankRef[] || []).forEach((b) => (m[b.id] = b));
      setBanks(m);
    });
  }, []);

  // Per-row enrichment maps populated alongside `txs` so badges & chip
  // filters can render without N+1 queries inside the render loop.
  const [identByTx, setIdentByTx] = useState<Record<string, IdentRow[]>>({});
  const [receiveByTx, setReceiveByTx] = useState<Record<string, ReceiveMeta>>({});
  const [partyNames, setPartyNames] = useState<Record<string, string>>({});
  // Chip filter — empty string = "show all"; otherwise narrows to a single
  // auto-identification state. Applied client-side because the state is
  // a join across three tables and we already have the rows in memory.
  const [filterAutoState, setFilterAutoState] = useState<"" | AutoState>("");

  // Re-fetch when server-side filters change. Date range goes here too so
  // we don't pull 500 rows and then trim — Postgres does the work.
  useEffect(() => { void load(); }, [filterBank, filterType, filterAssign, filterFromDate, filterToDate]);

  async function load() {
    setLoading(true);
    let q = supabase
      .from("finance_bank_transactions")
      .select("*")
      .eq("is_deleted", false)
      .order("transaction_datetime", { ascending: false })
      .limit(500);
    if (filterBank) q = q.eq("bank_id", filterBank);
    if (filterType) q = q.eq("transaction_type", filterType);
    if (filterAssign) q = q.eq("assignment_status", filterAssign);
    // Inclusive range on the real transaction date column.
    if (filterFromDate) q = q.gte("transaction_datetime", filterFromDate);
    if (filterToDate) q = q.lte("transaction_datetime", filterToDate);
    const { data } = await q;
    const rows = (data as Tx[]) || [];
    setTxs(rows);

    // -----------------------------------------------------------------------
    // Side-load the per-tx enrichment used by badges & chip filters. Three
    // parallel `.in()` queries keep this O(1) round-trips regardless of how
    // many rows came back from the main fetch.
    // -----------------------------------------------------------------------
    const ids = rows.map((r) => r.id);
    if (ids.length === 0) {
      setIdentByTx({}); setReceiveByTx({}); setPartyNames({});
    } else {
      const [identsRes, receivesRes] = await Promise.all([
        supabase
          .from("finance_bank_tx_identifiers")
          .select("bank_transaction_id, match_type, raw_value, normalized_value, verified_owner_name, verified_bank_name")
          .in("bank_transaction_id", ids),
        supabase
          .from("finance_receive_identifications")
          .select("id, bank_transaction_id, party_id, status, auto_identified, identification_source, sepidar_sync_status, voucher_id")
          .in("bank_transaction_id", ids)
          .eq("is_deleted", false),
      ]);
      const im: Record<string, IdentRow[]> = {};
      for (const r of (identsRes.data || []) as Array<IdentRow & { bank_transaction_id: string }>) {
        (im[r.bank_transaction_id] ||= []).push(r);
      }
      setIdentByTx(im);
      const rm: Record<string, ReceiveMeta> = {};
      const partyIds = new Set<string>();
      for (const r of (receivesRes.data || []) as Array<ReceiveMeta & { bank_transaction_id: string }>) {
        // A tx should only have ONE active receive identification (DB guard
        // enforces this), but if duplicates ever slip through we keep the
        // first — order doesn't matter for badge rendering.
        if (!rm[r.bank_transaction_id]) rm[r.bank_transaction_id] = r;
        if (r.party_id) partyIds.add(r.party_id);
      }
      setReceiveByTx(rm);
      if (partyIds.size > 0) {
        const { data: pdata } = await supabase
          .from("finance_parties")
          .select("id, company_name, sepidar_full_name, first_name, last_name")
          .in("id", Array.from(partyIds));
        const pm: Record<string, string> = {};
        for (const p of (pdata || []) as Array<{ id: string; company_name: string | null; sepidar_full_name: string | null; first_name: string | null; last_name: string | null }>) {
          pm[p.id] =
            p.sepidar_full_name ||
            p.company_name ||
            [p.first_name, p.last_name].filter(Boolean).join(" ").trim() ||
            "—";
        }
        setPartyNames(pm);
      } else {
        setPartyNames({});
      }
    }
    setLoading(false);
  }

  const filtered = useMemo(() => {
    // Parse amount bounds once. Empty string → no bound.
    const min = filterMinAmount ? parseMoney(filterMinAmount) : null;
    const max = filterMaxAmount ? parseMoney(filterMaxAmount) : null;
    const needle = filterDescr.trim().toLowerCase();
    return txs.filter((t) => {
      if (needle && !(t.description || "").toLowerCase().includes(needle)) return false;
      if (min !== null || max !== null) {
        // Compare against whichever side of the transaction is non-zero.
        // Falls back to abs(amount) for legacy rows that only set `amount`.
        const v = Math.abs(
          Number(t.deposit_amount) || Number(t.withdraw_amount) || Number(t.amount) || 0,
        );
        if (min !== null && v < min) return false;
        if (max !== null && v > max) return false;
      }
      // Auto-identification chip filter — derived state, applied last so
      // it composes cleanly with the existing description / amount filters.
      if (filterAutoState) {
        const st = deriveAutoState(t, identByTx[t.id], receiveByTx[t.id]);
        if (st !== filterAutoState) return false;
      }
      return true;
    });
  }, [txs, filterDescr, filterMinAmount, filterMaxAmount, filterAutoState, identByTx, receiveByTx]);

  // Live counts for the chip bar — driven by the unfiltered (server-side
  // filtered) set so the user can see how many rows each chip would reveal.
  const autoCounts = useMemo(() => {
    const c: Record<AutoState, number> = {
      auto_identified: 0, manual: 0, needs_review: 0, no_identifier: 0, sepidar_failed: 0,
    };
    for (const t of txs) c[deriveAutoState(t, identByTx[t.id], receiveByTx[t.id])]++;
    return c;
  }, [txs, identByTx, receiveByTx]);


  async function softDelete(t: Tx) {
    if (!confirm("حذف این تراکنش؟")) return;
    const { error } = await supabase
      .from("finance_bank_transactions")
      .update({ is_deleted: true, deleted_at: new Date().toISOString() })
      .eq("id", t.id);
    if (error) return toastFinanceError(toast, error);
    if (t.bank_id) await recalculateBankUnassignedBalances(t.bank_id);
    toast.success("حذف شد");
    void load();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-bold">تراکنش‌های بانکی</h2>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" onClick={() => setOpenExcel(true)}><Upload className="w-4 h-4 ml-1" /> آپلود اکسل</Button>
          <Button variant="outline" onClick={() => toast.info("دریافت از API هنوز پیاده‌سازی نشده — placeholder")}>
            <Download className="w-4 h-4 ml-1" /> دریافت از API
          </Button>
          <Button onClick={() => setOpenManual(true)}><Plus className="w-4 h-4 ml-1" /> ثبت دستی</Button>
        </div>
      </div>

      {/* Filters — first row: bank / type / assignment / description search */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <BankSelector value={filterBank} onChange={setFilterBank} placeholder="همه بانک‌ها" />
        <select value={filterType} onChange={(e) => setFilterType(e.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
          <option value="">نوع تراکنش</option>
          <option value="deposit">واریز</option>
          <option value="withdraw">برداشت</option>
        </select>
        <select value={filterAssign} onChange={(e) => setFilterAssign(e.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
          <option value="">وضعیت تخصیص</option>
          <option value="unassigned">تخصیص نشده</option>
          <option value="assigning">در حال تخصیص</option>
          <option value="assigned">تخصیص شده</option>
          <option value="rejected">رد شده</option>
          <option value="cancelled">لغو شده</option>
        </select>
        <Input placeholder="شرح..." value={filterDescr} onChange={(e) => setFilterDescr(e.target.value)} />
      </div>

      {/* Filters — second row: real transaction date range + amount range.
          Date filters hit `transaction_datetime` (not `created_at`).
          Amount range matches abs(deposit OR withdraw) so a single range
          covers both directions. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div>
          <Label className="text-xs text-muted-foreground mb-1 block">از تاریخ تراکنش</Label>
          <DatePicker value={filterFromDate} onChange={setFilterFromDate} />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground mb-1 block">تا تاریخ تراکنش</Label>
          <DatePicker value={filterToDate} onChange={setFilterToDate} />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground mb-1 block">حداقل مبلغ</Label>
          <Input inputMode="numeric" placeholder="0" value={filterMinAmount} onChange={(e) => setFilterMinAmount(e.target.value)} />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground mb-1 block">حداکثر مبلغ</Label>
          <Input inputMode="numeric" placeholder="—" value={filterMaxAmount} onChange={(e) => setFilterMaxAmount(e.target.value)} />
        </div>
      </div>

      {(filterFromDate || filterToDate || filterMinAmount || filterMaxAmount) && (
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => { setFilterFromDate(null); setFilterToDate(null); setFilterMinAmount(""); setFilterMaxAmount(""); }}
          >
            پاک کردن فیلترهای تاریخ و مبلغ
          </Button>
        </div>
      )}

      {/* Auto-identification chip filters — server-side filtered txs are
          partitioned into 5 derived states (see deriveAutoState). Counts
          reflect the unfiltered set so the user sees the impact of each
          chip before clicking it. */}
      <div className="flex flex-wrap gap-1.5">
        {(
          [
            ["", "همه", txs.length],
            ["auto_identified", "شناسایی خودکار", autoCounts.auto_identified],
            ["manual", "شناسایی دستی", autoCounts.manual],
            ["needs_review", "نیازمند بازبینی", autoCounts.needs_review],
            ["no_identifier", "بدون شناسه", autoCounts.no_identifier],
            ["sepidar_failed", "خطای سپیدار", autoCounts.sepidar_failed],
          ] as Array<[string, string, number]>
        ).map(([key, label, count]) => (
          <button
            key={key || "all"}
            onClick={() => setFilterAutoState(key as "" | AutoState)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
              filterAutoState === key
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-card hover:bg-muted/50"
            }`}
          >
            {label} <span className="opacity-70">({count})</span>
          </button>
        ))}
      </div>


      {loading ? (
        <p className="text-sm text-muted-foreground">در حال بارگذاری…</p>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto rounded-xl border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr className="text-right">
                  <th className="p-2 font-bold">بانک</th>
                  <th className="p-2 font-bold">تاریخ</th>
                  <th className="p-2 font-bold">نوع</th>
                  <th className="p-2 font-bold">واریز</th>
                  <th className="p-2 font-bold">برداشت</th>
                  <th className="p-2 font-bold">مانده</th>
                  <th className="p-2 font-bold">شرح</th>
                  <th className="p-2 font-bold">مرجع</th>
                  <th className="p-2 font-bold">منبع</th>
                  <th className="p-2 font-bold">وضعیت</th>
                  <th className="p-2"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((t) => (
                  <tr key={t.id} className="border-t hover:bg-secondary/30">
                    <td className="p-2">{banks[t.bank_id || ""]?.title || banks[t.bank_id || ""]?.bank_name || "—"}</td>
                    <td className="p-2"><JalaliDateCell value={t.transaction_datetime} withTime /></td>
                    <td className="p-2">{t.transaction_type === "deposit" ? "واریز" : "برداشت"}</td>
                    <td className="p-2"><MoneyCell value={t.deposit_amount} positive /></td>
                    <td className="p-2"><MoneyCell value={t.withdraw_amount} negative /></td>
                    <td className="p-2"><MoneyCell value={t.balance_after} /></td>
                    <td className="p-2 max-w-[260px] align-top">
                      {/* Full description on hover via native tooltip; click to expand inline.
                          Keeps the row compact by default but never hides text from the user. */}
                      <ExpandableDescription text={t.description} />
                      <RowBadges
                        idents={identByTx[t.id]}
                        ri={receiveByTx[t.id]}
                        partyName={receiveByTx[t.id]?.party_id ? partyNames[receiveByTx[t.id]!.party_id!] || null : null}
                        autoState={deriveAutoState(t, identByTx[t.id], receiveByTx[t.id])}
                      />
                    </td>

                    <td className="p-2 font-mono text-xs">{t.reference_number || t.tracking_number || "—"}</td>
                    <td className="p-2 text-xs">{t.source_type || "—"}</td>
                    <td className="p-2"><FinanceStatusBadge status={t.assignment_status} /></td>
                    <td className="p-2">
                      <div className="flex gap-1 flex-wrap items-center">
                        {t.assignment_status === "unassigned" && t.transaction_type === "deposit" && (
                          <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setOpenReceiveId(t)}>
                            <ArrowDownToLine className="w-3 h-3 ml-1" /> شناسایی دریافت
                          </Button>
                        )}
                        {t.assignment_status === "unassigned" && t.transaction_type === "withdraw" && (
                          <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => toast.info("ثبت پرداخت از تب درخواست‌های پرداخت")}>
                            <ArrowUpFromLine className="w-3 h-3 ml-1" /> ثبت پرداخت
                          </Button>
                        )}
                        {t.assignment_status === "unassigned" && (
                          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => toast.info("اتصال به انتقال بین بانکی از تب مربوطه")}>
                            <ArrowLeftRight className="w-3 h-3 ml-1" /> انتقال بانکی
                          </Button>
                        )}
                        {t.assignment_status === "assigning" && (
                          <span className="text-[11px] text-amber-700 inline-flex items-center gap-1">
                            <Link2 className="w-3 h-3" /> در انتظار تایید مدیر
                          </span>
                        )}
                        {t.assignment_status === "assigned" && t.assigned_operation_type === "receive_identification" && (
                          <span className="text-[11px] text-emerald-700">شناسایی شده</span>
                        )}
                        <Button size="icon" variant="ghost" title="جزئیات خام" onClick={() => setOpenRaw(t)}><FileText className="w-3.5 h-3.5" /></Button>
                        {t.assignment_status === "unassigned" && (
                          <Button size="icon" variant="ghost" title="حذف نرم" onClick={() => softDelete(t)}><Trash2 className="w-3.5 h-3.5" /></Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={11} className="p-8 text-center text-muted-foreground">تراکنشی یافت نشد</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-2">
            {filtered.map((t) => (
              <div key={t.id} className="rounded-xl border bg-card p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-sm">{banks[t.bank_id || ""]?.title || "—"}</span>
                  <FinanceStatusBadge status={t.assignment_status} />
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <JalaliDateCell value={t.transaction_datetime} withTime />
                  {t.transaction_type === "deposit"
                    ? <MoneyCell value={t.deposit_amount} positive />
                    : <MoneyCell value={t.withdraw_amount} negative />}
                </div>
                {t.description && (
                  <div className="mt-2"><ExpandableDescription text={t.description} /></div>
                )}

                <div className="mt-2 flex gap-1 flex-wrap">
                  {t.assignment_status === "unassigned" && t.transaction_type === "deposit" && (
                    <Button size="sm" variant="outline" onClick={() => setOpenReceiveId(t)}>
                      <ArrowDownToLine className="w-3 h-3 ml-1" /> شناسایی دریافت
                    </Button>
                  )}
                  {t.assignment_status === "assigning" && (
                    <span className="text-[11px] text-amber-700">در انتظار تایید مدیر</span>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => setOpenRaw(t)}><FileText className="w-3 h-3 ml-1" /> جزئیات</Button>
                  {t.assignment_status === "unassigned" && (
                    <Button size="sm" variant="ghost" onClick={() => softDelete(t)}><Trash2 className="w-3 h-3 ml-1" /> حذف</Button>
                  )}
                </div>
              </div>
            ))}
            {filtered.length === 0 && (
              <p className="text-center text-muted-foreground py-8">تراکنشی یافت نشد</p>
            )}
          </div>
        </>
      )}

      {openManual && <ManualTxDialog onClose={() => setOpenManual(false)} onDone={() => { setOpenManual(false); void load(); }} />}
      {openExcel && <ExcelImportDialog onClose={() => setOpenExcel(false)} onDone={() => { setOpenExcel(false); void load(); }} />}
      {openReceiveId && (
        <NewReceiveIdDialog
          presetTxId={openReceiveId.id}
          onClose={() => setOpenReceiveId(null)}
          onDone={() => { setOpenReceiveId(null); void load(); }}
        />
      )}
      {openRaw && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setOpenRaw(null)}>
          <div className="bg-card rounded-xl border shadow-lg w-full max-w-lg max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b flex items-center justify-between">
              <h3 className="font-bold">جزئیات خام</h3>
              <Button size="sm" variant="ghost" onClick={() => setOpenRaw(null)}><X className="w-4 h-4" /></Button>
            </div>
            {/* Original file download — only shown when the row was
                created by an Excel/CSV import that archived its source
                file into the `finance-imports` bucket. */}
            {openRaw.imported_file_path && (
              <div className="p-4 border-b flex items-center justify-between gap-2 flex-wrap">
                <div className="text-xs">
                  <div className="font-bold">فایل اصلی</div>
                  <div className="text-muted-foreground truncate max-w-[280px]">
                    {openRaw.original_file_name || openRaw.imported_file_name || openRaw.imported_file_path}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    // Bucket is private → mint a short-lived signed URL on click.
                    const { data, error } = await supabase.storage
                      .from("finance-imports")
                      .createSignedUrl(openRaw.imported_file_path!, 60);
                    if (error || !data?.signedUrl) {
                      toast.error("دریافت فایل اصلی ناموفق بود");
                      return;
                    }
                    window.open(data.signedUrl, "_blank", "noopener");
                  }}
                >
                  <Download className="w-4 h-4 ml-1" /> دانلود فایل اصلی
                </Button>
              </div>
            )}
            <pre dir="ltr" className="p-4 text-xs overflow-x-auto whitespace-pre-wrap">{JSON.stringify(openRaw.raw_data ?? openRaw, null, 2)}</pre>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * ExpandableDescription
 * Renders a bank transaction description with three affordances so the user
 * never loses access to the full text:
 *   1. Native browser tooltip (title=) on hover — instant preview.
 *   2. Two-line clamp by default so rows stay compact.
 *   3. Inline "نمایش کامل شرح" / "بستن" toggle when the text exceeds the clamp,
 *      revealing the full description in-place without a modal.
 */
/**
 * RowBadges
 * Compact, RTL-friendly badge cluster that summarises every signal the
 * auto-identification pipeline produced for a single bank transaction:
 *   • One chip per extracted identifier (card / IBAN / account).
 *   • Verified owner name (from bankpartyaccountinfos / verify-account).
 *   • Matched party (from the linked receive identification, if any).
 *   • Auto-identification state (auto / manual / needs review / no id).
 *   • Sepidar posting status when a voucher exists.
 * Kept deliberately minimal — uses semantic tokens only, no hard-coded colors.
 */
function RowBadges({
  idents, ri, partyName, autoState,
}: {
  idents: IdentRow[] | undefined;
  ri: ReceiveMeta | undefined;
  partyName: string | null;
  autoState: AutoState;
}) {
  const chip = "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-bold";
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {idents?.map((ident, i) => (
        <span key={i} className={`${chip} bg-muted/50 text-foreground`} title={ident.raw_value || ""}>
          {MATCH_TYPE_LABEL[ident.match_type] || "شناسه"}: {ident.normalized_value?.slice(-6) || "—"}
          {ident.verified_owner_name && (
            <span className="opacity-70">· {ident.verified_owner_name}</span>
          )}
        </span>
      ))}
      {partyName && (
        <span className={`${chip} border-primary/40 text-primary`}>ذینفع: {partyName}</span>
      )}
      {autoState === "auto_identified" && (
        <span className={`${chip} border-emerald-500/40 text-emerald-600 dark:text-emerald-400`}>شناسایی خودکار</span>
      )}
      {autoState === "manual" && ri && (
        <span className={`${chip} border-sky-500/40 text-sky-600 dark:text-sky-400`}>شناسایی دستی</span>
      )}
      {autoState === "needs_review" && (
        <span className={`${chip} border-amber-500/40 text-amber-600 dark:text-amber-400`}>نیازمند بازبینی</span>
      )}
      {autoState === "no_identifier" && (
        <span className={`${chip} border-muted text-muted-foreground`}>بدون شناسه</span>
      )}
      {ri?.sepidar_sync_status === "synced" && (
        <span className={`${chip} border-emerald-500/40 text-emerald-600 dark:text-emerald-400`}>سپیدار: ثبت‌شده</span>
      )}
      {ri?.sepidar_sync_status === "failed" && (
        <span className={`${chip} border-destructive/40 text-destructive`}>سپیدار: خطا</span>
      )}
      {ri?.sepidar_sync_status === "pending" && ri && (
        <span className={`${chip} border-muted text-muted-foreground`}>سپیدار: در انتظار</span>
      )}
    </div>
  );
}

function ExpandableDescription({ text }: { text: string | null }) {
  const [expanded, setExpanded] = useState(false);
  if (!text) return <span className="text-muted-foreground">—</span>;
  // Heuristic threshold: anything beyond ~80 chars likely needs the toggle.
  const isLong = text.length > 80;
  return (
    <div className="text-xs leading-relaxed">
      <p
        title={text}
        className={expanded ? "whitespace-pre-wrap break-words" : "line-clamp-2 break-words"}
      >
        {text}
      </p>
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-[11px] font-bold text-primary hover:underline"
        >
          {expanded ? "بستن" : "نمایش کامل شرح"}
        </button>
      )}
    </div>
  );
}

function ManualTxDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [bankId, setBankId] = useState<string | null>(null);
  const [type, setType] = useState<"deposit" | "withdraw">("deposit");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [reference, setReference] = useState("");
  // Hold the picked moment as a Gregorian ISO timestamp (Tehran-anchored).
  // The DatePicker shows a Jalali calendar but emits Gregorian, matching the
  // shape Postgres expects for `transaction_datetime` (timestamptz).
  const [date, setDate] = useState<string | null>(new Date().toISOString());
  const [saving, setSaving] = useState(false);

  async function save() {
    if (saving) return;
    if (!bankId) return toast.error("بانک را انتخاب کنید");
    const amt = parseMoney(amount);
    if (amt <= 0) return toast.error("مبلغ نامعتبر");
    setSaving(true);
    const payload = {
      bank_id: bankId,
      // `date` is already a valid Gregorian ISO timestamp from the picker.
      transaction_datetime: date ?? new Date().toISOString(),
      transaction_type: type,
      deposit_amount: type === "deposit" ? amt : 0,
      withdraw_amount: type === "withdraw" ? amt : 0,
      amount: amt,
      description,
      reference_number: reference || null,
      source_type: "manual" as const,
      assignment_status: "unassigned",
    };
    const { error } = await supabase.from("finance_bank_transactions").insert(payload);
    setSaving(false);
    if (error) {
      if (error.code === "23505") return toast.error("تراکنش تکراری");
      return toastFinanceError(toast, error);
    }
    await recalculateBankUnassignedBalances(bankId);
    toast.success("ثبت شد");
    onDone();
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-card rounded-t-2xl sm:rounded-2xl border shadow-lg w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b flex items-center justify-between">
          <h3 className="font-bold">ثبت دستی تراکنش</h3>
          <Button size="sm" variant="ghost" onClick={onClose}><X className="w-4 h-4" /></Button>
        </div>
        <div className="p-4 space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">بانک</Label>
            <BankSelector value={bankId} onChange={setBankId} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label className="text-xs">نوع</Label>
              <select value={type} onChange={(e) => setType(e.target.value as "deposit" | "withdraw")} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                <option value="deposit">واریز</option>
                <option value="withdraw">برداشت</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">تاریخ و ساعت</Label>
              {/* Jalali calendar UI; value flows as Gregorian ISO so the
                  existing insert payload doesn't need any other changes. */}
              <DatePicker mode="datetime" value={date} onChange={setDate} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">مبلغ (ریال)</Label>
            <Input dir="ltr" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">شماره مرجع / پیگیری</Label>
            <Input dir="ltr" value={reference} onChange={(e) => setReference(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">شرح</Label>
            <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
        </div>
        <div className="p-4 border-t flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>انصراف</Button>
          <Button onClick={save} disabled={saving}>ذخیره</Button>
        </div>
      </div>
    </div>
  );
}

function ExcelImportDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [bankId, setBankId] = useState<string | null>(null);
  const [bankInfo, setBankInfo] = useState<{ title: string | null; bank_name: string | null; import_template_id: string | null; legacy_bank_name_code: number | null } | null>(null);
  const [templates, setTemplates] = useState<import("@/lib/bankImport").BankImportTemplate[]>([]);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<import("@/lib/bankImport").ParsedRow[]>([]);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [summary, setSummary] = useState<{ total: number; valid: number; duplicate: number; invalid: number; inserted: number } | null>(null);
  // Phase 6: counters returned by the auto-identify pipeline so the
  // import dialog can display per-state chips after the final save step.
  const [autoSummary, setAutoSummary] = useState<AutoIdentifySummary | null>(null);

  useEffect(() => {
    void supabase
      .from("finance_bank_import_templates")
      .select("*")
      .order("bank_name_code", { ascending: true })
      .then(({ data }) => setTemplates((data as unknown as import("@/lib/bankImport").BankImportTemplate[]) || []));
  }, []);

  useEffect(() => {
    setTemplateId(null);
    setParsed([]);
    setSummary(null);
    if (!bankId) { setBankInfo(null); return; }
    void supabase
      .from("finance_banks")
      .select("title,bank_name,import_template_id,legacy_bank_name_code")
      .eq("id", bankId)
      .maybeSingle()
      .then(({ data }) => {
        const info = data as { title: string | null; bank_name: string | null; import_template_id: string | null; legacy_bank_name_code: number | null } | null;
        setBankInfo(info);
      });
  }, [bankId]);

  // Auto-select template based on bank: explicit mapping first, then legacy code
  useEffect(() => {
    if (!bankInfo || templates.length === 0) return;
    if (bankInfo.import_template_id) {
      setTemplateId(bankInfo.import_template_id);
      return;
    }
    if (bankInfo.legacy_bank_name_code != null) {
      const m = templates.find((t) => t.bank_name_code === bankInfo.legacy_bank_name_code);
      if (m) setTemplateId(m.id);
    }
  }, [bankInfo, templates]);

  const selectedTemplate = useMemo(() => templates.find((t) => t.id === templateId) || null, [templates, templateId]);
  const templateActive = !!selectedTemplate?.is_active;
  const noActiveTemplate = !!bankId && !!bankInfo && !templateActive;

  async function preview() {
    setSummary(null);
    if (!bankId) return toast.error("اطلاعات ضروری تکمیل نشده است");
    if (!title.trim() || !description.trim()) return toast.error("اطلاعات ضروری تکمیل نشده است");
    if (!file) return toast.error("اطلاعات ضروری تکمیل نشده است");
    if (!selectedTemplate) return toast.error("قالب خواندن فایل را انتخاب کنید");
    if (!selectedTemplate.is_active) return toast.error("برای این بانک هنوز قالب خواندن فایل تعریف نشده است");

    const ext = file.name.split(".").pop()?.toLowerCase() || "";
    if (!["xls", "xlsx", "csv"].includes(ext)) return toast.error("فرمت فایل مجاز نیست");

    setPreviewing(true);
    try {
      const { readFileRows, parseRowsWithTemplate } = await import("@/lib/bankImport");
      const rows = await readFileRows(file, selectedTemplate);
      const list = parseRowsWithTemplate(rows, selectedTemplate);
      if (list.length === 0) {
        toast.error("اطلاعات قابل ثبت در فایل پیدا نشد");
        setParsed([]);
        return;
      }
      // duplicate check against db
      const validList = list.filter((r) => r.status === "valid");
      if (validList.length > 0) {
        const datetimes = validList.map((r) => r.transaction_datetime!).filter(Boolean);
        const { data: existing } = await supabase
          .from("finance_bank_transactions")
          .select("transaction_datetime,amount,document_number,transaction_type")
          .eq("bank_id", bankId)
          .in("transaction_datetime", datetimes);
        const set = new Set(
          ((existing as { transaction_datetime: string | null; amount: number | null; document_number: string | null; transaction_type: string | null }[]) || []).map(
            (e) => `${e.transaction_datetime}|${e.amount}|${e.document_number || ""}|${e.transaction_type}`,
          ),
        );
        for (const r of validList) {
          const key = `${r.transaction_datetime}|${r.amount}|${r.document_number || ""}|${r.transaction_type}`;
          if (set.has(key)) { r.status = "duplicate"; r.status_reason = "تکراری"; }
        }
      }
      setParsed(list);
      toast.success(`${list.length} ردیف خوانده شد`);
    } catch (e) {
      toastFinanceError(toast, e);
    } finally {
      setPreviewing(false);
    }
  }

  async function importAll() {
    if (!bankId || !file) return;
    const validRows = parsed.filter((r) => r.status === "valid");
    if (validRows.length === 0) return toast.error("ردیف معتبری برای ثبت نیست");
    setSaving(true);

    // ──────────────────────────────────────────────────────────────────
    // STEP 1 — Archive the original Excel/CSV file to Supabase Storage
    // BEFORE inserting any rows. We do this first so every inserted row
    // can reference the same archived path; if the upload fails we abort
    // the whole import (Persian error) and no transactions are created.
    // Bucket: finance-imports (private, see migration).
    // Path shape: {bank_id}/{yyyy-mm-dd}/{uuid}-{original-name}
    // ──────────────────────────────────────────────────────────────────
    const safeName = file.name.replace(/[^\w.\-]+/g, "_");
    const today = new Date().toISOString().slice(0, 10);
    const storagePath = `${bankId}/${today}/${crypto.randomUUID()}-${safeName}`;
    const { error: upErr } = await supabase.storage
      .from("finance-imports")
      .upload(storagePath, file, {
        upsert: false,
        contentType: file.type || "application/octet-stream",
      });
    if (upErr) {
      setSaving(false);
      // Persian error per spec — stop the import on upload failure.
      toast.error(`بارگذاری فایل اصلی در فضای ذخیره‌سازی ناموفق بود: ${upErr.message}`);
      return;
    }

    // STEP 2 — Insert parsed rows, each carrying the archived path.
    // We also use `.select("id")` so we can hand the persisted UUID to the
    // auto-identification pipeline in STEP 3 below. Doing them in the same
    // loop keeps the dialog progress feedback simple (one toast at the end).
    let inserted = 0;
    // Accumulator for the auto-identify summary chips. We seed it with
    // zeros and bump per row — this avoids reflowing the list later.
    const autoSum = emptyAutoIdentifySummary();
    for (const r of validRows) {
      const payload = {
        bank_id: bankId,
        transaction_datetime: r.transaction_datetime,
        transaction_type: r.transaction_type,
        deposit_amount: r.deposit,
        withdraw_amount: r.withdraw,
        amount: r.amount,
        description: r.description || description,
        document_number: r.document_number || null,
        source_type: selectedTemplate?.file_type === "csv" ? "csv" : "excel",
        assignment_status: "unassigned",
        original_file_name: file.name,
        imported_file_name: title,
        // New column added by migration — lets us download the source file later.
        imported_file_path: storagePath,
        raw_data: r.raw as unknown as Record<string, unknown>,
      };
      const { data: insertedRow, error } = await supabase
        .from("finance_bank_transactions")
        .insert([payload])
        .select("id")
        .maybeSingle();
      if (error || !insertedRow) continue;
      inserted++;

      // STEP 3 — Run the auto-identification pipeline. We `await` per row
      // (rather than firing in parallel) so a flaky external API can't
      // saturate the user's browser, and so the audit log entries appear
      // in import order. The helper handles ALL its own logging + error
      // swallowing — a failure here must NEVER abort the import loop.
      try {
        const outcome = await autoIdentifyTransaction(
          insertedRow.id as string,
          r.transaction_type,
          r.identifiers,
        );
        bumpSummary(autoSum, outcome);
      } catch {
        // Counted as needs_review so the user can investigate without
        // losing track of the row.
        bumpSummary(autoSum, { state: "needs_review", message: "pipeline crashed" });
      }
    }
    if (bankId) await recalculateBankUnassignedBalances(bankId);
    setSaving(false);
    const total = parsed.length;
    const valid = parsed.filter((r) => r.status === "valid").length;
    const dup = parsed.filter((r) => r.status === "duplicate").length;
    const inv = parsed.filter((r) => r.status === "invalid").length;
    setSummary({ total, valid, duplicate: dup, invalid: inv, inserted });
    setAutoSummary(autoSum);
    // Richer toast that surfaces auto-identification results at a glance.
    toast.success(
      `${inserted} ردیف ثبت شد · شناسایی خودکار: ${autoSum.auto_identified} · نیازمند بازبینی: ${autoSum.needs_review}`,
    );
    onDone();
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-card rounded-t-2xl sm:rounded-2xl border shadow-lg w-full max-w-3xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b flex items-center justify-between sticky top-0 bg-card z-10">
          <h3 className="font-bold">آپلود فایل تراکنش‌ها</h3>
          <Button size="sm" variant="ghost" onClick={onClose}><X className="w-4 h-4" /></Button>
        </div>
        <div className="p-4 space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">بانک *</Label>
              <BankSelector value={bankId} onChange={setBankId} />
              {bankInfo && (
                <p className="text-[11px] text-muted-foreground">
                  {bankInfo.title || bankInfo.bank_name || "—"}
                  {bankInfo.legacy_bank_name_code != null && <> · کد قدیمی: {legacyBankLabel(bankInfo.legacy_bank_name_code)}</>}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">قالب خواندن فایل *</Label>
              <select
                value={templateId || ""}
                onChange={(e) => setTemplateId(e.target.value || null)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">— انتخاب کنید —</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title} ({legacyBankLabel(t.bank_name_code)}){!t.is_active ? " — غیرفعال" : ""}
                  </option>
                ))}
              </select>
              {selectedTemplate && (
                <p className="text-[11px] text-muted-foreground">
                  {selectedTemplate.title} · {selectedTemplate.file_type.toUpperCase()}
                  {!selectedTemplate.is_active && <span className="text-amber-700"> · غیرفعال</span>}
                </p>
              )}
            </div>
          </div>

          {noActiveTemplate && (
            <div className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md p-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                {selectedTemplate?.description || "برای این بانک هنوز قالب خواندن فایل تعریف نشده است"}
              </span>
            </div>
          )}
          <div className="space-y-1.5">
            <Label className="text-xs">عنوان *</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="مثلاً: گردش بانک ملت اردیبهشت" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">توضیحات *</Label>
            <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">فایل تراکنش‌ها * (xls / xlsx / csv)</Label>
            <Input type="file" accept=".xls,.xlsx,.csv" onChange={(e) => { setFile(e.target.files?.[0] || null); setParsed([]); setSummary(null); }} />
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={preview} disabled={previewing || !file || !templateActive}>
              {previewing ? "در حال پردازش…" : "پیش‌نمایش"}
            </Button>
          </div>

          {parsed.length > 0 && (
            <>
              <div className="rounded-lg border overflow-x-auto max-h-80">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40 sticky top-0">
                    <tr className="text-right">
                      <th className="p-2">ردیف</th>
                      <th className="p-2">تاریخ</th>
                      <th className="p-2">ساعت</th>
                      <th className="p-2">واریز</th>
                      <th className="p-2">برداشت</th>
                      <th className="p-2">شماره سند</th>
                      <th className="p-2">توضیحات</th>
                      <th className="p-2">وضعیت</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.map((r) => (
                      <tr key={r.index} className={
                        r.status === "valid" ? "border-t" :
                        r.status === "duplicate" ? "border-t bg-amber-500/10" :
                        "border-t bg-destructive/10"
                      }>
                        <td className="p-2">{r.index}</td>
                        <td className="p-2 font-mono">{r.date}</td>
                        <td className="p-2 font-mono">{r.time}</td>
                        <td className="p-2 font-mono text-emerald-700">{r.deposit ? r.deposit.toLocaleString() : "—"}</td>
                        <td className="p-2 font-mono text-rose-700">{r.withdraw ? r.withdraw.toLocaleString() : "—"}</td>
                        <td className="p-2 font-mono">{r.document_number || "—"}</td>
                        <td className="p-2 max-w-[260px] truncate">{r.description || "—"}</td>
                        <td className="p-2">
                          {r.status === "valid" && <span className="text-emerald-700">معتبر</span>}
                          {r.status === "duplicate" && <span className="text-amber-700">تکراری</span>}
                          {r.status === "invalid" && <span className="text-rose-700">{r.status_reason || "نامعتبر"}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap gap-3 text-xs">
                <span>کل: {parsed.length}</span>
                <span className="text-emerald-700">معتبر: {parsed.filter((r) => r.status === "valid").length}</span>
                <span className="text-amber-700">تکراری: {parsed.filter((r) => r.status === "duplicate").length}</span>
                <span className="text-rose-700">خطادار: {parsed.filter((r) => r.status === "invalid").length}</span>
                {summary && <span className="font-bold">ثبت‌شده: {summary.inserted}</span>}
              </div>
              {/* Phase 6 — auto-identification summary chips. Only rendered
                  after `importAll` finishes so the user sees them as part of
                  the post-import recap, alongside the legacy validity chips. */}
              {autoSummary && (
                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 text-emerald-700 px-2 py-0.5">
                    شناسایی خودکار: {autoSummary.auto_identified}
                  </span>
                  <span className="rounded-full border border-amber-500/40 bg-amber-500/10 text-amber-700 px-2 py-0.5">
                    نیازمند بازبینی: {autoSummary.needs_review}
                  </span>
                  <span className="rounded-full border border-muted bg-muted/30 text-muted-foreground px-2 py-0.5">
                    بدون شناسه: {autoSummary.no_identifier}
                  </span>
                  {autoSummary.sepidar_posted > 0 && (
                    <span className="rounded-full border border-primary/40 bg-primary/10 text-primary px-2 py-0.5">
                      ارسال به سپیدار: {autoSummary.sepidar_posted}
                    </span>
                  )}
                  {autoSummary.sepidar_failed > 0 && (
                    <span className="rounded-full border border-destructive/40 bg-destructive/10 text-destructive px-2 py-0.5">
                      خطای سپیدار: {autoSummary.sepidar_failed}
                    </span>
                  )}
                </div>
              )}
            </>
          )}
        </div>
        <div className="p-4 border-t flex justify-end gap-2 sticky bottom-0 bg-card">
          <Button variant="outline" onClick={onClose}>انصراف</Button>
          <Button onClick={importAll} disabled={saving || !templateActive || parsed.filter((r) => r.status === "valid").length === 0}>
            ثبت نهایی
          </Button>
        </div>
      </div>
    </div>
  );
}

