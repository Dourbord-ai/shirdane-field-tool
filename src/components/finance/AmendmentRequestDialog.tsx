import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { AlertTriangle, Loader2, FileEdit } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";

interface AmendmentRequestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  factorId: string;
  invoiceNumber: string;
  onSuccess?: () => void;
}

export default function AmendmentRequestDialog({
  open,
  onOpenChange,
  factorId,
  invoiceNumber,
  onSuccess,
}: AmendmentRequestDialogProps) {
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const qc = useQueryClient();

  const handleSubmit = async () => {
    if (!reason.trim()) {
      toast.error("لطفاً دلیل اصلاح را وارد کنید");
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.functions.invoke("factor-request-amendment", {
        body: { factor_id: factorId, reason: reason.trim() },
      });
      if (error) throw error;
      toast.success("درخواست اصلاح ثبت شد");
      qc.invalidateQueries({ queryKey: ["factor_amendments"] });
      qc.invalidateQueries({ queryKey: ["factors"] });
      onOpenChange(false);
      setReason("");
      onSuccess?.();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "خطا در ثبت درخواست";
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-right">
            <FileEdit className="h-5 w-5 text-orange-500" />
            درخواست اصلاح فاکتور
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="rounded-md bg-orange-50 border border-orange-200 p-3 flex gap-2">
            <AlertTriangle className="h-5 w-5 text-orange-500 shrink-0 mt-0.5" />
            <div className="text-sm text-orange-800">
              <p className="font-medium">فاکتور شماره {invoiceNumber}</p>
              <p className="mt-1">با شروع فرآیند اصلاح، سند مالی این فاکتور برگشت داده می‌شود و فاکتور به حالت پیش‌نویس برمی‌گردد.</p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="reason" className="text-right block">
              دلیل اصلاح <span className="text-red-500">*</span>
            </Label>
            <Textarea
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="توضیح دهید چه تغییراتی نیاز است..."
              rows={4}
              className="resize-none text-right"
              disabled={loading}
            />
          </div>
        </div>

        <DialogFooter className="flex gap-2 justify-start flex-row-reverse">
          <Button
            onClick={handleSubmit}
            disabled={loading || !reason.trim()}
            className="bg-orange-500 hover:bg-orange-600 text-white"
          >
            {loading ? (
              <><Loader2 className="h-4 w-4 animate-spin ml-2" />در حال ثبت...</>
            ) : (
              "ثبت درخواست اصلاح"
            )}
          </Button>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            انصراف
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

