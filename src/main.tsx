import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import "./lib/devAccess"; // TEMP: dev access mode warning + bypass
import "./lib/devVerifyAccount"; // dev-only: exposes window.__verifyAccountTest
import "./lib/financeAutoProcessDebug"; // registers window.enable/disableFinanceAutoProcessDebug
import "./lib/financeIdentifiersCleanup"; // registers window.financeResetIdentifiers
import { initGlobalErrorLogger } from "@/lib/logger";

initGlobalErrorLogger();

createRoot(document.getElementById("root")!).render(<App />);
