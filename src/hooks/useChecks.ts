// =============================================================================
// useChecks / useCheck / useCheckEvents / useDueChecks
// -----------------------------------------------------------------------------
// React-Query hooks for the Check Management module. They centralise:
//   - fetching the list of checks (optionally filtered by direction/status)
//   - fetching a single check with its joined party + bank
//   - fetching the full event timeline for one check
//   - computing due-soon buckets (today / this week / overdue)
//
// Putting all the network logic here keeps the UI components purely visual
// and gives us one place to invalidate caches after a mutation.
// =============================================================================
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { CheckDirection, CheckStatus } from "@/lib/checks";

// Shape of a row joined with its party + bank summary fields. We pick only
// the columns the UI actually renders to keep payloads small.
export interface CheckRow {
  id: string;
  direction: CheckDirection;
  party_id: string | null;
  amount: number;
  check_number: string;
  sayad_number: string | null;
  bank_id: string | null;
  bank_account_id: string | null;
  checkbook_leaf_id: string | null;
  issue_date: string | null;
  receive_date: string | null;
  due_date: string;
  status: CheckStatus;
  description: string | null;
  party_effected_at: string | null;
  bank_effected_at: string | null;
  created_at: string;
  // Inline joins — Supabase returns them as nested objects via the FK alias.
  party?: { first_name: string | null; last_name: string | null; company_name: string | null } | null;
  bank?: { title: string | null; bank_name: string | null } | null;
}

// Standard query key factory so invalidation calls match exactly.
export const checksKeys = {
  all: ["finance_checks"] as const,
  list: (filters: { direction?: CheckDirection; status?: CheckStatus } = {}) =>
    [...checksKeys.all, "list", filters] as const,
  one: (id: string) => [...checksKeys.all, "one", id] as const,
  events: (id: string) => [...checksKeys.all, "events", id] as const,
  due: () => [...checksKeys.all, "due"] as const,
};

// SELECT clause shared by list + one queries. We use Supabase's PostgREST
// relationship syntax (FK alias) to embed the party/bank row inline.
const CHECK_SELECT = `
  id, direction, party_id, amount, check_number, sayad_number,
  bank_id, bank_account_id, checkbook_leaf_id,
  issue_date, receive_date, due_date, status, description,
  party_effected_at, bank_effected_at, created_at,
  party:finance_parties!finance_checks_party_id_fkey ( first_name, last_name, company_name ),
  bank:finance_banks!finance_checks_bank_id_fkey ( title, bank_name )
`;

export function useChecks(filters: { direction?: CheckDirection; status?: CheckStatus } = {}) {
  return useQuery({
    queryKey: checksKeys.list(filters),
    queryFn: async (): Promise<CheckRow[]> => {
      let q = supabase
        .from("finance_checks" as never)
        .select(CHECK_SELECT)
        .order("due_date", { ascending: true });
      if (filters.direction) q = q.eq("direction", filters.direction);
      if (filters.status) q = q.eq("status", filters.status);
      const { data, error } = await q;
      if (error) throw error;
      return (data as unknown as CheckRow[]) ?? [];
    },
  });
}

export function useCheck(id: string | null) {
  return useQuery({
    queryKey: id ? checksKeys.one(id) : ["finance_checks", "one", "none"],
    enabled: !!id,
    queryFn: async (): Promise<CheckRow | null> => {
      const { data, error } = await supabase
        .from("finance_checks" as never)
        .select(CHECK_SELECT)
        .eq("id", id!)
        .maybeSingle();
      if (error) throw error;
      return (data as unknown as CheckRow) ?? null;
    },
  });
}

export interface CheckEventRow {
  id: string;
  check_id: string;
  event_type: string;
  event_date: string;
  description: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export function useCheckEvents(checkId: string | null) {
  return useQuery({
    queryKey: checkId ? checksKeys.events(checkId) : ["finance_checks", "events", "none"],
    enabled: !!checkId,
    queryFn: async (): Promise<CheckEventRow[]> => {
      const { data, error } = await supabase
        .from("finance_check_events" as never)
        .select("*")
        .eq("check_id", checkId!)
        .order("event_date", { ascending: false });
      if (error) throw error;
      return (data as unknown as CheckEventRow[]) ?? [];
    },
  });
}

// Invalidation helper — called from every mutation site so the lists refresh.
export function useInvalidateChecks() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: checksKeys.all });
}
