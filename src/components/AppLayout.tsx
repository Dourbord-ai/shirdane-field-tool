import { Outlet } from "react-router-dom";
import AppHeader from "./AppHeader";

export default function AppLayout() {
  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="pt-14 pb-6 px-4 max-w-lg mx-auto">
        <Outlet />
      </main>
    </div>
  );
}
