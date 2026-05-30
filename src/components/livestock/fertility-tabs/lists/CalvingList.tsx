// CalvingList — full table for «لیست زایش».
// Renders every field captured by the calving form plus a dedicated
// "اطلاعات گوساله‌ها" column that lists each calf born in this event
// (gender, status, ear/body number, link to created cow when available).
// This restores the per-calf detail that used to live in the card-style
// CalvesPanel before the lists were converted to tables.
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Baby, ExternalLink } from "lucide-react";
import type { FertilityEvent } from "@/lib/fertility";
import { existanceLabel, isFemaleCow } from "@/lib/cowPresence";
import type { CalfLiveInfo } from "@/components/livestock/FertilitySection";
import {
  TableShell, Th, Td, RowActions, EmptyState,
  formatEventDateTime, pick, yesNo, CancelBadge,
} from "./shared";

// Per-calf entry inside metadata.calves[] as written by CalvingRegistrationDialog.
// Kept local because only this list consumes the full shape.
interface CalfMeta {
  index?: number;
  gender?: "male" | "female" | string;
  gender_label?: string;
  physical_status?: "alive" | "healthy" | "dead" | string;
  physical_status_label?: string;
  body_number?: string | null;
  ear_number?: string | null;
  birth_weight?: number | null;
  notes?: string | null;
  created_cow_id?: number | null;
}

interface Props {
  events: FertilityEvent[];
  onEdit?: (e: FertilityEvent) => void;
  onCancel?: (e: FertilityEvent) => void;
  onCreateCalves?: (e: FertilityEvent) => void;
  resolveUserName?: (v: number | string | null | undefined) => string | null;
  // Map of created_cow_id → live cow snapshot. When provided we prefer the
  // live row over metadata so the table reflects current sex/status (e.g.
  // a calf that died after birth shows the current existancestatus).
  calfLiveMap?: Map<number, CalfLiveInfo>;
}

// A single calf rendered inside the table cell. Mirrors the chip logic from
// CalvesPanel but in a compact, multi-line format suitable for a table row.
function CalfLine({ c, idx, liveMap }: { c: CalfMeta; idx: number; liveMap?: Map<number, CalfLiveInfo> }) {
  // Prefer the live cow record when this calf was already converted to a dam.
  const live = c?.created_cow_id ? liveMap?.get(Number(c.created_cow_id)) : undefined;

  // Identifier: live tag/ear first, then metadata ear/body number.
  const ear =
    live?.tag_number ??
    (live?.earnumber != null ? String(live.earnumber) : null) ??
    c?.ear_number ??
    (c?.body_number ? `بدن ${c.body_number}` : null);

  // Sex label — live truth wins, otherwise metadata label / coded gender.
  const sexText = live
    ? isFemaleCow(live) ? "ماده" : "نر"
    : c?.gender_label ||
      (c?.gender === "female" ? "ماده" : c?.gender === "male" ? "نر" : null);

  // Status: live existancestatus, otherwise metadata physical_status(_label).
  const isDead = c?.physical_status === "dead";
  const statusText = live
    ? existanceLabel(live.existancestatus)
    : isDead
      ? "تلف شده / مرده‌زا"
      : c?.physical_status_label ||
        (c?.physical_status === "alive" || c?.physical_status === "healthy" ? "زنده" : null);

  // Tone for the small status chip.
  const aliveTone = live
    ? live.existancestatus == null || live.existancestatus === 0
    : !isDead;
  const toneClass = aliveTone
    ? "text-primary"
    : "text-destructive";

  // Body of the row — clickable when linked to a real cow.
  const body = (
    <>
      <span className="font-semibold">گوساله {(idx + 1).toLocaleString("fa-IR")}:</span>{" "}
      {sexText && <span>{sexText}</span>}
      {statusText && <span className={`mx-1 ${toneClass}`}>• {statusText}</span>}
      {ear && (
        <span className="opacity-80">
          • <span dir="ltr">{ear}</span>
        </span>
      )}
      {/* Explicitly tell the user when an alive calf has not been turned into
          a cow record yet — requested by the spec. Dead/stillborn calves
          skip this message entirely (no cow creation expected). */}
      {!live && !isDead && (
        <span className="mx-1 text-[10px] text-muted-foreground">• هنوز به دام تبدیل نشده</span>
      )}
      {live && <ExternalLink className="inline w-3 h-3 mr-1 opacity-70" />}
      {c?.notes && (
        <div className="text-[10px] text-muted-foreground mt-0.5 whitespace-pre-wrap">
          {c.notes}
        </div>
      )}
    </>
  );

  return live ? (
    <Link
      to={`/livestock/${live.id}`}
      className="block text-[11px] hover:opacity-80 transition-opacity"
      title="مشاهده پروفایل گوساله"
    >
      {body}
    </Link>
  ) : (
    <div className="text-[11px]">{body}</div>
  );
}

export default function CalvingList({
  events, onEdit, onCancel, onCreateCalves, resolveUserName, calfLiveMap,
}: Props) {
  if (events.length === 0) return <EmptyState text="رویداد زایش ثبت نشده است" />;

  return (
    <TableShell>
      <thead>
        <tr>
          <Th>تاریخ</Th>
          <Th>ساعت</Th>
          <Th>دوره</Th>
          <Th>تعداد گوساله</Th>
          {/* Single rich column that lists every calf for this event so
              multi-birth records (twins/triplets) are fully visible. */}
          <Th>اطلاعات گوساله‌ها</Th>
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
          const calves = (pick<CalfMeta[]>(e.metadata, "calves") ?? []) as CalfMeta[];
          const operator =
            e.operator_name ||
            (resolveUserName ? resolveUserName(e.operator_user_id) : null) ||
            "";
          return (
            <tr key={e.id} className="border-b border-border last:border-b-0 hover:bg-muted/20 align-top">
              <Td>{date}</Td>
              <Td>{time}</Td>
              <Td>{pick<number>(e.metadata, "period")}</Td>
              <Td>{pick<number>(e.metadata, "calf_count") ?? calves.length}</Td>
              <Td className="min-w-[220px] max-w-[320px]">
                {calves.length === 0 ? (
                  <span className="text-[11px] text-amber-400">
                    رکورد گوساله ثبت نشده است
                  </span>
                ) : (
                  <div className="space-y-1">
                    {calves.map((c, idx) => (
                      <CalfLine key={idx} c={c} idx={idx} liveMap={calfLiveMap} />
                    ))}
                  </div>
                )}
              </Td>
              <Td>{pick<string>(e.metadata, "calving_condition_label")}</Td>
              <Td>{yesNo(pick(e.metadata, "is_helped"))}</Td>
              <Td>{pick<string>(e.metadata, "caregiver_name")}</Td>
              <Td>{operator}</Td>
              <Td className="max-w-[200px] whitespace-pre-wrap">{e.notes}</Td>
              <Td><CancelBadge e={e} /></Td>
              <Td className="text-left">
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
