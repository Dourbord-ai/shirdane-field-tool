// ---------------------------------------------------------------------------
// NewInvoice — production entry point for creating an invoice.
//
// As of the M-normalize rollout this page renders ONLY the new normalized
// mixed-row form (factors + factor_items + per-type detail tables). The
// legacy single-product-type form has been archived to NewInvoiceLegacy.tsx
// and is no longer wired into the router. We keep that file on disk strictly
// as a rollback safety net — to restore it, swap the import below back to
// `./NewInvoiceLegacy` and re-export it as default.
// ---------------------------------------------------------------------------

import MixedInvoiceForm from "@/components/invoices/MixedInvoiceForm";

export default function NewInvoice() {
  // Thin shell. All header/row/totals/submit logic lives in MixedInvoiceForm
  // so this page stays small and the normalized flow has a single source of
  // truth.
  return (
    <div className="py-6 space-y-4 animate-fade-in">
      <h1 className="text-heading text-foreground">ثبت فاکتور جدید</h1>
      <MixedInvoiceForm />
    </div>
  );
}
