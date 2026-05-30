// CalvingList — full table for «لیست زایش».
// Surfaces every field the calving form captures: period, helped status,
// calving condition, calf count, per-calf details (gender/status/weight),
// caregiver, notes.
import { Button } from "@/components/ui/button";
import { Baby } from "lucide-react";
import type { FertilityEvent } from "@/lib/fertility";
import {
  TableShell, Th, Td, RowActions, EmptyState,
  formatEventDateTime, pick, yesNo, CancelBadge,
} from "./shared";

// Shape of one calf entry inside metadata.calves. Matches the payload the
// CalvingRegistrationDialog writes — kept local because no other component
// consumes this exact shape.
interface CalfMeta {
  index?: number;
  gender_label?: string;
  physical_status_label?: string;
  body_number?: string | null;
  ear_number?: string | null;
  birth_weight?: number | null;
  notes?: string | null;
}

interface Props {
  events: FertilityEvent[];
  onEdit?: (e: FertilityEvent) => void;
  onCancel?: (e: FertilityEvent) => void;
  onCreateCalves?: (e: FertilityEvent) => void;
  resolveUserName?: (v: number | string | null | undefined) => string | null;
}

export default function CalvingList({
  events, onEdit, onCancel, onCreateCalves, resolveUserName,
}: Props) {
  if (events.length === 0) return <EmptyState text="رویداد زایش ثبت نشده است" />;

  return (
    <TableShell>
      {/* Columns map to CalvingRegistrationDialog fields:
          دوره          → metadata.period
          تعداد گوساله  → metadata.calf_count
          جنسیت‌ها      → metadata.calves[*].gender_label
          وضعیت تولد    → metadata.calves[*].physical_status_label
          نوع زایش      → metadata.calving_condition_label
          با کمک        → metadata.is_helped
          مراقب         → metadata.caregiver_name
          یادداشت       → notes */}
      <thead>
        <tr>
          <Th>تاریخ</Th>
          <Th>ساعت</Th>
          <Th>دوره</Th>
          <Th>تعداد گوساله</Th>
          <Th>جنسیت‌ها</Th>
          <Th>وضعیت تولد</Th>
          <Th>نوع زایش</Th>
          <Th>با کمک</Th>
          <Th>مراقب</Th>
          <Th>ثبت‌کننده</Th>
          <Th>یادداشت</Th>
          <Th>وضعیت</Th>
          <Th className="text-left">عملیات</Th>
        </tr>
      </thead>
      <tbody>
        {events.map((e) => {
          const { date, time } = formatEventDateTime(e.event_date, pick(e.metadata, "time"));
          // calves is an array; we summarise it across two columns so the
          // operator can see all genders/statuses at a glance.
          const calves = (pick<CalfMeta[]>(e.metadata, "calves") ?? []) as CalfMeta[];
          const genders = calves.map((c) => c.gender_label).filter(Boolean).join("، ");
          const statuses = calves.map((c) => c.physical_status_label).filter(Boolean).join("، ");
          const operator =
            e.operator_name ||
            (resolveUserName ? resolveUserName(e.operator_user_id) : null) ||
            "";
          return (
            <tr key={e.id} className="border-b border-border last:border-b-0 hover:bg-muted/20">
              <Td>{date}</Td>
              <Td>{time}</Td>
              <Td>{pick<number>(e.metadata, "period")}</Td>
              <Td>{pick<number>(e.metadata, "calf_count")}</Td>
              <Td>{genders}</Td>
              <Td>{statuses}</Td>
              <Td>{pick<string>(e.metadata, "calving_condition_label")}</Td>
              <Td>{yesNo(pick(e.metadata, "is_helped"))}</Td>
              <Td>{pick<string>(e.metadata, "caregiver_name")}</Td>
              <Td>{operator}</Td>
              <Td className="max-w-[200px] whitespace-pre-wrap">{e.notes}</Td>
              <Td><CancelBadge e={e} /></Td>
              <Td className="text-left">
                {/* Calving rows uniquely expose a "ثبت گوساله‌ها" button so the
                    user can create cow records from the calving metadata. */}
                <RowActions
                  e={e}
                  onEdit={onEdit}
                  onCancel={onCancel}
                  extra={onCreateCalves && !e.is_cancelled && calves.length > 0 ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-primary hover:text-primary"
                      onClick={() => onCreateCalves(e)}
                      title="ثبت گوساله‌ها"
                    >
                      <Baby className="h-3.5 w-3.5" />
                    </Button>
                  ) : null}
                />
              </Td>
            </tr>
          );
        })}
      </tbody>
    </TableShell>
  );
}
