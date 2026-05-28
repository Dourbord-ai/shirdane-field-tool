// LocalPartyBeneficiarySelector
// ---------------------------------------------------------------------------
// Beneficiary picker that reads from the LOCAL `finance_parties` table — the
// same data source used by "شناسایی دریافت" — instead of querying Sepidar.
// This eliminates the discrepancy where parties that exist locally (and show
// up in شناسایی دریافت) were missing from the payment-request beneficiary
// selector because Sepidar's beneficiary view returned only a subset.
//
// Search covers every identifier finance operators use to find a party:
//   - Persian first/last name
//   - company_name
//   - sepidar_full_name (the canonical Sepidar display label)
//   - national_code / national_id
//   - mobile / telephone
//   - sepidar_dl_code
//
// Parties without a `sepidar_party_id` are still shown but rendered disabled
// with a clear validation message — instead of silently hiding them — so the
// operator knows to sync the party first rather than wondering why it's gone.
// ---------------------------------------------------------------------------
import { useEffect, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, Search, X, AlertTriangle, RefreshCw, AlertCircle } from "lucide-react";
import { formatMoney } from "@/lib/finance";
import { supabase } from "@/integrations/supabase/client";

// Row shape returned to the parent on selection. We keep the property names
// aligned with `SepidarBeneficiary` so the callsite in PaymentRequestsTab can
// snapshot fields with the same code path it used before.
export interface LocalPartyBeneficiary {
  // Local finance_parties UUID — what the RPC stores into
  // finance_payment_request_items.party_id (required by voucher generation).
  party_id: string;
  // Sepidar mirror fields snapshotted onto the payment-request row.
  beneficiary_id: number | null; // sepidar_party_id
  dl_ref: string | null;          // sepidar_dl_id
  dl_code: string | null;         // sepidar_dl_code
  beneficiary_name: string;
  beneficiary_type: string | null;
  balance: number | null;         // local cached balance
  has_sepidar: boolean;           // false ⇒ disabled in UI
}

interface Props {
  /** Currently selected local finance_parties UUID. */
  value: string | null;
  /** Emits (party_id|null, beneficiary?). null clears the row. */
  onChange: (partyId: string | null, beneficiary?: LocalPartyBeneficiary) => void;
  placeholder?: string;
  fallbackLabel?: string | null;
}

// Internal row pulled from `finance_parties`. We keep the columns lean.
interface PartyRow {
  id: string;
  ownership_type: string | null;
  first_name: string | null;
  last_name: string | null;
  company_name: string | null;
  sepidar_full_name: string | null;
  national_code: string | null;
  national_id: string | null;
  mobile: string | null;
  telephone: string | null;
  sepidar_party_id: number | null;
  sepidar_dl_id: string | null;
  sepidar_dl_code: string | null;
  balance: number | null;
}

// Module-level cache so multiple selectors on the same page share one fetch.
let cachedParties: PartyRow[] | null = null;
let inflight: Promise<PartyRow[]> | null = null;

