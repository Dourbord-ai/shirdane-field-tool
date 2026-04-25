# SQL Server Sync Worker

Local Node.js worker that mirrors Supabase factor data into the legacy
SQL Server.

## Two ways to run

### Option A — Offline single-file executable (recommended)

Server needs **no internet, no Node, no npm**. Just one `.exe`.

**On an internet-connected machine (once):**
```bash
cd scripts
npm install
node build-offline-bundle.cjs
```

This produces `scripts/dist/offline-bundle/` containing:
- `sync-worker-win.exe` — Windows executable (Node + all deps bundled)
- `sync-worker-linux`   — Linux executable
- `.env.example`        — fill in and rename to `.env`
- `README-DEPLOY.txt`   — 3-step deploy guide
- `install-windows-service.bat` — optional auto-start

Copy that folder to the server (USB / share / SCP). Done.

### Option B — Run with Node directly

```bash
cd scripts
npm install
cp .env.example .env   # then edit values
node sql-sync-worker.cjs
```

## How it works

```
Form (شیردانه) → Supabase RPC submit_cow_factor → [factors, cow_factor_details, sync_queue]
                                                                           │
                                                                           ▼
                                            This worker polls sync_queue every 5s
                                                                           │
                                                                           ▼
                                                  SQL Server (Factors, CowFactorDetails)
```

1. **Atomic claim** — flips one `pending` row to `processing` (race-safe).
2. **UPSERT** — `MERGE` into `Factors`, replace child `CowFactorDetails`.
3. **Mark synced/failed** — updates `sync_queue` and `factors.sync_status`.
4. **Retries** — failures stay `pending` until `retry_count >= MAX_RETRIES`.

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

## Network access required on the server

| Target | Port | Required |
|---|---|---|
| `gwwryrdrbmhifhfdmkph.supabase.co` | 443 (HTTPS) | ✅ Yes |
| Your SQL Server (LAN) | 1433 (TCP) | ✅ Yes |
| Anything else (general internet) | — | ❌ No |

You can whitelist just the Supabase domain — no full internet needed.

## SQL Server schema requirements

Add this column to your `Factors` table — it's the natural key the worker
uses for UPSERT (idempotent re-runs):

```sql
ALTER TABLE Factors
  ADD SupabaseFactorId NVARCHAR(36) NULL;

CREATE UNIQUE INDEX UX_Factors_SupabaseFactorId
  ON Factors(SupabaseFactorId)
  WHERE SupabaseFactorId IS NOT NULL;
```

## Run as a Windows service

Use the bundled `install-windows-service.bat` (requires [NSSM](https://nssm.cc),
also offline-installable) to register the worker as an auto-starting service.

## Monitoring

Failed rows in Supabase:
```sql
SELECT * FROM sync_queue WHERE status = 'failed' ORDER BY updated_at DESC;
```

Retry a failed row manually:
```sql
UPDATE sync_queue SET status='pending', retry_count=0 WHERE id='<uuid>';
```
