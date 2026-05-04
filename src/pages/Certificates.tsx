// ============================================================
// Certificates.tsx — مدارک و مجوزها (renders inside AppLayout).
// ============================================================

import { useMemo, useState } from 'react';
import {
  Award,
  Plus,
  Search,
  X,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Files,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';

import {
  CertificateRow,
  CertificateStatus,
  getCertificateStatus,
  useCertificates,
} from '@/hooks/useCertificates';
import CertificateCard from '@/components/certificates/CertificateCard';
import CertificateForm from '@/components/certificates/CertificateForm';
import CertificateDetailDialog from '@/components/certificates/CertificateDetailDialog';

type FilterValue = 'all' | CertificateStatus;

const Certificates = () => {
  const { items, loading, remove, refresh } = useCertificates();

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterValue>('all');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CertificateRow | null>(null);
  const [detail, setDetail] = useState<CertificateRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CertificateRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await refresh();
      toast.success('لیست مدارک به‌روزرسانی شد');
    } catch (err) {
      console.error(err);
      toast.error('خطا در به‌روزرسانی');
    } finally {
      setRefreshing(false);
    }
  };

  const enriched = useMemo(
    () =>
      items.map((c) => ({
        cert: c,
        ...getCertificateStatus(c.expiry_date_shamsi),
      })),
    [items]
  );

  const summary = useMemo(() => {
    const counters = { valid: 0, expiring: 0, expired: 0, none: 0 };
    enriched.forEach((e) => {
      counters[e.status] += 1;
    });
    return { total: items.length, ...counters };
  }, [enriched, items.length]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return enriched.filter(({ cert, status }) => {
      if (filter !== 'all' && status !== filter) return false;
      if (!q) return true;
      return (
        cert.title.toLowerCase().includes(q) ||
        (cert.issuer ?? '').toLowerCase().includes(q) ||
        (cert.doc_number ?? '').toLowerCase().includes(q)
      );
    });
  }, [enriched, search, filter]);

  const openAdd = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const openEdit = (cert: CertificateRow) => {
    setDetail(null);
    setEditing(cert);
    setFormOpen(true);
  };

  const handleDeleteConfirmed = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      await remove(deleteTarget.id);
      toast.success('مدرک حذف شد');
      setDeleteTarget(null);
      setDetail(null);
    } catch (err) {
      console.error(err);
      toast.error('خطا در حذف مدرک');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="py-6 animate-fade-in">
      <div className="mb-5 flex items-center gap-3">
        <div className="inline-flex rounded-2xl bg-primary p-3">
          <Award className="h-6 w-6 text-primary-foreground" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-foreground md:text-2xl">مدارک و مجوزها</h1>
          <p className="text-xs text-muted-foreground">
            مدیریت مرکزی گواهینامه‌ها، مجوزها و پروانه‌های دامداری
          </p>
        </div>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <SummaryCard label="کل مدارک" value={summary.total} icon={Files} tone="primary" />
        <SummaryCard label="معتبر" value={summary.valid} icon={CheckCircle2} tone="emerald" />
        <SummaryCard label="نزدیک انقضا" value={summary.expiring} icon={AlertTriangle} tone="amber" />
        <SummaryCard label="منقضی شده" value={summary.expired} icon={XCircle} tone="red" />
      </div>

      <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="جستجو در نام، صادرکننده، شماره..."
            className="pr-9"
            dir="rtl"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground hover:bg-accent"
              aria-label="پاک کردن جستجو"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <Select value={filter} onValueChange={(v) => setFilter(v as FilterValue)}>
          <SelectTrigger className="md:w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">همه مدارک</SelectItem>
            <SelectItem value="valid">🟢 معتبر</SelectItem>
            <SelectItem value="expiring">🟡 نزدیک انقضا</SelectItem>
            <SelectItem value="expired">🔴 منقضی شده</SelectItem>
            <SelectItem value="none">بدون تاریخ انقضا</SelectItem>
          </SelectContent>
        </Select>

        <Button
          type="button"
          variant="outline"
          onClick={handleRefresh}
          disabled={refreshing || loading}
          className="md:w-auto"
          aria-label="به‌روزرسانی لیست"
        >
          <RefreshCw className={`ml-1 h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          به‌روزرسانی
        </Button>

        <Button onClick={openAdd} className="md:w-auto">
          <Plus className="ml-1 h-4 w-4" />
          افزودن مدرک
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="ml-2 h-5 w-5 animate-spin" />
          در حال بارگذاری مدارک...
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center">
          <Award className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
          <p className="mb-4 text-sm text-muted-foreground">
            {items.length === 0
              ? 'هنوز هیچ مدرکی ثبت نشده است.'
              : 'هیچ مدرکی با این جستجو/فیلتر یافت نشد.'}
          </p>
          {items.length === 0 && (
            <Button onClick={openAdd}>
              <Plus className="ml-1 h-4 w-4" />
              افزودن اولین مدرک
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:gap-4 lg:grid-cols-4 xl:grid-cols-5">
          {visible.map(({ cert }) => (
            <CertificateCard key={cert.id} certificate={cert} onClick={() => setDetail(cert)} />
          ))}
        </div>
      )}

      <CertificateForm open={formOpen} onOpenChange={setFormOpen} certificate={editing} />

      <CertificateDetailDialog
        certificate={detail}
        open={!!detail}
        onOpenChange={(o) => !o && setDetail(null)}
        onEdit={openEdit}
        onDelete={(c) => setDeleteTarget(c)}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف مدرک</AlertDialogTitle>
            <AlertDialogDescription>
              آیا از حذف «{deleteTarget?.title}» اطمینان دارید؟ این عمل قابل بازگشت نیست.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>خیر</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleDeleteConfirmed();
              }}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting && <Loader2 className="ml-2 h-4 w-4 animate-spin" />}
              بله، حذف کن
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

const SummaryCard = ({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number;
  icon: typeof Files;
  tone: 'primary' | 'emerald' | 'amber' | 'red';
}) => {
  const toneClasses: Record<typeof tone, string> = {
    primary: 'bg-primary/10 text-primary',
    emerald: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
    amber: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
    red: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  };

  return (
    <div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3 shadow-sm">
      <div className={`inline-flex rounded-xl p-2 ${toneClasses[tone]}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <p className="truncate text-xs text-muted-foreground">{label}</p>
        <p className="text-lg font-bold leading-tight text-foreground">{value}</p>
      </div>
    </div>
  );
};

export default Certificates;
