import { useEffect, useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { MoneyCell, JalaliDateCell } from "@/components/finance/atoms";
import { toastFinanceError } from "@/lib/financeErrors";
import { toast } from "sonner";
import {
  getBeneficiaryStatementComparison,
  exportStatementToExcel,
  BeneficiaryStatementComparison,
  StatementRow,
} from "@/lib/beneficiaryStatement";
import { X, Download, RefreshCw, AlertTriangle, Eye } from "lucide-react";

// How many characters to show before the "نمایش کامل" trigger appears in the
// description column. Tuned so the row stays single-line on desktop but long
// shrh strings (typical Sepidar text) still get the expand affordance.
const DESCRIPTION_PREVIEW_LIMIT = 60;

/**
 * Render the running balance with sign-driven semantic color:
 *   balance > 0 → بستانکار  → green
 *   balance < 0 → بدهکار   → red
 *   balance = 0 → بی‌حساب  → neutral foreground
 * We delegate to MoneyCell so number formatting stays consistent with the
 * rest of the finance UI; we only flip the positive/negative tone props.
 */
function BalanceCell({ value }: { value: number }) {
  const positive = value > 0;
  const negative = value < 0;
  return <MoneyCell value={value} positive={positive} negative={negative} />;
}

/**
 * Description cell with overflow handling. Short text renders inline as
 * before; long text is truncated and gets an "نمایش کامل" eye-button that
 * surfaces the full text in a modal so nothing is silently clipped.
 */
function DescriptionCell({
  text,
  onExpand,
}: {
  text: string;
  onExpand: (full: string) => void;
}) {
  const value = text || "";
  const isLong = value.length > DESCRIPTION_PREVIEW_LIMIT;
  if (!value) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex items-start gap-1 max-w-xs">
      <span
        className="truncate text-foreground/90"
        title={value}
        dir="auto"
      >
        {value}
      </span>
      {isLong && (
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6 shrink-0"
          onClick={() => onExpand(value)}
          aria-label="نمایش کامل شرح"
          title="نمایش کامل شرح"
        >
          <Eye className="w-3.5 h-3.5" />
        </Button>
      )}
    </div>
  );
}

/**
 * Simple RTL modal used to display a long description in full without
 * clipping. Kept local to this dialog because no other screen needs it.
 */
function DescriptionModal({
  text,
  onClose,
}: {
  text: string | null;
  onClose: () => void;
}) {
  if (!text) return null;
  return (
    <div
      className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4"
      onClick={onClose}
      dir="rtl"
    >
      <div
        className="bg-card border rounded-xl shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-3 border-b flex items-center justify-between">
          <h4 className="font-bold text-sm">شرح کامل</h4>
          <Button size="icon" variant="ghost" onClick={onClose} aria-label="بستن">
            <X className="w-4 h-4" />
          </Button>
        </div>
        <div className="p-4 overflow-y-auto text-sm leading-7 whitespace-pre-wrap break-words" dir="auto">
          {text}
        </div>
      </div>
    </div>
  );
}


const PAGE_SIZE = 15;

export default function BeneficiaryStatementCompareDialog({
  beneficiaryId,
  onClose,
}: {
  beneficiaryId: string;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<BeneficiaryStatementComparison | null>(null);
  // Holds the full description text when the user clicks the "نمایش کامل"
  // eye-button on a row whose description is too long for the table cell.
  // null = modal closed.
  const [expandedDescription, setExpandedDescription] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await getBeneficiaryStatementComparison(beneficiaryId);
      setData(res);
    } catch (e: unknown) {
      toastFinanceError(toast, e);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beneficiaryId]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-stretch sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
      dir="rtl"
    >
      <div
        className="bg-card rounded-none sm:rounded-2xl border shadow-xl w-full max-w-6xl h-full sm:h-[92vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b flex items-center justify-between gap-2 bg-card">
          <div>
            <h3 className="font-bold text-lg">مقایسه صورتحساب با سپیدار</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              کنترل و audit اسناد مالی برنامه و سپیدار
            </p>
          </div>
          <div className="flex gap-1">
            <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
              <RefreshCw className="w-4 h-4 ml-1" /> بازخوانی
            </Button>
            <Button size="icon" variant="ghost" onClick={onClose}>
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {loading && (
            <div className="text-center py-12 text-muted-foreground text-sm">
              در حال واکشی صورتحساب...
            </div>
          )}
          {!loading && data && (
            <Body data={data} onExpandDescription={setExpandedDescription} />
          )}
        </div>
      </div>
      {/* Full-description modal lives at the dialog root so it overlays the
          entire compare dialog (z-[60] > z-50). */}
      <DescriptionModal
        text={expandedDescription}
        onClose={() => setExpandedDescription(null)}
      />
    </div>
  );
}

