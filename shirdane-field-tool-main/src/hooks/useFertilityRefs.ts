import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface FertilityOperation {
  id: number;
  name: string;
  operation_name: string;
  sort_order: number;
  is_active: boolean;
}

export interface FertilityStatus {
  id: number;
  name: string;
  color: string;
  pregnancy_state: string;
  milking_state: string;
  is_abortion: boolean;
  sort_order: number;
}

export interface CowOption {
  id: number;
  bodynumber: number | null;
  earnumber: number | null;
  tag_number: string | null;
  sex: number | null;
  sextype: string | null;
  existancestatus: number | null;
  is_dry: boolean | null;
  last_fertility_status: number | null;
}

export function useFertilityOperations() {
  return useQuery({
    queryKey: ["fertility_operations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fertility_operations")
        .select("id, name, operation_name, sort_order, is_active")
        .eq("is_active", true)
        .order("sort_order");
      if (error) throw error;
      return (data ?? []) as FertilityOperation[];
    },
    staleTime: 5 * 60_000,
  });
}

export function useFertilityStatuses() {
  return useQuery({
    queryKey: ["fertility_statuses"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fertility_statuses")
        .select("id, name, color, pregnancy_state, milking_state, is_abortion, sort_order")
        .order("sort_order");
      if (error) throw error;
      return (data ?? []) as FertilityStatus[];
    },
    staleTime: 5 * 60_000,
  });
}

export function useCows() {
  return useQuery({
    queryKey: ["cows_for_fertility"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cows")
        .select("id, bodynumber, earnumber, tag_number, sex, sextype, existancestatus, is_dry, last_fertility_status")
        .order("bodynumber", { ascending: true })
        .limit(1000);
      if (error) throw error;
      return (data ?? []) as CowOption[];
    },
    staleTime: 60_000,
  });
}

export const cowLabel = (c: CowOption) => {
  const body = c.bodynumber ? `بدنه ${c.bodynumber}` : "";
  const ear = c.earnumber ? ` / گوش ${c.earnumber}` : "";
  const tag = c.tag_number ? ` (${c.tag_number})` : "";
  return `${body}${ear}${tag}`.trim() || `#${c.id}`;
};
