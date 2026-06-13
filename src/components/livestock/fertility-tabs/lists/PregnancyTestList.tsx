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
// Mapping from the structured business key (fertility_operation_id) to the
// user-facing «شماره تست» label. This is the PRIMARY source of truth.
// 3=اولیه, 4=نهایی, 11=تکمیلی, 12=خشکی — defined by the dairy ops catalog.
const OP_ID_LABELS: Record<number, string> = {
  3: "تست اولیه",
  4: "تست نهایی",
  11: "تست تکمیلی",
  12: "تست خشکی",
};

// Legacy fallback: older rows wrote the type only into metadata.test_type.
// Kept for backward compatibility — never used when fertility_operation_id
// is present.
const TEST_NUMBER_LABELS: Record<string, string> = {
  initial: "تست اولیه",
  final: "تست نهایی",
  extra: "تست تکمیلی",
  dry: "تست خشکی",
};

// Normalize any stored result value (Persian, English, legacy variants) to
// a single canonical key so we can render a consistent colored badge.
// Source of truth: registration form writes the Persian label into `result`
// and the English code into `metadata.result`. Older rows may have stored
// either form, so we accept both.
type ResultKind = "positive" | "negative" | "suspicious";
function normalizeResult(raw: string): ResultKind | null {
  const v = raw.trim().toLowerCase();
  if (!v) return null;
  if (v === "positive" || v === "مثبت") return "positive";
  if (v === "negative" || v === "منفی") return "negative";
  if (v === "suspicious" || v === "suspect" || v === "مشکوک") return "suspicious";
  return null;
}

const RESULT_BADGE: Record<ResultKind, { label: string; className: string }> = {
  // سبز/قرمز/زرد طبق گاید برند داشبورد. از توکن‌های موجود استفاده می‌کنیم
  // تا در تم تاریک هم خوانا باشد.
  positive: { label: "مثبت", className: "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30" },
  negative: { label: "منفی", className: "bg-red-500/15 text-red-300 border border-red-500/30" },
  suspicious: { label: "مشکوک", className: "bg-amber-500/15 text-amber-300 border border-amber-500/30" },
};

function ResultBadge({ value }: { value: string }) {
  const kind = normalizeResult(value);
  if (!kind) {
    // مقدار ناشناخته را به‌صورت متن خام نشان می‌دهیم تا داده‌ای پنهان نشود.
    return <span className="text-muted-foreground">{value || "—"}</span>;
  }
  const cfg = RESULT_BADGE[kind];
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${cfg.className}`}>
      {cfg.label}
    </span>
  );
}

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
          // Priority chain per business rule:
          //  1) fertility_operation_id (structured business key — preferred)
          //  2) metadata.test_type (legacy fallback for old rows)
          //  3) «نامشخص» when neither is present
          const opId = e.fertility_operation_id ?? null;
          const legacyType = pick<string>(e.metadata, "test_type");
          const testNumber =
            (opId != null && OP_ID_LABELS[opId]) ||
            (legacyType && (TEST_NUMBER_LABELS[legacyType] ?? legacyType)) ||
            "نامشخص";
          
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
              
              <Td><ResultBadge value={result} /></Td>
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
