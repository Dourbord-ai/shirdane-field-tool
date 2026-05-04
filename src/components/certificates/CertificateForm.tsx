// ============================================================
// CertificateForm.tsx — Add / Edit dialog. Multi-file upload
// (images + PDFs), Shamsi dates, optional auto-renewal.
// ============================================================

import { useEffect, useRef, useState } from 'react';
import { FileText, ImageIcon, Loader2, Upload, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import ShamsiDatePicker from '@/components/ShamsiDatePicker';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAuth } from '@/contexts/AuthContext';
import {
  CertificateRow,
  useCertificates,
  CertificateInput,
  RENEWAL_LEAD_TIME_OPTIONS,
  RenewalLeadTime,
} from '@/hooks/useCertificates';
import { uploadCertificateFiles } from '@/utils/uploadCertificateImage';

const DOC_TYPES = [
  'گواهینامه',
  'مجوز',
  'پروانه',
  'مدارک هویتی حقوقی و حقیقی',
] as const;

const isIdentityDoc = (t: string) => t === 'مدارک هویتی حقوقی و حقیقی';

const isPdfUrl = (url: string) => /\.pdf(\?.*)?$/i.test(url);
const isImageUrl = (url: string) => /\.(png|jpe?g|gif|webp|bmp|svg)(\?.*)?$/i.test(url);

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  certificate?: CertificateRow | null;
}

