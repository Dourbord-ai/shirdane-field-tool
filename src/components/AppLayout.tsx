import { Outlet } from "react-router-dom";
import AppHeader from "./AppHeader";

export default function AppLayout() {
  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="pt-14 pb-6 px-4 sm:px-6 lg:px-8 max-w-lg sm:max-w-2xl lg:max-w-5xl xl:max-w-6xl mx-auto w-full">
        <Outlet />
      </main>
    </div>
  );
}
