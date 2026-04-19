import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, AlertCircle, BadgeCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

export type PaymentMethod = "1" | "2" | "3"; // 1=card, 2=sheba, 3=deposit

interface VerifyResult {
  name: string;
  bankName: string | null;
  cached: boolean;
}

interface AccountVerifyButtonProps {
  type: PaymentMethod;
  number: string;
  onUseName?: (name: string) => void;
}

const TYPE_LABEL: Record<PaymentMethod, string> = {
  "1": "کارت",
  "2": "شبا",
  "3": "حساب",
};

export default function AccountVerifyButton({ type, number, onUseName }: AccountVerifyButtonProps) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [error, setError] = useState<string | null>(null);

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
        // Try to read inner error from response if available
        let msg = fnError.message || "خطا در ارتباط با سرویس";
        // @ts-expect-error - context may include response
        const ctxRes = fnError.context?.body || fnError.context;
        if (ctxRes?.error) msg = ctxRes.error;
        throw new Error(msg);
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
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 space-y-2 animate-in fade-in slide-in-from-top-2 duration-300">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="w-5 h-5 text-primary shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-muted-foreground">صاحب حساب</span>
                {result.cached && (
                  <span className="text-[10px] bg-muted px-2 py-0.5 rounded-full text-muted-foreground">
                    از حافظه
                  </span>
                )}
              </div>
              <p className="text-sm font-bold text-foreground break-words">{result.name}</p>
              {result.bankName && (
                <p className="text-xs text-muted-foreground">بانک: {result.bankName}</p>
              )}
            </div>
          </div>
          {onUseName && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => {
                onUseName(result.name);
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
