// =====================================================================
// cowFactor.ts
// ---------------------------------------------------------------------
// Service module for the "فاکتور دام" (Livestock invoice) submission flow.
//
// ARCHITECTURE (post-pivot):
//   Supabase = primary system. Holds factors, cow_factor_details, and
//              a sync_queue outbox.
//   SQL Server = secondary mirror. A separate local worker script
//                (see scripts/sql-sync-worker.cjs) reads sync_queue
//                from Supabase and writes to the legacy SQL Server.
//
// What this file does:
//   1. Validates the form on the client (fast feedback, no round-trip).
//   2. Uploads the optional invoice image to Supabase Storage (≤ 2MB).
//   3. Calls the Postgres RPC `submit_cow_factor` which atomically:
//        - validates again (server-side, authoritative)
//        - inserts the factor + cow_factor_details rows
//        - enqueues a row in sync_queue for the local SQL worker
//   4. Returns a normalized result the UI can display.
//
// IMPORTANT: We keep the legacy PascalCase contract for the `Factor`
// and `CowFactorDetail` JSON because the SQL Server side still expects
// those exact names — the worker reads the queue payload as-is.
// =====================================================================

import { supabase } from "@/integrations/supabase/client";

// ---------------------------------------------------------------------
// 1) BACKEND CONTRACT TYPES (preserved for SQL Server compatibility)
// ---------------------------------------------------------------------

export interface CowFactorHeader {
  FactorTypeId: number;        // 1 = خرید (buy) | 2 = فروش (sell)
  ProductTypeId: number;       // numeric id for "دام" (livestock)
  FactorDate: string;          // Persian (Jalali) date string e.g. "1403/02/15"
  Date: string;                // duplicate of FactorDate per legacy contract
  FactorNumber: number;        // user-entered invoice number
  TotalPrice: number;
  PayablePrice: number;
  Vat: number;
  VatPercent: number;
  OffPrice: number;
  DeliveryCost: number;
  CkeckoutTypeId: number;      // typo preserved (legacy backend spelling)
  SellerBuyerTypes: number;    // 1 = company, 2 = person
  Image?: string;              // storage path of uploaded invoice image

  // Optional / conditional fields:
  ShoppingCenterId?: number;
  BuyerUserId?: number;
  OtherCenterName?: string;
  OtherCenterPhoneNumber?: string;
  OtherCenterAddress?: string;
  OtherCenterDescription?: string;
}

export interface CowFactorDetail {
  CowIds: number[];
  Weights: number[];
  UnitPrices: number[];
  RowPrices: number[];
  ExistenceStatuses: number[];
  Descriptions: string[];
}

export interface SubmitCowFactorRequest {
  Factor: CowFactorHeader;
  CowFactorDetail: CowFactorDetail;
}

/**
 * Normalized response the UI consumes. We keep `id` as the new factor's
 * UUID (string) — the legacy code used `id > 0` for success; we now use
 * `success` boolean so the UI doesn't have to care about id types.
 */
export interface SubmitCowFactorResponse {
  id: string | null;
  success: boolean;
  message: string;
}

// ---------------------------------------------------------------------
// 2) FORM-FACING TYPES (what the React component passes in)
// ---------------------------------------------------------------------

export interface CowFormRow {
  cowId: string;          // string because <select> values are strings
  weight: string;
  unitPrice: string;
  rowTotal: number;       // pre-computed by the form to avoid float drift
  existenceStatus: string;
  description: string;
}

export interface CowFormHeader {
  invoiceType: "buy" | "sell";
  productTypeId?: number;
  factorDate: string;
  factorNumber: string;
  totalPrice: number;
  payablePrice: number;
  vatAmount: number;
  vatPercent: number;     // 0 or 10
  discount: number;
  shipping: number;
  checkoutTypeId: number;
  sellerType: "company" | "person";
  shoppingCenterId?: number;
  otherCenterName?: string;
  otherCenterPhoneNumber?: string;
  otherCenterAddress?: string;
  otherCenterDescription?: string;
  /**
   * Optional File object (image or PDF) to upload as the invoice scan.
   * The service uploads it to the `cow-factor-images` bucket and stores
   * the resulting path in `factors.image`.
   */
  imageFile?: File | null;
}

// ---------------------------------------------------------------------
// 3) MAPPING TABLES — UI value → backend numeric id
// ---------------------------------------------------------------------

/**
 * Existence status codes mirror the legacy `cows.existancestatus` column.
 *  1 = موجود/فروش (in herd / sold normally)
 *  2 = تلفات
 *  3 = کشتار
 *  4 = سایر
 */
const EXISTENCE_STATUS_MAP: Record<string, number> = {
  sale: 1,
  loss: 2,
  slaughter: 3,
  other: 4,
};

