// PregnancyTestList — full table for «لیست تست آبستنی».
// Surfaces every field collected by PregnancyTestRegistrationDialog:
// test number (initial/final/extra/dry), method, result, vet, notes.
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

// Map the internal test_type code to the user-facing «test number» label the
// form actually uses: تست اول / دوم / سوم / چهارم. This lives next to the
// list because it is purely a presentation concern.
const TEST_NUMBER_LABELS: Record<string, string> = {
  initial: "تست اول",
  final: "تست دوم",
  extra: "تست سوم",
  dry: "تست چهارم (خشکی)",
};

export default function PregnancyTestList({ events, onEdit, onCancel, resolveUserName }: Props) {
  if (events.length === 0) return <EmptyState text="تست آبستنی ثبت نشده است" />;

  return (
    <TableShell>
      {/* Columns:
          شماره تست → metadata.test_type → TEST_NUMBER_LABELS
          روش تست  → metadata.test_type_label (دامپزشک / سونوگرافی / ...)
          نتیجه    → result (column) or metadata.result_label
          دامپزشک  → metadata.doctor_name / metadata.vet_name / operator_name
          یادداشت  → notes */}
      <thead>
        <tr>
          <Th>تاریخ</Th>
          <Th>ساعت</Th>
          <Th>شماره تست</Th>
          
          <Th>نتیجه</Th>
          <Th>دامپزشک / ثبت‌کننده</Th>
          <Th>یادداشت</Th>
          <Th>وضعیت</Th>
          <Th className="text-left">عملیات</Th>
        </tr>
      </thead>
      <tbody>
        {events.map((e) => {
          const { date, time } = formatEventDateTime(e.event_date, pick(e.metadata, "time"));
          const testType = pick<string>(e.metadata, "test_type");
          const testNumber = testType ? TEST_NUMBER_LABELS[testType] ?? testType : "";
          
          const result = e.result || pick<string>(e.metadata, "result_label") || "";
          const vet =
            pick<string>(e.metadata, "doctor_name") ||
            pick<string>(e.metadata, "vet_name") ||
            e.operator_name ||
            (resolveUserName ? resolveUserName(e.operator_user_id) : null) ||
            "";
          return (
            <tr key={e.id} className="border-b border-border last:border-b-0 hover:bg-muted/20">
              <Td>{date}</Td>
              <Td>{time}</Td>
              <Td>{testNumber}</Td>
              
              <Td>{result}</Td>
              <Td>{vet}</Td>
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
