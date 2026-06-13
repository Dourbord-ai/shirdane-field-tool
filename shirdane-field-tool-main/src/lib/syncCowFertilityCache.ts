import { supabase } from "@/integrations/supabase/client";

/**
 * After insert/update/delete of a fertility event, the DB trigger
 * `livestock_fertility_events_rebuild_cache` already recalculates
 * cows.last_fertility_status and the cached date fields from the
 * full timeline (source of truth = livestock_fertility_events).
 *
 * This helper re-reads the latest event + cached cow fields,
 * logs a debug payload, and returns the snapshot so callers can
 * verify/invalidate caches.
 *
 * IMPORTANT: Do NOT use cached cow fields for validation logic.
 * They are only for list display, filters, shortcuts, and reports.
 */
export async function syncCowFertilityCache(cowId: number) {
  if (!cowId) return null;

  const { data: latestEvent } = await supabase
    .from("livestock_fertility_events")
    .select("id, fertility_operation_id, fertility_status_id, event_date, event_time")
    .eq("livestock_id", cowId)
    .eq("is_cancelled", false)
    .order("event_date", { ascending: false })
    .order("event_time", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: cow } = await supabase
    .from("cows")
    .select(
      "id, last_fertility_status, last_fertility_status_date, last_erotic_date, last_inoculation_date, last_pregnancy_date, last_abortion_date, last_birth_date, last_dry_date, last_rinse_date, last_clean_test_date, last_sync_date"
    )
    .eq("id", cowId)
    .maybeSingle();

  // eslint-disable-next-line no-console
  console.debug("[syncCowFertilityCache]", {
    cowId,
    latestEvent,
    newLastFertilityStatus: cow?.last_fertility_status ?? null,
    updatedCachedDates: cow
      ? {
          last_erotic_date: cow.last_erotic_date,
          last_inoculation_date: cow.last_inoculation_date,
          last_pregnancy_date: cow.last_pregnancy_date,
          last_abortion_date: cow.last_abortion_date,
          last_birth_date: cow.last_birth_date,
          last_dry_date: cow.last_dry_date,
          last_rinse_date: cow.last_rinse_date,
          last_clean_test_date: cow.last_clean_test_date,
          last_sync_date: cow.last_sync_date,
        }
      : null,
  });

  return { latestEvent, cow };
}