function Body({
  data,
  onExpandDescription,
}: {
  data: BeneficiaryStatementComparison;
  // Passed down to StatementTable so per-row "نمایش کامل" can trigger the
  // shared modal mounted at the dialog root.
  onExpandDescription: (text: string) => void;
}) {
  const totalDiffs =
    data.onlyInInternal.length +
    data.onlyInSepidar.length +
    data.amountMismatches.length +
    data.dateMismatches.length;

  return (
    <>
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard label="نام ذینفع" value={data.beneficiary.name} />
        <SummaryCard label="کد ذینفع" value={data.beneficiary.code || "—"} />
        <SummaryCard label="مانده اول دوره" money={data.openingBalance} />
        <SummaryCard label="مانده فعلی برنامه" money={data.internalFinalBalance} />
        <SummaryCard label="مانده فعلی سپیدار" money={data.sepidarFinalBalance} />
        <SummaryCard
          label="اختلاف نهایی"
          money={data.finalBalanceDifference}
          tone={Math.abs(data.finalBalanceDifference) > 0.01 ? "danger" : "ok"}
        />
        <SummaryCard label="تعداد ردیف برنامه" value={String(data.internalStatement.length)} />
        <SummaryCard
          label="تعداد اختلافات"
          value={String(totalDiffs)}
          tone={totalDiffs > 0 ? "warn" : "ok"}
        />
      </div>

      {!data.sepidarAvailable && (
        <div className="rounded-lg border bg-amber-50 text-amber-900 text-xs p-3 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <p className="font-bold">صورتحساب سپیدار قابل واکشی نیست.</p>
            {data.sepidarErrorMessage && (
              <p className="mt-1 break-words">{data.sepidarErrorMessage}</p>
            )}
            <p className="mt-1 text-amber-800/80">
              اتصال به stored procedure سپیدار هنوز پیکربندی نشده است (TODO).
            </p>
          </div>
        </div>
      )}

      <Tabs defaultValue="internal" className="w-full">
        <TabsList className="grid grid-cols-3 w-full">
          <TabsTrigger value="internal">اسناد برنامه</TabsTrigger>
          <TabsTrigger value="sepidar">اسناد سپیدار</TabsTrigger>
          <TabsTrigger value="diff">
            اختلافات {totalDiffs > 0 && <span className="mr-1 text-rose-600">({totalDiffs})</span>}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="internal" className="mt-3">
          <StatementTable
            title="لیست اسناد مالی در برنامه"
            rows={data.internalStatement}
            kind="internal"
            onExport={() => exportStatementToExcel(data, "internal")}
          />
        </TabsContent>
        <TabsContent value="sepidar" className="mt-3">
          <StatementTable
            title="لیست اسناد مالی در سپیدار"
            rows={data.sepidarStatement}
            kind="sepidar"
            onExport={() => exportStatementToExcel(data, "sepidar")}
          />
        </TabsContent>
        <TabsContent value="diff" className="mt-3">
          <DiffSection data={data} />
        </TabsContent>
      </Tabs>
    </>
  );
}

function SummaryCard({
  label,
  value,
  money,
  tone,
}: {
  label: string;
  value?: string;
  money?: number;
  tone?: "ok" | "warn" | "danger";
}) {
  const ring =
    tone === "danger"
      ? "border-rose-300 bg-rose-50"
      : tone === "warn"
      ? "border-amber-300 bg-amber-50"
      : tone === "ok"
      ? "border-emerald-300 bg-emerald-50"
      : "border-border bg-card";
  return (
    <div className={`rounded-xl border p-3 ${ring}`}>
      <p className="text-[11px] text-muted-foreground">{label}</p>
      {money != null ? (
        <MoneyCell value={money} className="text-base mt-1" positive={money > 0} negative={money < 0} />
      ) : (
        <p className="text-sm font-bold mt-1 truncate" dir="auto">
          {value}
        </p>
      )}
    </div>
  );
}

