// Edge Function: sepidar-post-voucher
// ----------------------------------------------------------------------------
// Posts a finance_vouchers row to Sepidar by calling the matching strongly-typed
// bridge stored procedure for its voucher_type / source_operation_type:
//
//   receive_identification           -> bridge.CreateBankVoucher
//   payment_allocation / request     -> bridge.CreatePaymentRequestVoucher
//   bank_transfer                    -> bridge.CreateSimpleInterBankTransferVoucher
//   party_transfer                   -> bridge.CreatePartyTransferVoucher
//
// Each branch loads the original source row + related parties/banks, validates
// the required Sepidar mapping ids, and binds typed sql.Request().input(...)
// parameters that match the procedure signatures exactly.
//
// On success → finance_vouchers.sepidar_sync_status='synced' + sepidar ids + status='posted'.
// On failure → finance_vouchers.sepidar_sync_status='failed' + sepidar_error_message.
//
// Env (re-uses the existing Sepidar SQL secrets — DO NOT rename):
//   SEPIDAR_SQL_SERVER / SEPIDAR_SQL_PORT / SEPIDAR_SQL_DATABASE
//   SEPIDAR_SQL_USER   / SEPIDAR_SQL_PASSWORD
//   SEPIDAR_SQL_ENCRYPT / SEPIDAR_SQL_TRUST_CERT
//   SEPIDAR_POST_VOUCHER_SP   (optional ops override — forces a specific SP name
//                              but still uses the typed params of the detected
//                              voucher_type branch)
//   SEPIDAR_CREATOR_ID         (optional numeric, default 1)
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY  (auto-injected)

