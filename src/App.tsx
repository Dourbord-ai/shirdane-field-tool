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
import AppLayout from "./components/AppLayout";
import NotFound from "./pages/NotFound";

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
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