function StatementTable({
  title,
  rows,
  kind,
  onExport,
}: {
  title: string;
  rows: StatementRow[];
  kind: "internal" | "sepidar";
  onExport: () => void;
}) {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) =>
      [
        r.description,
        r.documentNumber,
        r.source,
        r.account,
        String(r.debit),
        String(r.credit),
        String(r.balance),
        r.date,
      ]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(s)),
    );
  }, [rows, q]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const cur = Math.min(page, totalPages);
  const slice = filtered.slice((cur - 1) * PAGE_SIZE, cur * PAGE_SIZE);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h4 className="font-bold">{title}</h4>
        <div className="flex gap-2 items-center">
          <Input
            placeholder="جستجو..."
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            className="h-9 w-48"
          />
          <Button size="sm" variant="outline" onClick={onExport} disabled={!rows.length}>
            <Download className="w-4 h-4 ml-1" /> Excel
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border" dir="rtl">
        <table className="w-full text-sm text-right" dir="rtl">
          <thead className="bg-muted/50 text-xs">
            <tr>
              <th className="p-2 text-right">تاریخ</th>
              <th className="p-2 text-right">شماره سند</th>
              <th className="p-2 text-right">شرح</th>
              <th className="p-2 text-right">بدهکار</th>
              <th className="p-2 text-right">بستانکار</th>
              <th className="p-2 text-right">مانده</th>
              {kind === "sepidar" && <th className="p-2 text-right">کد معین</th>}
              {kind === "sepidar" && <th className="p-2 text-right">عنوان معین</th>}
              {kind === "sepidar" && <th className="p-2 text-right">کد تفصیل</th>}
              {kind === "sepidar" && <th className="p-2 text-right">عنوان تفصیل</th>}
              {/* Issuer column intentionally hidden from display (data still kept in model + Excel export) */}
              {kind === "internal" && <th className="p-2 text-right">منبع</th>}
            </tr>
          </thead>
          <tbody>
            {slice.map((r) => (
              <tr key={r.id} className="border-t hover:bg-muted/30">
                <td className="p-2 whitespace-nowrap"><JalaliDateCell value={r.date} /></td>
                <td className="p-2 font-mono text-xs">{r.documentNumber || "—"}</td>
                <td className="p-2 max-w-xs truncate" title={r.description}>{r.description || "—"}</td>
                <td className="p-2"><MoneyCell value={r.debit} /></td>
                <td className="p-2"><MoneyCell value={r.credit} /></td>
                <td className="p-2"><MoneyCell value={r.balance} /></td>
                {kind === "sepidar" && <td className="p-2 font-mono text-xs">{r.dlCode || "—"}</td>}
                {kind === "sepidar" && <td className="p-2">{r.dlTitle || "—"}</td>}
                {kind === "sepidar" && <td className="p-2 font-mono text-xs">{r.slCode || "—"}</td>}
                {kind === "sepidar" && <td className="p-2">{r.slTitle || "—"}</td>}
                {/* Issuer cell hidden — see header note above */}
                {kind === "internal" && <td className="p-2 text-xs text-muted-foreground">{r.source || "—"}</td>}
              </tr>
            ))}
            {!slice.length && (
              <tr>
                <td colSpan={kind === "sepidar" ? 10 : 7} className="p-6 text-center text-sm text-muted-foreground">
                  ردیفی یافت نشد
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">
            صفحه {cur} از {totalPages} — مجموع {filtered.length} ردیف
          </span>
          <div className="flex gap-1">
            <Button size="sm" variant="outline" disabled={cur <= 1} onClick={() => setPage(cur - 1)}>
              قبلی
            </Button>
            <Button size="sm" variant="outline" disabled={cur >= totalPages} onClick={() => setPage(cur + 1)}>
              بعدی
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function DiffSection({ data }: { data: BeneficiaryStatementComparison }) {
  const finalDiff = Math.abs(data.finalBalanceDifference) > 0.01;
  return (
    <div className="space-y-4">
      {finalDiff && (
        <div className="rounded-lg border-r-4 border-rose-500 bg-rose-50 text-rose-900 p-3 text-sm">
          <p className="font-bold">مانده نهایی برنامه و سپیدار برابر نیست.</p>
          <p className="text-xs mt-1">
            اختلاف: <MoneyCell value={data.finalBalanceDifference} />
          </p>
        </div>
      )}

      <DiffGroup
        title="اسناد موجود در سپیدار ولی ناموجود در برنامه"
        message="این سند در سپیدار وجود دارد اما در برنامه ثبت نشده است. احتمال ثبت دستی در سپیدار وجود دارد."
        rows={data.onlyInSepidar}
        tone="danger"
      />
      <DiffGroup
        title="اسناد موجود در برنامه ولی ناموجود در سپیدار"
        message="این سند در برنامه ثبت شده اما هنوز در سپیدار درج نشده است."
        rows={data.onlyInInternal.filter(
          (r) => !data.amountMismatches.some((d) => d.internal?.id === r.id),
        )}
        tone="warn"
      />
      <DiffPairGroup
        title="اسناد مشابه با مبلغ متفاوت"
        message="سند مشابه پیدا شد اما مبلغ بدهکار/بستانکار متفاوت است."
        diffs={data.amountMismatches}
        tone="warn-yellow"
      />
      <DiffPairGroup
        title="اسناد مشابه با تاریخ متفاوت"
        message="سند مشابه پیدا شد اما تاریخ آن متفاوت است."
        diffs={data.dateMismatches}
        tone="warn-yellow"
      />

      {data.matchedItems.length > 0 && (
        <div className="rounded-lg border-r-4 border-emerald-500 bg-emerald-50 text-emerald-900 p-3 text-sm">
          <p className="font-bold">
            {data.matchedItems.length} سند بین برنامه و سپیدار به‌درستی تطبیق یافت.
          </p>
        </div>
      )}
    </div>
  );
}

function diffTone(tone: "danger" | "warn" | "warn-yellow") {
  if (tone === "danger") return "border-rose-500 bg-rose-50/40";
  if (tone === "warn") return "border-orange-500 bg-orange-50/40";
  return "border-amber-400 bg-amber-50/40";
}

function DiffGroup({
  title,
  message,
  rows,
  tone,
}: {
  title: string;
  message: string;
  rows: StatementRow[];
  tone: "danger" | "warn";
}) {
  if (!rows.length) return null;
  return (
    <div className={`rounded-lg border-r-4 ${diffTone(tone)} p-3 space-y-2`}>
      <div>
        <h4 className="font-bold text-sm">
          {title} <span className="text-xs text-muted-foreground">({rows.length})</span>
        </h4>
        <p className="text-xs text-muted-foreground mt-0.5">{message}</p>
      </div>
      <div className="overflow-x-auto rounded border bg-card" dir="rtl">
        <table className="w-full text-xs text-right" dir="rtl">
          <thead className="bg-muted/40">
            <tr>
              <th className="p-2 text-right">تاریخ</th>
              <th className="p-2 text-right">شرح</th>
              <th className="p-2 text-right">بدهکار</th>
              <th className="p-2 text-right">بستانکار</th>
              <th className="p-2 text-right">شماره سند</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="p-2"><JalaliDateCell value={r.date} /></td>
                <td className="p-2">{r.description || "—"}</td>
                <td className="p-2"><MoneyCell value={r.debit} /></td>
                <td className="p-2"><MoneyCell value={r.credit} /></td>
                <td className="p-2 font-mono">{r.documentNumber || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DiffPairGroup({
  title,
  message,
  diffs,
  tone,
}: {
  title: string;
  message: string;
  diffs: { internal?: StatementRow; sepidar?: StatementRow }[];
  tone: "danger" | "warn" | "warn-yellow";
}) {
  if (!diffs.length) return null;
  return (
    <div className={`rounded-lg border-r-4 ${diffTone(tone)} p-3 space-y-2`}>
      <div>
        <h4 className="font-bold text-sm">
          {title} <span className="text-xs text-muted-foreground">({diffs.length})</span>
        </h4>
        <p className="text-xs text-muted-foreground mt-0.5">{message}</p>
      </div>
      <div className="space-y-2">
        {diffs.map((d, i) => (
          <div key={i} className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <PairCard label="برنامه" row={d.internal} tone="info" />
            <PairCard label="سپیدار" row={d.sepidar} tone="info" />
          </div>
        ))}
      </div>
    </div>
  );
}

function PairCard({
  label,
  row,
  tone,
}: {
  label: string;
  row?: StatementRow;
  tone: "info";
}) {
  return (
    <div className="rounded border bg-card p-2 text-xs">
      <p className="text-[10px] text-muted-foreground mb-1">{label}</p>
      {row ? (
        <>
          <div className="flex justify-between"><span>تاریخ:</span><JalaliDateCell value={row.date} /></div>
          <div className="flex justify-between"><span>شرح:</span><span className="truncate max-w-[60%]" dir="auto">{row.description || "—"}</span></div>
          <div className="flex justify-between"><span>بدهکار:</span><MoneyCell value={row.debit} /></div>
          <div className="flex justify-between"><span>بستانکار:</span><MoneyCell value={row.credit} /></div>
          <div className="flex justify-between"><span>شماره سند:</span><span className="font-mono">{row.documentNumber || "—"}</span></div>
        </>
      ) : (
        <span className="text-muted-foreground">—</span>
      )}
    </div>
  );
}
