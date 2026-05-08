import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import {
  presenceLabel,
  fertilityLabel,
  presenceBadgeClass,
  isFemale,
  dryLabel,
} from "@/lib/livestock";
import { Loader2, History, ArrowRight, Activity, Milk, HeartPulse, ShoppingCart } from "lucide-react";
import FertilitySection from "@/components/livestock/FertilitySection";
import CowHistoryTabs from "@/components/livestock/CowHistoryTabs";

type Cow = {
  id: number;
  tag_number: string | null;
  earnumber: number | null;
  bodynumber: number | null;
  sextype: string | null;
  sex: number | null;
  existancestatus: number | null;
  is_dry: boolean | null;
  last_fertility_status: number | null;
  created_at: string;
  purchase_date: string | null;
  purchase_price: number | null;
  supplier: string | null;
  purchase_invoice_number: string | null;
  pre_entry_birth_date: string | null;
  pre_entry_abortion_date: string | null;
  pre_entry_dry_date: string | null;
  pre_entry_period: number | null;
  pre_entry_note: string | null;
};

type Event = {
  id: string;
  event_type: string;
  from_value: string | null;
  to_value: string | null;
  description: string | null;
  event_date: string | null;
  created_at: string;
};

const EVENT_LABELS: Record<string, string> = {
  presence_change: "تغییر وضعیت حضور",
  dry_change: "تغییر وضعیت دوشش",
  fertility_change: "تغییر وضعیت باروری",
  sale: "فروش",
  death: "تلفات",
  slaughter: "کشتار",
  other: "خروج به سایر دلایل",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card p-4 space-y-3">
      <h2 className="text-body-lg font-bold text-foreground">{title}</h2>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between items-start gap-3 text-sm">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="text-foreground font-medium text-left">{value ?? "—"}</span>
    </div>
  );
}

