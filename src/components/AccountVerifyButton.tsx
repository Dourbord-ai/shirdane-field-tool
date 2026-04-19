import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, CheckCircle2, AlertCircle, BadgeCheck, AlertTriangle, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

export type PaymentMethod = "1" | "2" | "3"; // 1=card, 2=sheba, 3=deposit

interface VerifyResult {
  name: string;
  bankName: string | null;
  cached: boolean;
}

export type MatchStatus = "match" | "partial" | "mismatch" | null;

interface AccountVerifyButtonProps {
  type: PaymentMethod;
  number: string;
  accountHolderName: string;
  onAccountHolderNameChange: (name: string) => void;
  nameLabel?: string;
  namePlaceholder?: string;
  onUseName?: (name: string) => void;
  onMatchStatusChange?: (status: MatchStatus) => void;
}

const TYPE_LABEL: Record<PaymentMethod, string> = {
  "1": "کارت",
  "2": "شبا",
  "3": "حساب",
};

// --- Name comparison helpers ---
function normalizeName(s: string): string {
  if (!s) return "";
  let n = s.trim().toLowerCase();
  // Persian/Arabic digit normalization (defensive)
  n = n.replace(/[ي]/g, "ی").replace(/[ك]/g, "ک");
  // Remove diacritics / tatweel
  n = n.replace(/[\u064B-\u0652\u0670\u0640]/g, "");
  // Collapse whitespace
  n = n.replace(/\s+/g, " ").trim();
  return n;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[b.length];
}

function compareNames(userInput: string, official: string): MatchStatus {
  const a = normalizeName(userInput);
  const b = normalizeName(official);
  if (!a || !b) return null;
  if (a === b) return "match";

  // Token-based comparison (order-insensitive)
  const ta = a.split(" ").filter(Boolean).sort().join(" ");
  const tb = b.split(" ").filter(Boolean).sort().join(" ");
  if (ta === tb) return "match";

  // Containment counts as match (e.g. user typed first name only fully matches inside)
  if (b.includes(a) || a.includes(b)) {
    const ratio = Math.min(a.length, b.length) / Math.max(a.length, b.length);
    return ratio >= 0.6 ? "match" : "partial";
  }

  const dist = levenshtein(ta, tb);
  const maxLen = Math.max(ta.length, tb.length);
  const similarity = 1 - dist / maxLen;

  if (similarity >= 0.85) return "match";
  if (similarity >= 0.55) return "partial";
  return "mismatch";
}

