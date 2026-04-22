/* eslint-disable */
// =====================================================================
// sql-sync-worker.cjs
// ---------------------------------------------------------------------
// Local background worker that mirrors Supabase factor data into the
// legacy SQL Server. Run this on the SAME local network as SQL Server.
//
// HOW IT WORKS:
//   1. Polls Supabase `sync_queue` for rows where status='pending'
//   2. Marks them 'processing' (atomic claim)
//   3. Writes Factor + CowFactorDetails to SQL Server using UPSERT
//   4. Marks 'synced' on success, 'failed' (+ retry_count++) on error
//   5. Sleeps and repeats
//
// USAGE (on your local machine):
//   1) cd scripts
//   2) npm install @supabase/supabase-js mssql
//   3) Set the env vars below (or create a .env file + use dotenv)
//   4) node sql-sync-worker.cjs
//
// REQUIRED ENV VARS:
//   SUPABASE_URL                 e.g. https://xxxx.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY    server-only key (NEVER expose in browser)
//   SQLSERVER_HOST               e.g. 192.168.1.10
//   SQLSERVER_PORT               e.g. 1433
//   SQLSERVER_USER               sa or app user
//   SQLSERVER_PASSWORD           ...
//   SQLSERVER_DATABASE           e.g. CowFarm
//   POLL_INTERVAL_MS             optional, default 5000
//   MAX_RETRIES                  optional, default 5
//
// We use SERVICE_ROLE_KEY (not the anon key) because this worker runs
// in a trusted environment and must update sync_queue rows.
// =====================================================================

const { createClient } = require("@supabase/supabase-js");
const sql = require("mssql");

// ---- Config (read from env so the file is committable) ----
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || "5000", 10);
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || "5", 10);

const sqlConfig = {
  server: process.env.SQLSERVER_HOST,
  port: parseInt(process.env.SQLSERVER_PORT || "1433", 10),
  user: process.env.SQLSERVER_USER,
  password: process.env.SQLSERVER_PASSWORD,
  database: process.env.SQLSERVER_DATABASE,
  options: {
    // Required when SQL Server uses a self-signed cert on a LAN.
    encrypt: false,
    trustServerCertificate: true,
  },
  pool: { max: 5, min: 0, idleTimeoutMillis: 30000 },
};

// Fail fast if a required env var is missing.
function assertEnv() {
  const required = [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SQLSERVER_HOST",
    "SQLSERVER_USER",
    "SQLSERVER_PASSWORD",
    "SQLSERVER_DATABASE",
  ];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(`[FATAL] Missing env vars: ${missing.join(", ")}`);
    process.exit(1);
  }
}

const supabase = () =>
  createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

// ---------------------------------------------------------------------
// Atomically claim ONE pending sync_queue row by setting it to 'processing'.
// Returns the claimed row, or null if nothing pending.
// ---------------------------------------------------------------------
async function claimNextPending(sb) {
  // Step 1: pick the oldest pending id.
  const { data: candidates, error: selErr } = await sb
    .from("sync_queue")
    .select("id")
    .eq("status", "pending")
    .lt("retry_count", MAX_RETRIES)
    .order("created_at", { ascending: true })
    .limit(1);

  if (selErr) throw selErr;
  if (!candidates || candidates.length === 0) return null;

  const id = candidates[0].id;

  // Step 2: try to flip it to 'processing'. The .eq('status', 'pending')
  // makes this a conditional update — if another worker grabbed it first,
  // we get 0 rows back and skip.
  const { data: claimed, error: updErr } = await sb
    .from("sync_queue")
    .update({ status: "processing" })
    .eq("id", id)
    .eq("status", "pending")
    .select("*")
    .single();

  if (updErr) {
    // Not found = lost the race; that's normal under concurrency.
    if (updErr.code === "PGRST116") return null;
    throw updErr;
  }
  return claimed;
}

