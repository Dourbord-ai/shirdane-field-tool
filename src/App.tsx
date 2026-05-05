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
import LivestockProfile from "./pages/LivestockProfile";
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
              <Route path="/livestock/:id" element={<LivestockProfile />} />
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
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
