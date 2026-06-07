// =============================================================================
// ImportFileFilter.tsx
// -----------------------------------------------------------------------------
// Picker dialog that lets the operator narrow the bank-transaction list to a
// single Excel import. There is NO dedicated "uploaded files" table — every
// bank-transactions row already carries the columns we need:
//
//   • imported_file_name   – the UUID-prefixed storage name (acts as file ID)
//   • original_file_name   – the human-uploaded filename
//   • imported_by          – uploader's app_users.id (NULL for legacy rows)
//   • imported_at          – upload timestamp
//
// So instead of adding a migration we BUILD the file list on the fly with a
// client-side GROUP BY over a single PostgREST query, then enrich uploader
// IDs into names via a second `app_users` query. Both queries are read-only.
// =============================================================================
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, FileSpreadsheet, X, Check } from "lucide-react";
import { JalaliDateCell } from "@/components/finance/atoms";

// Public props. The parent owns the current selection (so it can keep it in
// sync with `?import_file=` in the URL); we only emit a new selection here.
interface Props {
  open: boolean;
  onClose: () => void;
  selected: string | null;             // current imported_file_name (or null)
  onSelect: (fileName: string | null) => void;
}

// Row shape rendered inside the picker. Each row represents ONE distinct
// imported_file_name (which is what `.eq("imported_file_name", …)` filters on).
interface FileRow {
  imported_file_name: string;
  original_file_name: string | null;
  imported_by: string | null;
  imported_at: string | null;          // earliest imported_at within this group
  tx_count: number;
}

// Hard cap on how many distinct files we surface. 500 is far more than any
// realistic operator workflow but keeps the in-memory aggregation cheap.
const MAX_FILES = 500;

