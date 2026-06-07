// ============================================================
// ReceiveIdFilters
// ------------------------------------------------------------
// Advanced filter bar for the "شناسایی دریافت" (Receive
// Identification) list. Renders four server-side filters that
// combine with AND logic against `finance_receive_identifications`:
//
//   1) transaction_datetime range (Shamsi from/to date pickers)
//   2) party_id (single party, autocomplete via PartySelector)
//   3) amount range (min/max numeric inputs)
//   4) bank_id IN [...] (multi-select banks via Popover+checkboxes)
//
// Filter state is fully CONTROLLED via props so the parent tab
// can mirror it into `useSearchParams`. That way the filters
// survive page refresh AND any future pagination/range changes.
// ============================================================
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Filter, X, ChevronDown } from "lucide-react";
import { PartySelector } from "@/components/finance/selectors";
import ShamsiDatePicker from "@/components/ShamsiDatePicker";

// Public shape consumed by the parent. We keep every value as a
// nullable primitive so encoding into URLSearchParams stays trivial.
export interface ReceiveIdFilterState {
  // Shamsi "YYYY/MM/DD" string — the picker's native format. The
  // parent converts to Gregorian only at query-time.
  fromDate: string | null;
  toDate: string | null;
  partyId: string | null;
  // Stored as STRINGS so empty / partial typing doesn't fight with
  // `<Input type="number">`. The parent parses to Number at use.
  minAmount: string | null;
  maxAmount: string | null;
  // Multi-select: array of bank UUIDs, AND'd with `.in('bank_id', ...)`.
  bankIds: string[];
}

export const EMPTY_RECEIVE_ID_FILTERS: ReceiveIdFilterState = {
  fromDate: null,
  toDate: null,
  partyId: null,
  minAmount: null,
  maxAmount: null,
  bankIds: [],
};

// Counts how many filter slots the user has actually populated.
// Used for the "X فیلتر فعال" badge so users get instant feedback
// without scanning every field. Date range counts as 1 if EITHER
// bound is set, mirroring how the SQL clause is conditional.
export function countActiveFilters(f: ReceiveIdFilterState): number {
  let n = 0;
  if (f.fromDate || f.toDate) n++;
  if (f.partyId) n++;
  if (f.minAmount || f.maxAmount) n++;
  if (f.bankIds.length > 0) n++;
  return n;
}

interface BankOption {
  id: string;
  title: string | null;
  bank_name: string | null;
  account_number: string | null;
}

interface Props {
  // The currently-applied filter state (i.e. what the list is
  // actually using). We don't mutate this directly — the user edits
  // a DRAFT copy internally and only commits via "اعمال فیلتر".
  value: ReceiveIdFilterState;
  // Called when the user clicks "اعمال فیلتر". The parent should
  // push these into useSearchParams and re-run the query.
  onApply: (next: ReceiveIdFilterState) => void;
  // Called when the user clicks "حذف فیلترها". Parent clears params.
  onClear: () => void;
}

