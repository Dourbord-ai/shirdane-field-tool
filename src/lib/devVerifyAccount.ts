// Dev-only helper for manually testing the verify-account edge function
// without running the full auto-processing pipeline.
//
// Usage from the browser console:
//   await window.__verifyAccountTest({ type: "3", number: "1051810316" })
//   await window.__verifyAccountTest({ type: "3", number: "1109172299" })
//
// The helper always sends `debug: true` so the response includes the
// upstream URL, status, raw body preview and parser-branch diagnostics.

import { supabase } from "@/integrations/supabase/client";

// Shape we expose so TypeScript users can call the helper directly too.
export interface VerifyAccountTestInput {
  type: "1" | "2" | "3";
  number: string;
}

export async function verifyAccountTest(input: VerifyAccountTestInput) {
  // We use supabase.functions.invoke so the call goes through the same
  // auth/headers pipeline the rest of the app uses. `debug: true` opts
  // into the diagnostic payload added to verify-account.
  const { data, error } = await supabase.functions.invoke("verify-account", {
    body: { ...input, debug: true },
  });

  // Always print a structured group in the console so it's easy to read.
  // We do not throw — the goal is observation, not flow control.
  // eslint-disable-next-line no-console
  console.group(`[verifyAccountTest] type=${input.type} number=${input.number}`);
  // eslint-disable-next-line no-console
  console.log("data:", data);
  if (error) {
    // eslint-disable-next-line no-console
    console.error("error:", error);
  }
  // eslint-disable-next-line no-console
  console.groupEnd();

  return { data, error };
}

// Attach to window in dev so it's reachable from the browser console.
// Guard with import.meta.env.DEV so it never ships in production bundles.
if (typeof window !== "undefined" && import.meta.env?.DEV) {
  (window as unknown as Record<string, unknown>).__verifyAccountTest =
    verifyAccountTest;
  // eslint-disable-next-line no-console
  console.info(
    "[dev] window.__verifyAccountTest({ type: '3', number: '...' }) is available",
  );
}
