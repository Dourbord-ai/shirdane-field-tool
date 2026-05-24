// Edge Function: sepidar-create-beneficiary
// ------------------------------------------------------------------
// Creates a beneficiary/party in Sepidar by invoking ONLY the bridge
// stored procedure `bridge.CreateBeneficiary` on ShirdaneBridge
// (SQL Server 2008 compatible). The frontend never touches SQL directly.
//
// Contract with the SP:
//   EXEC bridge.CreateBeneficiary
//        @PartyId           uniqueidentifier,   -- local finance_parties.id
//        @FullName          nvarchar(200),
//        @OwnershipType     nvarchar(20)  = NULL, -- 'real' | 'legal'
//        @NationalCode      nvarchar(20)  = NULL,
//        @NationalId        nvarchar(20)  = NULL,
//        @EconomicCode      nvarchar(20)  = NULL,
//        @Mobile            nvarchar(30)  = NULL,
//        @Telephone         nvarchar(30)  = NULL,
//        @Address           nvarchar(500) = NULL,
//        @PostalCode        nvarchar(20)  = NULL,
//        @Description       nvarchar(500) = NULL
//
// The SP must return a single recordset with columns (snake or Pascal):
//   sepidar_party_id   (int)  -- Party.PartyId
//   sepidar_dl_id      (int)  -- DL.DLId
//   sepidar_dl_code    (int)  -- DL.Code
//   sepidar_account_id (int)  -- AccountSLRef bound to this party (optional)
//   sepidar_full_name  (nvarchar)
//
// Do NOT reuse `bridge.GetBeneficiaries` here — that one is read-only and
// must stay untouched (see sepidar-beneficiaries function).