export default function ReceiveIdFilters({ value, onApply, onClear }: Props) {
  // Local "draft" so typing in inputs doesn't trigger a DB query on
  // every keystroke — we only push to the parent on Apply / Clear.
  const [draft, setDraft] = useState<ReceiveIdFilterState>(value);

  // Re-sync the draft whenever the upstream value changes (e.g. the
  // user navigated back/forward and useSearchParams updated). Without
  // this, the inputs would silently desync from the URL state.
  useEffect(() => {
    setDraft(value);
  }, [value]);

  // Load the bank list once. The receive-identification universe is
  // farm-wide so we don't bother paginating; finance_banks holds
  // single-digit rows in practice.
  const [banks, setBanks] = useState<BankOption[]>([]);
  useEffect(() => {
    void supabase
      .from("finance_banks")
      .select("id,title,bank_name,account_number")
      .eq("is_deleted", false)
      .eq("is_active", true)
      .order("title")
      .then(({ data }) => setBanks((data as BankOption[]) || []));
  }, []);

  // Quick lookup map: bank-id → label. Used by the trigger button
  // when 1–2 banks are selected so the user sees which ones.
  const bankLabel = useMemo(() => {
    const m: Record<string, string> = {};
    banks.forEach(
      (b) =>
        (m[b.id] =
          b.title || b.bank_name || b.account_number || b.id.slice(0, 6)),
    );
    return m;
  }, [banks]);

  // Toggles a single bank in/out of draft.bankIds. We keep the array
  // sorted so URL serialisation is stable (avoids URL churn that
  // would unnecessarily push history entries).
  function toggleBank(id: string) {
    setDraft((d) => {
      const has = d.bankIds.includes(id);
      const next = has ? d.bankIds.filter((x) => x !== id) : [...d.bankIds, id];
      next.sort();
      return { ...d, bankIds: next };
    });
  }

  // How many slots the DRAFT currently has — shown next to the
  // Apply button to hint that there are pending unsaved changes.
  const draftCount = countActiveFilters(draft);
  // What's actually applied right now — drives the header badge.
  const appliedCount = countActiveFilters(value);

  return (
    <div className="rounded-xl border bg-card p-3 space-y-3">
      {/* Header row: title + active-filter badge + clear button */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-bold">فیلترهای پیشرفته</span>
          {appliedCount > 0 && (
            <Badge variant="secondary" className="text-[10px]">
              {appliedCount} فیلتر فعال
            </Badge>
          )}
        </div>
        {appliedCount > 0 && (
          <Button size="sm" variant="ghost" onClick={onClear}>
            <X className="w-3.5 h-3.5 ml-1" /> حذف فیلترها
          </Button>
        )}
      </div>

      {/* Grid of filter inputs — responsive: 1 col on mobile, 2 on
          tablet, 4 on desktop so all controls fit on a single row. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* --- 1) Transaction date range -------------------------- */}
        <div className="space-y-1.5">
          <Label className="text-[11px]">از تاریخ تراکنش</Label>
          <ShamsiDatePicker
            value={draft.fromDate || ""}
            onChange={(v) =>
              setDraft((d) => ({ ...d, fromDate: v || null }))
            }
            placeholder="انتخاب تاریخ شروع"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-[11px]">تا تاریخ تراکنش</Label>
          <ShamsiDatePicker
            value={draft.toDate || ""}
            onChange={(v) => setDraft((d) => ({ ...d, toDate: v || null }))}
            placeholder="انتخاب تاریخ پایان"
          />
        </div>

        {/* --- 2) Party (autocomplete) ---------------------------- */}
        <div className="space-y-1.5">
          <Label className="text-[11px]">ذینفع</Label>
          <PartySelector
            value={draft.partyId}
            // PartySelector returns (id, party?) — we only need id.
            onChange={(id) => setDraft((d) => ({ ...d, partyId: id }))}
            placeholder="جستجو ذینفع"
          />
        </div>

        {/* --- 4) Bank multi-select ------------------------------- */}
        <div className="space-y-1.5">
          <Label className="text-[11px]">بانک</Label>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                // Match the height of the other inputs so the grid
                // looks tidy. justify-between pushes the chevron to
                // the LEFT in RTL which visually mirrors a select.
                className="h-10 w-full justify-between text-right font-normal"
              >
                <span
                  className={
                    draft.bankIds.length === 0 ? "text-muted-foreground" : ""
                  }
                >
                  {draft.bankIds.length === 0
                    ? "همه بانک‌ها"
                    : draft.bankIds.length <= 2
                      ? draft.bankIds.map((id) => bankLabel[id] || "—").join("، ")
                      : `${draft.bankIds.length} بانک انتخاب شده`}
                </span>
                <ChevronDown className="w-4 h-4 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64 p-0" align="start">
              <div className="max-h-64 overflow-y-auto p-2 space-y-1">
                {banks.length === 0 && (
                  <p className="text-xs text-muted-foreground p-2 text-center">
                    بانکی ثبت نشده
                  </p>
                )}
                {banks.map((b) => {
                  const checked = draft.bankIds.includes(b.id);
                  return (
                    // Whole row is clickable so users don't have to
                    // hit the tiny checkbox target on mobile.
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => toggleBank(b.id)}
                      className="w-full flex items-center gap-2 p-2 rounded-md hover:bg-muted/50 text-right"
                    >
                      <Checkbox checked={checked} className="pointer-events-none" />
                      <span className="text-sm flex-1">{bankLabel[b.id]}</span>
                    </button>
                  );
                })}
              </div>
              {draft.bankIds.length > 0 && (
                <div className="border-t p-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="w-full"
                    onClick={() => setDraft((d) => ({ ...d, bankIds: [] }))}
                  >
                    پاک کردن انتخاب بانک‌ها
                  </Button>
                </div>
              )}
            </PopoverContent>
          </Popover>
        </div>

        {/* --- 3) Amount range ------------------------------------ */}
        <div className="space-y-1.5">
          <Label className="text-[11px]">حداقل مبلغ (ریال)</Label>
          <Input
            type="number"
            inputMode="numeric"
            placeholder="مثلاً ۱,۰۰۰,۰۰۰"
            value={draft.minAmount ?? ""}
            onChange={(e) =>
              setDraft((d) => ({ ...d, minAmount: e.target.value || null }))
            }
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-[11px]">حداکثر مبلغ (ریال)</Label>
          <Input
            type="number"
            inputMode="numeric"
            placeholder="بدون سقف"
            value={draft.maxAmount ?? ""}
            onChange={(e) =>
              setDraft((d) => ({ ...d, maxAmount: e.target.value || null }))
            }
          />
        </div>
      </div>

      {/* Action row — Apply + Clear. We expose Clear here too (in
          addition to the header chip) because on mobile the header
          can scroll off-screen below the open Popover. */}
      <div className="flex items-center justify-end gap-2 pt-1">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setDraft(EMPTY_RECEIVE_ID_FILTERS);
            onClear();
          }}
        >
          حذف فیلترها
        </Button>
        <Button size="sm" onClick={() => onApply(draft)}>
          اعمال فیلتر
          {draftCount > 0 && (
            <span className="mr-1.5 text-[10px] opacity-80">({draftCount})</span>
          )}
        </Button>
      </div>
    </div>
  );
}
