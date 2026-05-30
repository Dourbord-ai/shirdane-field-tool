// CleanTestList — full table for «لیست کلین تست».
// Mirrors every field captured by CleanTestRegistrationDialog so all form
// values are visible directly in the table (no detail dialog needed).
import type { FertilityEvent } from "@/lib/fertility";
import { Badge } from "@/components/ui/badge";
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

// Maps raw stored values (English code or Persian label) to the exact
// Persian label used in the form, plus a colour for the result badge.
function resultBadge(e: FertilityEvent): { label: string; cls: string } | null {
  const raw =
    (pick<string>(e.metadata, "clean_test_result_label") as string | undefined) ||
    (pick<string>(e.metadata, "clean_test_result") as string | undefined) ||
    (e as any).result ||
    "";
  if (!raw) return null;
  const key = String(raw).toLowerCase().trim();
  if (key === "positive" || key === "مثبت") {
    return { label: "مثبت", cls: "bg-emerald-100 text-emerald-700 border-emerald-200" };
  }
  if (key === "under_treatment" || key === "تحت درمان") {
    return { label: "تحت درمان", cls: "bg-amber-100 text-amber-700 border-amber-200" };
  }
  // Fall back to the raw value so nothing is silently dropped.
  return { label: String(raw), cls: "bg-muted text-foreground border-border" };
}

export default function CleanTestList({ events, onEdit, onCancel, resolveUserName }: Props) {
  if (events.length === 0) return <EmptyState text="کلین تستی ثبت نشده است" />;

  return (
    <TableShell>
      {/* Columns mirror CleanTestRegistrationDialog fields:
          تاریخ / ساعت  → event_date + metadata.time
          نتیجه         → metadata.clean_test_result (Persian label)
          بازدید کننده   → operator_name
          توضیحات       → notes */}
      <thead>
        <tr>
          <Th>تاریخ</Th>
          <Th>ساعت</Th>
          <Th>نتیجه</Th>
          <Th>بازدید کننده</Th>
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
          const badge = resultBadge(e);
          return (
            <tr key={e.id} className="border-b border-border last:border-b-0 hover:bg-muted/20">
              <Td>{date}</Td>
              <Td>{time}</Td>
              <Td>
                {badge ? (
                  <Badge variant="outline" className={`${badge.cls} font-medium`}>
                    {badge.label}
                  </Badge>
                ) : null}
              </Td>
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