const FACTOR_TYPE_MAP: Record<"buy" | "sell", number> = { buy: 1, sell: 2 };
const SELLER_BUYER_TYPE_MAP: Record<"company" | "person", number> = { company: 1, person: 2 };

/** Max size for the invoice image: 2MB per spec. */
export const MAX_IMAGE_SIZE_BYTES = 2 * 1024 * 1024;

// ---------------------------------------------------------------------
// 4) PAYLOAD MAPPER — UI shape → backend contract (PascalCase, parallel arrays)
// ---------------------------------------------------------------------

export function buildCowFactorPayload(
  header: CowFormHeader,
  rows: CowFormRow[],
  imagePath?: string | null,
): SubmitCowFactorRequest {
  // Build parallel arrays in a single pass so indices are guaranteed aligned.
  const CowIds: number[] = [];
  const Weights: number[] = [];
  const UnitPrices: number[] = [];
  const RowPrices: number[] = [];
  const ExistenceStatuses: number[] = [];
  const Descriptions: string[] = [];

  for (const r of rows) {
    CowIds.push(parseInt(r.cowId, 10));
    Weights.push(parseFloat(r.weight) || 0);
    UnitPrices.push(parseInt(r.unitPrice, 10) || 0);
    RowPrices.push(Math.round(r.rowTotal || 0));
    ExistenceStatuses.push(EXISTENCE_STATUS_MAP[r.existenceStatus] ?? 1);
    Descriptions.push(r.description || "");
  }

  const Factor: CowFactorHeader = {
    FactorTypeId: FACTOR_TYPE_MAP[header.invoiceType],
    ProductTypeId: header.productTypeId ?? 5, // 5 = دام
    FactorDate: header.factorDate,
    Date: header.factorDate,
    FactorNumber: parseInt(header.factorNumber, 10) || 0,
    TotalPrice: Math.round(header.totalPrice),
    PayablePrice: Math.round(header.payablePrice),
    Vat: Math.round(header.vatAmount),
    VatPercent: header.vatPercent,
    OffPrice: Math.round(header.discount),
    DeliveryCost: Math.round(header.shipping),
    CkeckoutTypeId: header.checkoutTypeId,
    SellerBuyerTypes: SELLER_BUYER_TYPE_MAP[header.sellerType],
  };

  if (imagePath) Factor.Image = imagePath;
  if (header.shoppingCenterId != null) Factor.ShoppingCenterId = header.shoppingCenterId;
  if (header.otherCenterName) Factor.OtherCenterName = header.otherCenterName;
  if (header.otherCenterPhoneNumber) Factor.OtherCenterPhoneNumber = header.otherCenterPhoneNumber;
  if (header.otherCenterAddress) Factor.OtherCenterAddress = header.otherCenterAddress;
  if (header.otherCenterDescription) Factor.OtherCenterDescription = header.otherCenterDescription;

  return {
    Factor,
    CowFactorDetail: { CowIds, Weights, UnitPrices, RowPrices, ExistenceStatuses, Descriptions },
  };
}

// ---------------------------------------------------------------------
// 5) CLIENT-SIDE VALIDATION (fast feedback before any network call)
// ---------------------------------------------------------------------

export class CowFactorValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CowFactorValidationError";
  }
}

export function validateCowFactorInput(header: CowFormHeader, rows: CowFormRow[]): void {
  if (!rows || rows.length === 0) {
    throw new CowFactorValidationError("حداقل یک ردیف دام باید وارد شود.");
  }
  if (!header.factorDate) {
    throw new CowFactorValidationError("تاریخ فاکتور الزامی است.");
  }
  if (!header.invoiceType) {
    throw new CowFactorValidationError("نوع فاکتور (خرید/فروش) الزامی است.");
  }

  // Image size guard — runs before the upload attempt to give a clear error.
  if (header.imageFile && header.imageFile.size > MAX_IMAGE_SIZE_BYTES) {
    throw new CowFactorValidationError("اندازه تصویر فاکتور نباید بیشتر از ۲ مگابایت باشد.");
  }

  const seen = new Set<number>();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const label = `ردیف ${i + 1}`;

    if (!r.cowId) throw new CowFactorValidationError(`${label}: شماره دام انتخاب نشده است.`);
    const cowIdNum = parseInt(r.cowId, 10);
    if (!Number.isFinite(cowIdNum) || cowIdNum <= 0) {
      throw new CowFactorValidationError(`${label}: شماره دام نامعتبر است.`);
    }

    const w = parseFloat(r.weight);
    if (!r.weight || !Number.isFinite(w) || w <= 0) {
      throw new CowFactorValidationError(`${label}: وزن باید بزرگ‌تر از صفر باشد.`);
    }

    const p = parseInt(r.unitPrice, 10);
    if (!r.unitPrice || !Number.isFinite(p) || p <= 0) {
      throw new CowFactorValidationError(`${label}: قیمت واحد باید بزرگ‌تر از صفر باشد.`);
    }

    // `existenceStatus` (نوع فروش/تلفات/کشتار) is ONLY meaningful for SELL
    // invoices — for BUY invoices the cow is being added to the herd, so this
    // field is irrelevant and must NOT be required. The payload mapper
    // defaults to 1 (sale/in-herd) when empty, which is safe for buy rows.
    if (header.invoiceType === "sell") {
      if (!r.existenceStatus) {
        throw new CowFactorValidationError(`${label}: نوع (فروش/تلفات/کشتار) انتخاب نشده است.`);
      }
      if (!(r.existenceStatus in EXISTENCE_STATUS_MAP)) {
        throw new CowFactorValidationError(`${label}: نوع نامعتبر است.`);
      }
    } else if (r.existenceStatus && !(r.existenceStatus in EXISTENCE_STATUS_MAP)) {
      // For buy invoices, only validate the value if user happened to set one.
      throw new CowFactorValidationError(`${label}: نوع نامعتبر است.`);
    }

    if (seen.has(cowIdNum)) {
      throw new CowFactorValidationError(
        `شماره دام «${r.cowId}» در چند ردیف تکراری است. هر دام فقط یک‌بار قابل ثبت است.`,
      );
    }
    seen.add(cowIdNum);
  }
}

