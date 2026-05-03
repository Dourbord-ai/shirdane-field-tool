// ============================================================
// submit-hr-request
// Bridges the React HR forms to the legacy HR SOAP/JSON API.
// - Looks up hr_users by username or hr_user_id
// - Wraps payload in legacy envelope (AppVersion + UserInfo)
// - Posts to HR_API_BASE_URL/<endpoint>
// - Normalizes response to { success, legacy_status, message|error, raw }
// - Logs every request to public.hr_requests_log (without password)
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const APP_VERSION = "2.0.0";

type RequestType =
  | "manual_traffic"
  | "overtime"
  | "mission"
  | "exception_shift"
  | "leave";

interface ActionConfig {
  endpoint: string;
  objectName: string;
  resultKey: string;
}

const ACTIONS: Record<RequestType, ActionConfig> = {
  manual_traffic: {
    endpoint: "/AddManualTrafficD79B1412BEBB2",
    objectName: "ManualTraffic",
    resultKey: "AddManualTrafficD79B1412BEBB2Result",
  },
  overtime: {
    endpoint: "/AddOvertimeD79B1412BEBB2",
    objectName: "Overtime",
    resultKey: "AddOvertimeD79B1412BEBB2Result",
  },
  mission: {
    endpoint: "/AddMissionD79B1412BEBB2",
    objectName: "Mission",
    resultKey: "AddMissionD79B1412BEBB2Result",
  },
  exception_shift: {
    endpoint: "/AddExceptionUserShiftD79B1412BEBB2",
    objectName: "ExceptionUserShift",
    resultKey: "AddExceptionUserShiftD79B1412BEBB2Result",
  },
  leave: {
    endpoint: "/AddLeaveD79B1412BEBB2",
    objectName: "Leave",
    resultKey: "AddLeaveD79B1412BEBB2Result",
  },
};

// ----------- helpers -----------

const isJalaliDate = (s: unknown): s is string =>
  typeof s === "string" && /^\d{4}\/\d{1,2}\/\d{1,2}$/.test(s);

const isHHmm = (s: unknown): s is string =>
  typeof s === "string" && /^\d{1,2}:\d{2}$/.test(s);

const cmpJalali = (a: string, b: string): number => {
  // Lexicographic on YYYY/MM/DD with zero-pad
  const pad = (s: string) => {
    const [y, m, d] = s.split("/");
    return `${y}/${m.padStart(2, "0")}/${d.padStart(2, "0")}`;
  };
  return pad(a) < pad(b) ? -1 : pad(a) > pad(b) ? 1 : 0;
};

const cmpHHmm = (a: string, b: string): number => {
  const toMin = (s: string) => {
    const [h, m] = s.split(":").map(Number);
    return h * 60 + m;
  };
  return toMin(a) - toMin(b);
};