export default function AccountVerifyButton({
  type,
  number,
  accountHolderName,
  onAccountHolderNameChange,
  nameLabel = "نام صاحب حساب",
  namePlaceholder = "نام و نام خانوادگی...",
  onUseName,
  onMatchStatusChange,
}: AccountVerifyButtonProps) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const matchStatus: MatchStatus = useMemo(() => {
    if (!result) return null;
    return compareNames(accountHolderName, result.name);
  }, [result, accountHolderName]);

  // Notify parent whenever status changes (for submit-blocking)
  useEffect(() => {
    onMatchStatusChange?.(matchStatus);
  }, [matchStatus, onMatchStatusChange]);

  const inputStateClass = (() => {
    if (!matchStatus) return "";
    if (matchStatus === "match") return "border-2 border-primary/60 bg-primary/5 focus-visible:ring-primary";
    if (matchStatus === "partial") return "border-2 border-yellow-500/60 bg-yellow-500/5 focus-visible:ring-yellow-500";
    return "border-2 border-destructive/60 bg-destructive/5 focus-visible:ring-destructive";
  })();

  const officialBoxClass = (() => {
    if (!matchStatus || matchStatus === "match") {
      return "border-primary/30 bg-primary/5";
    }
    if (matchStatus === "partial") {
      return "border-yellow-500/40 bg-yellow-500/5";
    }
    return "border-destructive/50 bg-destructive/10";
  })();

  const handleVerify = async () => {
    if (!number || !number.trim()) {
      toast({
        title: "شماره وارد نشده",
        description: `لطفاً ابتدا شماره ${TYPE_LABEL[type]} را وارد کنید`,
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const { data, error: fnError } = await supabase.functions.invoke("verify-account", {
        body: { type, number: number.trim() },
      });

      if (fnError) {
        const ctx = (fnError as { context?: { error?: string; body?: { error?: string } } }).context;
        const ctxMsg = ctx?.body?.error || ctx?.error;
        throw new Error(ctxMsg || fnError.message || "خطا در ارتباط با سرویس");
      }

      if (!data?.ok) {
        throw new Error(data?.error || "خطای ناشناخته");
      }

      setResult({ name: data.name, bankName: data.bankName, cached: !!data.cached });
    } catch (e) {
      const msg = (e as Error).message || "خطا در استعلام";
      setError(msg);
      toast({
        title: "استعلام ناموفق",
        description: msg,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-2">
      {/* Account holder name input — above verify button for live comparison */}
      <div className="space-y-1.5">
        <label className="block text-xs font-medium text-foreground">{nameLabel}</label>
        <Input
          value={accountHolderName}
          onChange={(e) => onAccountHolderNameChange(e.target.value)}
          placeholder={namePlaceholder}
          className={cn("rounded-xl touch-target text-sm transition-colors", inputStateClass)}
        />
        {matchStatus === "mismatch" && (
          <div className="flex items-center gap-1.5 text-destructive">
            <XCircle className="w-3.5 h-3.5" />
            <span className="text-[11px] font-bold">مغایرت کامل نام</span>
          </div>
        )}
        {matchStatus === "partial" && (
          <div className="flex items-center gap-1.5 text-yellow-600 dark:text-yellow-500">
            <AlertTriangle className="w-3.5 h-3.5" />
            <span className="text-[11px] font-medium">نام مشابه است ولی کاملاً یکسان نیست</span>
          </div>
        )}
        {matchStatus === "match" && (
          <div className="flex items-center gap-1.5 text-primary">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span className="text-[11px] font-medium">نام با حساب مطابقت دارد</span>
          </div>
        )}
      </div>

      <Button
        type="button"
        onClick={handleVerify}
        disabled={loading}
        variant="outline"
        size="sm"
        className="w-full rounded-xl border-primary/30 bg-primary/5 text-primary hover:bg-primary/10 hover:text-primary touch-target"
      >
        {loading ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">در حال استعلام از بانک...</span>
          </>
        ) : (
          <>
            <BadgeCheck className="w-4 h-4" />
            <span className="text-sm">بررسی حساب</span>
          </>
        )}
      </Button>

      {result && (
        <div className={cn("rounded-xl border p-3 space-y-2 animate-in fade-in slide-in-from-top-2 duration-300", officialBoxClass)}>
          <div className="flex items-start gap-2">
            {matchStatus === "mismatch" ? (
              <XCircle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
            ) : matchStatus === "partial" ? (
              <AlertTriangle className="w-5 h-5 text-yellow-600 dark:text-yellow-500 shrink-0 mt-0.5" />
            ) : (
              <CheckCircle2 className="w-5 h-5 text-primary shrink-0 mt-0.5" />
            )}
            <div className="flex-1 min-w-0 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-muted-foreground">صاحب حساب طبق بانک</span>
                {result.cached && (
                  <span className="text-[10px] bg-muted px-2 py-0.5 rounded-full text-muted-foreground">
                    از حافظه
                  </span>
                )}
              </div>
              <p className={cn(
                "text-sm font-bold break-words",
                matchStatus === "mismatch" ? "text-destructive" :
                matchStatus === "partial" ? "text-yellow-700 dark:text-yellow-500" :
                "text-foreground"
              )}>
                {result.name}
              </p>
              {result.bankName && (
                <p className="text-xs text-muted-foreground">بانک: {result.bankName}</p>
              )}
            </div>
          </div>
          {(onUseName || matchStatus !== "match") && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => {
                onAccountHolderNameChange(result.name);
                onUseName?.(result.name);
                toast({ title: "نام صاحب حساب وارد شد" });
              }}
              className="w-full rounded-lg text-xs"
            >
              استفاده از این نام
            </Button>
          )}
        </div>
      )}

      {error && !result && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 flex items-start gap-2 animate-in fade-in slide-in-from-top-2 duration-300">
          <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
          <p className="text-xs text-destructive flex-1">{error}</p>
        </div>
      )}
    </div>
  );
}
