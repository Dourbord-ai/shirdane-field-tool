// verify-account edge function
// Verifies bank cards, sheba (IBAN), and deposit accounts via cardinfo.ir.
// Includes detailed diagnostic logging and an opt-in `debug` payload in
// development to help troubleshoot upstream-format issues.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// CORS headers must be present on every response so the browser preview
// can call this function without being blocked by the preflight check.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface VerifyBody {
  type: "1" | "2" | "3"; // 1=card, 2=sheba, 3=deposit
  number: string;
  // When true, the function returns a `debug` object in the response so
  // callers (developer console / test panel) can see exactly what the
  // upstream service returned. This is opt-in to avoid leaking raw
  // upstream payloads in normal production traffic.
  debug?: boolean;
}

interface CardInfoResponse {
  destCard?: string;
  description?: string;
  name?: string;
  bankName?: string;
  doTime?: string;
  log_id?: number | null;
  error?: { message?: string; code?: number | null } | null;
  IBAN?: string;
  deposit?: string;
  depositDescription?: string;
  depositComment?: string;
  depositStatus?: string;
  errorDescription?: string;
  depositOwners?:
    | string
    | Array<{ firstName?: string; lastName?: string }>;
}

const TYPE_LABEL: Record<string, string> = {
  "1": "کارت",
  "2": "شبا",
  "3": "حساب",
};

// normalize() strips whitespace/dashes and converts Persian/Arabic digits
// to ASCII. For sheba it also uppercases (so `ir...` becomes `IR...`).
function normalize(type: string, raw: string): string {
  let n = (raw || "").trim().replace(/[\s\-]/g, "");
  const fa = "۰۱۲۳۴۵۶۷۸۹";
  const ar = "٠١٢٣٤٥٦٧٨٩";
  n = n.replace(/[۰-۹]/g, (d) => String(fa.indexOf(d)));
  n = n.replace(/[٠-٩]/g, (d) => String(ar.indexOf(d)));
  if (type === "2") n = n.toUpperCase();
  return n;
}

function validate(type: string, n: string): string | null {
  if (type === "1") {
    if (!/^\d{16}$/.test(n)) return "شماره کارت باید ۱۶ رقم باشد";
  } else if (type === "2") {
    const stripped = n.startsWith("IR") ? n.slice(2) : n;
    if (!/^\d{24}$/.test(stripped)) return "شماره شبا نامعتبر است";
  } else if (type === "3") {
    if (!/^\d{3,20}$/.test(n)) return "شماره حساب نامعتبر است";
  } else {
    return "نوع نامعتبر است";
  }
  return null;
}

function buildUrl(type: string, n: string): string {
  const base = "https://cardinfo.ir/inquiry/apiv1";
  if (type === "1") return `${base}?api=card_info&card=${n}`;
  if (type === "2") {
    const sheba = n.startsWith("IR") ? n : `IR${n}`;
    return `${base}?api=sheba_info&sheba=${sheba}`;
  }
  // type === "3" - hardcoded bank=016 (Keshavarzi)
  return `${base}?api=deposit_sheba&deposit=${n}&bank=016`;
}

