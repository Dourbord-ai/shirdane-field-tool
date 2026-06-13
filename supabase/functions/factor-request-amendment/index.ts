import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { factor_id, reason } = await req.json();
    if (!factor_id || !reason)
      return new Response(JSON.stringify({ error: "factor_id and reason required" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });

    const { data: factor, error: fe } = await supabase
      .from("factors")
      .select("id, lifecycle_state, voucher_id, sepidar_voucher_id, sepidar_voucher_number, total_amount, payable_amount")
      .eq("id", factor_id)
      .maybeSingle();

    if (fe || !factor)
      return new Response(JSON.stringify({ error: "Factor not found" }), { status: 404, headers: { ...cors, "Content-Type": "application/json" } });

    const allowed = ["approved", "posted", "sepidar_failed"];
    if (!allowed.includes(factor.lifecycle_state ?? ""))
      return new Response(JSON.stringify({ error: `Factor state '${factor.lifecycle_state}' cannot be amended` }), { status: 422, headers: { ...cors, "Content-Type": "application/json" } });

    const { data: maxRow } = await supabase
      .from("factor_amendments")
      .select("amendment_number")
      .eq("factor_id", factor_id)
      .order("amendment_number", { ascending: false })
      .limit(1)
      .maybeSingle();

    const amendment_number = ((maxRow?.amendment_number) ?? 0) + 1;

    const { data: amendment, error: ae } = await supabase
      .from("factor_amendments")
      .insert({
        factor_id,
        amendment_number,
        status: "draft",
        reason,
        original_total_amount: factor.total_amount,
        original_snapshot: {
          lifecycle_state: factor.lifecycle_state,
          voucher_id: factor.voucher_id,
          sepidar_voucher_id: factor.sepidar_voucher_id,
          sepidar_voucher_number: factor.sepidar_voucher_number,
          payable_amount: factor.payable_amount,
        },
        requested_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (ae || !amendment)
      return new Response(JSON.stringify({ error: ae?.message ?? "Failed to create amendment" }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });

    const { error: ue } = await supabase
      .from("factors")
      .update({ lifecycle_state: "draft", voucher_id: null, sepidar_voucher_id: null, sepidar_voucher_number: null })
      .eq("id", factor_id);

    if (ue) {
      await supabase.from("factor_amendments").delete().eq("id", amendment.id);
      return new Response(JSON.stringify({ error: ue.message }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({
      success: true,
      amendment_id: amendment.id,
      amendment_number,
      previous_lifecycle_state: factor.lifecycle_state,
      previous_voucher_id: factor.voucher_id,
    }), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
