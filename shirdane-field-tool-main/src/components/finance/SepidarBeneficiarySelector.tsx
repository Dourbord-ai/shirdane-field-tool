// SepidarBeneficiarySelector
// ---------------------------------------------------------------------------
// Searchable async selector that fetches the beneficiary list from Sepidar
// via the `sepidar-beneficiaries` edge function (NEVER directly from Supabase
// or SQL Server). It is mobile-first, RTL, and emits the full selected row
// so the caller can snapshot the relevant fields onto its own record.
// ---------------------------------------------------------------------------
import { useEffect, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, Search, X, AlertTriangle, RefreshCw } from "lucide-react";
import { formatMoney } from "@/lib/finance";
import { getSepidarBeneficiaries, type SepidarBeneficiary } from "@/lib/sepidar";

interface Props {
  /** Currently selected beneficiary id (stringified) — used to display the chip. */
  value: string | null;
  /** Called with (id|null, fullRow|undefined) so parents can snapshot any field. */
  onChange: (id: string | null, beneficiary?: SepidarBeneficiary) => void;
  placeholder?: string;
  /** Optional pre-populated label when value is set but the list hasn't loaded yet. */
  fallbackLabel?: string | null;
}

// Cache the beneficiary list at the module level so multiple selectors on the
// same page (typical for payment requests with multiple rows) only trigger
// ONE network round-trip to Sepidar.
let cachedList: SepidarBeneficiary[] | null = null;
let inflight: Promise<SepidarBeneficiary[]> | null = null;
async function loadBeneficiaries(force = false): Promise<SepidarBeneficiary[]> {
  if (!force && cachedList) return cachedList;
  if (!force && inflight) return inflight;
  inflight = getSepidarBeneficiaries()
    .then((r) => {
      cachedList = r.data || [];
      return cachedList;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function SepidarBeneficiarySelector({ value, onChange, placeholder = "انتخاب ذینفع از سپیدار", fallbackLabel }: Props) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<SepidarBeneficiary[]>(cachedList || []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  // Debounce the search so typing on mobile feels smooth and we don't filter
  // on every keystroke when the list is large.
  const [debounced, setDebounced] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Pull the selected row out of the list so we can display chip details
  // (name + dl_code) without forcing the caller to pass them in.
  const selected = useMemo(
    () => (value ? list.find((b) => String(b.beneficiary_id) === String(value)) || null : null),
    [value, list],
  );

  // Fetch on open (uses cache after first hit). We keep the list in module
  // cache so re-opening the dialog feels instant.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(null);
    if (!cachedList) setLoading(true);
    loadBeneficiaries()
      .then((rows) => {
        if (cancelled) return;
        setList(rows);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "خطا در دریافت ذینفعان از سپیدار");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Also do a silent prefetch on mount so the first open is instant.
  useEffect(() => {
    if (!cachedList) void loadBeneficiaries().then(setList).catch(() => {/* silent */});
  }, []);

  // Debounce: wait 200ms after the user stops typing before filtering.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebounced(query.trim().toLowerCase()), 200);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  // Client-side filtering across the requested searchable fields.
  const filtered = useMemo(() => {
    if (!debounced) return list.slice(0, 200); // cap initial render for perf
    const q = debounced;
    return list.filter((b) => {
      const hay = [
        b.beneficiary_name,
        b.dl_code,
        b.national_code,
        b.phone,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [list, debounced]);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const rows = await loadBeneficiaries(true);
      setList(rows);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "خطا در بارگذاری مجدد ذینفعان");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {/* Trigger chip: shows current selection, supports clearing via X. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="h-auto min-h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-right flex items-center justify-between gap-2"
      >
        {selected ? (
          <div className="flex flex-col gap-0.5 flex-1 min-w-0">
            <span className="font-bold truncate">{selected.beneficiary_name || "—"}</span>
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              {selected.dl_code && <span>کد: {selected.dl_code}</span>}
              {selected.beneficiary_type && <span>{selected.beneficiary_type}</span>}
              {selected.phone && <span dir="ltr">{selected.phone}</span>}
            </div>
          </div>
        ) : value && fallbackLabel ? (
          <span className="truncate flex-1">{fallbackLabel}</span>
        ) : (
          <span className="text-muted-foreground flex-1">{placeholder}</span>
        )}
        {selected && (
          <X
            className="w-4 h-4 text-muted-foreground shrink-0"
            onClick={(e) => {
              // Stop bubbling so the dialog doesn't also open.
              e.stopPropagation();
              onChange(null);
            }}
          />
        )}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-card rounded-t-2xl sm:rounded-2xl border shadow-lg w-full max-w-lg max-h-[88vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Sticky header: search + close. */}
            <div className="p-3 border-b flex items-center gap-2 sticky top-0 bg-card">
              <div className="flex items-center gap-2 flex-1 rounded-md border border-input px-2">
                <Search className="w-4 h-4 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="جستجو نام، کد، کد ملی یا تلفن"
                  className="border-0 focus-visible:ring-0 h-9 p-0"
                  autoFocus
                />
                {query && (
                  <button onClick={() => setQuery("")} className="text-muted-foreground">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <Button size="icon" variant="ghost" onClick={refresh} disabled={loading} title="بارگذاری مجدد">
                <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
              </Button>
              <Button size="icon" variant="ghost" onClick={() => setOpen(false)}>
                <X className="w-4 h-4" />
              </Button>
            </div>

            {/* Body: loading, error, empty, or results */}
            <div className="overflow-y-auto flex-1 p-2">
              {loading && list.length === 0 && (
                <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  در حال دریافت لیست ذینفعان از سپیدار…
                </div>
              )}
              {error && (
                <div className="m-2 rounded-md bg-destructive/10 border border-destructive/30 p-3 text-sm text-destructive flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                  <div className="flex-1">
                    <p className="font-bold">دریافت ذینفعان از سپیدار با خطا روبرو شد</p>
                    <p className="text-xs mt-1 opacity-80">{error}</p>
                  </div>
                </div>
              )}
              {!loading && !error && filtered.length === 0 && (
                <p className="text-center text-sm text-muted-foreground py-10">
                  {debounced ? "نتیجه‌ای برای این جستجو پیدا نشد" : "ذینفعی موجود نیست"}
                </p>
              )}
              {filtered.map((b) => {
                const id = String(b.beneficiary_id ?? "");
                const positive = (b.balance || 0) >= 0;
                return (
                  <button
                    key={`${id}-${b.dl_code ?? ""}`}
                    className="w-full text-right p-3 hover:bg-secondary rounded-lg flex flex-col gap-1 border-b border-border last:border-0"
                    onClick={() => {
                      // Emit the whole row so the parent can snapshot
                      // beneficiary_id, dl_ref, dl_code, name, type, balance.
                      onChange(id || null, b);
                      setOpen(false);
                    }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold truncate">{b.beneficiary_name || "—"}</span>
                      <span
                        className={`tabular-nums text-xs ${positive ? "text-emerald-600" : "text-destructive"}`}
                      >
                        {formatMoney(b.balance ?? 0)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground gap-2">
                      <div className="flex items-center gap-2 truncate">
                        {b.dl_code && <span>کد: {b.dl_code}</span>}
                        {b.beneficiary_type && (
                          <span className="px-1.5 py-0.5 rounded bg-muted text-foreground/80">
                            {b.beneficiary_type}
                          </span>
                        )}
                      </div>
                      {b.phone && <span dir="ltr">{b.phone}</span>}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default SepidarBeneficiarySelector;
