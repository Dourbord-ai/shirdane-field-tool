import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface VerifyBody {
  type: "1" | "2" | "3"; // 1=card, 2=sheba, 3=deposit
  number: string;
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

function normalize(type: string, raw: string): string {
  let n = (raw || "").trim().replace(/[\s\-]/g, "");
  // Convert Persian/Arabic digits to English
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

function extractName(data: CardInfoResponse): string | null {
  if (data.name && data.name.trim()) return data.name.trim();
  if (Array.isArray(data.depositOwners) && data.depositOwners.length > 0) {
    const o = data.depositOwners[0];
    return [o.firstName, o.lastName].filter(Boolean).join(" ").trim() || null;
  }
  if (typeof data.depositOwners === "string" && data.depositOwners.trim()) {
    return data.depositOwners.trim();
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = (await req.json()) as VerifyBody;
    const type = String(body.type ?? "");
    const number = normalize(type, String(body.number ?? ""));

    const validationError = validate(type, number);
    if (validationError) {
      return new Response(
        JSON.stringify({ ok: false, error: validationError }),
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
      console.log("Cache hit for", TYPE_LABEL[type], number);
      return new Response(
        JSON.stringify({
          ok: true,
          cached: true,
          name: cached.matchname,
          bankName: cached.matchbankname || null,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 2. Call cardinfo.ir
    const apiKey = Deno.env.get("CARDINFO_API_KEY");
    if (!apiKey) {
      return new Response(
        JSON.stringify({ ok: false, error: "API key not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const url = buildUrl(type, number);
    console.log("Calling cardinfo.ir:", url);
    const apiRes = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    const text = await apiRes.text();
    let data: CardInfoResponse;
    try {
      data = JSON.parse(text);
    } catch {
      console.error("Invalid JSON from cardinfo:", text);
      return new Response(
        JSON.stringify({ ok: false, error: "پاسخ نامعتبر از سرویس" }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (data.error && data.error.message) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: data.error.message || data.errorDescription || "خطای استعلام",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const name = extractName(data);
    const bankName = data.bankName || null;

    if (!name) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: data.errorDescription || "نام صاحب حساب یافت نشد",
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
      console.error("Cache insert failed:", insertError);
      // Non-fatal — still return result
    }

    return new Response(
      JSON.stringify({ ok: true, cached: false, name, bankName }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("verify-account error:", e);
    return new Response(
      JSON.stringify({ ok: false, error: (e as Error).message || "خطای داخلی" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