function validatePayload(
  type: RequestType,
  payload: Record<string, any>,
): string | null {
  const need = (field: string) =>
    payload[field] === undefined ||
    payload[field] === null ||
    payload[field] === ""
      ? `فیلد ${field} الزامی است.`
      : null;

  if (type === "manual_traffic") {
    return (
      need("Date1") || need("Time") || need("TrafficFor") ||
      need("TrafficType") || need("DescriptionOfReq") ||
      (!isJalaliDate(payload.Date1) ? "Date1 باید Jalali YYYY/MM/DD باشد." : null) ||
      (!isHHmm(payload.Time) ? "Time باید HH:mm باشد." : null)
    );
  }

  if (type === "overtime") {
    const base =
      need("Date1") || need("StartTime") || need("EndTime") ||
      need("DescriptionOfReq") ||
      (!isJalaliDate(payload.Date1) ? "Date1 باید Jalali باشد." : null) ||
      (!isHHmm(payload.StartTime) ? "StartTime باید HH:mm باشد." : null) ||
      (!isHHmm(payload.EndTime) ? "EndTime باید HH:mm باشد." : null);
    if (base) return base;
    if (cmpHHmm(payload.StartTime, payload.EndTime) >= 0)
      return "ساعت شروع باید قبل از ساعت پایان باشد.";
    return null;
  }

  if (type === "mission") {
    if (payload.TypeOfMission === undefined || payload.TypeOfMission === null)
      return "TypeOfMission الزامی است.";
    const common =
      need("LocationType") || need("Location") || need("DescriptionOfReq");
    if (common) return common;
    if (payload.TypeOfMission === true) {
      const e =
        need("Date1") || need("StartTime") || need("EndTime") ||
        (!isJalaliDate(payload.Date1) ? "Date1 باید Jalali باشد." : null) ||
        (!isHHmm(payload.StartTime) ? "StartTime باید HH:mm باشد." : null) ||
        (!isHHmm(payload.EndTime) ? "EndTime باید HH:mm باشد." : null);
      if (e) return e;
      if (cmpHHmm(payload.StartTime, payload.EndTime) >= 0)
        return "ساعت شروع باید قبل از ساعت پایان باشد.";
    } else {
      const e =
        need("StartDate") || need("EndDate") ||
        (!isJalaliDate(payload.StartDate) ? "StartDate باید Jalali باشد." : null) ||
        (!isJalaliDate(payload.EndDate) ? "EndDate باید Jalali باشد." : null);
      if (e) return e;
      if (cmpJalali(payload.StartDate, payload.EndDate) > 0)
        return "تاریخ شروع باید قبل یا برابر تاریخ پایان باشد.";
    }
    return null;
  }

  if (type === "exception_shift") {
    const e =
      need("Date1") || need("ShiftType") ||
      need("StartTime") || need("EndTime") ||
      need("DescriptionOfReq") ||
      (!isJalaliDate(payload.Date1) ? "Date1 باید Jalali باشد." : null) ||
      (!isHHmm(payload.StartTime) ? "StartTime باید HH:mm باشد." : null) ||
      (!isHHmm(payload.EndTime) ? "EndTime باید HH:mm باشد." : null);
    if (e) return e;
    if (cmpHHmm(payload.StartTime, payload.EndTime) >= 0)
      return "ساعت شروع شیفت باید قبل از ساعت پایان باشد.";

    const st = Number(payload.ShiftType);
    if (![1, 2, 3].includes(st))
      return "ShiftType باید 1 (عادی), 2 (جمعه کاری) یا 3 (تعطیل کاری) باشد.";

    if (st === 2) {
      if (!payload.AlternateShiftDate)
        return "AlternateShiftDate برای ShiftType=2 الزامی است.";
      if (!isJalaliDate(payload.AlternateShiftDate))
        return "AlternateShiftDate باید Jalali باشد.";
    }
    if (st === 3 && payload.AlternateShiftDate) {
      return "برای تعطیل کاری امکان انتخاب تایم تعطیل جایگزین وجود ندارد.";
    }

    // Optional break window — if one side is provided, both must be valid HH:mm and ordered
    const hasBreakStart = payload.BreakStart !== undefined && payload.BreakStart !== null && payload.BreakStart !== "";
    const hasBreakEnd   = payload.BreakEnd   !== undefined && payload.BreakEnd   !== null && payload.BreakEnd   !== "";
    if (hasBreakStart || hasBreakEnd) {
      if (!hasBreakStart || !hasBreakEnd)
        return "بازه استراحت باید هر دو ساعت شروع و پایان داشته باشد.";
      if (!isHHmm(payload.BreakStart)) return "BreakStart باید HH:mm باشد.";
      if (!isHHmm(payload.BreakEnd))   return "BreakEnd باید HH:mm باشد.";
      if (cmpHHmm(payload.BreakStart, payload.BreakEnd) >= 0)
        return "ساعت شروع استراحت باید قبل از ساعت پایان باشد.";
    }
    return null;
  }

  if (type === "leave") {
    if (payload.TypeOfLeave === undefined || payload.TypeOfLeave === null)
      return "TypeOfLeave الزامی است.";
    if (payload.TypeOfLeave === true) {
      const e =
        need("Date1") || need("StartTime") || need("EndTime") ||
        need("DescriptionOfReq") ||
        (!isJalaliDate(payload.Date1) ? "Date1 باید Jalali باشد." : null) ||
        (!isHHmm(payload.StartTime) ? "StartTime باید HH:mm باشد." : null) ||
        (!isHHmm(payload.EndTime) ? "EndTime باید HH:mm باشد." : null);
      if (e) return e;
      if (cmpHHmm(payload.StartTime, payload.EndTime) >= 0)
        return "ساعت شروع باید قبل از ساعت پایان باشد.";
    } else {
      const e =
        need("TypeOfFalseLeave") || need("StartDate") || need("EndDate") ||
        (!isJalaliDate(payload.StartDate) ? "StartDate باید Jalali باشد." : null) ||
        (!isJalaliDate(payload.EndDate) ? "EndDate باید Jalali باشد." : null);
      if (e) return e;
      if (cmpJalali(payload.StartDate, payload.EndDate) > 0)
        return "تاریخ شروع باید قبل یا برابر تاریخ پایان باشد.";
      const t = Number(payload.TypeOfFalseLeave);
      if ((t === 2 || t === 3 || t === 4) &&
          (!payload.DescriptionOfReq || String(payload.DescriptionOfReq).trim() === "")) {
        return "برای این نوع مرخصی، توضیحات الزامی است.";
      }
    }
    return null;
  }

  return "نوع درخواست نامعتبر است.";
}