import { getSepidarSqlConfig, sql } from "../_shared/sepidarSqlClient.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// CORS — kept inline so the function is self-contained.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Helper: always emit JSON with CORS headers.
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), {
    status: s,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

type Body = { voucher_id?: string | null };

// Translate raw SQL Server errors into Persian, user-friendly text.
function persianizeError(raw: string): string {
  const m = (raw || "").toLowerCase();
  if (m.includes("login failed") || m.includes("18456"))
    return "نام کاربری یا رمز عبور اتصال سپیدار اشتباه است.";
  if (
    m.includes("etimedout") ||
    m.includes("timeout") ||
    m.includes("econnrefused") ||
    m.includes("enotfound") ||
    m.includes("socket") ||
    m.includes("network")
  )
    return "ارتباط با سرور سپیدار برقرار نشد.";
  if (
    m.includes("could not find stored procedure") ||
    m.includes("cannot find") ||
    m.includes("2812")
  )
    return "پروسیژر ثبت سند سپیدار پیدا نشد.";
  return "ثبت سند در سپیدار با خطا مواجه شد.";
}

// Mark voucher as failed + log. Best-effort, never throws.
async function markFailed(
  sb: ReturnType<typeof createClient>,
  voucherId: string,
  message: string,
  attempts: number,
) {
  try {
    await sb
      .from("finance_vouchers")
      .update({
        sepidar_sync_status: "failed",
        sepidar_error_message: message,
        sepidar_sync_attempts: attempts,
      })
      .eq("id", voucherId);
    await sb.from("finance_sepidar_sync_logs").insert({
      voucher_id: voucherId,
      operation_type: "post_voucher",
      status: "failed",
      error_message: message,
    } as never);
  } catch (e) {
    console.warn("[sepidar-post-voucher] markFailed log failed", e);
  }
}

// Default SP names per branch.
const DEFAULT_SP: Record<string, string> = {
  receive_identification: "bridge.CreateBankVoucher",
  payment_allocation: "bridge.CreatePaymentRequestVoucher",
  payment_request: "bridge.CreatePaymentRequestVoucher",
  bank_transfer: "bridge.CreateSimpleInterBankTransferVoucher",
  party_transfer: "bridge.CreatePartyTransferVoucher",
};

// RequestType mapping per Sepidar conventions:
//   1 = payment, 2 = receive
const REQUEST_TYPE: Record<string, number> = {
  receive_identification: 2,
  payment_allocation: 1,
  payment_request: 1,
};

// Build a safe ISO date string for SQL Server datetime input.
function toSqlDate(v: unknown): Date {
  if (v == null) return new Date();
  const d = new Date(v as string);
  if (isNaN(d.getTime())) return new Date();
  return d;
}

// Trim helper that returns the first non-empty value or a fallback.
function firstNonEmpty(...vals: Array<unknown>): string {
  for (const v of vals) {
    if (v == null) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return "";
}

// ---------------------------------------------------------------------------
// Jalali (Shamsi) date helper — inlined because Edge Functions cannot import
// from src/. Mirrors src/lib/jalali.ts::gregorianToJalali so descriptions sent
// to Sepidar match the legacy app output format (e.g. 1405/02/30).
// ---------------------------------------------------------------------------
const _G_D_M = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
function gregorianToJalali(gy: number, gm: number, gd: number) {
  const gy2 = gm > 2 ? gy + 1 : gy;
  let days =
    355666 + 365 * gy + Math.floor((gy2 + 3) / 4) -
    Math.floor((gy2 + 99) / 100) + Math.floor((gy2 + 399) / 400) +
    gd + _G_D_M[gm - 1];
  let jy = -1595 + 33 * Math.floor(days / 12053);
  days %= 12053;
  jy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) { jy += Math.floor((days - 1) / 365); days = (days - 1) % 365; }
  let jm: number, jd: number;
  if (days < 186) { jm = 1 + Math.floor(days / 31); jd = 1 + (days % 31); }
  else { jm = 7 + Math.floor((days - 186) / 30); jd = 1 + ((days - 186) % 30); }
  return { jy, jm, jd };
}

// Returns a Jalali string formatted YYYY/MM/DD matching the legacy app
// description style. Accepts Date, ISO string, or null.
function formatJalaliForSepidarDescription(d: Date | string | null | undefined): string {
  if (!d) return "";
  const date = d instanceof Date ? d : new Date(d);
  if (isNaN(date.getTime())) return "";
  const { jy, jm, jd } = gregorianToJalali(
    date.getFullYear(), date.getMonth() + 1, date.getDate(),
  );
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${jy}/${pad(jm)}/${pad(jd)}`;
}

// Read a field from either a top-level column or row.raw_data (jsonb).
// Used to detect optional legacy descriptors like change_status_description /
// extra_description that may live in the imported raw payload.
function rawField(row: Record<string, unknown> | null | undefined, key: string): string {
  if (!row) return "";
  const direct = (row as Record<string, unknown>)[key];
  if (direct != null && String(direct).trim()) return String(direct).trim();
  const raw = (row as Record<string, unknown>).raw_data ?? (row as Record<string, unknown>).data;
  if (raw && typeof raw === "object") {
    const v = (raw as Record<string, unknown>)[key];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return "";
}

// -----------------------------------------------------------------------------
// Display-name resolvers — Sepidar descriptions must always show *real* names,
// never raw numeric ids or empty strings. If neither table can produce a name
// the caller is expected to abort with a Persian error message.
// -----------------------------------------------------------------------------

// finance_parties → human-readable name following ownership_type rules.
function resolvePartyDisplayName(p: Record<string, unknown> | null | undefined): string {
  if (!p) return "";
  const ownership = String(p.ownership_type ?? "").toLowerCase();
  if (ownership === "legal") {
    const co = firstNonEmpty(p.company_name, p.sepidar_full_name, p.title, p.name);
    if (co) return co;
  } else {
    const fn = String(p.first_name ?? "").trim();
    const ln = String(p.last_name ?? "").trim();
    const full = `${fn} ${ln}`.trim();
    if (full) return full;
  }
  return firstNonEmpty(
    p.company_name, p.sepidar_full_name, p.full_name, p.title, p.name,
  );
}

// finance_banks → human-readable bank label. Never the numeric id.
function resolveBankDisplayName(b: Record<string, unknown> | null | undefined): string {
  if (!b) return "";
  const title = firstNonEmpty(b.title, b.sepidar_full_title);
  if (title) return title;
  const bank = firstNonEmpty(b.bank_name, b.account_holder_name);
  const acct = String(b.account_number ?? "").trim();
  if (bank && acct) {
    // last digits → keep description compact (matches legacy output).
    const tail = acct.length > 4 ? acct.slice(-4) : acct;
    return `${bank} ${tail}`;
  }
  return bank || acct || "";
}

// Builds Description / Description1 / Description2 strings for each Sepidar
// voucher branch using legacy templates. Centralised so every branch shares
// the same generation logic.
function buildVoucherDescriptions(args: {
  branch: string;
  date: Date;
  sourceRow: Record<string, unknown>;
  fromPartyName?: string;
  toPartyName?: string;
  partyName?: string;
  bankName?: string;
  fromBankName?: string;
  toBankName?: string;
  // Optional bank_transfer extras.
  paymentHeaderNumber?: string | number | null;
  draftNumber?: string | number | null;
}): { description: string; description1: string; description2: string } {
  const dateStr = formatJalaliForSepidarDescription(args.date);
  const src = args.sourceRow ?? {};
  const baseDesc = firstNonEmpty(src.description, src.title);
  const itemDesc = baseDesc; // alias used by payment templates per spec

  switch (args.branch) {
    case "party_transfer": {
      const long = `جا به جایی در تاریخ ${dateStr} از ${args.fromPartyName ?? ""} به ${args.toPartyName ?? ""} بابت ${baseDesc}`;
      return {
        description: `جا به جایی در تاریخ ${dateStr} بابت ${baseDesc}`,
        description1: long,
        description2: long,
      };
    }
    case "bank_transfer": {
      const phn = args.paymentHeaderNumber != null && String(args.paymentHeaderNumber).trim()
        ? String(args.paymentHeaderNumber).trim() : "";
      const dn = args.draftNumber != null && String(args.draftNumber).trim()
        ? String(args.draftNumber).trim() : "1";
      const long = `برداشت طی حواله شماره ${dn} تاریخ ${dateStr} از حساب بانکی ${args.fromBankName ?? ""} به ${args.toBankName ?? ""} بابت جا به جایی`;
      return {
        description: `بابت پرداخت طی اعلامیه پرداخت شماره ${phn} تاریخ ${dateStr}`,
        description1: long,
        description2: long,
      };
    }
    case "receive_identification": {
      return {
        description: `دریافت در تاریخ ${dateStr} بابت ${baseDesc}`,
        description1: `واریز در تاریخ ${dateStr} به حساب بانکی ${args.bankName ?? ""} بابت ${baseDesc}`,
        description2: `واریز در تاریخ ${dateStr} توسط ${args.partyName ?? ""} بابت ${baseDesc}`,
      };
    }
    case "payment_allocation":
    case "payment_request": {
      return {
        description: `پرداخت در تاریخ ${dateStr} بابت ${itemDesc}`,
        description1: `برداشت در تاریخ ${dateStr} از حساب بانکی ${args.bankName ?? ""} به ${args.partyName ?? ""} بابت ${itemDesc}`,
        description2: `برداشت در تاریخ ${dateStr} از حساب بانکی ${args.bankName ?? ""} بابت ${itemDesc}`,
      };
    }
    default:
      return { description: baseDesc, description1: "", description2: "" };
  }
}

// Persian error helper for missing party/bank display names.
const MISSING_NAME_ERR = "نام ذینفع/بانک برای توضیحات سند پیدا نشد";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST")
    return json({ success: false, message: "Method not allowed" }, 405);

  // ---- Parse body --------------------------------------------------------------
  let body: Body = {};
  try {
    body = await req.json();
  } catch {
    return json({ success: false, message: "بدنه درخواست نامعتبر است." }, 400);
  }
  const voucherId = (body.voucher_id ?? "").toString().trim();
  if (!voucherId)
    return json({ success: false, message: "voucher_id الزامی است." }, 400);

  // ---- Supabase service-role client -------------------------------------------
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !serviceKey)
    return json(
      { success: false, message: "تنظیمات Supabase در Edge Function ناقص است." },
      500,
    );
  const sb = createClient(supabaseUrl, serviceKey);

  // ---- Load voucher header -----------------------------------------------------
  const { data: voucher, error: vErr } = await sb
    .from("finance_vouchers")
    .select("*")
    .eq("id", voucherId)
    .maybeSingle();
  if (vErr || !voucher) {
    return json(
      {
        success: false,
        message: "سند مالی یافت نشد.",
        rawError: vErr?.message ?? null,
      },
      404,
    );
  }

  const vRow = voucher as Record<string, unknown>;
  const attempts = Number(vRow.sepidar_sync_attempts ?? 0) + 1;

  // Voucher items are still loaded so we keep the existing "no items = abort"
  // safety guard. Even though the typed SPs read directly from the source row,
  // an empty voucher means upstream construction is broken and posting would be
  // meaningless.
  const { data: items, error: iErr } = await sb
    .from("finance_voucher_items")
    .select("*")
    .eq("voucher_id", voucherId)
    .order("row_number", { ascending: true });
  if (iErr) {
    await markFailed(sb, voucherId, "بارگذاری ردیف‌های سند با خطا مواجه شد.", attempts);
    return json(
      { success: false, message: "بارگذاری ردیف‌های سند ناموفق بود.", rawError: iErr.message },
      500,
    );
  }
  if (!items || items.length === 0) {
    await markFailed(sb, voucherId, "سند هیچ ردیفی ندارد.", attempts);
    return json({ success: false, message: "سند هیچ ردیفی ندارد." }, 400);
  }

  // Optimistic UI marker — flips to failed below on any error.
  await sb
    .from("finance_vouchers")
    .update({ sepidar_sync_status: "syncing", sepidar_sync_attempts: attempts })
    .eq("id", voucherId);

  // ---- Sepidar SQL config ------------------------------------------------------
  const cfg = getSepidarSqlConfig();
  if (!cfg.ok) {
    await markFailed(sb, voucherId, cfg.message, attempts);
    return json({ success: false, message: cfg.message }, 500);
  }

  // Determine branch.
  const vType = String(vRow.voucher_type ?? "").trim().toLowerCase();
  const sOp = String(vRow.source_operation_type ?? "").trim().toLowerCase();
  const branch = vType || sOp; // we accept either
  const sourceId = String(vRow.source_operation_id ?? "").trim();

  const overrideSp = Deno.env.get("SEPIDAR_POST_VOUCHER_SP") || "";
  const defaultSp = DEFAULT_SP[branch] || DEFAULT_SP[sOp] || DEFAULT_SP[vType];
  if (!defaultSp) {
    const msg = `نوع سند برای ثبت در سپیدار پشتیبانی نمی‌شود (voucher_type=${vType || "-"}, source_operation_type=${sOp || "-"}).`;
    await markFailed(sb, voucherId, msg, attempts);
    return json({ success: false, message: msg }, 400);
  }
  const spName = overrideSp || defaultSp;
  const creatorRaw = Deno.env.get("SEPIDAR_CREATOR_ID") || "1";
  const creator = Number(creatorRaw);
  if (!Number.isInteger(creator) || creator <= 0) {
    throw new Error("SEPIDAR_CREATOR_ID باید عدد صحیح معتبر باشد");
  }

  // ---- Helpers to build typed requests per branch -----------------------------
  // Each branch loads its specific source row + related parties/banks, then
  // builds a typed sql.Request with EXACT parameters the SP expects.
  // Returns either { request, params, logParams } or { error }.

  type Branch =
    | { ok: true; request: sql.Request; logParams: Record<string, unknown> }
    | { ok: false; message: string };

  async function buildBranch(pool: sql.ConnectionPool): Promise<Branch> {
    if (!sourceId) {
      return { ok: false, message: "شناسه عملیات مبدا (source_operation_id) خالی است." };
    }

    const baseDate = toSqlDate(vRow.voucher_date);
    const desc = firstNonEmpty(vRow.description, vRow.title);

    // ---------- 1) receive_identification -> CreateBankVoucher ----------------
    if (branch === "receive_identification" || sOp === "receive_identification") {
      const { data: rec, error } = await sb
        .from("finance_receive_identifications")
        .select("*")
        .eq("id", sourceId)
        .maybeSingle();
      if (error || !rec)
        return { ok: false, message: "رکورد شناسایی وصول مرتبط با سند یافت نشد." };

      const r = rec as Record<string, unknown>;
      const partyId = r.party_id as string | null;
      const bankId = r.bank_id as string | null;
      if (!partyId)
        return { ok: false, message: "طرف حساب در شناسایی وصول مشخص نیست." };
      if (!bankId)
        return { ok: false, message: "حساب بانکی در شناسایی وصول مشخص نیست." };

      const [{ data: party }, { data: bank }] = await Promise.all([
        sb.from("finance_parties").select("*").eq("id", partyId).maybeSingle(),
        sb.from("finance_banks").select("*").eq("id", bankId).maybeSingle(),
      ]);
      if (!party) return { ok: false, message: "اطلاعات طرف حساب یافت نشد." };
      if (!bank) return { ok: false, message: "اطلاعات بانک یافت نشد." };

      const p = party as Record<string, unknown>;
      const b = bank as Record<string, unknown>;
      const bankAccountSL = b.sepidar_account_id as number | null;
      const bankDL = b.sepidar_dl_id as number | null;
      const sepPartyId = p.sepidar_party_id as number | null;
      const sepPartyAcc = (p.party_account_sl_ref ?? p.sepidar_account_id) as number | null;
      if (bankAccountSL == null)
        return { ok: false, message: "نگاشت حساب معین بانک در سپیدار انجام نشده (sepidar_account_id بانک)." };
      if (bankDL == null)
        return { ok: false, message: "نگاشت تفصیلی بانک در سپیدار انجام نشده (sepidar_dl_id بانک)." };
      if (sepPartyId == null)
        return { ok: false, message: "نگاشت طرف حساب در سپیدار انجام نشده (sepidar_party_id)." };
      if (sepPartyAcc == null)
        return { ok: false, message: "نگاشت حساب معین طرف حساب در سپیدار انجام نشده (sepidar_account_id)." };

      const amount = Number(r.amount ?? 0);
      const date = toSqlDate(r.transaction_datetime ?? vRow.voucher_date);

      const partyName = resolvePartyDisplayName(p);
      const bankName = resolveBankDisplayName(b);
      if (!partyName || !bankName) {
        return { ok: false, message: MISSING_NAME_ERR };
      }

      const descs = buildVoucherDescriptions({
        branch: "receive_identification",
        date,
        sourceRow: r,
        partyName,
        bankName,
      });
      console.log("[sepidar-post-voucher] descriptions(receive_identification)", {
        voucher_id: voucherId,
        source_operation_type: sOp || vType,
        partyName,
        bankName,
        ...descs,
      });

      const req = pool.request();
      req.input("BankAccountSLRef", sql.Int, Number(bankAccountSL));
      req.input("BankDLRef", sql.Int, Number(bankDL));
      req.input("PartyId", sql.Int, Number(sepPartyId));
      req.input("PartyAccountSLRef", sql.Int, Number(sepPartyAcc));
      req.input("RequestType", sql.Int, REQUEST_TYPE.receive_identification);
      req.input("Amount", sql.Decimal(18, 2), amount);
      req.input("VoucherDate", sql.DateTime, date);
      req.input("Description", sql.NVarChar(sql.MAX), descs.description);
      req.input("Description1", sql.NVarChar(sql.MAX), descs.description1);
      req.input("Description2", sql.NVarChar(sql.MAX), descs.description2);
      req.input("Creator", sql.Int, creator);

      return {
        ok: true,
        request: req,
        logParams: {
          BankAccountSLRef: bankAccountSL,
          BankDLRef: bankDL,
          PartyId: sepPartyId,
          PartyAccountSLRef: sepPartyAcc,
          RequestType: REQUEST_TYPE.receive_identification,
          Amount: amount,
          VoucherDate: date.toISOString(),
          Creator: creator,
          ...descs,
        },
      };
    }

    // ---------- 2) payment_allocation / payment_request -----------------------
    if (
      branch === "payment_allocation" ||
      branch === "payment_request" ||
      sOp === "payment_allocation" ||
      sOp === "payment_request"
    ) {
      // Try allocation first (most common upstream type), fall back to request.
      let amount = 0;
      let date = baseDate;
      let description = desc;
      let partyRow: Record<string, unknown> | null = null;
      let requestTypeCode: number = REQUEST_TYPE.payment_allocation;

      const { data: alloc } = await sb
        .from("finance_payment_allocations")
        .select("*")
        .eq("id", sourceId)
        .maybeSingle();

      let prRow: Record<string, unknown> | null = null;
      let priRow: Record<string, unknown> | null = null;

      if (alloc) {
        const a = alloc as Record<string, unknown>;
        amount = Number(a.amount ?? 0);
        date = toSqlDate(a.allocation_datetime ?? vRow.voucher_date);

        if (a.payment_request_item_id) {
          const { data: pri } = await sb
            .from("finance_payment_request_items")
            .select("*")
            .eq("id", a.payment_request_item_id as string)
            .maybeSingle();
          priRow = (pri as Record<string, unknown> | null) ?? null;
        }
        if (a.payment_request_id) {
          const { data: pr } = await sb
            .from("finance_payment_requests")
            .select("*")
            .eq("id", a.payment_request_id as string)
            .maybeSingle();
          prRow = (pr as Record<string, unknown> | null) ?? null;
        }

        const partyId =
          (a.party_id as string | null) ||
          (priRow?.party_id as string | null) ||
          null;
        if (!partyId) return { ok: false, message: "طرف حساب در تخصیص پرداخت مشخص نیست." };
        const { data: party } = await sb
          .from("finance_parties")
          .select("*")
          .eq("id", partyId)
          .maybeSingle();
        partyRow = (party as Record<string, unknown> | null) ?? null;
      } else {
        // Treat sourceId as a payment_request id (or item id) directly.
        const { data: pr } = await sb
          .from("finance_payment_requests")
          .select("*")
          .eq("id", sourceId)
          .maybeSingle();
        prRow = (pr as Record<string, unknown> | null) ?? null;
        if (!prRow) {
          // try as item id
          const { data: pri } = await sb
            .from("finance_payment_request_items")
            .select("*")
            .eq("id", sourceId)
            .maybeSingle();
          priRow = (pri as Record<string, unknown> | null) ?? null;
          if (priRow?.payment_request_id) {
            const { data: pr2 } = await sb
              .from("finance_payment_requests")
              .select("*")
              .eq("id", priRow.payment_request_id as string)
              .maybeSingle();
            prRow = (pr2 as Record<string, unknown> | null) ?? null;
          }
        }
        if (!prRow && !priRow)
          return { ok: false, message: "درخواست/ردیف پرداخت مرتبط با سند یافت نشد." };

        amount = Number(priRow?.amount ?? prRow?.total_amount ?? 0);
        date = toSqlDate(vRow.voucher_date);
        const partyId =
          (priRow?.party_id as string | null) ||
          null;
        if (!partyId) return { ok: false, message: "طرف حساب در ردیف درخواست پرداخت مشخص نیست." };
        const { data: party } = await sb
          .from("finance_parties")
          .select("*")
          .eq("id", partyId)
          .maybeSingle();
        partyRow = (party as Record<string, unknown> | null) ?? null;
      }

      if (!partyRow) return { ok: false, message: "اطلاعات طرف حساب یافت نشد." };

      // RequestType: map from payment_requests.request_type if available;
      // otherwise from legacy_request_type_code; otherwise default to payment=1.
      const prType = String(prRow?.request_type ?? "").toLowerCase();
      const prLegacy = Number(prRow?.legacy_request_type_code ?? priRow?.legacy_request_type_code ?? 0);
      if (prType === "receive" || prType === "receipt") requestTypeCode = 2;
      else if (prType === "payment" || prType === "pay") requestTypeCode = 1;
      else if (prLegacy > 0) requestTypeCode = prLegacy;
      else requestTypeCode = REQUEST_TYPE.payment_allocation;

      description = firstNonEmpty(
        prRow?.title,
        prRow?.description,
        priRow?.description,
        vRow.description,
        vRow.title,
      );

      const sepPartyId = partyRow.sepidar_party_id as number | null;
      const sepPartyAcc = (partyRow.party_account_sl_ref ?? partyRow.sepidar_account_id) as number | null;
      if (sepPartyId == null)
        return { ok: false, message: "نگاشت طرف حساب در سپیدار انجام نشده (sepidar_party_id)." };
      if (sepPartyAcc == null)
        return { ok: false, message: "نگاشت حساب معین طرف حساب در سپیدار انجام نشده (sepidar_account_id)." };

      // Resolve the related bank for legacy description (برداشت ... از حساب بانکی X).
      // Try alloc.bank_id → priRow.bank_id → prRow.bank_id → related bank_transaction.
      let bankRow: Record<string, unknown> | null = null;
      const a = (alloc ?? {}) as Record<string, unknown>;
      const bankIdCandidate =
        (a.bank_id as string | null) ||
        (priRow?.bank_id as string | null) ||
        (prRow?.bank_id as string | null) ||
        null;
      if (bankIdCandidate) {
        const { data: bk } = await sb
          .from("finance_banks").select("*").eq("id", bankIdCandidate).maybeSingle();
        bankRow = (bk as Record<string, unknown> | null) ?? null;
      }
      if (!bankRow && a.bank_transaction_id) {
        const { data: btx } = await sb
          .from("finance_bank_transactions").select("bank_id").eq("id", a.bank_transaction_id as string).maybeSingle();
        const bid = (btx as Record<string, unknown> | null)?.bank_id as string | undefined;
        if (bid) {
          const { data: bk } = await sb
            .from("finance_banks").select("*").eq("id", bid).maybeSingle();
          bankRow = (bk as Record<string, unknown> | null) ?? null;
        }
      }

      // Pick the most specific "item" row available to feed the description tail.
      const itemRow = (priRow ?? a ?? prRow ?? {}) as Record<string, unknown>;
      const partyName = resolvePartyDisplayName(partyRow);
      const bankName = resolveBankDisplayName(bankRow);
      if (!partyName || !bankName) {
        return { ok: false, message: MISSING_NAME_ERR };
      }
      const descs = buildVoucherDescriptions({
        branch: "payment_allocation",
        date,
        sourceRow: itemRow,
        partyName,
        bankName,
      });
      console.log("[sepidar-post-voucher] descriptions(payment)", {
        voucher_id: voucherId,
        source_operation_type: sOp || vType,
        partyName,
        bankName,
        ...descs,
      });

      const req = pool.request();
      req.input("PartyId", sql.Int, Number(sepPartyId));
      req.input("PartyAccountSLRef", sql.Int, Number(sepPartyAcc));
      req.input("RequestType", sql.Int, requestTypeCode);
      req.input("Amount", sql.Decimal(18, 2), amount);
      req.input("VoucherDate", sql.DateTime, date);
      req.input("Description", sql.NVarChar(sql.MAX), descs.description);
      req.input("Description1", sql.NVarChar(sql.MAX), descs.description1);
      req.input("Description2", sql.NVarChar(sql.MAX), descs.description2);
      req.input("Creator", sql.Int, creator);

      return {
        ok: true,
        request: req,
        logParams: {
          PartyId: sepPartyId,
          PartyAccountSLRef: sepPartyAcc,
          RequestType: requestTypeCode,
          Amount: amount,
          VoucherDate: date.toISOString(),
          Creator: creator,
          ...descs,
        },
      };
    }

    // ---------- 3) bank_transfer -> CreateSimpleInterBankTransferVoucher ------
    if (branch === "bank_transfer" || sOp === "bank_transfer") {
      const { data: bt, error } = await sb
        .from("finance_bank_transfers")
        .select("*")
        .eq("id", sourceId)
        .maybeSingle();
      if (error || !bt)
        return { ok: false, message: "انتقال بین بانکی مرتبط با سند یافت نشد." };

      const t = bt as Record<string, unknown>;
      const fromId = t.from_bank_id as string | null;
      const toId = t.to_bank_id as string | null;
      if (!fromId || !toId)
        return { ok: false, message: "بانک مبدا/مقصد در انتقال مشخص نیست." };

      const [{ data: fromBank }, { data: toBank }] = await Promise.all([
        sb.from("finance_banks").select("*").eq("id", fromId).maybeSingle(),
        sb.from("finance_banks").select("*").eq("id", toId).maybeSingle(),
      ]);
      if (!fromBank) return { ok: false, message: "اطلاعات بانک مبدا یافت نشد." };
      if (!toBank) return { ok: false, message: "اطلاعات بانک مقصد یافت نشد." };

      const fb = fromBank as Record<string, unknown>;
      const tb = toBank as Record<string, unknown>;
      const fromAcc = fb.sepidar_account_id as number | null;
      const fromDL = fb.sepidar_dl_id as number | null;
      const toAcc = tb.sepidar_account_id as number | null;
      const toDL = tb.sepidar_dl_id as number | null;
      if (fromAcc == null || fromDL == null)
        return { ok: false, message: "نگاشت بانک مبدا در سپیدار ناقص است (sepidar_account_id/sepidar_dl_id)." };
      if (toAcc == null || toDL == null)
        return { ok: false, message: "نگاشت بانک مقصد در سپیدار ناقص است (sepidar_account_id/sepidar_dl_id)." };

      const amount = Number(t.from_amount ?? t.to_amount ?? 0);
      const date = toSqlDate(t.transfer_datetime ?? vRow.voucher_date);

      const fromBankName = resolveBankDisplayName(fb);
      const toBankName = resolveBankDisplayName(tb);
      if (!fromBankName || !toBankName) {
        return { ok: false, message: MISSING_NAME_ERR };
      }
      const descs = buildVoucherDescriptions({
        branch: "bank_transfer",
        date,
        sourceRow: t,
        fromBankName,
        toBankName,
        paymentHeaderNumber: (t.payment_header_number ?? t.payment_announcement_number ?? null) as string | number | null,
        draftNumber: (t.draft_number ?? t.transfer_number ?? null) as string | number | null,
      });
      console.log("[sepidar-post-voucher] descriptions(bank_transfer)", {
        voucher_id: voucherId,
        source_operation_type: sOp || vType,
        fromBankName,
        toBankName,
        ...descs,
      });

      const req = pool.request();
      req.input("FromBankAccountSLRef", sql.Int, Number(fromAcc));
      req.input("FromBankDLRef", sql.Int, Number(fromDL));
      req.input("ToBankAccountSLRef", sql.Int, Number(toAcc));
      req.input("ToBankDLRef", sql.Int, Number(toDL));
      req.input("Amount", sql.Decimal(18, 2), amount);
      req.input("VoucherDate", sql.DateTime, date);
      req.input("Description", sql.NVarChar(sql.MAX), descs.description);
      req.input("Description1", sql.NVarChar(sql.MAX), descs.description1);
      req.input("Description2", sql.NVarChar(sql.MAX), descs.description2);
      req.input("Creator", sql.Int, creator);

      return {
        ok: true,
        request: req,
        logParams: {
          FromBankAccountSLRef: fromAcc,
          FromBankDLRef: fromDL,
          ToBankAccountSLRef: toAcc,
          ToBankDLRef: toDL,
          Amount: amount,
          VoucherDate: date.toISOString(),
          Creator: creator,
          ...descs,
        },
      };
    }

    // ---------- 4) party_transfer -> CreatePartyTransferVoucher ---------------
    if (branch === "party_transfer" || sOp === "party_transfer") {
      const { data: pt, error } = await sb
        .from("finance_party_transfers")
        .select("*")
        .eq("id", sourceId)
        .maybeSingle();
      if (error || !pt)
        return { ok: false, message: "انتقال بین طرف حساب‌ها مرتبط با سند یافت نشد." };

      const t = pt as Record<string, unknown>;
      const fromId = t.from_party_id as string | null;
      const toId = t.to_party_id as string | null;
      if (!fromId || !toId)
        return { ok: false, message: "طرف حساب مبدا/مقصد در انتقال مشخص نیست." };

      const [{ data: fromParty }, { data: toParty }] = await Promise.all([
        sb.from("finance_parties").select("*").eq("id", fromId).maybeSingle(),
        sb.from("finance_parties").select("*").eq("id", toId).maybeSingle(),
      ]);
      if (!fromParty) return { ok: false, message: "اطلاعات طرف حساب مبدا یافت نشد." };
      if (!toParty) return { ok: false, message: "اطلاعات طرف حساب مقصد یافت نشد." };

      const fp = fromParty as Record<string, unknown>;
      const tp = toParty as Record<string, unknown>;
      const fpId = fp.sepidar_party_id as number | null;
      const fpAcc = (fp.party_account_sl_ref ?? fp.sepidar_account_id) as number | null;
      const tpId = tp.sepidar_party_id as number | null;
      const tpAcc = (tp.party_account_sl_ref ?? tp.sepidar_account_id) as number | null;
      if (fpId == null || fpAcc == null)
        return { ok: false, message: "نگاشت طرف حساب مبدا در سپیدار ناقص است (sepidar_party_id/sepidar_account_id)." };
      if (tpId == null || tpAcc == null)
        return { ok: false, message: "نگاشت طرف حساب مقصد در سپیدار ناقص است (sepidar_party_id/sepidar_account_id)." };

      const amount = Number(t.amount ?? 0);
      const date = toSqlDate(t.transfer_datetime ?? vRow.voucher_date);

      const descs = buildVoucherDescriptions({
        branch: "party_transfer",
        date,
        sourceRow: t,
        fromPartyName: firstNonEmpty(fp.full_name, fp.name, fp.title),
        toPartyName: firstNonEmpty(tp.full_name, tp.name, tp.title),
      });
      console.log("[sepidar-post-voucher] descriptions(party_transfer)", descs);

      const req = pool.request();
      req.input("FromPartyId", sql.Int, Number(fpId));
      req.input("FromPartyAccountSLRef", sql.Int, Number(fpAcc));
      req.input("ToPartyId", sql.Int, Number(tpId));
      req.input("ToPartyAccountSLRef", sql.Int, Number(tpAcc));
      req.input("Amount", sql.Decimal(18, 2), amount);
      req.input("VoucherDate", sql.DateTime, date);
      req.input("Description", sql.NVarChar(sql.MAX), descs.description);
      req.input("Description1", sql.NVarChar(sql.MAX), descs.description1);
      req.input("Description2", sql.NVarChar(sql.MAX), descs.description2);
      req.input("Creator", sql.Int, creator);

      return {
        ok: true,
        request: req,
        logParams: {
          FromPartyId: fpId,
          FromPartyAccountSLRef: fpAcc,
          ToPartyId: tpId,
          ToPartyAccountSLRef: tpAcc,
          Amount: amount,
          VoucherDate: date.toISOString(),
          Creator: creator,
          ...descs,
        },
      };
    }

    return {
      ok: false,
      message: `شاخه ناشناخته برای ثبت سند سپیدار (branch=${branch || "-"}).`,
    };
  }

  // ---- Execute -----------------------------------------------------------------
  let pool: sql.ConnectionPool | null = null;
  try {
    pool = await new sql.ConnectionPool(cfg.config).connect();

    const built = await buildBranch(pool);
    if (!built.ok) {
      await markFailed(sb, voucherId, built.message, attempts);
      return json({ success: false, message: built.message }, 400);
    }

    console.log("[sepidar-post-voucher] start", {
      ...cfg.meta,
      voucherId,
      voucherType: vType,
      sourceOp: sOp,
      sourceId,
      spName,
      params: built.logParams,
      itemCount: items.length,
    });

    const result = await built.request.execute(spName);
    const row = ((result.recordset as Record<string, unknown>[]) || [])[0] || {};

    // SP contract: success = 0 (failure) or 1 (success) when explicitly returned.
    const successFlag = Number(
      row.success ?? row.Success ?? 1,
    );
    if (successFlag === 0) {
      const errMsg = String(row.error_message ?? row.ErrorMessage ?? "unknown SP failure");
      console.error("[sepidar-post-voucher] SP returned success=0", errMsg, row);
      await markFailed(sb, voucherId, errMsg, attempts);
      return json({
        success: false,
        message: "ثبت سند در سپیدار ناموفق بود.",
        rawError: errMsg,
      });
    }

    // Pick first non-null id under any of the accepted aliases.
    const pick = (...keys: string[]) => {
      for (const k of keys) {
        const v = row[k];
        if (v != null && v !== "") return v;
      }
      return null;
    };
    const update: Record<string, unknown> = {
      sepidar_sync_status: "synced",
      sepidar_synced_at: new Date().toISOString(),
      sepidar_error_message: null,
      status: "posted",
    };
    const sepidarVoucherId = pick("sepidar_voucher_id", "SepidarVoucherId", "VoucherId");
    const sepidarVoucherNumber = pick("sepidar_voucher_number", "VoucherNumber");
    const sepidarReference = pick("sepidar_reference_number", "ReferenceNumber");
    const sepidarDaily = pick("sepidar_daily_number", "DailyNumber");
    if (sepidarVoucherId != null) update.sepidar_voucher_id = Number(sepidarVoucherId);
    if (sepidarVoucherNumber != null)
      update.sepidar_voucher_number = Number(sepidarVoucherNumber);
    if (sepidarReference != null)
      update.sepidar_reference_number = Number(sepidarReference);
    if (sepidarDaily != null) update.sepidar_daily_number = Number(sepidarDaily);

    await sb.from("finance_vouchers").update(update).eq("id", voucherId);

    await sb.from("finance_sepidar_sync_logs").insert({
      voucher_id: voucherId,
      operation_type: "post_voucher",
      status: "success",
      response_payload: { ...(row as Record<string, unknown>), sp_name: spName } as never,
    } as never);

    console.log("[sepidar-post-voucher] ok", { voucherId, spName, row });
    return json({
      success: true,
      message: "سند با موفقیت در سپیدار ثبت شد.",
      data: row,
    });
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    const message = persianizeError(raw);
    console.error("[sepidar-post-voucher] error", { voucherId, spName, raw });
    await markFailed(sb, voucherId, message, attempts);
    return json({ success: false, message, rawError: raw }, 500);
  } finally {
    try {
      if (pool) await pool.close();
    } catch (closeErr) {
      console.warn("pool close", closeErr);
    }
  }
});
