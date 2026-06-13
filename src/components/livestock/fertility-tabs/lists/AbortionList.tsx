// AbortionList — full table for «لیست سقط».
// Surfaces every field captured by AbortionRegistrationDialog: period,
// milking-after status, dry-after status, notes.
import type { FertilityEvent } from "@/lib/fertility";
import {
  TableShell, Th, Td, RowActions, EmptyState,
  formatEventDateTime, pick, yesNo, CancelBadge,
} from "./shared";

interface Props {
  events: FertilityEvent[];
  onEdit?: (e: FertilityEvent) => void;
  onCancel?: (e: FertilityEvent) => void;
  resolveUserName?: (v: number | string | null | undefined) => string | null;
}

export default function AbortionList({ events, onEdit, onCancel, resolveUserName }: Props) {
  if (events.length === 0) return <EmptyState text="رویداد سقط ثبت نشده است" />;

  return (
    <TableShell>
      {/* Columns:
          دوره                → metadata.period
          شیردهی پس از سقط    → metadata.is_milking_after_abortion
          خشک پس از سقط      → metadata.is_dry_after_abortion
          ثبت‌کننده            → operator_name
          یادداشت             → notes */}
      <thead>
        <tr>
          <Th>تاریخ</Th>
          <Th>ساعت</Th>
          <Th>دوره</Th>
          <Th>شیردهی پس از سقط</Th>
          <Th>خشک پس از سقط</Th>
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
          return (
            <tr key={e.id} className="border-b border-border last:border-b-0 hover:bg-muted/20">
              <Td>{date}</Td>
              <Td>{time}</Td>
              <Td>{pick<number>(e.metadata, "period")}</Td>
              <Td>{yesNo(pick(e.metadata, "is_milking_after_abortion"))}</Td>
              <Td>{yesNo(pick(e.metadata, "is_dry_after_abortion"))}</Td>
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