// ---------------------------------------------------------------------
// UPSERT factor + details into SQL Server.
// Adjust table/column names if your legacy schema differs.
// ---------------------------------------------------------------------
async function writeFactorToSqlServer(pool, payload) {
  const factor = payload.Factor || {};
  const detail = payload.CowFactorDetail || {};
  const supabaseFactorId = factor.SupabaseFactorId;

  // Use SUPABASE_FACTOR_ID as the natural key in SQL Server so we can UPSERT
  // without relying on identity columns. We assume your Factors table has
  // a column `SupabaseFactorId NVARCHAR(36) UNIQUE` — add it if missing.
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const req = new sql.Request(tx);

    // ---- UPSERT Factor (MERGE) ----
    req.input("SupabaseFactorId", sql.NVarChar(36), supabaseFactorId);
    req.input("FactorTypeId", sql.Int, factor.FactorTypeId ?? null);
    req.input("ProductTypeId", sql.Int, factor.ProductTypeId ?? null);
    req.input("FactorDate", sql.NVarChar(20), factor.FactorDate ?? null);
    req.input("FactorNumber", sql.Int, factor.FactorNumber ?? null);
    req.input("TotalPrice", sql.Decimal(18, 2), factor.TotalPrice ?? 0);
    req.input("PayablePrice", sql.Decimal(18, 2), factor.PayablePrice ?? 0);
    req.input("Vat", sql.Decimal(18, 2), factor.Vat ?? 0);
    req.input("VatPercent", sql.Decimal(9, 4), factor.VatPercent ?? 0);
    req.input("OffPrice", sql.Decimal(18, 2), factor.OffPrice ?? 0);
    req.input("DeliveryCost", sql.Decimal(18, 2), factor.DeliveryCost ?? 0);
    req.input("CkeckoutTypeId", sql.Int, factor.CkeckoutTypeId ?? null);
    req.input("SellerBuyerTypes", sql.Int, factor.SellerBuyerTypes ?? null);
    req.input("ShoppingCenterId", sql.BigInt, factor.ShoppingCenterId ?? null);
    req.input("BuyerUserId", sql.BigInt, factor.BuyerUserId ?? null);
    req.input("OtherCenterName", sql.NVarChar(255), factor.OtherCenterName ?? null);
    req.input("OtherCenterPhoneNumber", sql.NVarChar(50), factor.OtherCenterPhoneNumber ?? null);
    req.input("OtherCenterAddress", sql.NVarChar(500), factor.OtherCenterAddress ?? null);
    req.input("OtherCenterDescription", sql.NVarChar(1000), factor.OtherCenterDescription ?? null);
    req.input("Image", sql.NVarChar(500), factor.Image ?? null);

    const upsertFactor = `
      MERGE Factors AS target
      USING (SELECT @SupabaseFactorId AS SupabaseFactorId) AS src
        ON target.SupabaseFactorId = src.SupabaseFactorId
      WHEN MATCHED THEN UPDATE SET
        FactorTypeId = @FactorTypeId,
        ProductTypeId = @ProductTypeId,
        FactorDate = @FactorDate,
        FactorNumber = @FactorNumber,
        TotalPrice = @TotalPrice,
        PayablePrice = @PayablePrice,
        Vat = @Vat,
        VatPercent = @VatPercent,
        OffPrice = @OffPrice,
        DeliveryCost = @DeliveryCost,
        CkeckoutTypeId = @CkeckoutTypeId,
        SellerBuyerTypes = @SellerBuyerTypes,
        ShoppingCenterId = @ShoppingCenterId,
        BuyerUserId = @BuyerUserId,
        OtherCenterName = @OtherCenterName,
        OtherCenterPhoneNumber = @OtherCenterPhoneNumber,
        OtherCenterAddress = @OtherCenterAddress,
        OtherCenterDescription = @OtherCenterDescription,
        [Image] = @Image
      WHEN NOT MATCHED THEN INSERT (
        SupabaseFactorId, FactorTypeId, ProductTypeId, FactorDate, FactorNumber,
        TotalPrice, PayablePrice, Vat, VatPercent, OffPrice, DeliveryCost,
        CkeckoutTypeId, SellerBuyerTypes, ShoppingCenterId, BuyerUserId,
        OtherCenterName, OtherCenterPhoneNumber, OtherCenterAddress,
        OtherCenterDescription, [Image]
      ) VALUES (
        @SupabaseFactorId, @FactorTypeId, @ProductTypeId, @FactorDate, @FactorNumber,
        @TotalPrice, @PayablePrice, @Vat, @VatPercent, @OffPrice, @DeliveryCost,
        @CkeckoutTypeId, @SellerBuyerTypes, @ShoppingCenterId, @BuyerUserId,
        @OtherCenterName, @OtherCenterPhoneNumber, @OtherCenterAddress,
        @OtherCenterDescription, @Image
      )
      OUTPUT inserted.Id;
    `;
    const result = await req.query(upsertFactor);
    const sqlFactorId = result.recordset[0].Id;

    // ---- Replace cow details for idempotency ----
    const delReq = new sql.Request(tx);
    delReq.input("FactorId", sql.Int, sqlFactorId);
    await delReq.query("DELETE FROM CowFactorDetails WHERE FactorId = @FactorId");

    // Insert each cow row (parallel arrays aligned by index).
    const cowIds = detail.CowIds || [];
    for (let i = 0; i < cowIds.length; i++) {
      const r = new sql.Request(tx);
      r.input("FactorId", sql.Int, sqlFactorId);
      r.input("CowId", sql.BigInt, cowIds[i]);
      r.input("Weight", sql.Decimal(10, 2), detail.Weights?.[i] ?? 0);
      r.input("UnitPrice", sql.Decimal(18, 2), detail.UnitPrices?.[i] ?? 0);
      r.input("RowPrice", sql.Decimal(18, 2), detail.RowPrices?.[i] ?? 0);
      r.input("ExistenceStatus", sql.Int, detail.ExistenceStatuses?.[i] ?? 1);
      r.input("Description", sql.NVarChar(1000), detail.Descriptions?.[i] ?? null);
      await r.query(`
        INSERT INTO CowFactorDetails
          (FactorId, CowId, Weight, UnitPrice, RowPrice, ExistenceStatus, [Description])
        VALUES
          (@FactorId, @CowId, @Weight, @UnitPrice, @RowPrice, @ExistenceStatus, @Description);
      `);
    }

    await tx.commit();
    return sqlFactorId;
  } catch (e) {
    try { await tx.rollback(); } catch (_) { /* ignore */ }
    throw e;
  }
}