import { getSepidarSqlConfig, sql } from "../_shared/sepidarSqlClient.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Convert raw mssql/SQL Server error text into Persian, operator-friendly
// messages. We keep the raw text only in console logs + rawError for devs.
function persianizeError(raw: string): string {
  const m = (raw || "").toLowerCase();
  if (m.includes("login failed") || m.includes("18456")) {
    return "نام کاربری یا رمز عبور اتصال سپیدار اشتباه است.";
  }
  if (
    m.includes("etimedout") || m.includes("timeout") ||
    m.includes("econnrefused") || m.includes("enotfound") ||
    m.includes("socket") || m.includes("network")
  ) {
    return "ارتباط با سرور سپیدار برقرار نشد.";
  }
  if (
    m.includes("could not find stored procedure") ||
    m.includes("cannot find") || m.includes("2812")
  ) {
    return "پروسیژر ایجاد ذینفع در سپیدار پیدا نشد.";
  }
  if (m.includes("duplicate") || m.includes("unique") || m.includes("2627") || m.includes("2601")) {
    return "این ذینفع قبلاً در سپیدار ثبت شده است.";
  }
  return "خطا در ایجاد ذینفع در سپیدار.";
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Read a value from a recordset row tolerating both snake_case (preferred
// new SP contract) and PascalCase (in case the SP returns Sepidar-style
// column names). This keeps the function resilient to small SP tweaks.
function pick(r: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) {
    if (r[k] !== undefined && r[k] !== null && r[k] !== "") return r[k];
  }
  return null;
}
function asInt(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

interface CreateBody {
  partyId: string;       // local finance_parties.id (uuid)
  fullName: string;
  ownershipType?: string | null;
  nationalCode?: string | null;
  nationalId?: string | null;
  economicCode?: string | null;
  mobile?: string | null;
  telephone?: string | null;
  address?: string | null;
  postalCode?: string | null;
  description?: string | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return json({ success: false, message: "Method not allowed" }, 405);
  }

  // ---- 1. Parse + validate body. We validate inline (no zod) to keep this
  //         function dependency-light, matching the rest of sepidar-*.
  let body: CreateBody;
  try {
    body = (await req.json()) as CreateBody;
  } catch {
    return json({ success: false, message: "بدنه درخواست نامعتبر است." }, 400);
  }
  if (!body?.partyId || typeof body.partyId !== "string") {
    return json({ success: false, message: "شناسه ذینفع (partyId) الزامی است." }, 400);
  }
  if (!body?.fullName || !String(body.fullName).trim()) {
    return json({ success: false, message: "نام کامل ذینفع الزامی است." }, 400);
  }

  // ---- 2. Resolve SQL Server connection config from shared helper. This
  //         centralizes env-var handling so all sepidar-* functions match.
  const cfg = getSepidarSqlConfig();
  if (!cfg.ok) return json({ success: false, message: cfg.message }, 500);

  const t0 = Date.now();
  let pool: sql.ConnectionPool | null = null;
  try {
    console.log("[sepidar-create-beneficiary] connecting", cfg.meta);
    pool = await new sql.ConnectionPool(cfg.config).connect();

    // ---- 3. Bind every parameter explicitly so the SP receives proper
    //         SQL types (esp. NVarChar for Persian names + correct lengths).
    const request = pool.request();
    request.input("PartyId", sql.UniqueIdentifier, body.partyId);
    request.input("FullName", sql.NVarChar(200), String(body.fullName).trim());
    request.input("OwnershipType", sql.NVarChar(20), body.ownershipType ?? null);
    request.input("NationalCode", sql.NVarChar(20), body.nationalCode ?? null);
    request.input("NationalId", sql.NVarChar(20), body.nationalId ?? null);
    request.input("EconomicCode", sql.NVarChar(20), body.economicCode ?? null);
    request.input("Mobile", sql.NVarChar(30), body.mobile ?? null);
    request.input("Telephone", sql.NVarChar(30), body.telephone ?? null);
    request.input("Address", sql.NVarChar(500), body.address ?? null);
    request.input("PostalCode", sql.NVarChar(20), body.postalCode ?? null);
    request.input("Description", sql.NVarChar(500), body.description ?? null);

    console.log("[sepidar-create-beneficiary] executing bridge.CreateBeneficiary");
    const tExec = Date.now();
    const result = await request.execute("bridge.CreateBeneficiary");
    const row = (result.recordset?.[0] as Record<string, unknown>) || {};
    console.log("[sepidar-create-beneficiary] executed", {
      execMs: Date.now() - tExec,
      totalMs: Date.now() - t0,
      hasRow: Boolean(result.recordset?.length),
    });

    // ---- 4. Normalize the SP output. The SP is expected to surface the
    //         Sepidar identifiers we need to persist on finance_parties.
    const sepidar_party_id   = asInt(pick(row, "sepidar_party_id", "PartyId", "BeneficiaryId"));
    const sepidar_dl_id      = asInt(pick(row, "sepidar_dl_id", "DLId", "DlId"));
    const sepidar_dl_code    = asInt(pick(row, "sepidar_dl_code", "DLCode", "DlCode", "Code"));
    const sepidar_account_id = asInt(pick(row, "sepidar_account_id", "AccountSLRef", "SLRef"));
    const sepidar_full_name  = (pick(row, "sepidar_full_name", "FullName", "Name") as string) || null;

    // The SP signals dedupe by returning status_code='exists' on the same
    // recordset (instead of raising a unique-constraint error). We surface
    // it so the client can log/telemeter the link-vs-create distinction,
    // but treat both 'created' and 'exists' as a successful sync.
    const status_code = ((pick(row, "status_code", "StatusCode", "Status") as string) || "created").toLowerCase();
    const isExisting = status_code === "exists";

    // Without at least a party_id the create did not actually happen.
    if (sepidar_party_id == null) {
      return json({
        success: false,
        message: "پاسخ سپیدار شامل شناسه ذینفع نبود.",
        data: row,
      }, 200);
    }

    return json({
      success: true,
      status_code: isExisting ? "exists" : "created",
      message: isExisting
        ? "ذینفع از قبل در سپیدار وجود داشت و به رکورد محلی متصل شد."
        : "ذینفع با موفقیت در سپیدار ایجاد شد.",
      sepidar_party_id,
      sepidar_dl_id,
      sepidar_dl_code,
      sepidar_account_id,
      sepidar_full_name,
      raw: row,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[sepidar-create-beneficiary] error", msg, e);
    return json({
      success: false,
      message: persianizeError(msg),
      rawError: msg,
    }, 200);
  } finally {
    try { if (pool) await pool.close(); }
    catch (closeErr) { console.warn("[sepidar-create-beneficiary] pool close error", closeErr); }
  }
});
