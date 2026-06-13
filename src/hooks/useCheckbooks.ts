// =============================================================================
// useCheckbooks / useCheckbookLeaves
// -----------------------------------------------------------------------------
// Hooks for our own checkbooks and the auto-generated leaf rows used when
// issuing a payable check. Kept in a dedicated file because checkbook screens
// are independent of received-check workflows.
// =============================================================================
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { CheckbookLeafStatus } from "@/lib/checks";

export interface CheckbookRow {
  id: string;
  bank_id: string;
  bank_account_id: string | null;
  title: string;
  start_serial: number;
  end_serial: number;
  sheet_count: number;
  issued_at: string | null;
  is_active: boolean;
  description: string | null;
  created_at: string;
  bank?: { title: string | null; bank_name: string | null } | null;
}

export interface CheckbookLeafRow {
  id: string;
  checkbook_id: string;
  serial_number: number;
  status: CheckbookLeafStatus;
  issued_check_id: string | null;
  used_at: string | null;
}

export const checkbookKeys = {
  all: ["finance_checkbooks"] as const,
  list: () => [...checkbookKeys.all, "list"] as const,
  leaves: (checkbookId: string) => [...checkbookKeys.all, "leaves", checkbookId] as const,
  availableLeaves: (checkbookId: string | null) =>
    [...checkbookKeys.all, "available", checkbookId ?? "none"] as const,
};

export function useCheckbooks() {
  return useQuery({
    queryKey: checkbookKeys.list(),
    queryFn: async (): Promise<CheckbookRow[]> => {
      const { data, error } = await supabase
        .from("finance_checkbooks" as never)
        .select(`
          id, bank_id, bank_account_id, title, start_serial, end_serial,
          sheet_count, issued_at, is_active, description, created_at,
          bank:finance_banks!finance_checkbooks_bank_id_fkey ( title, bank_name )
        `)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data as unknown as CheckbookRow[]) ?? [];
    },
  });
}

export function useCheckbookLeaves(checkbookId: string | null) {
  return useQuery({
    queryKey: checkbookId ? checkbookKeys.leaves(checkbookId) : ["finance_checkbooks", "leaves", "none"],
    enabled: !!checkbookId,
    queryFn: async (): Promise<CheckbookLeafRow[]> => {
      const { data, error } = await supabase
        .from("finance_checkbook_leaves" as never)
        .select("*")
        .eq("checkbook_id", checkbookId!)
        .order("serial_number", { ascending: true });
      if (error) throw error;
      return (data as unknown as CheckbookLeafRow[]) ?? [];
    },
  });
}

// Convenience hook: only the available (unused) leaves of a checkbook.
// Used by the payable-check dialog to populate the leaf picker.
export function useAvailableLeaves(checkbookId: string | null) {
  return useQuery({
    queryKey: checkbookKeys.availableLeaves(checkbookId),
    enabled: !!checkbookId,
    queryFn: async (): Promise<CheckbookLeafRow[]> => {
      const { data, error } = await supabase
        .from("finance_checkbook_leaves" as never)
        .select("*")
        .eq("checkbook_id", checkbookId!)
        .eq("status", "available")
        .order("serial_number", { ascending: true });
      if (error) throw error;
      return (data as unknown as CheckbookLeafRow[]) ?? [];
    },
  });
}

export function useInvalidateCheckbooks() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: checkbookKeys.all });
}