// ----------- response normalization -----------

function extractLegacyResult(raw: any, resultKey: string): any {
  if (!raw || typeof raw !== "object") return raw;
  if (raw[resultKey] !== undefined) return raw[resultKey];
  if (raw.d !== undefined) {
    // Sometimes wrapped twice
    if (typeof raw.d === "object" && raw.d?.[resultKey] !== undefined)
      return raw.d[resultKey];
    return raw.d;
  }
  return raw;
}

function normalizeLegacy(raw: any, resultKey: string): {
  legacy_status: number | null;
  message: string;
} {
  const inner = extractLegacyResult(raw, resultKey) ?? {};
  // Try common shapes for status code + message
  let code: any =
    inner.Item1 ?? inner.m_Item1 ?? inner.item1 ?? inner.Status ?? inner.status ?? null;
  let msg: any =
    inner.Item2 ?? inner.m_Item2 ?? inner.item2 ?? inner.Message ?? inner.message ?? "";

  // Sometimes code is string-numeric
  const numCode = code === null || code === undefined ? null : Number(code);
  return {
    legacy_status: Number.isFinite(numCode as number) ? (numCode as number) : null,
    message: typeof msg === "string" ? msg : JSON.stringify(msg),
  };
}

// ----------- main handler -----------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const HR_API_BASE_URL = Deno.env.get("HR_API_BASE_URL");
  if (!HR_API_BASE_URL) {
    return new Response(
      JSON.stringify({ success: false, error: "HR_API_BASE_URL is not configured." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ success: false, error: "JSON بدنه درخواست نامعتبر است." }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const type: RequestType = body?.type;
  const username: string | undefined = body?.username || undefined;
  const hrUserIdInput: number | string | undefined = body?.hr_user_id ?? undefined;
  const payload: Record<string, any> = body?.payload || {};

  if (!type || !ACTIONS[type]) {
    return new Response(
      JSON.stringify({ success: false, error: "type نامعتبر است." }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
  if (!username && (hrUserIdInput === undefined || hrUserIdInput === null || hrUserIdInput === "")) {
    return new Response(
      JSON.stringify({ success: false, error: "username یا hr_user_id الزامی است." }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // Frontend payload validation (defensive — frontend already validates)
  const validationError = validatePayload(type, payload);
  if (validationError) {
    return new Response(
      JSON.stringify({ success: false, error: validationError }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // Optional: capture caller's Supabase user (best-effort, no rejection)
  let supaUserId: string | null = null;
  const authHeader = req.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    try {
      const { data } = await supabase.auth.getClaims(authHeader.replace("Bearer ", ""));
      supaUserId = (data?.claims?.sub as string) || null;
    } catch {
      // ignore
    }
  }

  // Lookup hr_users
  let hrUserQuery = supabase
    .from("hr_users")
    .select("id, username, password_hash, personnel_code")
    .limit(1);

  if (hrUserIdInput !== undefined && hrUserIdInput !== null && hrUserIdInput !== "") {
    hrUserQuery = hrUserQuery.eq("id", Number(hrUserIdInput));
  } else if (username) {
    hrUserQuery = hrUserQuery.eq("username", username);
  }

  const { data: hrUserRows, error: hrUserErr } = await hrUserQuery;
  if (hrUserErr || !hrUserRows || hrUserRows.length === 0) {
    const errMsg = hrUserErr?.message || "کاربر HR پیدا نشد.";
    await supabase.from("hr_requests_log").insert({
      user_id: supaUserId,
      hr_user_id: hrUserIdInput ? Number(hrUserIdInput) : null,
      request_type: type,
      payload,
      legacy_payload: null,
      response: null,
      status: "error",
      error: errMsg,
    });
    return new Response(
      JSON.stringify({ success: false, error: errMsg }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const hrUser = hrUserRows[0];
  const action = ACTIONS[type];

  // Build legacy envelope
  const legacyEnvelope = {
    AppVersion: APP_VERSION,
    UserInfo: {
      Id: String(hrUser.id),
      UserName: hrUser.username,
      Password: hrUser.password_hash,
    },
    [action.objectName]: payload,
  };

  // For logging — strip password
  const legacyForLog = {
    ...legacyEnvelope,
    UserInfo: { Id: String(hrUser.id), UserName: hrUser.username },
  };

  // Call legacy API
  const url = `${HR_API_BASE_URL.replace(/\/+$/, "")}${action.endpoint}`;
  let legacyRaw: any = null;
  let rawText = "";
  let httpOk = false;
  let httpStatus = 0;
  let fetchError: string | null = null;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(legacyEnvelope),
    });
    httpStatus = res.status;
    httpOk = res.ok;
    rawText = await res.text();
    try {
      legacyRaw = rawText ? JSON.parse(rawText) : null;
    } catch {
      legacyRaw = { raw_text: rawText };
    }
  } catch (err: any) {
    fetchError = err?.message || String(err);
  }

  if (fetchError || !httpOk) {
    const errMsg =
      fetchError ||
      `سرور HR پاسخ نامعتبر داد (HTTP ${httpStatus}).`;

    // Safe payload — never include real password_hash
    const safeLegacyPayload = {
      ...legacyEnvelope,
      UserInfo: {
        Id: String(hrUser.id),
        UserName: hrUser.username,
        Password: "***",
      },
    };

    await supabase.from("hr_requests_log").insert({
      user_id: supaUserId,
      hr_user_id: Number(hrUser.id),
      request_type: type,
      payload,
      legacy_payload: legacyForLog,
      response: legacyRaw,
      status: "error",
      error: errMsg,
    });

    // TEMPORARY DEBUG RESPONSE — remove once HR API integration is verified
    return new Response(
      JSON.stringify({
        success: false,
        debug: true,
        legacy_http_status: httpStatus,
        endpoint_url: url,
        request_type: type,
        safe_legacy_payload: safeLegacyPayload,
        raw_text: rawText,
        ...(fetchError ? { fetch_error: fetchError } : {}),
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const { legacy_status, message } = normalizeLegacy(legacyRaw, action.resultKey);
  const success = legacy_status === 1;

  await supabase.from("hr_requests_log").insert({
    user_id: supaUserId,
    hr_user_id: Number(hrUser.id),
    request_type: type,
    payload,
    legacy_payload: legacyForLog,
    response: legacyRaw,
    status: success ? "success" : "error",
    error: success ? null : (message || `legacy_status=${legacy_status ?? "?"}`),
  });

  if (success) {
    return new Response(
      JSON.stringify({
        success: true,
        legacy_status,
        message: message || "ثبت با موفقیت انجام شد.",
        raw: legacyRaw,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  return new Response(
    JSON.stringify({
      success: false,
      legacy_status,
      error: message || "خطا در ثبت درخواست.",
      raw: legacyRaw,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
