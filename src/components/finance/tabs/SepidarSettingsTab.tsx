import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PartySelector } from "@/components/finance/selectors";
import { JalaliDateCell } from "@/components/finance/atoms";
import { Send, Save, RefreshCw } from "lucide-react";
import { toast } from "sonner";

interface Settings {
  id: string;
  bridge_base_url: string | null;
  bridge_enabled: boolean | null;
  default_bank_fee_party_id: string | null;
  default_receive_account_id: number | null;
  default_payment_account_id: number | null;
  default_party_debit_account_id: number | null;
  default_party_credit_account_id: number | null;
  default_creditor_payment_account_id: number | null;
  default_prepayment_account_id: number | null;
  default_on_account_payment_account_id: number | null;
}

interface Log {
  id: string;
  voucher_id: string | null;
  operation_type: string | null;
  status: string | null;
  error_message: string | null;
  created_at: string;
}

export default function SepidarSettingsTab() {
  const [s, setS] = useState<Settings | null>(null);
  const [logs, setLogs] = useState<Log[]>([]);

  useEffect(() => {
    supabase.from("finance_sepidar_settings").select("*").limit(1).maybeSingle().then(({ data }) => setS(data as Settings));
    supabase.from("finance_sepidar_sync_logs").select("*").order("created_at", { ascending: false }).limit(50).then(({ data }) => setLogs((data as Log[]) || []));
  }, []);

  async function save() {
    if (!s) return;
    const { error } = await supabase.from("finance_sepidar_settings").update({
      bridge_base_url: s.bridge_base_url,
      bridge_enabled: s.bridge_enabled,
      default_bank_fee_party_id: s.default_bank_fee_party_id,
      default_receive_account_id: s.default_receive_account_id,
      default_payment_account_id: s.default_payment_account_id,
      default_party_debit_account_id: s.default_party_debit_account_id,
      default_party_credit_account_id: s.default_party_credit_account_id,
    }).eq("id", s.id);
    if (error) return toast.error(error.message);
    toast.success("ذخیره شد");
  }

  if (!s) return <p className="text-sm text-muted-foreground">در حال بارگذاری…</p>;

  return (
    <div className="space-y-4 max-w-2xl">
      <h2 className="text-lg font-bold">تنظیمات سپیدار</h2>

      <div className="rounded-xl border bg-card p-4 space-y-3">
        <div className="space-y-1.5">
          <Label className="text-xs">آدرس پل سپیدار (Bridge URL)</Label>
          <Input dir="ltr" value={s.bridge_base_url || ""} onChange={(e) => setS({ ...s, bridge_base_url: e.target.value })} placeholder="https://..." />
        </div>
        <button
          type="button"
          onClick={() => setS({ ...s, bridge_enabled: !s.bridge_enabled })}
          className={`h-10 w-full rounded-md border text-sm font-bold ${s.bridge_enabled ? "bg-primary text-primary-foreground border-primary" : "bg-background"}`}
        >
          پل سپیدار: {s.bridge_enabled ? "فعال" : "غیرفعال"}
        </button>

        <div className="space-y-1.5">
          <Label className="text-xs">ذینفع پیش‌فرض کارمزد بانکی</Label>
          <PartySelector value={s.default_bank_fee_party_id} onChange={(id) => setS({ ...s, default_bank_fee_party_id: id })} />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label className="text-xs">حساب پیش‌فرض دریافت</Label>
            <Input dir="ltr" inputMode="numeric" value={s.default_receive_account_id || ""} onChange={(e) => setS({ ...s, default_receive_account_id: Number(e.target.value) || null })} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">حساب پیش‌فرض پرداخت</Label>
            <Input dir="ltr" inputMode="numeric" value={s.default_payment_account_id || ""} onChange={(e) => setS({ ...s, default_payment_account_id: Number(e.target.value) || null })} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">حساب پیش‌فرض ذینفع بدهکار</Label>
            <Input dir="ltr" inputMode="numeric" value={s.default_party_debit_account_id || ""} onChange={(e) => setS({ ...s, default_party_debit_account_id: Number(e.target.value) || null })} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">حساب پیش‌فرض ذینفع بستانکار</Label>
            <Input dir="ltr" inputMode="numeric" value={s.default_party_credit_account_id || ""} onChange={(e) => setS({ ...s, default_party_credit_account_id: Number(e.target.value) || null })} />
          </div>
        </div>

        <div className="flex gap-2">
          <Button onClick={save} className="flex-1"><Save className="w-4 h-4 ml-1" /> ذخیره</Button>
          <Button variant="outline" className="flex-1" onClick={() => toast.info("تست اتصال (placeholder)")}>
            <Send className="w-4 h-4 ml-1" /> تست اتصال
          </Button>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-bold text-sm">لاگ‌های ارسال سپیدار</h3>
          <Button size="sm" variant="ghost" onClick={() => supabase.from("finance_sepidar_sync_logs").select("*").order("created_at", { ascending: false }).limit(50).then(({ data }) => setLogs((data as Log[]) || []))}>
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
        </div>
        <div className="rounded-xl border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-right">
              <tr>
                <th className="p-2">تاریخ</th>
                <th className="p-2">سند</th>
                <th className="p-2">عملیات</th>
                <th className="p-2">وضعیت</th>
                <th className="p-2">خطا</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id} className="border-t">
                  <td className="p-2"><JalaliDateCell value={l.created_at} withTime /></td>
                  <td className="p-2 font-mono text-xs">{l.voucher_id?.slice(0, 8) || "—"}</td>
                  <td className="p-2 text-xs">{l.operation_type}</td>
                  <td className="p-2 text-xs">{l.status}</td>
                  <td className="p-2 text-xs text-red-700">{l.error_message || "—"}</td>
                </tr>
              ))}
              {logs.length === 0 && <tr><td colSpan={5} className="p-8 text-center text-muted-foreground">لاگی موجود نیست</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
