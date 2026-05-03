// ============================================================
// useHrAlerts
// - On login + every 2 hours, kicks the server-side checker
//   (check-hr-alerts) for the current user. The checker handles
//   throttling, push, and dedup — frontend just triggers it.
// - Polls active hr_notification_alerts every 60s for banner UI.
// - Exposes dismiss(id) → sets dismissed_until = now() + 30 minutes.
// ============================================================

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface HrAlert {
  id: string;
  alert_date: string;
  alert_type: string;
  title: string;
  message: string;
  status: string;
  dismissed_until: string | null;
}

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const POLL_MS = 60_000;
const LAST_KICK_KEY = "hr_alerts_last_kick";

export function useHrAlerts() {
  const { user, isAuthenticated } = useAuth();
  const [alerts, setAlerts] = useState<HrAlert[]>([]);

  // Trigger server-side check (throttled to once per 2h per browser)
  const kickServerCheck = useCallback(async () => {
    if (!user?.username) return;
    try {
      const last = Number(localStorage.getItem(LAST_KICK_KEY) || 0);
      if (Date.now() - last < TWO_HOURS_MS) return;
      localStorage.setItem(LAST_KICK_KEY, String(Date.now()));
      await supabase.functions.invoke("check-hr-alerts", {
        body: { username: user.username },
      });
    } catch (_) {
      // swallow — server handles all reliability
    }
  }, [user?.username]);

  // Fetch active, non-dismissed alerts for the current user
  const refresh = useCallback(async () => {
    if (!user?.username) {
      setAlerts([]);
      return;
    }
    const nowIso = new Date().toISOString();
    const { data } = await supabase
      .from("hr_notification_alerts")
      .select("id, alert_date, alert_type, title, message, status, dismissed_until")
      .eq("username", user.username)
      .eq("status", "active")
      .or(`dismissed_until.is.null,dismissed_until.lt.${nowIso}`)
      .order("alert_date", { ascending: false });
    setAlerts((data ?? []) as HrAlert[]);
  }, [user?.username]);

  // Dismiss for 30 minutes
  const dismiss = useCallback(async (id: string) => {
    const until = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    await supabase
      .from("hr_notification_alerts")
      .update({ dismissed_until: until })
      .eq("id", id);
    setAlerts((prev) => prev.filter((a) => a.id !== id));
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;
    void kickServerCheck();
    void refresh();

    const kickInterval = setInterval(kickServerCheck, TWO_HOURS_MS);
    const pollInterval = setInterval(refresh, POLL_MS);
    return () => {
      clearInterval(kickInterval);
      clearInterval(pollInterval);
    };
  }, [isAuthenticated, kickServerCheck, refresh]);

  return { alerts, dismiss, refresh };
}