async function loadParties(force = false): Promise<PartyRow[]> {
  if (!force && cachedParties) return cachedParties;
  if (!force && inflight) return inflight;
  inflight = (async () => {
    // Pull all active parties. The Supabase default cap is 1000; finance has
    // ~370 active rows today so a single round-trip is enough.
    const { data, error } = await supabase
      .from("finance_parties")
      .select(
        "id, ownership_type, first_name, last_name, company_name, sepidar_full_name, national_code, national_id, mobile, telephone, sepidar_party_id, sepidar_dl_id, sepidar_dl_code, balance",
      )
      .eq("is_deleted", false)
      .order("sepidar_full_name", { ascending: true, nullsFirst: false })
      .limit(2000);
    if (error) throw error;
    cachedParties = (data || []) as PartyRow[];
    return cachedParties;
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

// Build a stable display label that matches what users see elsewhere.
function partyLabel(p: PartyRow): string {
  const person = [p.first_name, p.last_name].filter(Boolean).join(" ").trim();
  return p.sepidar_full_name || p.company_name || person || "بدون نام";
}

// Normalize Persian/Arabic chars + digits so search matches regardless of
// the user typing ي vs ی or ك vs ک, or Arabic-indic digits.
function normalize(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/[ي]/g, "ی")
    .replace(/[ك]/g, "ک")
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .toLowerCase()
    .trim();
}

export function LocalPartyBeneficiarySelector({
  value,
  onChange,
  placeholder = "انتخاب ذینفع (طرف حساب)",
  fallbackLabel,
}: Props) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<PartyRow[]>(cachedParties || []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selected = useMemo(
    () => (value ? list.find((p) => p.id === value) || null : null),
    [value, list],
  );

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(null);
    if (!cachedParties) setLoading(true);
    loadParties()
      .then((rows) => {
        if (!cancelled) setList(rows);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "خطا در دریافت طرف حساب‌ها");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Silent prefetch on mount so first open is instant.
  useEffect(() => {
    if (!cachedParties) void loadParties().then(setList).catch(() => {/* silent */});
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebounced(normalize(query)), 200);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  // Client-side filtering across all useful identifiers.
  const filtered = useMemo(() => {
    if (!debounced) return list.slice(0, 200);
    const q = debounced;
    return list.filter((p) => {
      const hay = normalize(
        [
          p.sepidar_full_name,
          p.company_name,
          p.first_name,
          p.last_name,
          p.national_code,
          p.national_id,
          p.mobile,
          p.telephone,
          p.sepidar_dl_code,
        ]
          .filter(Boolean)
          .join(" "),
      );
      return hay.includes(q);
    });
  }, [list, debounced]);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const rows = await loadParties(true);
      setList(rows);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "خطا در بارگذاری مجدد طرف حساب‌ها");
    } finally {
      setLoading(false);
    }
  }

  function emit(p: PartyRow) {
    if (!p.sepidar_party_id) return; // disabled rows shouldn't reach here
    const out: LocalPartyBeneficiary = {
      party_id: p.id,
      beneficiary_id: p.sepidar_party_id,
      dl_ref: p.sepidar_dl_id,
      dl_code: p.sepidar_dl_code,
      beneficiary_name: partyLabel(p),
      beneficiary_type: p.ownership_type,
      balance: p.balance,
      has_sepidar: true,
    };
    onChange(p.id, out);
    setOpen(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="h-auto min-h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-right flex items-center justify-between gap-2"
      >
        {selected ? (
          <div className="flex flex-col gap-0.5 flex-1 min-w-0">
            <span className="font-bold truncate">{partyLabel(selected)}</span>
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              {selected.sepidar_dl_code && <span>کد: {selected.sepidar_dl_code}</span>}
              {selected.ownership_type && <span>{selected.ownership_type}</span>}
              {selected.mobile && <span dir="ltr">{selected.mobile}</span>}
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
            <div className="p-3 border-b flex items-center gap-2 sticky top-0 bg-card">
              <div className="flex items-center gap-2 flex-1 rounded-md border border-input px-2">
                <Search className="w-4 h-4 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="جستجو نام، شرکت، کد ملی، موبایل یا کد سپیدار"
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

            <div className="overflow-y-auto flex-1 p-2">
              {loading && list.length === 0 && (
                <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  در حال دریافت طرف حساب‌ها…
                </div>
              )}
              {error && (
                <div className="m-2 rounded-md bg-destructive/10 border border-destructive/30 p-3 text-sm text-destructive flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                  <div className="flex-1">
                    <p className="font-bold">دریافت طرف حساب‌ها با خطا روبرو شد</p>
                    <p className="text-xs mt-1 opacity-80">{error}</p>
                  </div>
                </div>
              )}
              {!loading && !error && filtered.length === 0 && (
                <p className="text-center text-sm text-muted-foreground py-10">
                  {debounced ? "نتیجه‌ای برای این جستجو پیدا نشد" : "طرف حسابی موجود نیست"}
                </p>
              )}
              {filtered.map((p) => {
                const disabled = !p.sepidar_party_id;
                const positive = (p.balance || 0) >= 0;
                return (
                  <button
                    key={p.id}
                    disabled={disabled}
                    className={`w-full text-right p-3 rounded-lg flex flex-col gap-1 border-b border-border last:border-0 ${
                      disabled ? "opacity-60 cursor-not-allowed" : "hover:bg-secondary"
                    }`}
                    onClick={() => emit(p)}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold truncate">{partyLabel(p)}</span>
                      <span
                        className={`tabular-nums text-xs ${positive ? "text-emerald-600" : "text-destructive"}`}
                      >
                        {formatMoney(p.balance ?? 0)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground gap-2">
                      <div className="flex items-center gap-2 truncate">
                        {p.sepidar_dl_code && <span>کد: {p.sepidar_dl_code}</span>}
                        {p.ownership_type && (
                          <span className="px-1.5 py-0.5 rounded bg-muted text-foreground/80">
                            {p.ownership_type}
                          </span>
                        )}
                        {p.national_code && <span dir="ltr">{p.national_code}</span>}
                      </div>
                      {p.mobile && <span dir="ltr">{p.mobile}</span>}
                    </div>
                    {disabled && (
                      <div className="flex items-center gap-1 text-[11px] text-amber-600">
                        <AlertCircle className="w-3.5 h-3.5" />
                        برای استفاده در درخواست پرداخت، ابتدا این طرف حساب با سپیدار همگام‌سازی شود.
                      </div>
                    )}
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

export default LocalPartyBeneficiarySelector;
