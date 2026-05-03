// ============================================================
// check-hr-alerts
// Server-side checker that:
//   1. Calls the legacy HR API (same as get-hr-attendance) for a user
//   2. Detects "incomplete" attendance days (تاخیر / ثبت نشده / اطلاعات ناقص)
//      while ignoring Fridays, holidays, approved leaves & missions
//   3. Upserts rows in hr_notification_alerts (one row per
//      hr_user_id + alert_date + alert_type) → no duplicates
//   4. Sends ONE grouped push notification per user, throttled
//      to once every 2 hours (last_sent_at)
//   5. Skips push if today is Friday in Tehran
//
// Modes:
//   POST { username }              → check that one user
//   POST { all: true }             → iterate every hr_users row
//                                    (use this from a cron job)
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const LEGACY_URL = Deno.env.get("HR_API_URL")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

// ------------------------------------------------------------
// Tehran weekday helper — Friday = "Fri"
// ------------------------------------------------------------
function isTehranFriday(d: Date = new Date()): boolean {
  const wd = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tehran",
    weekday: "short",
  }).format(d);
  return wd === "Fri";
}

// ------------------------------------------------------------
// Legacy KV helpers (mirror of get-hr-attendance)
// ------------------------------------------------------------
type KV = { Key?: string; Value?: unknown; key?: string; value?: unknown };

function kvArr(raw: any, name: string): KV[] {
  const v = raw?.[name];
  return Array.isArray(v) ? (v as KV[]) : [];
}
function indexByDate(items: KV[]): Map<string, unknown> {
  const map = new Map<string, unknown>();
  for (const it of items) {
    const k = (it?.Key ?? it?.key) as string | undefined;
    if (k) map.set(String(k), it?.Value ?? it?.value);
  }
  return map;
}
function num(v: unknown): number {
  const n = Number(v);
  return isFinite(n) ? n : 0;
}
function pick<T = unknown>(obj: any, keys: string[]): T | undefined {
  if (!obj || typeof obj !== "object") return undefined;
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null) return obj[k] as T;
  }
  return undefined;
}

// ------------------------------------------------------------
// Detect incomplete days
// Returns { alert_type, state_label } per problematic day.
// Skips Fridays, holidays, approved leave/mission days.
// Skips today (still in progress) and future days.
// ------------------------------------------------------------
type Detected = { date: string; alert_type: string; state: string };

function detectIncompleteDays(daysRaw: any): Detected[] {
  if (!daysRaw || typeof daysRaw !== "object") return [];

  const dayOfWeeks = indexByDate(kvArr(daysRaw, "DayOfWeeks"));
  const lowTimes = indexByDate(kvArr(daysRaw, "LowTimes"));
  const traffics = indexByDate(kvArr(daysRaw, "Traffics"));
  const times = indexByDate(kvArr(daysRaw, "Times"));
  const shiftTimes = indexByDate(kvArr(daysRaw, "ShiftTimes"));

  const holidays: string[] = Array.isArray(daysRaw?.Holidays) ? daysRaw.Holidays : [];
  const trueLeaves: string[] = Array.isArray(daysRaw?.TrueLeaveDates) ? daysRaw.TrueLeaveDates : [];
  const trueMissions: string[] = Array.isArray(daysRaw?.TrueMissionDates) ? daysRaw.TrueMissionDates : [];

  // Today's Shamsi (rough — done by checking the legacy "report_date" upstream is
  // out of scope; we rely on date comparison: skip the latest date in dataset)
  const allDates = new Set<string>();
  for (const m of [dayOfWeeks, lowTimes, traffics, times, shiftTimes]) {
    for (const k of m.keys()) allDates.add(k);
  }
  const sorted = Array.from(allDates).sort();
  const todayIsh = sorted[sorted.length - 1]; // skip last day to avoid alerting mid-day

  const out: Detected[] = [];

  for (const date of sorted) {
    if (date === todayIsh) continue;

    const dayName = String(dayOfWeeks.get(date) ?? "");
    if (dayName === "جمعه") continue;
    if (holidays.includes(date)) continue;
    if (trueLeaves.includes(date)) continue;
    if (trueMissions.includes(date)) continue;

    const shiftMin = num(shiftTimes.get(date));
    if (shiftMin <= 0) continue; // no scheduled shift → ignore

    const trafficsVal = traffics.get(date);
    const trafficsArr = Array.isArray(trafficsVal)
      ? trafficsVal
      : typeof trafficsVal === "string"
      ? trafficsVal.split(/[\-،,]/).map((s) => s.trim()).filter(Boolean)
      : [];

    const lateMin = num(lowTimes.get(date));
    const workedMin = num(times.get(date));

    // 1) Not registered: no traffic at all and no worked minutes
    if (trafficsArr.length === 0 && workedMin === 0) {
      out.push({ date, alert_type: "not_registered", state: "ثبت نشده" });
      continue;
    }
    // 2) Incomplete traffic: odd count (missing in/out pair)
    if (trafficsArr.length > 0 && trafficsArr.length % 2 !== 0) {
      out.push({ date, alert_type: "incomplete", state: "اطلاعات ناقص" });
      continue;
    }
    // 3) Late
    if (lateMin > 0) {
      out.push({ date, alert_type: "late", state: "تاخیر" });
      continue;
    }
  }

  return out;
}

