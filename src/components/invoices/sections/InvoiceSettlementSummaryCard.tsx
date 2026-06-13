// ---------------------------------------------------------------------------
// InvoiceSettlementSummaryCard
//
// Shown inside the expanded invoice row. Two render modes:
//
//   A) NO linked settlement     → nothing rendered (the existing
//                                  "ثبت درخواست تسویه" CTA stays visible).
//   B) Linked settlement exists → a summary card with status, item count,
//                                  total, created date + actions:
//                                    • مشاهده درخواست تسویه
//                                    • ویرایش از طریق فاکتور (currently a
//                                      lightweight info-only action because
//                                      a dedicated "edit invoice settlement"
//                                      route is out of scope for this patch)
//
// This component is intentionally read-only: it never mutates the request.
// Edits go through the invoice form (Rule 4), so we just route the user
// back to the right place.
// ---------------------------------------------------------------------------

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CreditCard, ExternalLink, Pencil, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

import {
  fetchInvoiceLinkedSettlement,
  type InvoiceLinkedSettlement,
} from "@/lib/finance/invoiceSettlementLink";
import { PAYMENT_REQUEST_STATUS_LABEL } from "@/lib/finance";

interface Props {
  factorId: string;
  // Optional refresh trigger — parent bumps a counter after invoice edits
  // so the card refetches without a full page reload.
  refreshKey?: number;
  // Notifies the parent when the linked-state changes so it can hide the
  // legacy "ثبت درخواست تسویه" button (Rule 3 — no duplicate creation).
  onLinkedChange?: (linked: InvoiceLinkedSettlement | null) => void;
}

// Money formatter local to this card — same Persian-digit style as the
// other invoice-detail cells. Kept tiny on purpose.
function formatRial(value: number | null | undefined): string {
  const n = Number(value || 0);
  const s = Math.round(n).toLocaleString("en-US");
  const fa = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"];
  return s.replace(/\d/g, (d) => fa[Number(d)]) + " ریال";
}

function formatJalali(iso: string | null): string {
  if (!iso) return "—";
  try {
    // Intl with the Persian calendar is enough for a created-at chip; we
    // intentionally avoid pulling jalaali libs here.
    return new Intl.DateTimeFormat("fa-IR", {
      year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export default function InvoiceSettlementSummaryCard({
  factorId,
  refreshKey = 0,
  onLinkedChange,
}: Props) {
  const navigate = useNavigate();
  // Three-state: undefined = loading, null = no link, object = linked.
  const [linked, setLinked] = useState<InvoiceLinkedSettlement | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    setLinked(undefined);
    fetchInvoiceLinkedSettlement(factorId).then((res) => {
      if (cancelled) return;
      setLinked(res);
      // Bubble up so the parent can toggle the legacy CTA.
      onLinkedChange?.(res);
    });
    return () => { cancelled = true; };
    // We intentionally include refreshKey so the parent can force a reload.
  }, [factorId, refreshKey, onLinkedChange]);

  // Loading shimmer — kept minimal so it doesn't dominate the layout.
  if (linked === undefined) {
    return (
      <div className="mt-4 rounded-xl border border-border bg-card/40 p-3 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" />
        در حال بررسی درخواست تسویه...
      </div>
    );
  }

  // No link → nothing to render; the legacy CTA in RelatedCostsSection
  // stays visible, preserving Rule 5 (flexible invoices).
  if (linked === null) return null;

  const goToRequest = () => {
    // UAT Bug 3 fix — deterministic deep-link to the linked request:
    //   1) Stash the target request id so PaymentRequestsTab can auto-open
    //      the detail view once the list loads.
    //   2) Defensively clear `finance:pr_seed_draft_v1`. That key is used
    //      by the invoice → "new settlement request" flow; if a stale
    //      draft survives in sessionStorage the PR tab would otherwise
    //      auto-open the "new request" dialog on top of our detail view.
    //   3) Navigate via the `?tab=` query param (NOT the `#hash`) because
    //      Finance.tsx reads `searchParams.get("tab")` to choose the
    //      active tab. The hash-based URL used previously left the tab on
    //      "dashboard" until the user clicked Payment Requests manually.
    try {
      sessionStorage.setItem("finance.openPaymentRequestId", linked.id);
      sessionStorage.removeItem("finance:pr_seed_draft_v1");
    } catch { /* sessionStorage may be unavailable in some embeds */ }
    navigate("/finance?tab=payment-requests");
  };

  return (
    <div className="mt-4 rounded-xl border border-primary/30 bg-primary/5 p-3 space-y-3">
      {/* Header: title + status badge. The "درخواست تسویه ثبت شده" wording
          is the explicit replacement called out by Rule 3. */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <CreditCard className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-bold text-foreground">درخواست تسویه ثبت شده</h3>
        </div>
        <Badge variant="secondary" className="text-[10px]">
          {PAYMENT_REQUEST_STATUS_LABEL[linked.status] || linked.status || "—"}
        </Badge>
      </div>

      {/* Compact summary grid: count / total / created date. */}
      <div className="grid grid-cols-3 gap-2 text-[11px]">
        <div className="flex flex-col">
          <span className="text-muted-foreground">تعداد آیتم</span>
          <span className="font-bold text-foreground">{linked.item_count}</span>
        </div>
        <div className="flex flex-col">
          <span className="text-muted-foreground">مبلغ کل</span>
          <span className="font-bold text-foreground">{formatRial(linked.total_amount)}</span>
        </div>
        <div className="flex flex-col">
          <span className="text-muted-foreground">تاریخ ثبت</span>
          <span className="font-bold text-foreground">{formatJalali(linked.created_at)}</span>
        </div>
      </div>

      {/* Actions row. Edit-through-invoice is rendered as a static hint for
          now because the dedicated edit-from-invoice flow is out of scope
          for this patch — but the affordance is in place so the wording
          matches the contract Rule 4 sets. */}
      <div className="flex items-center gap-2">
        <Button size="sm" variant="default" onClick={goToRequest}>
          <ExternalLink className="w-4 h-4 ml-1" /> مشاهده درخواست تسویه
        </Button>
        <Button
          size="sm"
          variant="outline"
          // Editing settlement config goes through the invoice form per
          // Rule 4. Until a dedicated re-open-invoice flow ships we surface
          // the message and disable navigation rather than silently routing
          // to a half-built screen.
          disabled
          title="ویرایش پیکربندی تسویه از طریق ویرایش فاکتور انجام می‌شود."
        >
          <Pencil className="w-4 h-4 ml-1" /> ویرایش از طریق فاکتور
        </Button>
      </div>
    </div>
  );
}
