import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { MoneyCell } from "@/components/finance/atoms";
import {
  Wallet,
  AlertCircle,
  ClipboardList,
  TrendingDown,
  TrendingUp,
  FileX,
  AlertTriangle,
  Upload,
  Plus,
  ArrowLeftRight,
  ArrowDownToLine,
  UserPlus,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface KPI {
  totalBankBalance: number;
  unassignedTx: number;
  openRequests: number;
  partiesDebit: number;
  partiesCredit: number;
  vouchersNotSynced: number;
  sepidarErrors: number;
}

export default function FinanceDashboardTab({ onTabChange }: { onTabChange: (tab: string) => void }) {
  const [kpi, setKpi] = useState<KPI>({
    totalBankBalance: 0,
    unassignedTx: 0,
    openRequests: 0,
    partiesDebit: 0,
    partiesCredit: 0,
    vouchersNotSynced: 0,
    sepidarErrors: 0,
  });

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    const [banks, unassigned, openReq, parties, notSynced, failed] = await Promise.all([
      supabase.from("finance_banks").select("last_balance,online_balance").eq("is_deleted", false).eq("is_active", true),
      supabase.from("finance_bank_transactions").select("id", { count: "exact", head: true }).eq("is_deleted", false).eq("assignment_status", "unassigned"),
      supabase.from("finance_payment_requests").select("id", { count: "exact", head: true }).eq("is_deleted", false).in("status", ["draft", "pending_approval", "approved"]),
      supabase.from("finance_parties").select("balance").eq("is_deleted", false),
      supabase.from("finance_vouchers").select("id", { count: "exact", head: true }).eq("is_deleted", false).eq("sepidar_sync_status", "not_synced"),
      supabase.from("finance_vouchers").select("id", { count: "exact", head: true }).eq("is_deleted", false).eq("sepidar_sync_status", "failed"),
    ]);
    let total = 0;
    ((banks.data as { last_balance: number | null; online_balance: number | null }[]) || []).forEach(
      (b) => (total += Number(b.online_balance || b.last_balance || 0)),
    );
    let debit = 0;
    let credit = 0;
    ((parties.data as { balance: number | null }[]) || []).forEach((p) => {
      const v = Number(p.balance || 0);
      if (v > 0) credit += v;
      else if (v < 0) debit += -v;
    });
    setKpi({
      totalBankBalance: total,
      unassignedTx: unassigned.count || 0,
      openRequests: openReq.count || 0,
      partiesDebit: debit,
      partiesCredit: credit,
      vouchersNotSynced: notSynced.count || 0,
      sepidarErrors: failed.count || 0,
    });
  }

  const cards = [
    { label: "جمع موجودی بانک‌ها", value: kpi.totalBankBalance, type: "money" as const, icon: Wallet, tone: "from-emerald-500 to-teal-600", onClick: () => onTabChange("banks") },
    { label: "تراکنش‌های تخصیص نشده", value: kpi.unassignedTx, type: "count" as const, icon: AlertCircle, tone: "from-amber-500 to-orange-600", onClick: () => onTabChange("transactions") },
    { label: "درخواست‌های پرداخت باز", value: kpi.openRequests, type: "count" as const, icon: ClipboardList, tone: "from-blue-500 to-indigo-600", onClick: () => onTabChange("payment-requests") },
    { label: "مانده بدهکار ذینفعان", value: kpi.partiesDebit, type: "money" as const, icon: TrendingDown, tone: "from-red-500 to-rose-600", onClick: () => onTabChange("parties") },
    { label: "مانده بستانکار ذینفعان", value: kpi.partiesCredit, type: "money" as const, icon: TrendingUp, tone: "from-emerald-500 to-green-600", onClick: () => onTabChange("parties") },
    { label: "اسناد ثبت‌نشده در سپیدار", value: kpi.vouchersNotSynced, type: "count" as const, icon: FileX, tone: "from-slate-500 to-slate-700", onClick: () => onTabChange("vouchers") },
    { label: "خطاهای ثبت سپیدار", value: kpi.sepidarErrors, type: "count" as const, icon: AlertTriangle, tone: "from-red-500 to-pink-600", onClick: () => onTabChange("vouchers") },
  ];

  const quick = [
    { label: "آپلود فایل تراکنش", icon: Upload, tab: "transactions" },
    { label: "درخواست پرداخت جدید", icon: Plus, tab: "payment-requests" },
    { label: "شناسایی دریافت", icon: ArrowDownToLine, tab: "receive-id" },
    { label: "انتقال بین بانکی", icon: ArrowLeftRight, tab: "bank-transfer" },
    { label: "انتقال بین ذینفع", icon: ArrowLeftRight, tab: "party-transfer" },
    { label: "ذینفع جدید", icon: UserPlus, tab: "parties" },
  ];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {cards.map((c) => (
          <button
            key={c.label}
            onClick={c.onClick}
            className="text-right rounded-xl border border-border bg-card p-4 hover:shadow-lg hover:border-primary/30 transition-all duration-200 active:scale-[0.99]"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground font-medium">{c.label}</p>
                <div className="mt-2">
                  {c.type === "money" ? (
                    <MoneyCell value={c.value} className="text-xl" />
                  ) : (
                    <span className="text-2xl font-bold tabular-nums">{toFa(c.value)}</span>
                  )}
                </div>
              </div>
              <div className={cn("w-10 h-10 rounded-lg bg-gradient-to-br flex items-center justify-center text-white shrink-0", c.tone)}>
                <c.icon className="w-5 h-5" />
              </div>
            </div>
          </button>
        ))}
      </div>

      <div>
        <h3 className="text-sm font-bold text-muted-foreground mb-2 px-1">عملیات سریع</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {quick.map((q) => (
            <button
              key={q.label}
              onClick={() => onTabChange(q.tab)}
              className="rounded-xl border border-border bg-card p-3 flex items-center gap-2 hover:border-primary/30 hover:shadow-md transition-all text-right"
            >
              <span className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <q.icon className="w-4 h-4" />
              </span>
              <span className="text-sm font-bold">{q.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function toFa(n: number) {
  return String(n).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);
}
