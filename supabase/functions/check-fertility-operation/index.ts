// Edge function: full timeline-based validation for a fertility operation.
// Returns { allowed: boolean, messages: string[], debug?: any }.
//
// Modes:
//   mode = "insert" (default) — simulate adding a new event
//   mode = "update"           — replace event with id = event_id
//   mode = "delete"           — remove event with id = event_id
//
// Body:
// {
//   cow_id: number,
//   fertility_operation_id: number,   // operation being checked
//   event_date: string (YYYY-MM-DD),  // date of the simulated event
//   fertility_status_id?: number,
//   mode?: "insert" | "update" | "delete",
//   event_id?: string,                // required for update/delete
//   debug?: boolean
// }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Operation IDs (must mirror fertility_operations table)
const OP = {
  Erotic: 1,
  Inoculation: 2,
  Pregnancy1: 3,
  Pregnancy2: 4,
  Abortion: 5,
  Birth: 6,
  Dry: 7,
  Rinse: 8,
  CleanTest: 10,
  Pregnancy3: 11,
  Pregnancy4: 12,
  Sync: 13,
} as const;

const FEMALE_ONLY_OPS = new Set<number>([
  OP.Erotic, OP.Inoculation, OP.Pregnancy1, OP.Pregnancy2, OP.Abortion,
  OP.Birth, OP.Dry, OP.Rinse, OP.CleanTest, OP.Pregnancy3, OP.Pregnancy4, OP.Sync,
]);

interface Body {
  cow_id?: number;
  livestock_id?: number;
  fertility_operation_id?: number;
  event_date?: string;
  event_time?: string | null;
  result_code?: string | null;
  fertility_status_id?: number | null;
  mode?: "insert" | "update" | "delete";
  event_id?: string;
  debug?: boolean;
}

// ---------- Jalali date helpers (mirror src/lib/jalali.ts) ----------
function jalaliToGregorianDays(jy: number, jm: number, jd: number): number {
  // returns absolute day number (used only for diff)
  let jy2 = jy + 1595;
  let days =
    -355668 +
    365 * jy2 +
    Math.floor(jy2 / 33) * 8 +
    Math.floor(((jy2 % 33) + 3) / 4) +
    jd +
    (jm < 7 ? (jm - 1) * 31 : (jm - 7) * 30 + 186);
  return days;
}

