// InseminationList — full table for «لیست تلقیح».
// Surfaces every field collected by InseminationRegistrationDialog so users
// can read sperm/male-cow, technician, dose info, second-insemination, etc.
// directly from the list — no Details modal required.
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

export default function InseminationList({ events, onEdit, onCancel, resolveUserName }: Props) {
  if (events.length === 0) return <EmptyState text="تلقیحی ثبت نشده است" />;

  return (
    <TableShell>
      {/* Columns mirror InseminationRegistrationDialog:
          نوع تلقیح    → metadata.insemination_type_label
          اسپرم        → metadata.sperm_label  (when sperm-based)
          کد گاو نر    → metadata.male_cow_label (when natural)
          نوع مصرف     → metadata.sperm_usage_type_label
          نیاز به تلقیح دوم → metadata.needs_reinjection
          تلقیح دوم    → metadata.second_insemination.{date,time}
          داروی کمکی   → metadata.helper_medicines
          تکنسین/ثبت‌کننده → operator_name */}
      <thead>
        <tr>
          <Th>تاریخ</Th>
          <Th>ساعت</Th>
          <Th>نوع تلقیح</Th>
          <Th>اسپرم</Th>
          <Th>کد گاو نر</Th>
          <Th>نوع مصرف</Th>
          <Th>نیاز به تلقیح دوم</Th>
          <Th>تلقیح دوم</Th>
          <Th>داروی کمکی</Th>
          <Th>تکنسین</Th>
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
          // second_insemination is a nested object — flatten it to a short label
          // ("1404/03/02  06:30") so the table stays one cell wide per column.
          const second = pick<{ date?: string; time?: string; sperm_usage_type_label?: string }>(
            e.metadata,
            "second_insemination",
          );
          const secondLabel = second
            ? [second.date, second.time].filter(Boolean).join("  ")
            : "";
          return (
            <tr key={e.id} className="border-b border-border last:border-b-0 hover:bg-muted/20">
              <Td>{date}</Td>
              <Td>{time}</Td>
              <Td>{pick<string>(e.metadata, "insemination_type_label")}</Td>
              <Td>{pick<string>(e.metadata, "sperm_label")}</Td>
              <Td>{pick<string>(e.metadata, "male_cow_label")}</Td>
              <Td>{pick<string>(e.metadata, "sperm_usage_type_label")}</Td>
              <Td>{yesNo(pick(e.metadata, "needs_reinjection"))}</Td>
              <Td>{secondLabel}</Td>
              <Td className="max-w-[160px] whitespace-pre-wrap">{pick<string>(e.metadata, "helper_medicines")}</Td>
              <Td>{operator}</Td>
              <Td className="max-w-[200px] whitespace-pre-wrap">{e.notes}</Td>
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
