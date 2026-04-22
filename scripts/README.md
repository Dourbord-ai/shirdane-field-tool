# SQL Server Sync Worker

Local Node.js worker that mirrors Supabase factor data into the legacy
SQL Server. Run on a machine with network access to BOTH Supabase
(internet) and your SQL Server (LAN).

## How it works

```
Form (شیردانه) ──> Supabase RPC submit_cow_factor ──> [factors, cow_factor_details, sync_queue]
                                                                                      │
                                                                                      ▼
                                                       This worker polls sync_queue every 5s
                                                                                      │
                                                                                      ▼
                                                              SQL Server (Factors, CowFactorDetails)
```

The worker does:
1. **Atomic claim** — flips one `pending` row to `processing` (race-safe).
2. **UPSERT** — `MERGE` into `Factors`, replace child `CowFactorDetails`.
3. **Mark synced/failed** — updates `sync_queue` and `factors.sync_status`.
4. **Retries** — failures stay `pending` until `retry_count >= MAX_RETRIES`.

## Setup

```bash
cd scripts
npm install
cp .env.example .env   # then edit values
node sql-sync-worker.cjs
```

## Required env vars

| Var | Purpose |
|-----|---------|
| `SUPABASE_URL` | `https://<ref>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | **server-only** key (never ship to browser) |
| `SQLSERVER_HOST` | e.g. `192.168.1.10` |
| `SQLSERVER_PORT` | default `1433` |
| `SQLSERVER_USER` / `SQLSERVER_PASSWORD` | SQL auth |
| `SQLSERVER_DATABASE` | e.g. `CowFarm` |
| `POLL_INTERVAL_MS` | optional, default `5000` |
| `MAX_RETRIES` | optional, default `5` |

## SQL Server schema requirements

Add this column to your `Factors` table if missing — it's the natural key
the worker uses for UPSERT (so re-running a queue job is idempotent):

```sql
ALTER TABLE Factors
  ADD SupabaseFactorId NVARCHAR(36) NULL;

CREATE UNIQUE INDEX UX_Factors_SupabaseFactorId
  ON Factors(SupabaseFactorId)
  WHERE SupabaseFactorId IS NOT NULL;
```

`CowFactorDetails` is replaced (DELETE then INSERT) per factor on each
sync, so no schema change is needed there.

## Run as a Windows service

Use [`node-windows`](https://www.npmjs.com/package/node-windows) or
NSSM to wrap this script as a service so it survives reboots.

## Monitoring

Failed rows in Supabase:
```sql
SELECT * FROM sync_queue WHERE status = 'failed' ORDER BY updated_at DESC;
```

Retry a failed row manually:
```sql
UPDATE sync_queue SET status='pending', retry_count=0 WHERE id='<uuid>';
```
