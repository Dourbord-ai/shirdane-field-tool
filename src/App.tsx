import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import Index from "./pages/Index";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import NewInvoice from "./pages/NewInvoice";
import Invoices from "./pages/Invoices";
import MilkReceipts from "./pages/MilkReceipts";
import LabResults from "./pages/LabResults";
import Livestock from "./pages/Livestock";
import LivestockListBuilder from "./pages/LivestockListBuilder";
import LivestockProfile from "./pages/LivestockProfile";
import DryOffNew from "./pages/livestock/DryOffNew";
import MilkRecordQuick from "./pages/MilkRecordQuick";
import Finance from "./pages/Finance";
import HumanResources from "./pages/HumanResources";
import Certificates from "./pages/Certificates";
import CertificatesGuard from "./components/CertificatesGuard";
import FertilityGuard from "./components/FertilityGuard";
import FertilityWorkflows from "./pages/fertility/FertilityWorkflows";
import FertilityRules from "./pages/fertility/FertilityRules";
import FertilityOperations from "./pages/fertility/FertilityOperations";
import FertilityTimeline from "./pages/fertility/FertilityTimeline";
import FertilityAlerts from "./pages/fertility/FertilityAlerts";
import FertilityEroticTypes from "./pages/fertility/FertilityEroticTypes";
import AppLayout from "./components/AppLayout";
import NotFound from "./pages/NotFound";
import LivestockGroupsAdmin from "./pages/admin/LivestockGroupsAdmin";
import LivestockTypesAdmin from "./pages/admin/LivestockTypesAdmin";
import LivestockStatusesAdmin from "./pages/admin/LivestockStatusesAdmin";
import LivestockLocationsAdmin from "./pages/admin/LivestockLocationsAdmin";
import SpermsAdmin from "./pages/admin/SpermsAdmin";
import SyncTypesAdmin from "./pages/admin/SyncTypesAdmin";
import SyncTypeDetailsAdmin from "./pages/admin/SyncTypeDetailsAdmin";
import Settings from "./pages/Settings";
import Reports from "./pages/Reports";
// Fertility settings (admin-managed thresholds) + Reproductive Action List
// report. Routes live under /settings/fertility and /reports/fertility/...
// per the approved spec.
import FertilitySettings from "./pages/settings/FertilitySettings";
import FertilityReports from "./pages/reports/FertilityReports";
import FertilityActionList from "./pages/reports/FertilityActionList";
import FertilityReportPlaceholder from "./components/reports/FertilityReportPlaceholder";
import ReportCategoryPlaceholder from "./components/reports/ReportCategoryPlaceholder";
import FertilityHerdPerformance from "./pages/reports/FertilityHerdPerformance";
// Task 6 — Freight Trips (multi-invoice freight allocation). Lazy-static
// imports keep the existing bundle behavior; these pages are small.
import FreightTripsList from "./pages/finance/FreightTrips";
import FreightTripEditor from "./pages/finance/FreightTripEditor";
import FreightTripDetail from "./pages/finance/FreightTripDetail";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/login" element={<Login />} />
            <Route element={<AppLayout />}>
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/invoices" element={<Invoices />} />
              <Route path="/invoices/new" element={<NewInvoice />} />
              <Route path="/receipts/milk" element={<MilkReceipts />} />
              <Route path="/receipts/lab" element={<LabResults />} />
              <Route path="/livestock" element={<Livestock />} />
              <Route path="/livestock/list-builder" element={<LivestockListBuilder />} />
              <Route path="/livestock/dry-off/new" element={<DryOffNew />} />
              <Route path="/livestock/:id" element={<LivestockProfile />} />
              <Route path="/milk-record/quick" element={<MilkRecordQuick />} />
              <Route path="/finance" element={<Finance />} />
              <Route path="/hr" element={<HumanResources />} />
              <Route
                path="/certificates"
                element={
                  <CertificatesGuard>
                    <Certificates />
                  </CertificatesGuard>
                }
              />
              <Route path="/fertility/workflows" element={<FertilityGuard><FertilityWorkflows /></FertilityGuard>} />
              <Route path="/fertility/rules" element={<FertilityGuard><FertilityRules /></FertilityGuard>} />
              <Route path="/fertility/operations" element={<FertilityGuard><FertilityOperations /></FertilityGuard>} />
              <Route path="/fertility/timeline" element={<FertilityGuard><FertilityTimeline /></FertilityGuard>} />
              <Route path="/fertility/alerts" element={<FertilityGuard><FertilityAlerts /></FertilityGuard>} />
              <Route path="/fertility/erotic-types" element={<FertilityGuard><FertilityEroticTypes /></FertilityGuard>} />
              <Route path="/admin/livestock-groups" element={<LivestockGroupsAdmin />} />
              <Route path="/admin/livestock-types" element={<LivestockTypesAdmin />} />
              <Route path="/admin/livestock-statuses" element={<LivestockStatusesAdmin />} />
              <Route path="/admin/livestock-locations" element={<LivestockLocationsAdmin />} />
              <Route path="/admin/sperms" element={<SpermsAdmin />} />
              <Route path="/admin/sync-types" element={<SyncTypesAdmin />} />
              <Route path="/admin/sync-type-details" element={<SyncTypeDetailsAdmin />} />
              <Route path="/settings" element={<Settings />} />
              {/* Fertility-specific settings page hosting the configurable
                  thresholds that drive the Reproductive Action List. */}
              <Route path="/settings/fertility" element={<FertilitySettings />} />
              <Route path="/reports" element={<Reports />} />
              {/* Fertility Reports submenu — landing page + all report routes. */}
              <Route path="/reports/fertility" element={<FertilityReports />} />
              {/* Reproductive Action List — the operational worklist. */}
              <Route path="/reports/fertility/action-list" element={<FertilityActionList />} />
              {/* Placeholder routes for future fertility reports. */}
              <Route path="/reports/fertility/dashboard" element={<FertilityReportPlaceholder pageTitle="داشبورد باروری" />} />
              <Route path="/reports/fertility/herd-performance" element={<FertilityHerdPerformance />} />
              <Route path="/reports/fertility/semen-performance" element={<FertilityReportPlaceholder pageTitle="عملکرد اسپرم" />} />
              <Route path="/reports/fertility/technician-performance" element={<FertilityReportPlaceholder pageTitle="عملکرد تلقیح‌کنندگان" />} />
              <Route path="/reports/fertility/synchronization-protocols" element={<FertilityReportPlaceholder pageTitle="پروتکل‌های همزمانی" />} />
              <Route path="/reports/fertility/pregnancy-cost" element={<FertilityReportPlaceholder pageTitle="هزینه آبستنی" />} />
              <Route path="/reports/fertility/pregnancy-loss" element={<FertilityReportPlaceholder pageTitle="سقط و تلفات آبستنی" />} />
              <Route path="/reports/fertility/fresh-cows" element={<FertilityReportPlaceholder pageTitle="گاوهای تازه‌زا" />} />
              <Route path="/reports/fertility/economic-analysis" element={<FertilityReportPlaceholder pageTitle="تحلیل اقتصادی تولیدمثل" />} />
              {/* Placeholder routes for future top-level report categories. */}
              <Route path="/reports/health" element={<ReportCategoryPlaceholder categoryTitle="سلامت و دامپزشکی" />} />
              <Route path="/reports/herd" element={<ReportCategoryPlaceholder categoryTitle="گله و جمعیت" />} />
              <Route path="/reports/nutrition" element={<ReportCategoryPlaceholder categoryTitle="تغذیه" />} />
              <Route path="/reports/genetics" element={<ReportCategoryPlaceholder categoryTitle="ژنتیک و اصلاح نژاد" />} />
              <Route path="/reports/economics" element={<ReportCategoryPlaceholder categoryTitle="اقتصاد و مالی" />} />
              <Route path="/reports/calf-heifer" element={<ReportCategoryPlaceholder categoryTitle="مدیریت گوساله و تلیسه" />} />
              <Route path="/reports/facility" element={<ReportCategoryPlaceholder categoryTitle="مدیریت تأسیسات" />} />
              <Route path="/reports/executive-kpis" element={<ReportCategoryPlaceholder categoryTitle="شاخص‌های کلیدی مدیریتی" />} />
              {/* Task 6 — Freight Trips routes. New trip uses the same
                  editor component with no :id param; detail/edit share the
                  same /:id base. */}
              <Route path="/finance/freight-trips" element={<FreightTripsList />} />
              <Route path="/finance/freight-trips/new" element={<FreightTripEditor />} />
              <Route path="/finance/freight-trips/:id" element={<FreightTripDetail />} />
              <Route path="/finance/freight-trips/:id/edit" element={<FreightTripEditor />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