// ---------------------------------------------------------------------
// 6) IMAGE UPLOAD — Supabase Storage bucket "cow-factor-images"
// ---------------------------------------------------------------------

/**
 * Upload the user's invoice image and return the storage path on success.
 * Returns null if there's nothing to upload. Throws on real errors.
 */
async function uploadInvoiceImage(file: File | null | undefined): Promise<string | null> {
  if (!file) return null;
  if (file.size > MAX_IMAGE_SIZE_BYTES) {
    throw new CowFactorValidationError("اندازه تصویر فاکتور نباید بیشتر از ۲ مگابایت باشد.");
  }

  // Build a unique path so concurrent uploads can't collide.
  // Format: <YYYY-MM>/<uuid>.<ext>
  const ext = (file.name.split(".").pop() || "bin").toLowerCase();
  const yearMonth = new Date().toISOString().slice(0, 7); // "2025-04"
  const path = `${yearMonth}/${crypto.randomUUID()}.${ext}`;

  const { error } = await supabase.storage
    .from("cow-factor-images")
    .upload(path, file, {
      // Don't overwrite if path collides (it shouldn't, given the UUID).
      upsert: false,
      contentType: file.type || undefined,
    });

  if (error) {
    throw new Error(`آپلود تصویر ناموفق بود: ${error.message}`);
  }
  return path;
}

// ---------------------------------------------------------------------
// 7) MAIN ENTRY POINT — submit factor via Supabase RPC
// ---------------------------------------------------------------------

/**
 * Submit a livestock factor.
 *
 * Flow:
 *   1) Client-side validation (throws CowFactorValidationError on failure).
 *   2) Upload optional image to Storage.
 *   3) Build the legacy-PascalCase payload.
 *   4) Call the `submit_cow_factor` RPC (atomic transaction in Postgres).
 *   5) Return a normalized response.
 *
 * The RPC also enqueues a row in `sync_queue` so the local SQL Server
 * worker can mirror the data — that part is asynchronous and out of band.
 */
export async function submitCowFactor(
  header: CowFormHeader,
  rows: CowFormRow[],
): Promise<SubmitCowFactorResponse> {
  // 1) Fail fast on bad input.
  validateCowFactorInput(header, rows);

  // 2) Upload image if the user attached one.
  const imagePath = await uploadInvoiceImage(header.imageFile ?? null);

  // 3) Map UI → legacy PascalCase contract.
  const body = buildCowFactorPayload(header, rows, imagePath);

  // 4) Invoke the Postgres RPC. The function returns jsonb; supabase-js
  //    surfaces it as `data` typed loosely. We coerce defensively below.
  // Cast to `any` because this RPC is custom and isn't in the generated
  // Supabase Database types yet (types.ts is read-only).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc("submit_cow_factor", {
    p_factor: body.Factor,
    p_details: body.CowFactorDetail,
  });

  if (error) {
    // Network or auth error — surface to UI.
    return {
      id: null,
      success: false,
      message: `خطا در ارتباط با پایگاه داده: ${error.message}`,
    };
  }

  // RPC returns: { id: uuid|null, success: bool, message: string }
  const result = (data ?? {}) as { id?: string | null; success?: boolean; message?: string };
  return {
    id: result.id ?? null,
    success: !!result.success,
    message: result.message ?? "پاسخ نامعتبر از سرور.",
  };
}