function parseDateToDays(s: string | null | undefined): number | null {
  if (!s) return null;
  // Strip time part if present
  const datePart = s.trim().split(/[ T]/)[0];
  // Jalali like 1403/05/12 or 1403-05-12
  const jm = datePart.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (jm) {
    const y = Number(jm[1]);
    const mo = Number(jm[2]);
    const d = Number(jm[3]);
    if (y >= 1300 && y <= 1500) {
      return jalaliToGregorianDays(y, mo, d);
    }
    // Gregorian
    const t = Date.parse(`${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
    if (!Number.isNaN(t)) return Math.round(t / 86_400_000);
  }
  const t = Date.parse(datePart);
  if (!Number.isNaN(t)) return Math.round(t / 86_400_000);
  return null;
}

interface FertilityEvent {
  id: string;
  livestock_id: number;
  fertility_operation_id: number | null;
  fertility_status_id: number | null;
  event_date: string | null;
  event_time: string | null;
  is_cancelled: boolean;
  metadata: Record<string, unknown>;
}

interface FertilityStatus {
  id: number;
  name: string;
  pregnancy_state: string; // pregnant | open | suspect | unknown
  milking_state: string;   // dry | milking | unknown
  is_abortion: boolean;
}

interface Workflow {
  id: string;
  name: string;
  category: number; // 0 all, 1 cow, 2 heifer, 3 male
  start_date: string | null;
  end_date: string | null;
  is_active: boolean;
}

interface Rule {
  id: string;
  workflow_id: string;
  fertility_operation_id: number;
  title: string;
  is_active: boolean;
  duration_of_credit: number | null;
  alert_enabled: boolean;
}

interface Condition {
  id: string;
  rule_id: string;
  condition_type: string;
  min_value: number | null;
  max_value: number | null;
  bool_value: boolean | null;
  text_value: string | null;
  extra_json: Record<string, unknown>;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = (await req.json()) as Body;
    const cow_id = Number(body.cow_id ?? body.livestock_id);
    const op_id = Number(body.fertility_operation_id);
    const event_date = body.event_date;
    const mode = body.mode ?? "insert";
    const debug = !!body.debug;

    if (!cow_id || !op_id || !event_date) {
      return json({ allowed: false, messages: ["اطلاعات ورودی ناقص است"] }, 400);
    }
    if ((mode === "update" || mode === "delete") && !body.event_id) {
      return json({ allowed: false, messages: ["شناسه رویداد برای ویرایش/حذف الزامی است"] }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const messages: string[] = [];

    // --- 1) Cow basic checks
    let cow: any = null;
    let cowErr: any = null;
    {
      const r = await supabase
        .from("cows")
        .select("id, sex, existancestatus, last_fertility_status, is_dry, purchase_date, date_of_birth")
        .eq("id", cow_id)
        .maybeSingle();
      if (r.error) {
        // retry without date_of_birth if column missing
        const r2 = await supabase
          .from("cows")
          .select("id, sex, existancestatus, last_fertility_status, is_dry, purchase_date")
          .eq("id", cow_id)
          .maybeSingle();
        cow = r2.data; cowErr = r2.error;
      } else {
        cow = r.data; cowErr = r.error;
      }
    }
    if (cowErr) return json({ allowed: false, messages: ["خطا در بازیابی اطلاعات دام"] }, 500);
    if (!cow) return json({ allowed: false, messages: ["دام یافت نشد"] });
    if (cow.existancestatus !== 1) {
      return json({ allowed: false, messages: ["این دام در گله موجود نیست و نمی‌توان عملیات باروری ثبت کرد"] });
    }
    if (FEMALE_ONLY_OPS.has(op_id) && cow.sex !== 1) {
      return json({ allowed: false, messages: ["این عملیات فقط برای دام ماده مجاز است"] });
    }

    // --- 2) Load reference data
    const [statusesRes, eventsRes] = await Promise.all([
      supabase.from("fertility_statuses").select("id, name, pregnancy_state, milking_state, is_abortion"),
      supabase
        .from("livestock_fertility_events")
        .select("id, livestock_id, fertility_operation_id, fertility_status_id, event_date, event_time, is_cancelled, metadata")
        .eq("livestock_id", cow_id)
        .eq("is_cancelled", false)
        .order("event_date", { ascending: true }),
    ]);

    if (statusesRes.error || eventsRes.error) {
      return json({ allowed: false, messages: ["خطا در بازیابی داده‌های مرجع"] }, 500);
    }

    const statuses: FertilityStatus[] = (statusesRes.data ?? []) as FertilityStatus[];
    const statusById = new Map(statuses.map((s) => [s.id, s]));

    let timeline: FertilityEvent[] = (eventsRes.data ?? []) as FertilityEvent[];

    // --- 3) Simulate the new event into the timeline
    const simulated: FertilityEvent = {
      id: body.event_id ?? "__simulated__",
      livestock_id: cow_id,
      fertility_operation_id: op_id,
      fertility_status_id: body.fertility_status_id ?? null,
      event_date: event_date,
      event_time: null,
      is_cancelled: false,
      metadata: {},
    };

    if (mode === "delete") {
      timeline = timeline.filter((e) => e.id !== body.event_id);
    } else if (mode === "update") {
      timeline = timeline.filter((e) => e.id !== body.event_id);
      timeline.push(simulated);
    } else {
      // insert: duplicate same op same date => block
      const dup = timeline.some(
        (e) => e.fertility_operation_id === op_id && e.event_date === event_date,
      );
      if (dup) {
        return json({ allowed: false, messages: ["این عملیات قبلاً برای این دام در همین تاریخ ثبت شده است"] });
      }
      timeline.push(simulated);
    }

    timeline.sort((a, b) => {
      const da = parseDateToDays(a.event_date);
      const db = parseDateToDays(b.event_date);
      return (da ?? 0) - (db ?? 0);
    });

    // --- 3.5) Load latest weight (best-effort; table may not exist)
    let weightVal: number | null = null;
    try {
      const { data: weightRow } = await supabase
        .from("livestock_physical_records" as any)
        .select("weight, record_date")
        .eq("livestock_id", cow_id)
        .lte("record_date", event_date)
        .order("record_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      weightVal = (weightRow as any)?.weight ?? null;
    } catch {
      weightVal = null;
    }

    // --- 4) Build context up to (and including) the simulated event date
    const ctx = buildContext(timeline, simulated, statusById, cow);
    ctx.weight = weightVal;
    ctx.date_of_birth = (cow as any)?.date_of_birth ?? null;

    // --- 5) Load active workflows for this cow's category
    const cowCategory = inferCategory(cow, ctx);
    const { data: wfRows, error: wfErr } = await supabase
      .from("breeding_workflows")
      .select("id, name, category, start_date, end_date, is_active")
      .eq("is_active", true);
    if (wfErr) return json({ allowed: false, messages: ["خطا در بازیابی ورکفلوها"] }, 500);

    const workflows: Workflow[] = ((wfRows ?? []) as Workflow[]).filter((w) => {
      if (w.category !== 0 && w.category !== cowCategory) return false;
      const ed = parseDateToDays(event_date);
      const sd = parseDateToDays(w.start_date);
      const edw = parseDateToDays(w.end_date);
      if (sd != null && ed != null && ed < sd) return false;
      if (edw != null && ed != null && ed > edw) return false;
      return true;
    });

    const debugPayload = () => ({
      lastErotic: ctx.lastErotic,
      lastInoculation: ctx.lastInoculation,
      lastSync: ctx.lastSync,
      lastBirth: ctx.lastBirth,
      lastFertilityStatus: ctx.lastFertilityStatus,
      pregnancy_state: ctx.pregnancy_state,
      milking_state: ctx.milking_state,
    });

    if (workflows.length === 0) {
      return json({
        allowed: true,
        messages: ["برای این عملیات قانون فعالی تعریف نشده است."],
        matched_rule_id: null,
        failed_rules: [],
        ...(debug ? { debug: debugPayload() } : {}),
      });
    }

    // --- 6) Load rules + conditions for this op across these workflows
    const wfIds = workflows.map((w) => w.id);
    const { data: ruleRows, error: ruleErr } = await supabase
      .from("breeding_workflow_rules")
      .select("id, workflow_id, fertility_operation_id, title, is_active, duration_of_credit, alert_enabled")
      .in("workflow_id", wfIds)
      .eq("fertility_operation_id", op_id)
      .eq("is_active", true);
    if (ruleErr) return json({ allowed: false, messages: ["خطا در بازیابی قواعد"] }, 500);

    const rules: Rule[] = (ruleRows ?? []) as Rule[];

    if (rules.length === 0) {
      return json({
        allowed: true,
        messages: ["برای این عملیات قانون فعالی تعریف نشده است."],
        matched_rule_id: null,
        failed_rules: [],
        ...(debug ? { debug: debugPayload() } : {}),
      });
    }

    const ruleIds = rules.map((r) => r.id);
    const { data: condRows, error: condErr } = await supabase
      .from("breeding_workflow_rule_conditions")
      .select("id, rule_id, condition_type, min_value, max_value, bool_value, text_value, extra_json")
      .in("rule_id", ruleIds);
    if (condErr) return json({ allowed: false, messages: ["خطا در بازیابی شرایط قواعد"] }, 500);

    const conditionsByRule = new Map<string, Condition[]>();
    for (const c of (condRows ?? []) as Condition[]) {
      const arr = conditionsByRule.get(c.rule_id) ?? [];
      arr.push(c);
      conditionsByRule.set(c.rule_id, arr);
    }

    // --- 7) Evaluate rules: rules = OR, conditions inside a rule = AND
    let matchedRuleId: string | null = null;
    const failedRules: Array<{ rule_id: string; title: string; reasons: string[] }> = [];

    for (const rule of rules) {
      const ruleConds = conditionsByRule.get(rule.id) ?? [];
      let allOk = true;
      const reasons: string[] = [];
      for (const cond of ruleConds) {
        const res = evaluateCondition(cond, ctx);
        if (!res.ok) {
          allOk = false;
          reasons.push(res.message);
        }
      }
      if (allOk) {
        matchedRuleId = rule.id;
        break;
      } else {
        failedRules.push({ rule_id: rule.id, title: rule.title, reasons });
      }
    }

    if (matchedRuleId) {
      messages.push("عملیات مطابق قواعد ورکفلو مجاز است");
      return json({
        allowed: true,
        messages,
        matched_rule_id: matchedRuleId,
        failed_rules: [],
        ...(debug ? { debug: debugPayload() } : {}),
      });
    }

    return json({
      allowed: false,
      messages: [
        "هیچ‌یک از قواعد ورکفلو برای این عملیات برقرار نیست:",
        ...failedRules.map((f) => `«${f.title}»: ${f.reasons.join(" و ")}`),
      ],
      matched_rule_id: null,
      failed_rules: failedRules,
      ...(debug ? { debug: debugPayload() } : {}),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "خطای نامشخص";
    return json({ allowed: false, messages: [msg] }, 500);
  }
});

// ============================================================================
// Context building
// ============================================================================

interface CowCtx {
  id: number;
  sex: number | null;
  is_dry: boolean | null;
  purchase_date: string | null;
}

interface Context {
  cow: CowCtx;
  event_date: string;
  daysSince: (d: string | null | undefined) => number | null;
  daysBetween: (a: string, b: string) => number;

  // Last events
  lastFertilityStatus: FertilityStatus | null;
  lastErotic: FertilityEvent | null;
  lastInoculation: FertilityEvent | null;
  lastPregnancyCheck: FertilityEvent | null;
  lastBirth: FertilityEvent | null;
  lastSync: FertilityEvent | null;
  lastAbortion: FertilityEvent | null;
  lastDry: FertilityEvent | null;

  // Derived
  pregnancy_state: string; // pregnant | open | suspect | unknown
  milking_state: string;   // dry | milking | unknown
  pregnancyDays: number | null;
  dateOfPregnancy: string | null;

  // Optional / not available in this DB
  weight: number | null;
  milkAvg: number | null;
  date_of_birth: string | null;

  // Whole timeline (up to the event being evaluated, inclusive)
  history: FertilityEvent[];
}

function buildContext(
  timeline: FertilityEvent[],
  simulated: FertilityEvent,
  statusById: Map<number, FertilityStatus>,
  cow: { id: number; sex: number | null; is_dry: boolean | null; purchase_date: string | null },
): Context {
  const evDate = simulated.event_date!;
  // History = events strictly before the simulated event (so we evaluate the
  // simulated event against the state produced by everything that came before).
  const evDay = parseDateToDays(evDate);
  const history = timeline.filter((e) => {
    if (!e.event_date) return false;
    const d = parseDateToDays(e.event_date);
    if (d == null || evDay == null) return false;
    if (d < evDay) return true;
    if (d === evDay && e.id !== simulated.id) return true;
    return false;
  });

  const findLastByOps = (ops: number[]) => {
    for (let i = history.length - 1; i >= 0; i--) {
      const ev = history[i];
      if (ev.fertility_operation_id != null && ops.includes(ev.fertility_operation_id)) return ev;
    }
    return null;
  };

  const lastErotic = findLastByOps([OP.Erotic]);
  const lastInoculation = findLastByOps([OP.Inoculation]);
  const lastPregnancyCheck = findLastByOps([OP.Pregnancy1, OP.Pregnancy2, OP.Pregnancy3, OP.Pregnancy4]);
  const lastBirth = findLastByOps([OP.Birth]);
  const lastSync = findLastByOps([OP.Sync]);
  const lastAbortion = findLastByOps([OP.Abortion]);
  const lastDry = findLastByOps([OP.Dry]);

  // Last status: walk backward to find the first event that carries a status id
  let lastFertilityStatus: FertilityStatus | null = null;
  for (let i = history.length - 1; i >= 0; i--) {
    const sid = history[i].fertility_status_id;
    if (sid != null) {
      lastFertilityStatus = statusById.get(sid) ?? null;
      if (lastFertilityStatus) break;
    }
  }
  // Fallback to cow.last_fertility_status if no event-based status
  if (!lastFertilityStatus && (cow as any).last_fertility_status != null) {
    lastFertilityStatus = statusById.get(Number((cow as any).last_fertility_status)) ?? null;
  }

  const pregnancy_state = lastFertilityStatus?.pregnancy_state ?? "unknown";
  const milking_state = lastFertilityStatus?.milking_state ?? (cow.is_dry ? "dry" : "unknown");

  // pregnancyDays: days since last positive insemination if currently pregnant
  let pregnancyDays: number | null = null;
  let dateOfPregnancy: string | null = null;
  if (pregnancy_state === "pregnant" && lastInoculation?.event_date) {
    // ensure no birth/abortion happened after that insemination
    const after = history.filter(
      (e) =>
        e.event_date! > lastInoculation.event_date! &&
        (e.fertility_operation_id === OP.Birth || e.fertility_operation_id === OP.Abortion),
    );
    if (after.length === 0) {
      dateOfPregnancy = lastInoculation.event_date;
      pregnancyDays = daysBetween(lastInoculation.event_date!, evDate);
    }
  }

  const daysSince = (d: string | null | undefined): number | null => {
    if (!d) return null;
    return daysBetween(d, evDate);
  };

  return {
    cow,
    event_date: evDate,
    daysSince,
    daysBetween,
    lastFertilityStatus,
    lastErotic,
    lastInoculation,
    lastPregnancyCheck,
    lastBirth,
    lastSync,
    lastAbortion,
    lastDry,
    pregnancy_state,
    milking_state,
    pregnancyDays,
    dateOfPregnancy,
    weight: null,
    milkAvg: null,
    date_of_birth: null,
    history,
  };
}

function inferCategory(
  cow: { sex: number | null },
  ctx: Context,
): number {
  // 1 cow (دام شیری/زایش‌کرده), 2 heifer (تلیسه), 3 male
  if (cow.sex === 2) return 3;
  if (ctx.lastBirth) return 1;
  return 2;
}

// ============================================================================
// Condition evaluation
// ============================================================================

interface EvalResult {
  ok: boolean;
  message: string;
}

function evaluateCondition(c: Condition, ctx: Context): EvalResult {
  switch (c.condition_type) {
    case "Weight": {
      if (ctx.weight == null) {
        return { ok: false, message: "اطلاعات وزن برای این دام ثبت نشده است" };
      }
      return evalRange(ctx.weight, c, "وزن", "کیلوگرم", true);
    }
    case "MilkRecord":
      return evalRange(ctx.milkAvg, c, "میانگین رکورد شیر", "کیلوگرم", true);
    case "PregnancyDays":
      return evalRange(ctx.pregnancyDays, c, "روزهای آبستنی", "روز", false);
    case "FertilityStatus": {
      const wanted = parseIdList(
        c.text_value,
        (c.extra_json as any)?.status_ids ?? (c.extra_json as any)?.ids ?? (c.extra_json as any)?.ConditionFertilityStatusId,
      );
      const cur = ctx.lastFertilityStatus?.id ?? null;
      if (wanted.length === 0) return { ok: true, message: "" };
      if (cur != null && wanted.includes(cur)) return { ok: true, message: "" };
      return { ok: false, message: `وضعیت باروری فعلی (${ctx.lastFertilityStatus?.name ?? "نامشخص"}) مجاز نیست` };
    }
    case "Sync": {
      const lastSync = ctx.lastSync;
      const lastStatusId = ctx.lastFertilityStatus?.id ?? null;
      if (c.bool_value === true) {
        if (!lastSync) {
          return { ok: false, message: "هیچ همزمان‌سازی قبلی ثبت نشده است" };
        }
        if (lastStatusId !== 21) {
          return { ok: false, message: "دام در وضعیت مجاز برای سینک نیست" };
        }
        return { ok: true, message: "" };
      }
      const days = ctx.daysSince(lastSync?.event_date);
      return evalDaysSinceOrBool(days, c, "همزمان‌سازی فحلی");
    }
    case "Erotic":
      return evalDaysSinceOrBool(ctx.daysSince(ctx.lastErotic?.event_date), c, "فحلی");
    case "Inoculation":
      return evalDaysSinceOrBool(ctx.daysSince(ctx.lastInoculation?.event_date), c, "تلقیح");
    case "Birth":
      return evalDaysSinceOrBool(ctx.daysSince(ctx.lastBirth?.event_date), c, "زایش");
    case "DateOfBirth":
      return evalRange(ctx.daysSince(ctx.date_of_birth), c, "سن دام", "روز", true);
    case "DateOfPregnancy":
      return evalRange(ctx.daysSince(ctx.dateOfPregnancy), c, "روزهای آبستنی", "روز", false);
    case "IsPregnancy": {
      const want = c.bool_value ?? true;
      const isPreg = ctx.pregnancy_state === "pregnant";
      if (isPreg === want) return { ok: true, message: "" };
      return { ok: false, message: want ? "دام آبستن نیست" : "دام آبستن است" };
    }
    case "IsDry": {
      const want = c.bool_value ?? true;
      const isDry = ctx.milking_state === "dry";
      if (isDry === want) return { ok: true, message: "" };
      return { ok: false, message: want ? "دام خشک نیست" : "دام خشک است" };
    }
    default:
      // Unknown condition types do not block
      return { ok: true, message: "" };
  }
}

function evalRange(
  value: number | null,
  c: Condition,
  label: string,
  unit: string,
  warnIfNull: boolean,
): EvalResult {
  if (value == null) {
    // Data missing — be permissive but warn via the rule message path.
    return warnIfNull
      ? { ok: false, message: `${label} برای این دام در دسترس نیست` }
      : { ok: false, message: `${label} قابل محاسبه نیست` };
  }
  if (c.min_value != null && value < Number(c.min_value)) {
    return { ok: false, message: `${label} (${value} ${unit}) کمتر از حد مجاز ${c.min_value} است` };
  }
  if (c.max_value != null && value > Number(c.max_value)) {
    return { ok: false, message: `${label} (${value} ${unit}) بیشتر از حد مجاز ${c.max_value} است` };
  }
  return { ok: true, message: "" };
}

function evalDaysSinceOrBool(
  daysSince: number | null,
  c: Condition,
  label: string,
): EvalResult {
  // bool mode: must have happened (true) or must NOT have happened (false)
  if (c.bool_value != null && c.min_value == null && c.max_value == null) {
    const happened = daysSince != null;
    if (happened === c.bool_value) return { ok: true, message: "" };
    return {
      ok: false,
      message: c.bool_value
        ? `${label} قبلاً ثبت نشده است`
        : `${label} قبلاً ثبت شده و مجاز نیست`,
    };
  }
  // window mode: require min/max days since last occurrence
  if (daysSince == null) {
    return { ok: false, message: `${label} قبلی برای این دام ثبت نشده است` };
  }
  if (c.min_value != null && daysSince < Number(c.min_value)) {
    return { ok: false, message: `از آخرین ${label} فقط ${daysSince} روز گذشته (حداقل ${c.min_value} روز نیاز است)` };
  }
  if (c.max_value != null && daysSince > Number(c.max_value)) {
    return { ok: false, message: `از آخرین ${label} ${daysSince} روز گذشته (حداکثر مجاز ${c.max_value} روز است)` };
  }
  return { ok: true, message: "" };
}

function parseIdList(text: string | null, extra: unknown): number[] {
  const out: number[] = [];
  const pushAll = (val: unknown) => {
    if (val == null) return;
    if (Array.isArray(val)) {
      for (const v of val) {
        const n = Number(v);
        if (Number.isFinite(n)) out.push(n);
      }
    } else if (typeof val === "string") {
      for (const part of val.split(/[,\-\s]+/)) {
        const n = Number(part.trim());
        if (Number.isFinite(n)) out.push(n);
      }
    } else if (typeof val === "number") {
      if (Number.isFinite(val)) out.push(val);
    }
  };
  pushAll(extra);
  pushAll(text);
  return out;
}

function daysBetween(a: string, b: string): number {
  const da = parseDateToDays(a);
  const db = parseDateToDays(b);
  if (da == null || db == null) return 0;
  return db - da;
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