const CertificateForm = ({ open, onOpenChange, certificate }: Props) => {
  const { user } = useAuth();
  const { create, update } = useCertificates();

  const [title, setTitle] = useState('');
  const [docType, setDocType] = useState<string>(DOC_TYPES[0]);
  const [issuer, setIssuer] = useState('');
  const [docNumber, setDocNumber] = useState('');
  const [issueDate, setIssueDate] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [description, setDescription] = useState('');
  const [renewalLeadTime, setRenewalLeadTime] = useState<RenewalLeadTime | 'none'>('none');
  const [renewalCustomDate, setRenewalCustomDate] = useState<string>('');

  const [existingFiles, setExistingFiles] = useState<string[]>([]);
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [newPreviews, setNewPreviews] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (certificate) {
      setTitle(certificate.title);
      setDocType(certificate.doc_type || DOC_TYPES[0]);
      setIssuer(certificate.issuer ?? '');
      setDocNumber(certificate.doc_number ?? '');
      setIssueDate(certificate.issue_date_shamsi ?? '');
      setExpiryDate(certificate.expiry_date_shamsi ?? '');
      setDescription(certificate.description ?? '');
      setRenewalLeadTime(certificate.renewal_lead_time ?? 'none');
      setRenewalCustomDate(certificate.renewal_custom_date_shamsi ?? '');

      const fromArray = certificate.attachment_urls ?? [];
      const fromLegacy = certificate.image_url ? [certificate.image_url] : [];
      setExistingFiles(fromArray.length > 0 ? fromArray : fromLegacy);
      setNewFiles([]);
      setNewPreviews([]);
    } else {
      setTitle('');
      setDocType(DOC_TYPES[0]);
      setIssuer('');
      setDocNumber('');
      setIssueDate('');
      setExpiryDate('');
      setDescription('');
      setRenewalLeadTime('none');
      setRenewalCustomDate('');
      setExistingFiles([]);
      setNewFiles([]);
      setNewPreviews([]);
    }
  }, [open, certificate]);

  const handlePickFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const arr = Array.from(files);
    setNewFiles((prev) => [...prev, ...arr]);
    setNewPreviews((prev) => [...prev, ...arr.map((f) => URL.createObjectURL(f))]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeNewFile = (idx: number) => {
    setNewPreviews((prev) => {
      const url = prev[idx];
      if (url) URL.revokeObjectURL(url);
      return prev.filter((_, i) => i !== idx);
    });
    setNewFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const removeExistingFile = (url: string) => {
    setExistingFiles((prev) => prev.filter((u) => u !== url));
  };

  useEffect(() => {
    return () => {
      newPreviews.forEach((u) => URL.revokeObjectURL(u));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = async () => {
    if (!title.trim()) {
      toast.error('نام مدرک الزامی است');
      return;
    }
    if (renewalLeadTime === 'custom' && !renewalCustomDate) {
      toast.error('برای حالت «تاریخ مشخص» باید تاریخ شروع تمدید را انتخاب کنید');
      return;
    }
    if (submitting) return;
    setSubmitting(true);

    try {
      let uploadedUrls: string[] = [];
      if (newFiles.length > 0) {
        uploadedUrls = await uploadCertificateFiles(newFiles);
        if (uploadedUrls.length < newFiles.length) {
          toast.error(`${newFiles.length - uploadedUrls.length} فایل آپلود نشد`);
        }
      }

      const finalAttachments = [...existingFiles, ...uploadedUrls];
      const finalImageUrl = finalAttachments[0] ?? null;

      const finalLeadTime: RenewalLeadTime | null =
        renewalLeadTime === 'none' ? null : renewalLeadTime;
      const finalCustomDate: string | null =
        finalLeadTime === 'custom' ? renewalCustomDate || null : null;

      const triggerUnchanged =
        certificate &&
        certificate.renewal_lead_time === finalLeadTime &&
        certificate.expiry_date_shamsi === (expiryDate || null) &&
        (certificate.renewal_custom_date_shamsi ?? null) === finalCustomDate;

      const payload: CertificateInput = {
        title: title.trim(),
        doc_type: docType,
        issuer: issuer.trim() || null,
        doc_number: docNumber.trim() || null,
        issue_date_shamsi: issueDate || null,
        expiry_date_shamsi: expiryDate || null,
        description: description.trim() || null,
        image_url: finalImageUrl,
        attachment_urls: finalAttachments,
        created_by:
          certificate?.created_by ?? user?.fullName ?? user?.username ?? null,
        renewal_lead_time: finalLeadTime,
        renewal_custom_date_shamsi: finalCustomDate,
        renewal_ticket_id: triggerUnchanged ? certificate!.renewal_ticket_id : null,
        renewal_ticket_created_at: triggerUnchanged
          ? certificate!.renewal_ticket_created_at
          : null,
      };

      if (certificate) {
        await update(certificate.id, payload);
        toast.success('مدرک با موفقیت ویرایش شد');
      } else {
        await create(payload);
        toast.success('مدرک با موفقیت ثبت شد');
      }

      onOpenChange(false);
    } catch (err) {
      console.error(err);
      toast.error('خطا در ذخیره مدرک');
    } finally {
      setSubmitting(false);
    }
  };

  const totalCount = existingFiles.length + newFiles.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto [&>button]:hidden">
        <DialogHeader>
          <DialogTitle className="text-right">
            {certificate ? 'ویرایش مدرک' : 'افزودن مدرک جدید'}
          </DialogTitle>
          <DialogDescription className="text-right">
            اطلاعات کامل مدرک را وارد کنید. فیلدهای ستاره‌دار الزامی هستند.
          </DialogDescription>
        </DialogHeader>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <Label className="block text-right">
              تصاویر و فایل‌های مدرک
              {totalCount > 0 && (
                <span className="mr-2 text-xs text-muted-foreground">({totalCount} فایل)</span>
              )}
            </Label>
            <span className="text-[11px] text-muted-foreground">
              تصویر یا PDF — چند فایل همزمان
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {existingFiles.map((url) => (
              <FileTile key={url} url={url} onRemove={() => removeExistingFile(url)} />
            ))}

            {newFiles.map((file, idx) => (
              <FileTile
                key={`new-${idx}-${file.name}`}
                url={newPreviews[idx]}
                fileName={file.name}
                isPdf={file.type === 'application/pdf' || /\.pdf$/i.test(file.name)}
                onRemove={() => removeNewFile(idx)}
              />
            ))}

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex aspect-square flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-muted/30 p-3 text-center text-muted-foreground transition hover:border-primary hover:text-primary"
            >
              <Upload className="h-6 w-6" />
              <span className="text-xs leading-tight">
                {totalCount === 0 ? 'افزودن تصویر یا PDF' : 'افزودن فایل جدید'}
              </span>
            </button>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,application/pdf"
            multiple
            className="hidden"
            onChange={(e) => handlePickFiles(e.target.files)}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <Label className="mb-1.5 block text-right">
              نام مدرک <span className="text-destructive">*</span>
            </Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="مثلاً پروانه بهره‌برداری"
              dir="rtl"
            />
          </div>

          <div>
            <Label className="mb-1.5 block text-right">نوع مدرک</Label>
            <Select
              value={docType}
              onValueChange={(v) => {
                setDocType(v);
                if (isIdentityDoc(v)) {
                  setIssuer('');
                  setDocNumber('');
                  setIssueDate('');
                  setExpiryDate('');
                  setRenewalLeadTime('none');
                  setRenewalCustomDate('');
                }
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DOC_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {!isIdentityDoc(docType) && (
            <>
              <div>
                <Label className="mb-1.5 block text-right">صادرکننده</Label>
                <Input
                  value={issuer}
                  onChange={(e) => setIssuer(e.target.value)}
                  placeholder="مثلاً سازمان دامپزشکی"
                  dir="rtl"
                />
              </div>

              <div>
                <Label className="mb-1.5 block text-right">شماره مدرک</Label>
                <Input
                  value={docNumber}
                  onChange={(e) => setDocNumber(e.target.value)}
                  placeholder="123456"
                  dir="ltr"
                />
              </div>

              <div>
                <Label className="mb-1.5 block text-right">تاریخ صدور</Label>
                <ShamsiDatePicker
                  value={issueDate}
                  onChange={setIssueDate}
                  placeholder="انتخاب تاریخ صدور"
                />
              </div>

              <div>
                <Label className="mb-1.5 block text-right">تاریخ انقضا</Label>
                <ShamsiDatePicker
                  value={expiryDate}
                  onChange={setExpiryDate}
                  placeholder="انتخاب تاریخ انقضا"
                />
              </div>

              <div className="md:col-span-2">
                <Label className="mb-1.5 block text-right">شروع فرایند تمدید</Label>
                <Select
                  value={renewalLeadTime}
                  onValueChange={(v) => setRenewalLeadTime(v as RenewalLeadTime | 'none')}
                  disabled={!expiryDate}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="انتخاب زمان شروع تمدید" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">بدون یادآوری خودکار</SelectItem>
                    {RENEWAL_LEAD_TIME_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {renewalLeadTime === 'custom' && (
                  <div className="mt-3">
                    <Label className="mb-1.5 block text-right">
                      تاریخ شروع تمدید <span className="text-destructive">*</span>
                    </Label>
                    <ShamsiDatePicker
                      value={renewalCustomDate}
                      onChange={setRenewalCustomDate}
                      placeholder="انتخاب تاریخ شروع تمدید"
                    />
                  </div>
                )}

                <p className="mt-1.5 text-xs text-muted-foreground text-right">
                  {!expiryDate
                    ? 'برای فعال‌سازی، ابتدا تاریخ انقضا را وارد کنید.'
                    : renewalLeadTime === 'custom'
                    ? 'در تاریخ انتخاب‌شده، یادآوری تمدید در سیستم ثبت می‌شود.'
                    : 'در زمان تعیین‌شده قبل از انقضا، یادآوری تمدید در سیستم ثبت می‌شود.'}
                </p>
              </div>
            </>
          )}
        </div>

        <div>
          <Label className="mb-1.5 block text-right">توضیحات</Label>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="توضیحات اختیاری در مورد این مدرک..."
            dir="rtl"
            className="min-h-[100px]"
          />
        </div>

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            انصراف
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting && <Loader2 className="ml-2 h-4 w-4 animate-spin" />}
            {certificate ? 'ذخیره تغییرات' : 'ثبت مدرک'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

interface FileTileProps {
  url: string;
  fileName?: string;
  isPdf?: boolean;
  onRemove: () => void;
}

const FileTile = ({ url, fileName, isPdf, onRemove }: FileTileProps) => {
  const looksLikePdf = isPdf ?? isPdfUrl(url);
  const looksLikeImage = !looksLikePdf && (isImageUrl(url) || url.startsWith('blob:'));

  return (
    <div className="relative aspect-square overflow-hidden rounded-xl border border-border bg-muted/40">
      {looksLikeImage ? (
        <img src={url} alt={fileName ?? 'پیش‌نمایش'} className="h-full w-full object-cover" />
      ) : looksLikePdf ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex h-full w-full flex-col items-center justify-center gap-1 bg-rose-50 p-2 text-rose-700 transition hover:bg-rose-100 dark:bg-rose-950/30 dark:text-rose-300"
          title={fileName ?? 'PDF'}
        >
          <FileText className="h-8 w-8" />
          <span className="line-clamp-2 px-1 text-center text-[10px] font-medium leading-tight">
            {fileName ?? 'PDF'}
          </span>
        </a>
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-muted-foreground">
          <ImageIcon className="h-6 w-6" />
          <span className="text-[10px]">فایل</span>
        </div>
      )}

      <span
        role="button"
        tabIndex={0}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          onRemove();
        }}
        className="absolute right-1.5 top-1.5 cursor-pointer rounded-full bg-destructive p-1 text-destructive-foreground shadow"
        aria-label="حذف فایل"
      >
        <X className="h-3.5 w-3.5" />
      </span>
    </div>
  );
};

export default CertificateForm;
