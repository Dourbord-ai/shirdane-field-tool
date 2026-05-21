import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MoneyCell, JalaliDateCell, FinanceStatusBadge, SepidarStatusBadge } from "@/components/finance/atoms";
import { sepidarSyncPlaceholder } from "@/lib/finance";
import { X, Send, RefreshCw, AlertCircle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

interface Voucher {
  id: string;
  voucher_number: number | null;
  voucher_type: string | null;
  source_operation_type: string | null;
  source_operation_id: string | null;
  voucher_date: string | null;
  title: string | null;
  description: string | null;
  total_debit: number | null;
  total_credit: number | null;
  status: string | null;
  sepidar_sync_status: string | null;
  sepidar_voucher_number: number | null;
  sepidar_error_message: string | null;
}

interface VItem {
  id: string;
  row_number: number | null;
  party_id: string | null;
  bank_id: string | null;
  account_type: string | null;
  debit: number | null;
  credit: number | null;
  description: string | null;
}

export default function VouchersTab() {
  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const [filterType, setFilterType] = useState("");
  const [filterSepidar, setFilterSepidar] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [q, setQ] = useState("");
  const [detail, setDetail] = useState<Voucher | null>(null);

  useEffect(() => { void load(); }, [filterType, filterSepidar, filterStatus]);
  async function load() {
    let query = supabase
      .from("finance_vouchers")
      .select("*")
      .eq("is_deleted", false)
      .order("voucher_date", { ascending: false })
      .limit(500);
    if (filterType) query = query.eq("voucher_type", filterType);
    if (filterSepidar) query = query.eq("sepidar_sync_status", filterSepidar);
    if (filterStatus) query = query.eq("status", filterStatus);
    const { data } = await query;
    setVouchers((data as Voucher[]) || []);
  }

  const filtered = vouchers.filter((v) => {
    if (!q) return true;
    return `${v.title || ""} ${v.voucher_number || ""}`.toLowerCase().includes(q.toLowerCase());
  });

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold">اسناد مالی</h2>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Input placeholder="جستجو..." value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={filterType} onChange={(e) => setFilterType(e.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
          <option value="">نوع سند</option>
          <option value="receive_identification">شناسایی دریافت</option>
          <option value="payment_request">پرداخت</option>
          <option value="bank_transfer">انتقال بانکی</option>
          <option value="party_transfer">انتقال ذینفع</option>
        </select>
        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
          <option value="">وضعیت سند</option>
          <option value="draft">پیش‌نویس</option>
          <option value="posted">ثبت شده</option>
        </select>
        <select value={filterSepidar} onChange={(e) => setFilterSepidar(e.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
          <option value="">وضعیت سپیدار</option>
          <option value="not_synced">ثبت نشده</option>
          <option value="syncing">در حال ثبت</option>
          <option value="synced">ثبت شده</option>
          <option value="failed">خطا</option>
        </select>
      </div>

      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40">
            <tr className="text-right">
              <th className="p-2">شماره</th>
              <th className="p-2">عنوان</th>
              <th className="p-2">نوع</th>
              <th className="p-2">تاریخ</th>
              <th className="p-2">بدهکار</th>
              <th className="p-2">بستانکار</th>
              <th className="p-2">وضعیت</th>
              <th className="p-2">سپیدار</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((v) => {
              const balanced = Math.abs(Number(v.total_debit || 0) - Number(v.total_credit || 0)) < 0.01;
              return (
                <tr key={v.id} onClick={() => setDetail(v)} className="border-t hover:bg-secondary/30 cursor-pointer">
                  <td className="p-2 font-mono tabular-nums">{v.voucher_number}</td>
                  <td className="p-2">{v.title || "—"}</td>
                  <td className="p-2 text-xs">{v.voucher_type || "—"}</td>
                  <td className="p-2"><JalaliDateCell value={v.voucher_date} /></td>
                  <td className="p-2"><MoneyCell value={v.total_debit} /></td>
                  <td className="p-2"><MoneyCell value={v.total_credit} /></td>
                  <td className="p-2">
                    <div className="flex items-center gap-1">
                      <FinanceStatusBadge status={v.status} />
                      {balanced ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> : <AlertCircle className="w-3.5 h-3.5 text-red-600" />}
                    </div>
                  </td>
                  <td className="p-2"><SepidarStatusBadge status={v.sepidar_sync_status} /></td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={8} className="p-8 text-center text-muted-foreground">سندی یافت نشد</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {detail && <VoucherDrawer voucher={detail} onClose={() => { setDetail(null); void load(); }} />}
    </div>
  );
}

function VoucherDrawer({ voucher, onClose }: { voucher: Voucher; onClose: () => void }) {
  const [items, setItems] = useState<VItem[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    supabase.from("finance_voucher_items").select("*").eq("voucher_id", voucher.id).order("row_number").then(({ data }) => setItems((data as VItem[]) || []));
  }, [voucher.id]);

  const balanced = Math.abs(Number(voucher.total_debit || 0) - Number(voucher.total_credit || 0)) < 0.01;

  async function postVoucher() {
    setBusy(true);
    await supabase.from("finance_vouchers").update({ status: "posted", approved_at: new Date().toISOString() }).eq("id", voucher.id);
    toast.success("تایید نهایی شد");
    setBusy(false);
    onClose();
  }
  async function sendSepidar() {
    setBusy(true);
    await sepidarSyncPlaceholder(voucher.id, "post_voucher");
    toast.success("ارسال به سپیدار (placeholder)");
    setBusy(false);
    onClose();
  }
  async function retrySepidar() {
    setBusy(true);
    await supabase.from("finance_vouchers").update({ sepidar_sync_status: "not_synced", sepidar_error_message: null }).eq("id", voucher.id);
    await sepidarSyncPlaceholder(voucher.id, "retry");
    toast.success("تلاش مجدد ارسال شد");
    setBusy(false);
    onClose();
  }
  async function deleteFromSepidar() {
    setBusy(true);
    await supabase.from("finance_vouchers").update({ sepidar_sync_status: "deleted_from_sepidar" }).eq("id", voucher.id);
    toast.success("از سپیدار حذف شد (placeholder)");
    setBusy(false);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex justify-end" onClick={onClose}>
      <div className="bg-card border-l shadow-lg w-full max-w-2xl h-full overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b flex items-center justify-between sticky top-0 bg-card">
          <div>
            <h3 className="font-bold">سند #{voucher.voucher_number}</h3>
            <p className="text-xs text-muted-foreground">{voucher.title}</p>
          </div>
          <Button size="icon" variant="ghost" onClick={onClose}><X className="w-4 h-4" /></Button>
        </div>
        <div className="p-4 space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">نوع</p><p className="font-bold text-sm">{voucher.voucher_type}</p></div>
            <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">تاریخ</p><JalaliDateCell value={voucher.voucher_date} /></div>
          </div>

          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-right">
                <tr>
                  <th className="p-2">#</th>
                  <th className="p-2">شرح</th>
                  <th className="p-2">بدهکار</th>
                  <th className="p-2">بستانکار</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.id} className="border-t">
                    <td className="p-2 tabular-nums">{i.row_number}</td>
                    <td className="p-2">{i.description || "—"}</td>
                    <td className="p-2"><MoneyCell value={i.debit} /></td>
                    <td className="p-2"><MoneyCell value={i.credit} /></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t bg-muted/30 font-bold">
                  <td colSpan={2} className="p-2 text-right">جمع</td>
                  <td className="p-2"><MoneyCell value={voucher.total_debit} /></td>
                  <td className="p-2"><MoneyCell value={voucher.total_credit} /></td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className={`rounded-lg p-3 text-sm flex items-center gap-2 ${balanced ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"}`}>
            {balanced ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
            {balanced ? "سند متوازن است" : "سند نامتوازن است"}
          </div>

          <div className="rounded-xl border p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">وضعیت سپیدار</span>
              <SepidarStatusBadge status={voucher.sepidar_sync_status} />
            </div>
            {voucher.sepidar_voucher_number && (
              <p className="text-xs text-muted-foreground">شماره سپیدار: <span className="font-mono">{voucher.sepidar_voucher_number}</span></p>
            )}
            {voucher.sepidar_error_message && (
              <p className="text-xs text-red-700 bg-red-50 p-2 rounded">{voucher.sepidar_error_message}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            {voucher.status !== "posted" && <Button onClick={postVoucher} disabled={busy}><CheckCircle2 className="w-4 h-4 ml-1" /> تایید نهایی</Button>}
            {/* Hide "ارسال به سپیدار" once the voucher is already posted/synced to Sepidar */}
            {voucher.sepidar_sync_status !== "synced" && voucher.sepidar_sync_status !== "syncing" && (
              <Button onClick={sendSepidar} disabled={busy} variant="outline"><Send className="w-4 h-4 ml-1" /> ارسال به سپیدار</Button>
            )}
            {voucher.sepidar_sync_status === "failed" && <Button onClick={retrySepidar} disabled={busy} variant="outline"><RefreshCw className="w-4 h-4 ml-1" /> تلاش مجدد</Button>}
            {voucher.sepidar_sync_status === "synced" && <Button onClick={deleteFromSepidar} disabled={busy} variant="outline">حذف از سپیدار</Button>}
          </div>

        </div>
      </div>
    </div>
  );
}
