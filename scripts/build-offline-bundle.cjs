#!/usr/bin/env node
/* eslint-disable */
// =====================================================================
// build-offline-bundle.cjs
// ---------------------------------------------------------------------
// Run this ONCE on an internet-connected machine. It produces a folder
// `dist/offline-bundle/` containing EVERYTHING the local server needs:
//
//   dist/offline-bundle/
//     ├── sync-worker-win.exe       <- single-file executable (Windows)
//     ├── sync-worker-linux         <- single-file executable (Linux)
//     ├── .env.example              <- template to fill in
//     ├── README-DEPLOY.txt         <- 3-step deploy guide
//     └── install-windows-service.bat (optional auto-start helper)
//
// After running this, copy the whole `offline-bundle` folder to the
// local server via USB / share. The server needs NO internet, NO Node,
// NO npm — just runs the .exe directly.
//
// USAGE:
//   cd scripts
//   npm install            # installs deps + pkg
//   node build-offline-bundle.cjs
// =====================================================================

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const OUT = path.join(ROOT, "dist", "offline-bundle");

console.log("[build] cleaning output folder...");
fs.rmSync(path.join(ROOT, "dist"), { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

console.log("[build] compiling executables (Windows + Linux)...");
execSync(
  "npx pkg . --targets node18-win-x64,node18-linux-x64 --out-path " + OUT,
  { cwd: ROOT, stdio: "inherit" }
);

// pkg names files after package.json "name" — rename to friendly names
const renames = {
  "sql-sync-worker-win.exe": "sync-worker-win.exe",
  "sql-sync-worker-linux": "sync-worker-linux",
};
for (const [from, to] of Object.entries(renames)) {
  const src = path.join(OUT, from);
  if (fs.existsSync(src)) fs.renameSync(src, path.join(OUT, to));
}

console.log("[build] copying .env.example...");
fs.copyFileSync(
  path.join(ROOT, ".env.example"),
  path.join(OUT, ".env.example")
);

console.log("[build] writing deploy README...");
fs.writeFileSync(
  path.join(OUT, "README-DEPLOY.txt"),
  `OFFLINE DEPLOYMENT — SQL SYNC WORKER
=====================================

This folder contains EVERYTHING needed. The server does NOT need
internet (except outbound HTTPS to *.supabase.co) and does NOT need
Node.js or npm installed.

STEPS (Windows)
---------------
1. Copy this entire folder to your local server (e.g. C:\\sync-worker\\).
2. Rename ".env.example" to ".env" and fill in:
     - SUPABASE_SERVICE_ROLE_KEY
     - SQLSERVER_HOST / USER / PASSWORD / DATABASE
3. Double-click "sync-worker-win.exe" — it will start polling.

STEPS (Linux)
-------------
1. Copy folder to server (e.g. /opt/sync-worker/).
2. cp .env.example .env  &&  nano .env
3. chmod +x sync-worker-linux  &&  ./sync-worker-linux

AUTO-START ON BOOT (Windows)
----------------------------
Run "install-windows-service.bat" as Administrator. It registers the
worker as a Windows Service using NSSM (must be installed separately
from https://nssm.cc — also offline-installable).

REQUIRED NETWORK ACCESS
-----------------------
  Outbound HTTPS (443) to: gwwryrdrbmhifhfdmkph.supabase.co
  Outbound TCP   (1433) to: your SQL Server host

That's it. No other internet access required.

MONITORING
----------
The .exe prints logs to the console. To capture to file on Windows:
  sync-worker-win.exe >> sync.log 2>&1
`
);

console.log("[build] writing Windows service helper...");
fs.writeFileSync(
  path.join(OUT, "install-windows-service.bat"),
  `@echo off
REM Requires NSSM (https://nssm.cc) installed and on PATH.
REM Run this file as Administrator.

set SERVICE_NAME=ShirdaneSqlSync
set EXE_PATH=%~dp0sync-worker-win.exe
set WORK_DIR=%~dp0

nssm install %SERVICE_NAME% "%EXE_PATH%"
nssm set %SERVICE_NAME% AppDirectory "%WORK_DIR%"
nssm set %SERVICE_NAME% Start SERVICE_AUTO_START
nssm set %SERVICE_NAME% AppStdout "%WORK_DIR%sync.log"
nssm set %SERVICE_NAME% AppStderr "%WORK_DIR%sync.log"
nssm start %SERVICE_NAME%

echo.
echo Service "%SERVICE_NAME%" installed and started.
echo Logs: %WORK_DIR%sync.log
pause
`
);

console.log("\n[build] DONE ✔");
console.log("[build] Bundle is at:", OUT);
console.log("[build] Copy that folder to the server. No internet needed there.");
