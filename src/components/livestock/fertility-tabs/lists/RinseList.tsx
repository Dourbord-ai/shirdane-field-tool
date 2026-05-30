// RinseList — full table for «لیست شستشو».
// Mirrors every field captured by RinseRegistrationDialog so the user can
// see all form values directly in the table (no detail dialog needed).
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

export default function RinseList({ events, onEdit, onCancel, resolveUserName }: Props) {
  if (events.length === 0) return <EmptyState text="رویداد شستشو ثبت نشده است" />;

  return (
    <TableShell>
      {/* Columns mirror RinseRegistrationDialog fields exactly:
          تاریخ / ساعت → event_date + metadata.time
          علت شستشو   → metadata.rinse_reason
          دارو/محلول   → metadata.solution (if captured by future form)
          ثبت‌کننده     → operator_name
          توضیحات     → notes */}
      <thead>
        <tr>
          <Th>تاریخ</Th>
          <Th>ساعت</Th>
          <Th>علت شستشو</Th>
          <Th>دارو / محلول مصرفی</Th>
          <Th>شستشو دهنده</Th>
          <Th>توضیحات</Th>
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
          const reason = pick<string>(e.metadata, "rinse_reason");
          // Solution/drug may be stored under any of these keys depending on form version.
          const solution =
            pick<string>(e.metadata, "solution") ||
            pick<string>(e.metadata, "drug") ||
            pick<string>(e.metadata, "medicine") ||
            "";
          return (
            <tr key={e.id} className="border-b border-border last:border-b-0 hover:bg-muted/20">
              <Td>{date}</Td>
              <Td>{time}</Td>
              <Td>{reason}</Td>
              <Td>{solution}</Td>
              <Td>{operator}</Td>
              <Td className="max-w-[240px] whitespace-pre-wrap">{e.notes}</Td>
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