export default function LivestockProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [cow, setCow] = useState<Cow | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = () => setRefreshKey((k) => k + 1);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!id) return;
      if (refreshKey === 0) setLoading(true);
      const numId = Number(id);
      const [{ data: cowData, error: cowErr }, { data: evData }] = await Promise.all([
        supabase.from("cows").select("*").eq("id", numId).maybeSingle(),
        supabase
          .from("livestock_events")
          .select("*")
          .eq("cow_id", numId)
          .order("created_at", { ascending: false }),
      ]);
      if (cancelled) return;
      if (cowErr || !cowData) {
        setNotFound(true);
      } else {
        setCow(cowData as Cow);
        setEvents((evData ?? []) as Event[]);
      }
      setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [id, refreshKey]);

  // Realtime: subscribe to changes for this cow + its fertility events
  useEffect(() => {
    if (!id) return;
    const numId = Number(id);
    const channel = supabase
      .channel(`cow-profile-${numId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "cows", filter: `id=eq.${numId}` },
        () => refresh(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "livestock_fertility_events", filter: `livestock_id=eq.${numId}` },
        () => refresh(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "livestock_events", filter: `cow_id=eq.${numId}` },
        () => refresh(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  if (notFound || !cow) {
    return (
      <div className="py-12 text-center space-y-3">
        <p className="text-muted-foreground">این دام یافت نشد.</p>
        <button
          onClick={() => navigate("/livestock")}
          className="text-primary underline text-sm"
        >
          بازگشت به لیست دام‌ها
        </button>
      </div>
    );
  }

  const female = isFemale(cow.sextype, cow.sex);
  const tag = cow.tag_number || cow.earnumber || cow.bodynumber || "—";
  const inHerd = (cow.existancestatus ?? 0) === 0;

  return (
    <div className="py-4 space-y-4 animate-fade-in livestock-surface -mx-4 px-4 sm:-mx-6 sm:px-6 min-h-screen">
      {/* Back */}
      <button
        onClick={() => navigate("/livestock")}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowRight className="w-4 h-4" />
        بازگشت به لیست دام‌ها
      </button>

      {/* Hero */}
      <div className="cow-hero">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">شماره پلاک</p>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="cow-hero-tag">#{tag}</h1>
              <span className={`text-xs px-2.5 py-1 rounded-full border ${presenceBadgeClass((cow.existancestatus ?? 0))}`}>
                {presenceLabel((cow.existancestatus ?? 0))}
              </span>
              {female && (
                <span className="chip-default">
                  {dryLabel(cow.is_dry)}
                </span>
              )}
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              {cow.sextype || (cow.sex === 0 ? "ماده" : cow.sex === 1 ? "نر" : "—")}
              {female && cow.last_fertility_status != null && (
                <> • {fertilityLabel(cow.last_fertility_status)}</>
              )}
            </p>
          </div>
        </div>

        {/* Quick actions */}
        {inHerd && (
          <div className="grid grid-cols-4 gap-2 mt-4">
            {female && (
              <button className="quick-action" onClick={() => document.getElementById("fertility-section")?.scrollIntoView({ behavior: "smooth" })}>
                <span className="quick-action-icon"><HeartPulse className="w-5 h-5" /></span>
                <span className="text-xs font-medium">باروری</span>
              </button>
            )}
            <button className="quick-action" onClick={() => document.getElementById("history-section")?.scrollIntoView({ behavior: "smooth" })}>
              <span className="quick-action-icon"><Activity className="w-5 h-5" /></span>
              <span className="text-xs font-medium">تاریخچه</span>
            </button>
            {female && (
              <button className="quick-action">
                <span className="quick-action-icon"><Milk className="w-5 h-5" /></span>
                <span className="text-xs font-medium">دوشش</span>
              </button>
            )}
            <button className="quick-action">
              <span className="quick-action-icon"><ShoppingCart className="w-5 h-5" /></span>
              <span className="text-xs font-medium">خرید</span>
            </button>
          </div>
        )}

        {!inHerd && (
          <p className="mt-3 text-xs text-muted-foreground bg-muted/50 rounded-md px-2 py-1.5">
            این دام از گله خارج شده است — عملیات فروش، تلفات، کشتار یا خروج مجدد قابل ثبت نیست.
          </p>
        )}
      </div>

      {/* Section 1: Basic info */}
      <Section title="اطلاعات پایه دام">
        <Row label="شماره پلاک" value={tag} />
        <Row label="نوع دام" value="گاو" />
        <Row label="جنسیت" value={cow.sextype || (cow.sex === 0 ? "ماده" : cow.sex === 1 ? "نر" : "—")} />
        <Row label="وضعیت حضور" value={presenceLabel((cow.existancestatus ?? 0))} />
        <Row
          label="تاریخ ورود"
          value={cow.created_at ? new Date(cow.created_at).toLocaleDateString("fa-IR") : "—"}
        />
      </Section>

      {/* Section 2: Female-only */}
      {female && (
        <Section title="وضعیت دام ماده">
          <Row label="وضعیت دوشش" value={dryLabel(cow.is_dry)} />
          <Row label="آخرین وضعیت باروری" value={fertilityLabel(cow.last_fertility_status)} />
        </Section>
      )}

      {/* Fertility tabs (female only) */}
      {female && (
        <div id="fertility-section">
          <FertilitySection
            livestockId={cow.id}
            latestStatus={cow.last_fertility_status}
          />
        </div>
      )}

      {/* Cow history tabs */}
      <div id="history-section">
        <CowHistoryTabs cowId={cow.id} />
      </div>

      {female && (cow.pre_entry_birth_date || cow.pre_entry_abortion_date || cow.pre_entry_dry_date || cow.pre_entry_period != null || cow.pre_entry_note) && (
        <Section title="اطلاعات اولیه قبل از ورود به دامداری">
          <Row label="تاریخ زایش قبل از ورود" value={cow.pre_entry_birth_date} />
          <Row label="تاریخ سقط قبل از ورود" value={cow.pre_entry_abortion_date} />
          <Row label="تاریخ خشکی قبل از ورود" value={cow.pre_entry_dry_date} />
          <Row label="دوره/روزهای قبل از ورود" value={cow.pre_entry_period != null ? `${cow.pre_entry_period} روز` : null} />
          <Row label="توضیحات" value={cow.pre_entry_note} />
        </Section>
      )}

      {/* Section 3: Purchase info */}
      <Section title="اطلاعات خرید">
        <Row label="تاریخ خرید" value={cow.purchase_date} />
        <Row
          label="قیمت خرید"
          value={
            cow.purchase_price != null
              ? `${Number(cow.purchase_price).toLocaleString("fa-IR")} ریال`
              : null
          }
        />
        <Row label="تامین‌کننده" value={cow.supplier} />
        <Row label="شماره فاکتور خرید" value={cow.purchase_invoice_number} />
      </Section>

      {/* Section 4: Timeline */}
      <Section title="تاریخچه و رویدادها">
        {events.length === 0 ? (
          <div className="flex flex-col items-center text-center py-6 text-muted-foreground">
            <History className="w-8 h-8 mb-2 opacity-50" />
            <p className="text-sm">رویدادی برای این دام ثبت نشده است</p>
            <p className="text-xs mt-1 opacity-70">
              تغییرات وضعیت حضور، دوشش، باروری و … در آینده اینجا نمایش داده می‌شود
            </p>
          </div>
        ) : (
          <ol className="relative border-r border-border pr-4 space-y-3">
            {events.map((e) => (
              <li key={e.id} className="relative">
                <span className="absolute -right-[21px] top-1.5 w-2.5 h-2.5 rounded-full bg-primary" />
                <div className="text-sm">
                  <p className="font-medium text-foreground">
                    {EVENT_LABELS[e.event_type] || e.event_type}
                  </p>
                  {(e.from_value || e.to_value) && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {e.from_value && <>از: {e.from_value} </>}
                      {e.to_value && <>به: {e.to_value}</>}
                    </p>
                  )}
                  {e.description && (
                    <p className="text-xs text-muted-foreground mt-0.5">{e.description}</p>
                  )}
                  <p className="text-[10px] text-muted-foreground mt-1">
                    {new Date(e.created_at).toLocaleDateString("fa-IR")}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </Section>
    </div>
  );
}
