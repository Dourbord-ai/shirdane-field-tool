import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { LayoutDashboard, Building2, ArrowRightLeft, ClipboardList, ArrowDownToLine, ArrowLeftRight, Repeat, Users, FileText, Settings, FileSpreadsheet } from "lucide-react";
import BankImportTemplatesTab from "@/components/finance/tabs/BankImportTemplatesTab";
import { cn } from "@/lib/utils";
import FinanceDashboardTab from "@/components/finance/tabs/FinanceDashboardTab";
import BanksTab from "@/components/finance/tabs/BanksTab";
import BankTransactionsTab from "@/components/finance/tabs/BankTransactionsTab";
import PaymentRequestsTab from "@/components/finance/tabs/PaymentRequestsTab";
import ReceiveIdentificationTab from "@/components/finance/tabs/ReceiveIdentificationTab";
import BankTransferTab from "@/components/finance/tabs/BankTransferTab";
import PartyTransferTab from "@/components/finance/tabs/PartyTransferTab";
import PartiesTab from "@/components/finance/tabs/PartiesTab";
import VouchersTab from "@/components/finance/tabs/VouchersTab";
import SepidarSettingsTab from "@/components/finance/tabs/SepidarSettingsTab";

const TABS = [
  { key: "dashboard", label: "داشبورد مالی", icon: LayoutDashboard },
  { key: "banks", label: "بانک‌ها", icon: Building2 },
  { key: "transactions", label: "تراکنش‌های بانکی", icon: ArrowRightLeft },
  { key: "payment-requests", label: "درخواست‌های پرداخت", icon: ClipboardList },
  { key: "receive-id", label: "شناسایی دریافت", icon: ArrowDownToLine },
  { key: "bank-transfer", label: "انتقال بین بانکی", icon: ArrowLeftRight },
  { key: "party-transfer", label: "انتقال بین ذینفع", icon: Repeat },
  { key: "parties", label: "ذینفعان", icon: Users },
  { key: "vouchers", label: "اسناد مالی", icon: FileText },
  { key: "sepidar", label: "تنظیمات سپیدار", icon: Settings },
];

export default function Finance() {
  const [params, setParams] = useSearchParams();
  const initial = params.get("tab") || "dashboard";
  const [tab, setTab] = useState(initial);
  const [bankFilter, setBankFilter] = useState<string | undefined>();

  function changeTab(t: string) {
    setTab(t);
    setParams({ tab: t });
  }

  return (
    <div className="py-4 space-y-4 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">امور مالی</h1>
        <p className="text-sm text-muted-foreground">مدیریت بانک‌ها، تراکنش‌ها، پرداخت‌ها، اسناد و سپیدار</p>
      </div>

      {/* Tabs — horizontal scroll on mobile */}
      <div className="overflow-x-auto -mx-3 px-3 pb-1">
        <div className="inline-flex gap-1 p-1 rounded-xl bg-muted/40 border min-w-full">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => changeTab(t.key)}
              className={cn(
                "shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-bold transition-all whitespace-nowrap",
                tab === t.key
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <t.icon className="w-4 h-4" />
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-xl bg-card border p-4 sm:p-5">
        {tab === "dashboard" && <FinanceDashboardTab onTabChange={changeTab} />}
        {tab === "banks" && <BanksTab onViewTransactions={(id) => { setBankFilter(id); changeTab("transactions"); }} />}
        {tab === "transactions" && <BankTransactionsTab initialBankId={bankFilter} />}
        {tab === "payment-requests" && <PaymentRequestsTab />}
        {tab === "receive-id" && <ReceiveIdentificationTab />}
        {tab === "bank-transfer" && <BankTransferTab />}
        {tab === "party-transfer" && <PartyTransferTab />}
        {tab === "parties" && <PartiesTab />}
        {tab === "vouchers" && <VouchersTab />}
        {tab === "sepidar" && <SepidarSettingsTab />}
      </div>
    </div>
  );
}