// ------------------------------------------------------------
// Process one HR user
// ------------------------------------------------------------
async function processUser(
  supabase: ReturnType<typeof createClient>,
  hrUser: { id: number; username: string; password_hash: string },
): Promise<{ username: string; detected: number; pushed: boolean; reason?: string }> {
  // 1) Call legacy HR API
  const legacyPayload = {
    UserInfo: {
      Id: String(hrUser.id),
      UserName: hrUser.username,
      Password: hrUser.password_hash,
    },
    AppVersion: "2.0.0",
    SearchWithOpenRequest: 2,
  };

  const legacyRes = await fetch(LEGACY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(legacyPayload),
  });

  if (!legacyRes.ok) {
    return { username: hrUser.username, detected: 0, pushed: false, reason: `legacy ${legacyRes.status}` };
  }

  const legacyJson: any = await legacyRes.json().catch(() => ({}));
  const root = legacyJson?.GetAllTrafficsD79B1412BEBB2Result ?? legacyJson?.d ?? legacyJson;
  const daysRaw = pick(root, ["m_Item4", "Item4"]);

  const detected = detectIncompleteDays(daysRaw);

  if (detected.length === 0) {
    // Mark previously-active alerts as resolved
    await supabase
      .from("hr_notification_alerts")
      .update({ status: "resolved" })
      .eq("hr_user_id", hrUser.id)
      .eq("status", "active");
    return { username: hrUser.username, detected: 0, pushed: false, reason: "no issues" };
  }

  // 2) Find matching app_user (for push targeting)
  const { data: appUser } = await supabase
    .from("app_users")
    .select("id")
    .eq("username", hrUser.username)
    .maybeSingle();

  const TITLE = "سامانه هوشمند منابع انسانی";

  // 3) Upsert one row per detected day
  for (const d of detected) {
    const message =
      `اطلاعات تردد شما در تاریخ ${d.date} ناقص است.\n` +
      `وضعیت: ${d.state}\n` +
      `لطفا فورا بررسی نمایید.`;

    await supabase
      .from("hr_notification_alerts")
      .upsert(
        {
          user_id: appUser?.id ?? null,
          hr_user_id: hrUser.id,
          username: hrUser.username,
          alert_date: d.date,
          alert_type: d.alert_type,
          title: TITLE,
          message,
          status: "active",
        },
        { onConflict: "hr_user_id,alert_date,alert_type" },
      );
  }

  // Resolve any active alerts that no longer apply
  const stillActiveKeys = new Set(detected.map((d) => `${d.date}|${d.alert_type}`));
  const { data: existing } = await supabase
    .from("hr_notification_alerts")
    .select("id, alert_date, alert_type")
    .eq("hr_user_id", hrUser.id)
    .eq("status", "active");
  const toResolve = (existing ?? []).filter(
    (a: any) => !stillActiveKeys.has(`${a.alert_date}|${a.alert_type}`),
  );
  if (toResolve.length > 0) {
    await supabase
      .from("hr_notification_alerts")
      .update({ status: "resolved" })
      .in("id", toResolve.map((a: any) => a.id));
  }

  // 4) Throttle push: skip if any active alert was sent < 2h ago for this user
  if (isTehranFriday()) {
    return { username: hrUser.username, detected: detected.length, pushed: false, reason: "friday" };
  }

  const { data: activeAlerts } = await supabase
    .from("hr_notification_alerts")
    .select("alert_date, alert_type, last_sent_at")
    .eq("hr_user_id", hrUser.id)
    .eq("status", "active");

  const now = Date.now();
  const lastSent = (activeAlerts ?? [])
    .map((a: any) => (a.last_sent_at ? new Date(a.last_sent_at).getTime() : 0))
    .reduce((a: number, b: number) => Math.max(a, b), 0);

  if (lastSent && now - lastSent < TWO_HOURS_MS) {
    return { username: hrUser.username, detected: detected.length, pushed: false, reason: "throttled" };
  }

  // 5) Build grouped push body
  const lines = (activeAlerts ?? []).map(
    (a: any) => `• ${a.alert_date} — ${stateLabelOf(a.alert_type)}`,
  );
  const body =
    detected.length === 1
      ? `اطلاعات تردد شما در تاریخ ${detected[0].date} ناقص است (${detected[0].state}). لطفا فورا بررسی نمایید.`
      : `اطلاعات تردد شما در ${lines.length} روز ناقص است:\n${lines.join("\n")}\nلطفا فورا بررسی نمایید.`;

  let pushed = false;
  if (appUser?.id) {
    try {
      const r = await fetch(`${SUPABASE_URL}/functions/v1/send-push`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SERVICE_ROLE}`,
        },
        body: JSON.stringify({
          user_id: appUser.id,
          title: TITLE,
          body,
          url: "/hr",
          tag: `hr-alerts-${hrUser.id}`,
        }),
      });
      pushed = r.ok;
    } catch (_) {
      pushed = false;
    }
  }

  // Update last_sent_at on all active alerts (so next throttle window starts now)
  await supabase
    .from("hr_notification_alerts")
    .update({ last_sent_at: new Date().toISOString() })
    .eq("hr_user_id", hrUser.id)
    .eq("status", "active");

  return { username: hrUser.username, detected: detected.length, pushed };
}

function stateLabelOf(t: string): string {
  if (t === "late") return "تاخیر";
  if (t === "not_registered") return "ثبت نشده";
  if (t === "incomplete") return "اطلاعات ناقص";
  return t;
}

// ------------------------------------------------------------
// Handler
// ------------------------------------------------------------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
    const body = await req.json().catch(() => ({}));

    let users: any[] = [];

    if (body?.all === true) {
      const { data } = await supabase
        .from("hr_users")
        .select("id, username, password_hash");
      users = data ?? [];
    } else if (body?.username) {
      const { data } = await supabase
        .from("hr_users")
        .select("id, username, password_hash")
        .eq("username", body.username)
        .maybeSingle();
      if (data) users = [data];
    } else {
      return new Response(
        JSON.stringify({ success: false, error: "ارسال username یا all=true الزامی است." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const results = [];
    for (const u of users) {
      try {
        results.push(await processUser(supabase, u));
      } catch (e) {
        results.push({ username: u.username, detected: 0, pushed: false, reason: String(e) });
      }
    }

    return new Response(
      JSON.stringify({ success: true, processed: results.length, results }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
