// ============================================================
// devAccess.ts — TEMPORARY development access mode.
//
// While DEV_ACCESS_MODE is true:
//   - hasPermission() always returns true
//   - All role / permission checks across the app are bypassed
//   - Route guards do not block anyone
//   - Frontend "no permission" messages are suppressed
//
// Set DEV_ACCESS_MODE = false (or remove this file's use) to
// restore normal role-based access control.
// ============================================================

export const DEV_ACCESS_MODE = true;

let _warned = false;
function warnOnce() {
  if (_warned || typeof window === "undefined") return;
  _warned = true;
  // eslint-disable-next-line no-console
  console.warn(
    "DEV_ACCESS_MODE is enabled. Role and permission checks are temporarily bypassed."
  );
}

if (DEV_ACCESS_MODE) warnOnce();

/** Returns true while DEV_ACCESS_MODE is enabled. */
export function hasPermission(_permission?: string): boolean {
  if (DEV_ACCESS_MODE) {
    warnOnce();
    return true;
  }
  return false;
}

/** Treats every authenticated (or even anonymous) user as admin in dev mode. */
export function isAdminBypass(currentIsAdmin: boolean): boolean {
  return DEV_ACCESS_MODE ? true : currentIsAdmin;
}
