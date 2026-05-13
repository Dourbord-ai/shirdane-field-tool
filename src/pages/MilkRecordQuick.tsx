import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence, PanInfo } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { getSession } from "@/lib/auth";
import { toast } from "sonner";
import {
  ArrowLeft,
  Sunrise,
  Sun,
  Moon,
  Check,
  Loader2,
  Wifi,
  WifiOff,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Plus,
} from "lucide-react";
import { todayJalali, formatJalali, gregorianToJalali, toPersianDigits } from "@/lib/jalali";
import { getShamsiToday } from "@/lib/shamsiNow";
// Real photographic backgrounds for the two registration modes — the single mode
// uses a close-up of one cow being milked, the batch mode uses a full milking parlor.
import milkBgSingle from "@/assets/milk-bg-single.jpg";
import milkBgBatch from "@/assets/milk-bg-batch.jpg";
import { Users, User } from "lucide-react";

type Period = 1 | 2 | 3;

type LocalEntry = {
  localId: string;
  remoteId?: number;
  livestock_id: number;
  ear_tag: string;
  cow_label: string;
  milk_amount: number;
  period: Period;
  record_date: string; // ISO
  status: "synced" | "pending" | "error";
  created_at: number;
};

const PERIOD_META: Record<Period, { label: string; icon: React.ReactNode; gradient: string; ring: string; accent: string; text: string }> = {
  1: {
    label: "صبح",
    icon: <Sunrise className="w-5 h-5" />,
    // sunrise warm orange + soft blue
    gradient:
      "linear-gradient(160deg, #fed7aa 0%, #fdba74 18%, #fb923c 38%, #fcd34d 58%, #93c5fd 88%, #bfdbfe 100%)",
    ring: "ring-orange-300/50",
    accent: "from-orange-500 to-amber-500",
    text: "text-orange-950",
  },
  2: {
    label: "ظهر",
    icon: <Sun className="w-5 h-5" />,
    gradient:
      "linear-gradient(180deg, #bae6fd 0%, #7dd3fc 30%, #38bdf8 70%, #e0f2fe 100%)",
    ring: "ring-sky-300/50",
    accent: "from-sky-500 to-cyan-500",
    text: "text-sky-950",
  },
  3: {
    label: "شب",
    icon: <Moon className="w-5 h-5" />,
    gradient:
      "linear-gradient(180deg, #0b1437 0%, #1e1b4b 35%, #312e81 70%, #1e293b 100%)",
    ring: "ring-indigo-400/40",
    accent: "from-indigo-500 to-violet-600",
    text: "text-slate-100",
  },
};

function detectPeriod(): Period {
  const h = new Date().getHours();
  if (h < 11) return 1;
  if (h < 17) return 2;
  return 3;
}

function todayIso(): string {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}

const QUEUE_KEY = "milk_record_quick_queue_v1";

function loadQueue(): LocalEntry[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as LocalEntry[];
  } catch {
    return [];
  }
}
function saveQueue(q: LocalEntry[]) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(q.slice(-100)));
}