export default function ImportFileFilter({ open, onClose, selected, onSelect }: Props) {
  // Three-state UI: loading / error / data. We refetch every time the dialog
  // opens so the operator always sees the freshest upload history.
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<FileRow[]>([]);

  // Free-text search filters the in-memory list by original/stored filename
  // OR uploader display name. We resolve uploader names below so the filter
  // can match them too.
  const [search, setSearch] = useState("");
  // Uploader id → display name lookup. Built after we know which user ids
  // appear in the file list, so we only fetch the users we actually need.
  const [uploaderNames, setUploaderNames] = useState<Record<string, string>>({});

  useEffect(() => {
    // Don't run the queries while the dialog is hidden — saves a round-trip
    // on every parent re-render that doesn't open us.
    if (!open) return;

    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        // STEP 1 — fetch ALL non-null import-file rows.
        // We intentionally select only the four columns we need so PostgREST
        // returns a compact payload even when the table holds thousands of
        // transactions. Order by imported_at DESC so when we group below the
        // first occurrence per group is naturally the most-recent timestamp.
        //
        // NOTE: Supabase has a hard 1000-row default. We bump to 5000 via
        // `.range(0, 4999)` because a single uploaded file commonly contains
        // hundreds of transactions, and we need enough raw rows to discover
        // every distinct file. The GROUP BY happens client-side.
        const { data, error: e1 } = await supabase
          .from("finance_bank_transactions")
          .select("imported_file_name, original_file_name, imported_by, imported_at")
          .not("imported_file_name", "is", null)
          .eq("is_deleted", false)
          .order("imported_at", { ascending: false })
          .range(0, 4999);
        if (e1) throw e1;

        // STEP 2 — group client-side by imported_file_name. We pick the
        // first-seen original_file_name / imported_by / imported_at because
        // the rows are already DESC-ordered by upload time, so "first seen"
        // == "most recent metadata for that file id".
        const grouped = new Map<string, FileRow>();
        for (const r of (data ?? []) as any[]) {
          const key = r.imported_file_name as string;
          const existing = grouped.get(key);
          if (existing) {
            existing.tx_count += 1;
          } else {
            grouped.set(key, {
              imported_file_name: key,
              original_file_name: r.original_file_name ?? null,
              imported_by: r.imported_by ?? null,
              imported_at: r.imported_at ?? null,
              tx_count: 1,
            });
          }
        }

        const list = Array.from(grouped.values())
          // Newest upload first — feels natural in a "recent imports" picker.
          .sort((a, b) => (b.imported_at ?? "").localeCompare(a.imported_at ?? ""))
          .slice(0, MAX_FILES);

        if (cancelled) return;
        setRows(list);

        // STEP 3 — fetch uploader display names. We collect distinct UUIDs,
        // then a single .in() query resolves them all in one round-trip.
        // For legacy rows where imported_by is NULL the UI shows "—".
        const uploaderIds = Array.from(
          new Set(list.map((r) => r.imported_by).filter(Boolean) as string[]),
        );
        if (uploaderIds.length) {
          const { data: users } = await supabase
            .from("app_users")
            .select("id, username, full_name")
            .in("id", uploaderIds);
          if (!cancelled && users) {
            const map: Record<string, string> = {};
            for (const u of users as any[]) {
              map[u.id] = u.full_name?.trim() || u.username || u.id;
            }
            setUploaderNames(map);
          }
        } else {
          setUploaderNames({});
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "خطا در دریافت فهرست فایل‌ها.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open]);

  // Derived list: apply the free-text filter client-side. This is fine
  // because the master list is capped at MAX_FILES = 500.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const uploader = (r.imported_by && uploaderNames[r.imported_by]) || "";
      return (
        (r.original_file_name ?? "").toLowerCase().includes(q) ||
        r.imported_file_name.toLowerCase().includes(q) ||
        uploader.toLowerCase().includes(q)
      );
    });
  }, [rows, search, uploaderNames]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>فیلتر بر اساس فایل اکسل</DialogTitle>
          <DialogDescription>
            با انتخاب یک فایل، لیست تراکنش‌ها فقط به تراکنش‌های واردشده از آن
            فایل محدود می‌شود. این فیلتر با سایر فیلترها ترکیب می‌شود.
          </DialogDescription>
        </DialogHeader>

        {/* Search input + clear-filter shortcut. The clear button is shown
            only when a filter is currently active so the UI stays clean. */}
        <div className="flex items-center gap-2">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="جستجو در نام فایل یا آپلودکننده…"
          />
          {selected && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                onSelect(null);
                onClose();
              }}
            >
              <X className="w-4 h-4 ml-1" />
              حذف فیلتر
            </Button>
          )}
        </div>

        {/* Body — loading / error / list. We render the list inside a fixed
            max-height scroller so the dialog never grows past the viewport
            even when 500 files are returned. */}
        <div className="max-h-[60vh] overflow-y-auto rounded-md border bg-card">
          {loading && (
            <div className="flex items-center justify-center py-10 text-muted-foreground text-sm">
              <Loader2 className="w-4 h-4 animate-spin ml-2" /> در حال بارگذاری…
            </div>
          )}

          {!loading && error && (
            <div className="m-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {!loading && !error && filtered.length === 0 && (
            <div className="py-10 text-center text-sm text-muted-foreground">
              فایلی یافت نشد.
            </div>
          )}

          {!loading && !error && filtered.length > 0 && (
            <ul className="divide-y divide-border">
              {filtered.map((r) => {
                const isSelected = selected === r.imported_file_name;
                const uploader =
                  (r.imported_by && uploaderNames[r.imported_by]) || "—";
                return (
                  <li key={r.imported_file_name}>
                    <button
                      type="button"
                      onClick={() => {
                        // Single-select: clicking emits selection and closes.
                        onSelect(r.imported_file_name);
                        onClose();
                      }}
                      className={`w-full text-right px-3 py-2.5 hover:bg-muted/40 transition-colors flex items-start gap-3 ${
                        isSelected ? "bg-primary/10" : ""
                      }`}
                    >
                      <FileSpreadsheet className="w-5 h-5 mt-0.5 text-primary shrink-0" />
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-foreground truncate">
                            {r.original_file_name || "—"}
                          </span>
                          {isSelected && (
                            <Check className="w-4 h-4 text-primary shrink-0" />
                          )}
                        </div>
                        <div
                          className="text-[11px] text-muted-foreground font-mono truncate"
                          title={r.imported_file_name}
                        >
                          {r.imported_file_name}
                        </div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                          <span>
                            تاریخ:{" "}
                            <span className="text-foreground">
                              <JalaliDateCell value={r.imported_at} withTime />
                            </span>
                          </span>
                          <span>
                            آپلودکننده:{" "}
                            <span className="text-foreground">{uploader}</span>
                          </span>
                          <span>
                            تعداد تراکنش:{" "}
                            <span className="text-foreground font-bold tabular-nums">
                              {r.tx_count.toLocaleString("fa-IR")}
                            </span>
                          </span>
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
