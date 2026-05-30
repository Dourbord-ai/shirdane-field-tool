// HeatList — full table for «لیست فحلی».
// Mirrors every field collected by HeatRegistrationDialog so the operator
// can see exactly what was recorded without opening a modal.
//
// Display rule (per product spec): never show raw machine codes in the table.
// Each stored code is converted to the exact Persian label used in the
// registration form. Source of truth for «نوع فحلی» is the structured FK
// `livestock_fertility_events.erotic_type_id` joined to
// `fertility_erotic_types.title`; `metadata.erotic_type_label` is only a
// backward-compatible fallback for legacy rows missing the FK.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { FertilityEvent } from "@/lib/fertility";
import {
  TableShell, Th, Td, RowActions, EmptyState,
  formatEventDateTime, pick, CancelBadge,
} from "./shared";

interface Props {
  events: FertilityEvent[];
  onEdit?: (e: FertilityEvent) => void;
  onCancel?: (e: FertilityEvent) => void;
  resolveUserName?: (v: number | string | null | undefined) => string | null;
}

// Code → Persian label maps. Values must mirror the options rendered by
// HeatRegistrationDialog so the list reads exactly like the form. Adding a
// new option in the form means adding a matching entry here.
const QUALITY_LABELS: Record<string, string> = {
  weak: "ضعیف",
  normal: "معمولی",
  good: "خوب",
};

const DISCHARGE_LABELS: Record<string, string> = {
  weak: "ضعیف",
  normal: "معمولی",
  good: "خوب",
};

// uterine_infection is stored as a boolean. The form labels these as
// «دارد / ندارد», so the list mirrors that wording (not the generic
// «بله / خیر» from shared.yesNo).
function uterineInfectionLabel(v: unknown): string {
  if (v === true) return "دارد";
  if (v === false) return "ندارد";
  return "";
}

// Translate a stored code into its Persian label. Unknown codes pass through
// unchanged so we don't accidentally hide data — but the maps above cover
// every value the form can write today.
function codeToLabel(map: Record<string, string>, v: unknown): string {
  if (typeof v !== "string" || !v) return "";
  return map[v] ?? v;
}

export default function HeatList({ events, onEdit, onCancel, resolveUserName }: Props) {
  // Fetch the full erotic-types catalog once and build an id → title map.
  // We pull all rows (no is_active filter) so historical heats that referenced
  // a now-deactivated type still resolve to a readable Persian title.
  const { data: eroticTypeMap = {} } = useQuery<Record<number, string>>({
    queryKey: ["fertility_erotic_types_map"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fertility_erotic_types" as never)
        .select("id, title");
      if (error) throw error;
      const map: Record<number, string> = {};
      for (const row of (data as Array<{ id: number; title: string }>) ?? []) {
        map[row.id] = row.title;
      }
      return map;
    },
    // Erotic types change very rarely — cache aggressively to avoid refetching
    // on every tab switch.
    staleTime: 5 * 60 * 1000,
  });

  if (events.length === 0) return <EmptyState text="رویداد فحلی ثبت نشده است" />;

  return (
    <TableShell>
      <thead>
        <tr>
          <Th>تاریخ</Th>
          <Th>ساعت</Th>
          <Th>نوع فحلی</Th>
          <Th>کیفیت</Th>
          <Th>ترشحات</Th>
          <Th>عفونت رحمی</Th>
          <Th>ثبت‌کننده</Th>
          <Th>یادداشت</Th>
          <Th>وضعیت</Th>
          <Th className="text-left">عملیات</Th>
        </tr>
      </thead>
      <tbody>
        {events.map((e) => {
          const { date, time } = formatEventDateTime(e.event_date, pick(e.metadata, "time"));
          const operator =
            e.operator_name ||
            (resolveUserName ? resolveUserName(e.operator_user_id) : null) ||
            "";

          // Resolve heat type with the documented priority:
          //   1. structured FK erotic_type_id → fertility_erotic_types.title
          //   2. legacy metadata.erotic_type_label
          //   3. empty (rendered as a muted dash by <Td>)
          const eroticType =
            (e.erotic_type_id != null && eroticTypeMap[e.erotic_type_id]) ||
            pick<string>(e.metadata, "erotic_type_label") ||
            "";

          // Convert stored codes → Persian labels exactly as the form shows them.
          const quality = codeToLabel(QUALITY_LABELS, pick(e.metadata, "quality"));
          const discharge = codeToLabel(DISCHARGE_LABELS, pick(e.metadata, "discharge"));
          const infection = uterineInfectionLabel(pick(e.metadata, "uterine_infection"));

          return (
            <tr key={e.id} className="border-b border-border last:border-b-0 hover:bg-muted/20">
              <Td>{date}</Td>
              <Td>{time}</Td>
              <Td>{eroticType}</Td>
              <Td>{quality}</Td>
              <Td>{discharge}</Td>
              <Td>{infection}</Td>
              <Td>{operator}</Td>
              <Td className="max-w-[220px] whitespace-pre-wrap">{e.notes}</Td>
              <Td><CancelBadge e={e} /></Td>
              <Td className="text-left">
                <RowActions e={e} onEdit={onEdit} onCancel={onCancel} />
              </Td>
            </tr>
          );
        })}
      </tbody>
    </TableShell>
  );
}