export default function MilkRecordQuick() {
  const navigate = useNavigate();
  const session = getSession();
  const userId = session.user?.id ?? null;

  const [period, setPeriod] = useState<Period>(detectPeriod());
  const [earTag, setEarTag] = useState("");
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [entries, setEntries] = useState<LocalEntry[]>(() => loadQueue());
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const [online, setOnline] = useState(typeof navigator !== "undefined" ? navigator.onLine : true);
  const [successPulse, setSuccessPulse] = useState(0);
  const earRef = useRef<HTMLInputElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);

  const meta = PERIOD_META[period];
  const isNight = period === 3;

  // online listeners
  useEffect(() => {
    const on = () => { setOnline(true); flushQueue(); };
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // persist queue
  useEffect(() => { saveQueue(entries); }, [entries]);

  // initial focus
  useEffect(() => { earRef.current?.focus(); }, []);

  const todayInfo = useMemo(() => getShamsiToday(new Date()), []);
  const todayLabel = useMemo(() => toPersianDigits(formatJalali(todayJalali())), []);

  const editing = activeIdx !== null ? entries[activeIdx] : null;

  // Lookup cow by ear tag
  async function findCow(tag: string): Promise<{ id: number; label: string } | { error: string }> {
    const num = Number(tag.replace(/[^\d]/g, ""));
    if (!num) return { error: "شماره گوش نامعتبر" };
    const { data, error } = await (supabase as any)
      .from("cows")
      .select("id, earnumber, bodynumber, sex, existancestatus")
      .eq("earnumber", num)
      .limit(1);
    if (error) return { error: "خطا در جستجوی دام" };
    const cow = data?.[0];
    if (!cow) return { error: "دامی با این شماره گوش یافت نشد" };
    if (cow.sex !== 0) return { error: "این دام ماده نیست" };
    if (cow.existancestatus !== null && cow.existancestatus !== 0)
      return { error: "این دام در گله فعال نیست" };
    const label = `گوش ${cow.earnumber}${cow.bodynumber ? ` • بدنه ${cow.bodynumber}` : ""}`;
    return { id: Number(cow.id), label };
  }

  async function flushQueue() {
    const pending = entries.filter((e) => e.status !== "synced");
    if (!pending.length) return;
    const updated = [...entries];
    for (const e of pending) {
      const idx = updated.findIndex((x) => x.localId === e.localId);
      if (idx < 0) continue;
      try {
        const { data, error } = await (supabase as any)
          .from("livestock_milk_records")
          .insert({
            livestock_id: e.livestock_id,
            milk_amount: e.milk_amount,
            record_date: e.record_date,
            period: e.period,
            registered_user_id: userId ?? null,
          })
          .select("id")
          .single();
        if (error) throw error;
        updated[idx] = { ...updated[idx], status: "synced", remoteId: data.id };
      } catch {
        updated[idx] = { ...updated[idx], status: "error" };
      }
    }
    setEntries(updated);
  }

  async function handleSubmit() {
    if (submitting) return;
    if (editing) return handleUpdate();
    const tag = earTag.trim();
    const amt = parseFloat(amount.replace(",", "."));
    if (!tag) { toast.error("شماره گوش را وارد کنید"); earRef.current?.focus(); return; }
    if (!amt || amt <= 0) { toast.error("مقدار شیر معتبر نیست"); amountRef.current?.focus(); return; }

    setSubmitting(true);
    const cow = await findCow(tag);
    if ("error" in cow) {
      toast.error(cow.error);
      setSubmitting(false);
      earRef.current?.focus();
      earRef.current?.select();
      return;
    }

    // duplicate guard within session (same cow + period + date not yet edited)
    const dup = entries.find(
      (e) => e.livestock_id === cow.id && e.period === period && e.record_date === todayIso(),
    );
    if (dup) {
      toast.error("برای این دام در این نوبت قبلاً ثبت شده است");
      setSubmitting(false);
      return;
    }

    const localId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const newEntry: LocalEntry = {
      localId,
      livestock_id: cow.id,
      ear_tag: tag,
      cow_label: cow.label,
      milk_amount: amt,
      period,
      record_date: todayIso(),
      status: online ? "pending" : "pending",
      created_at: Date.now(),
    };
    setEntries((prev) => [...prev, newEntry]);

    // optimistic clear
    setEarTag("");
    setAmount("");
    setSuccessPulse((n) => n + 1);
    setTimeout(() => earRef.current?.focus(), 50);

    if (online) {
      try {
        const { data, error } = await (supabase as any)
          .from("livestock_milk_records")
          .insert({
            livestock_id: cow.id,
            milk_amount: amt,
            record_date: todayIso(),
            period,
            registered_user_id: userId ?? null,
          })
          .select("id")
          .single();
        if (error) throw error;
        setEntries((prev) =>
          prev.map((e) => (e.localId === localId ? { ...e, status: "synced", remoteId: data.id } : e)),
        );
      } catch (err: any) {
        const msg = err?.message?.includes("uq_") || err?.code === "23505"
          ? "رکورد تکراری در دیتابیس"
          : "ذخیره ناموفق - در صف باقی ماند";
        toast.error(msg);
        setEntries((prev) =>
          prev.map((e) => (e.localId === localId ? { ...e, status: "error" } : e)),
        );
      }
    }
    setSubmitting(false);
  }

  async function handleUpdate() {
    if (!editing) return;
    const amt = parseFloat(amount.replace(",", "."));
    if (!amt || amt <= 0) { toast.error("مقدار شیر معتبر نیست"); return; }
    setSubmitting(true);
    const updatedLocal: LocalEntry = { ...editing, milk_amount: amt, period };
    setEntries((prev) => prev.map((e) => (e.localId === editing.localId ? updatedLocal : e)));
    if (editing.remoteId) {
      const { error } = await (supabase as any)
        .from("livestock_milk_records")
        .update({ milk_amount: amt, period })
        .eq("id", editing.remoteId);
      if (error) toast.error("ویرایش ناموفق بود");
      else toast.success("ویرایش ذخیره شد");
    }
    setSubmitting(false);
    setActiveIdx(null);
    setEarTag("");
    setAmount("");
    setTimeout(() => earRef.current?.focus(), 50);
  }

  function openHistory(idx: number) {
    const e = entries[idx];
    if (!e) return;
    setActiveIdx(idx);
    setEarTag(e.ear_tag);
    setAmount(String(e.milk_amount));
    setPeriod(e.period);
  }

  function closeHistory() {
    setActiveIdx(null);
    setEarTag("");
    setAmount("");
    setTimeout(() => earRef.current?.focus(), 50);
  }

  function nav(delta: 1 | -1) {
    if (activeIdx === null) {
      if (delta === -1 && entries.length) openHistory(entries.length - 1);
      return;
    }
    const next = activeIdx + delta;
    if (next < 0) return;
    if (next >= entries.length) { closeHistory(); return; }
    openHistory(next);
  }

  function onPan(_: any, info: PanInfo) {
    if (Math.abs(info.offset.x) < 60) return;
    if (info.offset.x > 0) nav(-1); // swipe right -> previous (RTL)
    else nav(1);
  }

  const totalForPeriod = useMemo(
    () => entries.filter((e) => e.period === period).reduce((s, e) => s + e.milk_amount, 0),
    [entries, period],
  );
  const countForPeriod = entries.filter((e) => e.period === period).length;
  const pendingCount = entries.filter((e) => e.status !== "synced").length;

  return (
    <div
      dir="rtl"
      className={`min-h-screen w-full overflow-y-auto transition-colors duration-700 ${isNight ? "text-slate-100" : "text-slate-900"}`}
      style={{ background: meta.gradient }}
    >
      {/* Animated atmosphere overlays */}
      <AtmosphereLayer period={period} />

      {/* Top bar */}
      <div className="relative z-10 flex items-center justify-between px-4 pt-4">
        <button
          onClick={() => navigate(-1)}
          className={`backdrop-blur-md ${isNight ? "bg-white/10" : "bg-white/40"} rounded-full p-2.5 active:scale-90 transition`}
          aria-label="بازگشت"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="text-center leading-tight">
          <div className="text-xl font-black tracking-wide">{todayInfo.weekdayName}</div>
          <div className="text-base font-bold opacity-90">{todayLabel}</div>
          <div className="text-[11px] opacity-70 mt-0.5">ثبت رکورد شیر</div>
        </div>
        <div className={`backdrop-blur-md ${isNight ? "bg-white/10" : "bg-white/40"} rounded-full p-2.5 flex items-center gap-1`}>
          {online ? <Wifi className="w-4 h-4 text-emerald-600" /> : <WifiOff className="w-4 h-4 text-rose-500" />}
          {pendingCount > 0 && (
            <span className="text-[10px] font-bold">{pendingCount}</span>
          )}
        </div>
      </div>

      {/* Period selector */}
      <div className="relative z-10 px-4 mt-4">
        <div className={`relative grid grid-cols-3 gap-1 p-1.5 rounded-2xl backdrop-blur-xl ${isNight ? "bg-white/10 ring-1 ring-white/15" : "bg-white/40 ring-1 ring-white/60"} shadow-lg`}>
          {([1, 2, 3] as Period[]).map((p) => {
            const m = PERIOD_META[p];
            const active = p === period;
            return (
              <button
                key={p}
                onClick={() => { setPeriod(p); }}
                className="relative h-12 rounded-xl flex items-center justify-center gap-2 text-sm font-bold transition"
              >
                {active && (
                  <motion.div
                    layoutId="period-pill"
                    className={`absolute inset-0 rounded-xl bg-gradient-to-br ${m.accent} shadow-lg`}
                    transition={{ type: "spring", stiffness: 400, damping: 32 }}
                  />
                )}
                <span className={`relative z-10 ${active ? "text-white" : ""}`}>{m.icon}</span>
                <span className={`relative z-10 ${active ? "text-white" : ""}`}>{m.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Stats */}
      <div className="relative z-10 px-4 mt-4 grid grid-cols-2 gap-2">
        <StatCard isNight={isNight} label="رکورد این نوبت" value={String(countForPeriod)} />
        <StatCard isNight={isNight} label="مجموع کیلوگرم" value={totalForPeriod.toFixed(1)} />
      </div>

      {/* Main input card with swipe */}
      <motion.div
        className="relative z-10 px-4 mt-5"
        onPan={onPan}
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={editing ? editing.localId : "new"}
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -30 }}
            transition={{ duration: 0.22 }}
            className={`rounded-3xl p-5 backdrop-blur-2xl shadow-2xl ${isNight ? "bg-white/10 ring-1 ring-white/15" : "bg-white/55 ring-1 ring-white/70"}`}
          >
            {editing ? (
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 text-xs font-bold">
                  <Pencil className="w-3.5 h-3.5" />
                  ویرایش رکورد {activeIdx! + 1} / {entries.length}
                </div>
                <button
                  onClick={closeHistory}
                  className={`text-xs px-3 py-1.5 rounded-full ${isNight ? "bg-white/15" : "bg-white/60"} active:scale-95 transition flex items-center gap-1`}
                >
                  <Plus className="w-3 h-3" /> رکورد جدید
                </button>
              </div>
            ) : (
              <div className="text-xs opacity-70 mb-3">رکورد جدید</div>
            )}

            {/* Ear tag */}
            <label className="block text-xs font-bold mb-1.5 opacity-80">شماره گوش</label>
            <input
              ref={earRef}
              value={earTag}
              onChange={(e) => setEarTag(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  amountRef.current?.focus();
                }
              }}
              inputMode="numeric"
              pattern="[0-9]*"
              dir="ltr"
              disabled={!!editing}
              placeholder="0000"
              className={`w-full text-center text-3xl font-black tracking-widest rounded-2xl py-4 outline-none transition ${
                isNight
                  ? "bg-slate-900/40 ring-1 ring-white/10 focus:ring-2 focus:ring-indigo-300 placeholder:text-white/30 text-white"
                  : "bg-white/70 ring-1 ring-white/80 focus:ring-2 focus:ring-orange-400 placeholder:text-slate-400"
              } ${editing ? "opacity-60" : ""}`}
            />

            {/* Amount */}
            <label className="block text-xs font-bold mb-1.5 mt-4 opacity-80">مقدار شیر</label>
            <div className="relative">
              <input
                ref={amountRef}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleSubmit();
                  }
                }}
                inputMode="decimal"
                dir="ltr"
                placeholder="0.0"
                className={`w-full text-center text-4xl font-black rounded-2xl py-4 pl-16 pr-4 outline-none transition ${
                  isNight
                    ? "bg-slate-900/40 ring-1 ring-white/10 focus:ring-2 focus:ring-indigo-300 placeholder:text-white/30 text-white"
                    : "bg-white/70 ring-1 ring-white/80 focus:ring-2 focus:ring-orange-400 placeholder:text-slate-400"
                }`}
              />
              <span className={`absolute left-4 top-1/2 -translate-y-1/2 text-sm font-bold opacity-60`}>kg</span>
            </div>
          </motion.div>
        </AnimatePresence>

        {/* Swipe nav */}
        {entries.length > 0 && (
          <div className="flex items-center justify-between mt-3 text-xs opacity-80">
            <button
              onClick={() => nav(-1)}
              disabled={activeIdx === 0}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-full ${isNight ? "bg-white/10" : "bg-white/40"} backdrop-blur disabled:opacity-30 active:scale-95 transition`}
            >
              <ChevronRight className="w-3.5 h-3.5" />
              قبلی
            </button>
            <span className="font-bold">
              {editing ? `${activeIdx! + 1} / ${entries.length}` : `${entries.length} رکورد`}
            </span>
            <button
              onClick={() => nav(1)}
              disabled={activeIdx === null}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-full ${isNight ? "bg-white/10" : "bg-white/40"} backdrop-blur disabled:opacity-30 active:scale-95 transition`}
            >
              بعدی
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Submit button — directly under the card */}
        <motion.button
          whileTap={{ scale: 0.96 }}
          onClick={handleSubmit}
          disabled={submitting}
          className={`mt-4 w-full h-16 rounded-2xl font-black text-lg text-white shadow-2xl bg-gradient-to-br ${meta.accent} disabled:opacity-60 flex items-center justify-center gap-2 active:shadow-inner relative overflow-hidden`}
        >
          {submitting ? (
            <Loader2 className="w-6 h-6 animate-spin" />
          ) : editing ? (
            <>
              <Check className="w-6 h-6" />
              ذخیره ویرایش
            </>
          ) : (
            <>
              <Check className="w-6 h-6" />
              ثبت
            </>
          )}
          <SuccessGlow trigger={successPulse} />
        </motion.button>
      </motion.div>

      {/* Last 3 session log — newest on top, drops oldest after 3 */}
      {entries.length > 0 && (
        <div className="relative z-10 px-4 mt-4 pb-8">
          <div className="text-[11px] font-bold opacity-70 mb-2 px-1">
            آخرین ثبت‌ها در این جلسه
          </div>
          <div className="flex flex-col gap-2">
            <AnimatePresence initial={false}>
              {[...entries].slice(-3).reverse().map((e) => {
                const realIdx = entries.findIndex((x) => x.localId === e.localId);
                const active = activeIdx === realIdx;
                return (
                  <motion.button
                    layout
                    key={e.localId}
                    initial={{ opacity: 0, y: -12, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 12, scale: 0.96 }}
                    transition={{ type: "spring", stiffness: 380, damping: 30 }}
                    onClick={() => openHistory(realIdx)}
                    className={`w-full flex items-center justify-between rounded-2xl px-4 py-3 backdrop-blur-md text-right active:scale-[0.98] transition ${
                      active
                        ? `bg-gradient-to-br ${meta.accent} text-white shadow-lg`
                        : isNight ? "bg-white/10 ring-1 ring-white/10" : "bg-white/55 ring-1 ring-white/60"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className={`inline-block w-2 h-2 rounded-full ${
                        e.status === "synced" ? "bg-emerald-400" : e.status === "error" ? "bg-rose-400" : "bg-amber-400"
                      }`} />
                      <div>
                        <div className="text-[11px] opacity-80">گوش {toPersianDigits(e.ear_tag)}</div>
                        <div className="text-[10px] opacity-70">{PERIOD_META[e.period].label}</div>
                      </div>
                    </div>
                    <div className="text-2xl font-black">
                      {toPersianDigits(e.milk_amount)}
                      <span className="text-xs font-bold opacity-70 mr-1">kg</span>
                    </div>
                  </motion.button>
                );
              })}
            </AnimatePresence>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, isNight }: { label: string; value: string; isNight: boolean }) {
  return (
    <div className={`rounded-2xl p-3 backdrop-blur-xl ${isNight ? "bg-white/10 ring-1 ring-white/10" : "bg-white/45 ring-1 ring-white/60"}`}>
      <div className="text-[11px] opacity-70">{label}</div>
      <div className="text-xl font-black">{value}</div>
    </div>
  );
}

function SuccessGlow({ trigger }: { trigger: number }) {
  return (
    <AnimatePresence>
      {trigger > 0 && (
        <motion.span
          key={trigger}
          initial={{ opacity: 0.7, scale: 0.2 }}
          animate={{ opacity: 0, scale: 2.5 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.7 }}
          className="absolute inset-0 rounded-2xl bg-white/40"
        />
      )}
    </AnimatePresence>
  );
}

function AtmosphereLayer({ period }: { period: Period }) {
  if (period === 1) {
    return (
      <>
        <motion.div
          className="absolute -top-20 -right-20 w-72 h-72 rounded-full bg-yellow-200/40 blur-3xl"
          animate={{ y: [0, 10, 0], opacity: [0.5, 0.7, 0.5] }}
          transition={{ duration: 8, repeat: Infinity }}
        />
        <motion.div
          className="absolute top-32 -left-10 w-40 h-16 rounded-full bg-white/40 blur-2xl"
          animate={{ x: [0, 30, 0] }}
          transition={{ duration: 14, repeat: Infinity }}
        />
      </>
    );
  }
  if (period === 2) {
    return (
      <>
        <motion.div
          className="absolute -top-10 right-1/4 w-56 h-56 rounded-full bg-white/50 blur-3xl"
          animate={{ scale: [1, 1.1, 1] }}
          transition={{ duration: 10, repeat: Infinity }}
        />
        <motion.div
          className="absolute top-40 -left-16 w-48 h-20 rounded-full bg-white/50 blur-2xl"
          animate={{ x: [0, 40, 0] }}
          transition={{ duration: 18, repeat: Infinity }}
        />
      </>
    );
  }
  return (
    <>
      <motion.div
        className="absolute -top-16 -right-10 w-60 h-60 rounded-full bg-indigo-300/20 blur-3xl"
        animate={{ opacity: [0.3, 0.5, 0.3] }}
        transition={{ duration: 6, repeat: Infinity }}
      />
      <div className="absolute inset-0 pointer-events-none opacity-30"
        style={{
          backgroundImage: "radial-gradient(2px 2px at 20% 30%, rgba(255,255,255,0.7), transparent), radial-gradient(1.5px 1.5px at 70% 50%, rgba(255,255,255,0.6), transparent), radial-gradient(2px 2px at 40% 70%, rgba(255,255,255,0.5), transparent), radial-gradient(1.5px 1.5px at 85% 20%, rgba(255,255,255,0.6), transparent)",
        }}
      />
    </>
  );
}