// extractName() tries multiple known response shapes; we track which
// branch matched so the caller can see the parser decision.
function extractName(
  data: CardInfoResponse,
): { name: string | null; branch: string } {
  if (data.name && data.name.trim()) {
    return { name: data.name.trim(), branch: "data.name" };
  }
  if (Array.isArray(data.depositOwners) && data.depositOwners.length > 0) {
    const o = data.depositOwners[0];
    const joined = [o.firstName, o.lastName].filter(Boolean).join(" ").trim();
    return { name: joined || null, branch: "depositOwners[0].firstName+lastName" };
  }
  if (typeof data.depositOwners === "string" && data.depositOwners.trim()) {
    return { name: data.depositOwners.trim(), branch: "depositOwners(string)" };
  }
  return { name: null, branch: "none" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // requestId helps correlate all log lines for a single invocation.
  const requestId = crypto.randomUUID().slice(0, 8);
  const log = (...args: unknown[]) => console.log(`[verify-account ${requestId}]`, ...args);
  const logErr = (...args: unknown[]) => console.error(`[verify-account ${requestId}]`, ...args);

  try {
    const body = (await req.json()) as VerifyBody;
    const rawType = String(body.type ?? "");
    const rawNumber = String(body.number ?? "");
    const debugMode = body.debug === true;

    log("incoming:", { type: rawType, number: rawNumber, debugMode });

    const type = rawType;
    const number = normalize(type, rawNumber);

    log("normalized:", { type, number, label: TYPE_LABEL[type] });

    const validationError = validate(type, number);
    if (validationError) {
      log("validation failed:", validationError);
      return new Response(
        JSON.stringify({
          ok: false,
          error: validationError,
          ...(debugMode ? { debug: { stage: "validate", type, number } } : {}),
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // 1. Check cache
    const { data: cached } = await supabase
      .from("bankpartyaccountinfos")
      .select("matchname, matchbankname")
      .eq("matchtype", type)
      .eq("matchcontent", number)
      .maybeSingle();

    if (cached && cached.matchname) {
      log("cache hit:", cached);
      const result = {
        ok: true,
        cached: true,
        name: cached.matchname,
        bankName: cached.matchbankname || null,
        ...(debugMode ? { debug: { stage: "cache_hit", branch: "db_cache" } } : {}),
      };
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    log("cache miss");

    // 2. Call cardinfo.ir
    const apiKey = Deno.env.get("CARDINFO_API_KEY");
    if (!apiKey) {
      logErr("CARDINFO_API_KEY not configured");
      return new Response(
        JSON.stringify({
          ok: false,
          error: "API key not configured",
          ...(debugMode ? { debug: { stage: "no_api_key" } } : {}),
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const url = buildUrl(type, number);
    log("calling upstream:", url);

    const apiRes = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    const text = await apiRes.text();
    const rawResponsePreview = text.length > 1000 ? text.slice(0, 1000) + "…[truncated]" : text;
    log("upstream status:", apiRes.status, "content-type:", apiRes.headers.get("content-type"));
    log("upstream raw body:", rawResponsePreview);

    // Build a reusable debug block so every branch below can include it
    // when the caller asked for it.
    const baseDebug = {
      requestId,
      normalizedPayload: { type, number },
      externalUrl: url,
      externalStatus: apiRes.status,
      externalContentType: apiRes.headers.get("content-type"),
      rawResponsePreview,
    };

    let data: CardInfoResponse;
    try {
      data = JSON.parse(text);
    } catch (parseErr) {
      logErr("upstream returned non-JSON:", parseErr);
      return new Response(
        JSON.stringify({
          ok: false,
          error: "پاسخ نامعتبر از سرویس (JSON parse failed)",
          ...(debugMode
            ? {
                debug: {
                  ...baseDebug,
                  stage: "parse_error",
                  parseError: (parseErr as Error).message,
                },
              }
            : {}),
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    log("parsed JSON keys:", Object.keys(data));

    if (data.error && data.error.message) {
      log("upstream returned error field:", data.error);
      return new Response(
        JSON.stringify({
          ok: false,
          error: data.error.message || data.errorDescription || "خطای استعلام",
          ...(debugMode
            ? { debug: { ...baseDebug, stage: "upstream_error", upstreamError: data.error } }
            : {}),
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { name, branch } = extractName(data);
    const bankName = data.bankName || null;
    log("extractName branch:", branch, "name:", name, "bankName:", bankName);

    if (!name) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: data.errorDescription || "نام صاحب حساب یافت نشد",
          ...(debugMode
            ? {
                debug: {
                  ...baseDebug,
                  stage: "no_name",
                  branch,
                  parsedKeys: Object.keys(data),
                  depositStatus: data.depositStatus,
                  errorDescription: data.errorDescription,
                },
              }
            : {}),
        }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 3. Save to cache
    const { error: insertError } = await supabase
      .from("bankpartyaccountinfos")
      .insert({
        matchtype: type,
        matchcontent: number,
        matchname: name,
        matchbankname: bankName,
        bankpartyid: null,
        status: null,
      });

    if (insertError) {
      logErr("cache insert failed:", insertError);
    }

    const finalResult = {
      ok: true,
      cached: false,
      name,
      bankName,
      ...(debugMode
        ? { debug: { ...baseDebug, stage: "success", branch } }
        : {}),
    };
    log("returning:", { ok: true, name, bankName, branch });

    return new Response(JSON.stringify(finalResult), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    logErr("uncaught error:", e);
    return new Response(
      JSON.stringify({
        ok: false,
        error: (e as Error).message || "خطای داخلی",
        debug: { stage: "uncaught", message: (e as Error).message, stack: (e as Error).stack },
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
