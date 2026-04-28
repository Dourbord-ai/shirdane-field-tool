import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowRight,
  Plus,
  Milk,
  Paperclip,
  FileText,
  Image as ImageIcon,
  Trash2,
  Download,
  Loader2,
  Calendar,
} from "lucide-react";
import {
  jalaliMonthNames,
  todayJalali,
  toPersianDigits,
} from "@/lib/jalali";

interface MilkReceipt {
  id: string;
  year: number;
  month: number;
  file_path: string;
  file_name: string | null;
  file_type: string | null;
  file_size: number | null;
  created_at: string;
}

const formatSize = (bytes: number | null) => {
  if (!bytes) return "";
  if (bytes < 1024) return `${toPersianDigits(bytes)} B`;
  if (bytes < 1024 * 1024) return `${toPersianDigits((bytes / 1024).toFixed(1))} KB`;
  return `${toPersianDigits((bytes / (1024 * 1024)).toFixed(1))} MB`;
};

const buildYears = () => {
  const today = todayJalali();
  const years: number[] = [];
  for (let y = today.year + 1; y >= today.year - 8; y--) years.push(y);
  return years;
};

export default function MilkReceipts() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const today = todayJalali();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [receipts, setReceipts] = useState<MilkReceipt[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [year, setYear] = useState<number>(today.year);
  const [month, setMonth] = useState<number>(today.month);
  const [file, setFile] = useState<File | null>(null);

  const years = buildYears();

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("milk_receipts")
      .select("*")
      .order("year", { ascending: false })
      .order("month", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) {
      toast({ title: "خطا در دریافت قبوض", description: error.message, variant: "destructive" });
    } else {
      setReceipts((data ?? []) as MilkReceipt[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const resetForm = () => {
    setYear(today.year);
    setMonth(today.month);
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleSubmit = async () => {
    if (!file) {
      toast({ title: "فایل پیوست نشده", description: "لطفاً تصویر یا PDF قبض را انتخاب کنید.", variant: "destructive" });
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      toast({ title: "حجم فایل زیاد است", description: "حداکثر اندازه فایل ۲۰ مگابایت.", variant: "destructive" });
      return;
    }

    setSubmitting(true);
    try {
      const ext = file.name.split(".").pop() || "bin";
      const path = `${year}/${String(month).padStart(2, "0")}/${crypto.randomUUID()}.${ext}`;

      const { error: upErr } = await supabase.storage
        .from("milk-receipts")
        .upload(path, file, { contentType: file.type, upsert: false });
      if (upErr) throw upErr;

      const { error: insErr } = await supabase.from("milk_receipts").insert({
        year,
        month,
        file_path: path,
        file_name: file.name,
        file_type: file.type,
        file_size: file.size,
      });
      if (insErr) throw insErr;

      toast({ title: "قبض شیر ثبت شد", description: "فایل با موفقیت بارگذاری و ذخیره شد." });
      setOpen(false);
      resetForm();
      load();
    } catch (e: any) {
      toast({ title: "خطا در ثبت قبض", description: e.message ?? String(e), variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (r: MilkReceipt) => {
    if (!confirm("حذف این قبض شیر؟")) return;
    const { error: delStorage } = await supabase.storage.from("milk-receipts").remove([r.file_path]);
    if (delStorage) {
      toast({ title: "خطا", description: delStorage.message, variant: "destructive" });
      return;
    }
    const { error } = await supabase.from("milk_receipts").delete().eq("id", r.id);
    if (error) {
      toast({ title: "خطا در حذف", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "قبض حذف شد" });
    load();
  };

  const getUrl = (path: string) =>
    supabase.storage.from("milk-receipts").getPublicUrl(path).data.publicUrl;

  return (
    <div className="py-6 space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <button
          onClick={() => navigate("/dashboard")}
          className="touch-target rounded-xl p-2 hover:bg-secondary transition-colors"
          aria-label="بازگشت"
        >
          <ArrowRight className="w-5 h-5" />
        </button>
        <div className="flex-1 text-right">
          <h1 className="text-heading text-foreground flex items-center justify-end gap-2">
            <Milk className="w-6 h-6 text-primary" />
            قبض شیر
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            صورت‌حساب فروش شیر کارخانه
          </p>
        </div>
      </div>

      {/* Add new */}
      <Button
        onClick={() => setOpen(true)}
        className="w-full touch-target rounded-xl gap-2 text-body-lg shadow-[0_6px_20px_-8px_hsl(142_50%_36%/0.5)]"
        size="lg"
      >
        <Plus className="w-5 h-5" />
        قبض شیر جدید
      </Button>

      {/* Receipts wall */}
      <section>
        <h2 className="text-body-lg font-bold text-foreground mb-3">
          قبوض ثبت‌شده
        </h2>

        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin ml-2" />
            در حال بارگذاری...
          </div>
        ) : receipts.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-border bg-card p-10 text-center">
            <Milk className="w-10 h-10 text-muted-foreground/50 mx-auto mb-3" />
            <p className="text-body text-muted-foreground">
              هنوز قبضی ثبت نشده است
            </p>
            <p className="text-sm text-muted-foreground/70 mt-1">
              برای شروع، روی «قبض شیر جدید» بزنید
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {receipts.map((r) => {
              const url = getUrl(r.file_path);
              const isImg = (r.file_type ?? "").startsWith("image/");
              return (
                <article
                  key={r.id}
                  className="group rounded-2xl border border-border bg-card overflow-hidden hover:shadow-[0_8px_28px_-12px_hsl(142_50%_36%/0.3)] hover:border-primary/30 transition-all"
                >
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block aspect-[4/3] bg-secondary relative overflow-hidden"
                  >
                    {isImg ? (
                      <img
                        src={url}
                        alt={`قبض شیر ${jalaliMonthNames[r.month - 1]} ${r.year}`}
                        loading="lazy"
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-blue-50 to-blue-100">
                        <FileText className="w-12 h-12 text-blue-500" />
                        <span className="text-xs text-blue-700 font-medium">PDF</span>
                      </div>
                    )}
                    <div className="absolute top-2 right-2 rounded-lg bg-background/90 backdrop-blur-sm border border-border px-2.5 py-1 text-xs font-bold text-foreground flex items-center gap-1">
                      <Calendar className="w-3 h-3 text-primary" />
                      {toPersianDigits(r.year)}
                    </div>
                  </a>
                  <div className="p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-body font-bold text-foreground truncate">
                        {jalaliMonthNames[r.month - 1]} {toPersianDigits(r.year)}
                      </h3>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {formatSize(r.file_size)}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground truncate flex items-center gap-1">
                      {isImg ? <ImageIcon className="w-3 h-3" /> : <FileText className="w-3 h-3" />}
                      {r.file_name}
                    </p>
                    <div className="flex items-center gap-2 pt-1">
                      <Button
                        asChild
                        variant="outline"
                        size="sm"
                        className="flex-1 rounded-lg gap-1"
                      >
                        <a href={url} target="_blank" rel="noopener noreferrer" download={r.file_name ?? undefined}>
                          <Download className="w-4 h-4" />
                          مشاهده
                        </a>
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDelete(r)}
                        className="text-destructive hover:text-destructive hover:bg-destructive/10 rounded-lg"
                        aria-label="حذف"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* New Receipt Dialog */}
      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm(); }}>
        <DialogContent className="max-w-md rounded-2xl text-right" dir="rtl">
          <DialogHeader>
            <DialogTitle className="text-right flex items-center gap-2">
              <Milk className="w-5 h-5 text-primary" />
              قبض شیر جدید
            </DialogTitle>
            <DialogDescription className="text-right">
              سال و ماه قبض را انتخاب و فایل را پیوست کنید.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">سال</Label>
                <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
                  <SelectTrigger className="h-11 rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {years.map((y) => (
                      <SelectItem key={y} value={String(y)}>
                        {toPersianDigits(y)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">ماه</Label>
                <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
                  <SelectTrigger className="h-11 rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {jalaliMonthNames.map((m, i) => (
                      <SelectItem key={i} value={String(i + 1)}>
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm font-medium">پیوست فایل</Label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,application/pdf"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="hidden"
              />
              {!file ? (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full touch-target rounded-xl border-2 border-dashed border-primary/30 bg-primary/5 hover:bg-primary/10 hover:border-primary/50 transition-colors p-6 flex flex-col items-center justify-center gap-2"
                >
                  <Paperclip className="w-6 h-6 text-primary" />
                  <span className="text-body font-medium text-foreground">
                    انتخاب فایل
                  </span>
                  <span className="text-xs text-muted-foreground">
                    تصویر یا PDF — حداکثر ۲۰ مگابایت
                  </span>
                </button>
              ) : (
                <div className="flex items-center gap-3 rounded-xl border border-border bg-background p-3">
                  {file.type.startsWith("image/") ? (
                    <ImageIcon className="w-5 h-5 text-primary shrink-0" />
                  ) : (
                    <FileText className="w-5 h-5 text-primary shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground truncate">{file.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatSize(file.size)}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      setFile(null);
                      if (fileInputRef.current) fileInputRef.current.value = "";
                    }}
                    className="text-destructive hover:text-destructive shrink-0"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="outline"
              onClick={() => { setOpen(false); resetForm(); }}
              disabled={submitting}
              className="rounded-xl"
            >
              انصراف
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={submitting || !file}
              className="rounded-xl gap-2"
            >
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
              ثبت قبض
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
