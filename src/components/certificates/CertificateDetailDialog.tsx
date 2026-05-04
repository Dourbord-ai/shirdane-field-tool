// ============================================================
// CertificateDetailDialog.tsx — Read-only viewer.
// ============================================================

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Download, ExternalLink, FileText, Pencil, Trash2, BellRing } from 'lucide-react';
import {
  CertificateRow,
  getCertificateStatus,
  RENEWAL_LEAD_TIME_OPTIONS,
} from '@/hooks/useCertificates';
import StatusBadge from './StatusBadge';
import { useState, useEffect } from 'react';

interface Props {
  certificate: CertificateRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit: (cert: CertificateRow) => void;
  onDelete: (cert: CertificateRow) => void;
}

const isPdfUrl = (url: string) => /\.pdf(\?.*)?$/i.test(url);
const isImageUrl = (url: string) => /\.(png|jpe?g|gif|webp|bmp|svg)(\?.*)?$/i.test(url);

const CertificateDetailDialog = ({
  certificate,
  open,
  onOpenChange,
  onEdit,
  onDelete,
}: Props) => {
  const attachments: string[] = certificate
    ? certificate.attachment_urls && certificate.attachment_urls.length > 0
      ? certificate.attachment_urls
      : certificate.image_url
      ? [certificate.image_url]
      : []
    : [];

  const [activeIdx, setActiveIdx] = useState(0);
  useEffect(() => {
    setActiveIdx(0);
  }, [certificate?.id]);

  if (!certificate) return null;
  const { status, daysRemaining } = getCertificateStatus(certificate.expiry_date_shamsi);

  const activeUrl = attachments[activeIdx];
  const activeIsPdf = activeUrl ? isPdfUrl(activeUrl) : false;
  const activeIsImage = activeUrl ? isImageUrl(activeUrl) : false;

  const Row = ({ label, value }: { label: string; value: string | null }) => {
    if (!value) return null;
    return (
      <div className="flex items-start justify-between gap-3 border-b border-border py-2 last:border-b-0">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="text-sm font-medium text-foreground">{value}</span>
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between gap-3 text-right">
            <span className="truncate">{certificate.title}</span>
            <StatusBadge status={status} daysRemaining={daysRemaining} />
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-border bg-muted/30 p-3">
            {attachments.length === 0 ? (
              <div className="flex h-72 items-center justify-center text-sm text-muted-foreground md:h-96">
                فایلی برای این مدرک ثبت نشده است
              </div>
            ) : (
              <>
                {activeIsImage ? (
                  <a href={activeUrl} target="_blank" rel="noopener noreferrer" className="block">
                    <img
                      src={activeUrl}
                      alt={certificate.title}
                      className="h-72 w-full rounded-lg object-contain md:h-96"
                    />
                  </a>
                ) : activeIsPdf ? (
                  <a
                    href={activeUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex h-72 w-full flex-col items-center justify-center gap-3 rounded-lg bg-rose-50 text-rose-700 transition hover:bg-rose-100 md:h-96 dark:bg-rose-950/30 dark:text-rose-300"
                  >
                    <FileText className="h-16 w-16" />
                    <span className="text-sm font-semibold">باز کردن فایل PDF</span>
                    <span className="text-xs opacity-70">برای مشاهده روی این کادر کلیک کنید</span>
                  </a>
                ) : (
                  <a
                    href={activeUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex h-72 w-full items-center justify-center text-sm text-primary underline md:h-96"
                  >
                    دانلود فایل
                  </a>
                )}

                {attachments.length > 1 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {attachments.map((url, idx) => {
                      const tIsPdf = isPdfUrl(url);
                      const tIsImg = isImageUrl(url);
                      const isActive = idx === activeIdx;
                      return (
                        <button
                          key={url}
                          type="button"
                          onClick={() => setActiveIdx(idx)}
                          className={`relative h-16 w-16 overflow-hidden rounded-md border-2 transition ${
                            isActive ? 'border-primary' : 'border-transparent hover:border-border'
                          }`}
                          aria-label={`فایل ${idx + 1}`}
                        >
                          {tIsImg ? (
                            <img src={url} alt="" className="h-full w-full object-cover" />
                          ) : tIsPdf ? (
                            <div className="flex h-full w-full flex-col items-center justify-center bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">
                              <FileText className="h-5 w-5" />
                              <span className="text-[9px]">PDF</span>
                            </div>
                          ) : (
                            <div className="flex h-full w-full items-center justify-center bg-muted text-[10px] text-muted-foreground">
                              فایل
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>

          <div className="flex flex-col">
            <div className="rounded-xl border border-border bg-card p-4">
              <Row label="نوع مدرک" value={certificate.doc_type} />
              <Row label="صادرکننده" value={certificate.issuer} />
              <Row label="شماره" value={certificate.doc_number} />
              <Row label="تاریخ صدور" value={certificate.issue_date_shamsi} />
              <Row label="تاریخ انقضا" value={certificate.expiry_date_shamsi} />
              <Row label="ثبت‌کننده" value={certificate.created_by} />
            </div>

            {certificate.renewal_lead_time && (
              <div className="mt-3 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/40 dark:bg-amber-950/30">
                <div className="rounded-lg bg-amber-100 p-2 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300">
                  <BellRing className="h-4 w-4" />
                </div>
                <div className="flex-1">
                  <p className="text-xs text-amber-900/80 dark:text-amber-200/80">
                    شروع فرایند تمدید
                  </p>
                  <p className="text-sm font-semibold text-amber-900 dark:text-amber-100">
                    {certificate.renewal_lead_time === 'custom'
                      ? `تاریخ مشخص: ${certificate.renewal_custom_date_shamsi ?? '—'}`
                      : RENEWAL_LEAD_TIME_OPTIONS.find(
                          (o) => o.value === certificate.renewal_lead_time
                        )?.label ?? '—'}
                  </p>
                  <p className="mt-1 text-xs text-amber-800/70 dark:text-amber-200/60">
                    با رسیدن زمان مقرر، یادآوری در سیستم ثبت می‌شود.
                  </p>
                </div>
              </div>
            )}

            {certificate.description && (
              <div className="mt-3 rounded-xl border border-border bg-card p-4">
                <p className="mb-2 text-xs text-muted-foreground">توضیحات</p>
                <p className="whitespace-pre-wrap text-sm text-foreground">
                  {certificate.description}
                </p>
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-2">
              {activeUrl && (
                <Button asChild variant="outline" size="sm">
                  <a href={activeUrl} target="_blank" rel="noopener noreferrer" download>
                    <Download className="ml-1 h-4 w-4" />
                    دانلود
                  </a>
                </Button>
              )}
              {activeUrl && (
                <Button asChild variant="outline" size="sm">
                  <a href={activeUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="ml-1 h-4 w-4" />
                    مشاهده اصلی
                  </a>
                </Button>
              )}
              <div className="flex-1" />
              <Button variant="outline" size="sm" onClick={() => onEdit(certificate)}>
                <Pencil className="ml-1 h-4 w-4" />
                ویرایش
              </Button>
              <Button variant="destructive" size="sm" onClick={() => onDelete(certificate)}>
                <Trash2 className="ml-1 h-4 w-4" />
                حذف
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default CertificateDetailDialog;
