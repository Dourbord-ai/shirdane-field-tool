// DryOffList — full table for «لیست خشک کردن».
// Mirrors the structure of HeatList/InseminationList/etc so the dry-off tab
// looks and behaves exactly like the other fertility operation lists.
//
// Supports both the canonical `event_type='dry_off'` and the legacy alias
// `event_type='dry'` (rows from older imports). Both render identically here.
//
// Surfaces every field captured by the DryOffNew form:
//   - تاریخ / ساعت (شمسی)
//   - دلیل خشکی (metadata.dry_off_reason)
//   - وضعیت آبستنی تشخیص خودکار (metadata.auto_detected.is_pregnant)
//   - تاریخ پیش‌بینی زایش (metadata.auto_detected.expected_calving_date — شمسی)
//   - جایگاه مقصد (metadata.auto_detected.destination_location_name)
//   - ثبت‌کننده (operator_name / operator_user_id)
//   - یادداشت (notes)
//   - وضعیت لغو
import type { FertilityEvent } from "@/lib/fertility";
import { formatShamsi } from "@/lib/dateDisplay";
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

// Persian label for the auto-detected pregnancy boolean. Mirrors the wording
// used in the DryOffNew form's read-only auto-detect panel so the table
// reads exactly like the form.
function pregnancyLabel(v: unknown): string {
  if (v === true) return "آبستن";
  if (v === false) return "غیر آبستن";
  return "";
}

export default function DryOffList({ events, onEdit, onCancel, resolveUserName }: Props) {
  if (events.length === 0) return <EmptyState text="رویداد خشک کردن ثبت نشده است" />;

  return (
    <TableShell>
      <thead>
        <tr>
          <Th>تاریخ</Th>
          <Th>ساعت</Th>
          <Th>دلیل خشکی</Th>
          <Th>وضعیت آبستنی</Th>
          <Th>تاریخ پیش‌بینی زایش</Th>
          <Th>جایگاه مقصد</Th>
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

          // Reason is stored directly on metadata.dry_off_reason by the form.
          const reason = pick<string>(e.metadata, "dry_off_reason") || "";

          // Auto-detected info lives in a nested `auto_detected` bag written
          // by DryOffNew at submit time. We defensively read it as an object.
          const auto =
            (pick<Record<string, unknown>>(e.metadata, "auto_detected") as Record<string, unknown> | undefined) || {};
          const pregnancy = pregnancyLabel(auto.is_pregnant);
          const expected =
            typeof auto.expected_calving_date === "string" && auto.expected_calving_date
              ? formatShamsi(auto.expected_calving_date)
              : "";
          const destination =
            typeof auto.destination_location_name === "string" ? auto.destination_location_name : "";

          return (
            <tr key={e.id} className="border-b border-border last:border-b-0 hover:bg-muted/20">
              <Td>{date}</Td>
              <Td>{time}</Td>
              <Td>{reason}</Td>
              <Td>{pregnancy}</Td>
              <Td>{expected}</Td>
              <Td>{destination}</Td>
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
