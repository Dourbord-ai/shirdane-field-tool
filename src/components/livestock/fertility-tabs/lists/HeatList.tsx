// HeatList — full table for «لیست فحلی».
// Mirrors every field collected by HeatRegistrationDialog so the operator
// can see exactly what was recorded without opening a modal.
import type { FertilityEvent } from "@/lib/fertility";
import {
  TableShell, Th, Td, RowActions, EmptyState,
  formatEventDateTime, pick, yesNo, CancelBadge,
} from "./shared";

interface Props {
  events: FertilityEvent[];
  onEdit?: (e: FertilityEvent) => void;
  onCancel?: (e: FertilityEvent) => void;
  // resolveUserName lets us turn legacy operator_user_id values into a
  // readable name. Currently we mostly rely on operator_name (text), but we
  // accept the helper so the API stays consistent across all list types.
  resolveUserName?: (v: number | string | null | undefined) => string | null;
}

export default function HeatList({ events, onEdit, onCancel, resolveUserName }: Props) {
  if (events.length === 0) return <EmptyState text="رویداد فحلی ثبت نشده است" />;

  return (
    <TableShell>
      {/* Column headers map 1:1 to fields the heat form collects:
          تاریخ + ساعت → event_date + metadata.time
          نوع فحلی     → metadata.erotic_type_label
          کیفیت        → metadata.quality
          ترشحات       → metadata.discharge
          عفونت رحم    → metadata.uterine_infection
          ثبت‌کننده     → operator_name
          یادداشت      → notes
          وضعیت        → is_cancelled badge */}
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
          // Read every form field out of the canonical columns + metadata bag.
          const { date, time } = formatEventDateTime(e.event_date, pick(e.metadata, "time"));
          const operator =
            e.operator_name ||
            (resolveUserName ? resolveUserName(e.operator_user_id) : null) ||
            "";
          return (
            <tr key={e.id} className="border-b border-border last:border-b-0 hover:bg-muted/20">
              <Td>{date}</Td>
              <Td>{time}</Td>
              <Td>{pick<string>(e.metadata, "erotic_type_label")}</Td>
              <Td>{pick<string>(e.metadata, "quality")}</Td>
              <Td>{pick<string>(e.metadata, "discharge")}</Td>
              <Td>{yesNo(pick(e.metadata, "uterine_infection"))}</Td>
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