// ---------------------------------------------------------------------
// Mark a queue row done / failed and update Supabase factor sync_status.
// ---------------------------------------------------------------------
async function markSynced(sb, queueRow) {
  const now = new Date().toISOString();
  await sb
    .from("sync_queue")
    .update({ status: "synced", last_error: null, synced_at: now })
    .eq("id", queueRow.id);
  await sb
    .from("factors")
    .update({ sync_status: "synced" })
    .eq("id", queueRow.entity_id);
}

async function markFailed(sb, queueRow, err) {
  const newRetries = (queueRow.retry_count || 0) + 1;
  const finalStatus = newRetries >= MAX_RETRIES ? "failed" : "pending";
  await sb
    .from("sync_queue")
    .update({
      status: finalStatus,
      retry_count: newRetries,
      last_error: String(err?.message || err),
    })
    .eq("id", queueRow.id);
  if (finalStatus === "failed") {
    await sb
      .from("factors")
      .update({ sync_status: "failed" })
      .eq("id", queueRow.entity_id);
  }
}

// ---------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------
async function main() {
  assertEnv();
  console.log(`[worker] starting; poll=${POLL_INTERVAL_MS}ms maxRetries=${MAX_RETRIES}`);

  const pool = await sql.connect(sqlConfig);
  const sb = supabase();

  // Graceful shutdown so SQL connections aren't leaked.
  let stopping = false;
  process.on("SIGINT", () => { stopping = true; });
  process.on("SIGTERM", () => { stopping = true; });

  while (!stopping) {
    try {
      const job = await claimNextPending(sb);
      if (!job) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        continue;
      }
      console.log(`[worker] processing queue id=${job.id} entity=${job.entity_id}`);
      try {
        await writeFactorToSqlServer(pool, job.payload);
        await markSynced(sb, job);
        console.log(`[worker] synced queue id=${job.id}`);
      } catch (e) {
        console.error(`[worker] FAILED queue id=${job.id}:`, e?.message || e);
        await markFailed(sb, job, e);
      }
    } catch (loopErr) {
      console.error("[worker] loop error:", loopErr?.message || loopErr);
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
  }

  await pool.close();
  console.log("[worker] shutdown complete");
}

main().catch((e) => {
  console.error("[worker] fatal:", e);
  process.exit(1);
});
