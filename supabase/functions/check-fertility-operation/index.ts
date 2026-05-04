// Edge function: validates whether a fertility operation can be registered for a cow.
// Returns { allowed: boolean, message?: string }.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Operation IDs from fertility_operations table
const FEMALE_ONLY_OPS = new Set([1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13]);

interface RequestBody {
  cow_id?: number;
  fertility_operation_id?: number;
  event_date?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = (await req.json()) as RequestBody;
    const cow_id = Number(body.cow_id);
    const op_id = Number(body.fertility_operation_id);
    const event_date = body.event_date;

    if (!cow_id || !op_id || !event_date) {
      return json({ allowed: false, message: "اطلاعات ورودی ناقص است" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 1) cow exists and is in herd
    const { data: cow, error: cowErr } = await supabase
      .from("cows")
      .select("id, sex, existancestatus")
      .eq("id", cow_id)
      .maybeSingle();
    if (cowErr) return json({ allowed: false, message: "خطا در بازیابی اطلاعات دام" }, 500);
    if (!cow) return json({ allowed: false, message: "دام یافت نشد" });
    if (cow.existancestatus !== 1) {
      return json({ allowed: false, message: "این دام در گله موجود نیست و نمی‌توان عملیات باروری ثبت کرد" });
    }

    // 2) sex check (sex: 1 = female / cow, 2 = male / bull)
    if (FEMALE_ONLY_OPS.has(op_id) && cow.sex !== 1) {
      return json({ allowed: false, message: "این عملیات فقط برای دام ماده مجاز است" });
    }

    // 3) no duplicate active event of same operation on same date
    const { count, error: dupErr } = await supabase
      .from("livestock_fertility_events")
      .select("id", { count: "exact", head: true })
      .eq("livestock_id", cow_id)
      .eq("fertility_operation_id", op_id)
      .eq("event_date", event_date)
      .eq("is_cancelled", false);
    if (dupErr) return json({ allowed: false, message: "خطا در بررسی رویدادهای قبلی" }, 500);
    if ((count ?? 0) > 0) {
      return json({ allowed: false, message: "این عملیات قبلاً برای این دام در همین تاریخ ثبت شده است" });
    }

    return json({ allowed: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "خطای نامشخص";
    return json({ allowed: false, message: msg }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
