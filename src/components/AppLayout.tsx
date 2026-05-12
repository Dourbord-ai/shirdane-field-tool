import { Outlet, useLocation } from "react-router-dom";
import AppHeader from "./AppHeader";
import GlobalSidebar from "./global/GlobalSidebar";
import MobileBottomNav from "./global/MobileBottomNav";

export default function AppLayout() {
  const location = useLocation();
  const fullscreen = location.pathname.startsWith("/milk-record/quick");

  if (fullscreen) {
    return (
      <div className="min-h-screen">
        <Outlet />
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <GlobalSidebar />
      <AppHeader />
      <main className="pt-[calc(var(--header-height)+0.5rem)] pb-[6rem] lg:pb-8 px-4 sm:px-6 lg:pr-[17rem] lg:pl-8 max-w-[1600px] mx-auto w-full">
        <Outlet />
      </main>
      <MobileBottomNav />
    </div>
  );
}
