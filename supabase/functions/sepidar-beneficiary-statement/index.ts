// Edge Function: sepidar-beneficiary-statement
// Do not change Sepidar SQL env variable names. Official env is SEPIDAR_SQL_SERVER, not SEPIDAR_SQL_HOST.
// Calls SQL Server stored procedure `bridge.GetBeneficiaryStatement` via the
// Sepidar bridge database and returns the recordset to the caller.

import { getSepidarSqlConfig, sql } from "../_shared/sepidarSqlClient.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Body = {
  partyId?: number | string | null;
  fromDate?: string | null;
  toDate?: string | null;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ success: false, message: "Method not allowed" }, 405);

  let body: Body = {};
  try {
    body = (await req.json()) as Body;
  } catch {
    return json({ success: false, message: "بدنه درخواست نامعتبر است." }, 400);
  }

  const partyId = body.partyId != null ? Number(body.partyId) : NaN;
  if (!Number.isFinite(partyId) || partyId <= 0) {
    return json({ success: false, message: "شناسه ذینفع سپیدار معتبر نیست." }, 400);
  }

  // Centralized env validation + config — see _shared/sepidarSqlClient.ts.
  const cfg = getSepidarSqlConfig();
  if (!cfg.ok) return json({ success: false, message: cfg.message }, 500);

  let pool: sql.ConnectionPool | null = null;
  try {
    console.log("[sepidar-statement] connecting", { ...cfg.meta, partyId });
    pool = await new sql.ConnectionPool(cfg.config).connect();

    const request = pool.request();
    request.input("PartyId", sql.Int, partyId);
    request.input("FromDate", sql.DateTime, body.fromDate ? new Date(body.fromDate) : null);
    request.input("ToDate", sql.DateTime, body.toDate ? new Date(body.toDate) : null);

    const result = await request.execute("bridge.GetBeneficiaryStatement");
    const rows = (result.recordset as Record<string, unknown>[]) || [];
    console.log("[sepidar-statement] ok rows=", rows.length);
    // TEMP DIAGNOSTIC: log first-row column keys + a sanitized peek at numeric
    // fields so we can confirm the actual Debit/Credit column names returned by
    // bridge.GetBeneficiaryStatement. No descriptions or personal data logged.
    if (rows.length) {
      const first = rows[0];
      const keys = Object.keys(first);
      // Build a key->type/value preview limited to plausible amount fields
      // (any key containing debit/credit/amount/bedeh/bestan, case-insensitive).
      const amountLike: Record<string, { type: string; sample: unknown }> = {};
      for (const k of keys) {
        if (/debit|credit|amount|bedeh|bestan|dr$|cr$/i.test(k)) {
          const v = first[k];
          amountLike[k] = { type: typeof v, sample: v };
        }
      }
      console.log("[sepidar-statement] first row keys=", keys);
      console.log("[sepidar-statement] amount-like fields=", amountLike);
    }

    return json({
      success: true,
      message: "صورت‌حساب ذینفع با موفقیت دریافت شد.",
      rowCount: rows.length,
      data: rows,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[sepidar-statement] error", msg);
    return json({
      success: false,
      message: "صورت‌حساب سپیدار قابل واکشی نیست.",
      rawError: msg,
    });
  } finally {
    try {
      if (pool) await pool.close();
    } catch (closeErr) {
      console.warn("[sepidar-statement] pool close error", closeErr);
    }
  }
});
