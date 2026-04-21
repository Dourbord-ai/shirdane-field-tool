// =====================================================================
// cowFactor.ts
// ---------------------------------------------------------------------
// Service module that handles ALL communication with the .NET backend
// for the "فاکتور دام" (Cow / Livestock invoice) flow.
//
// We deliberately keep this layer separate from the React component so:
//   1. The component stays focused on UI/state
//   2. The payload mapper (form -> API contract) is unit-testable
//   3. Validation happens in ONE place before any network call
//   4. If the backend contract changes, only this file changes
//
// IMPORTANT: The contract shape (PascalCase, parallel arrays) is defined
// by the legacy .NET API and MUST NOT be transformed/renamed.
// =====================================================================

// ---------------------------------------------------------------------
// 1) TYPE DEFINITIONS — mirror the backend contract EXACTLY (PascalCase)
// ---------------------------------------------------------------------

/**
 * The "Factor" header object the .NET API expects.
 * All field names, casing, and types match the SQL Server / .NET model.
 */
export interface CowFactorHeader {
  FactorTypeId: number;        // 1 = خرید (buy) | 2 = فروش (sell)
  ProductTypeId: number;       // numeric id for "دام" (livestock)
  FactorDate: string;          // Persian (Jalali) date as a string e.g. "1403/02/15"
  Date: string;                // duplicate of FactorDate per backend contract
  FactorNumber: number;        // user-entered invoice number
  TotalPrice: number;          // sum of row totals (before tax/discount)
  PayablePrice: number;        // final payable amount
  Vat: number;                 // tax amount in Rial
  VatPercent: number;          // tax percent (0 or 10)
  OffPrice: number;            // discount amount in Rial
  DeliveryCost: number;        // shipping/delivery amount in Rial
  CkeckoutTypeId: number;      // settlement type id (typo "Ckeckout" preserved on purpose — backend spelling)
  SellerBuyerTypes: number;    // 1 = company, 2 = person (legacy backend convention)

  // Conditional fields — only populated when applicable.
  // We always include them but with safe defaults so backend deserialization is predictable.
  ShoppingCenterId?: number;
  BuyerUserId?: number;
  OtherCenterName?: string;
  OtherCenterPhoneNumber?: string;
  OtherCenterAddress?: string;
  OtherCenterDescription?: string;
}

/**
 * The "CowFactorDetail" object — parallel arrays aligned by index.
 * CowIds[i], Weights[i], UnitPrices[i], etc. all describe the SAME row.
 *
 * RULE: Every array MUST have the same length. The backend relies on
 * positional alignment, NOT object grouping.
 */
export interface CowFactorDetail {
  CowIds: number[];
  Weights: number[];
  UnitPrices: number[];
  RowPrices: number[];
  ExistenceStatuses: number[];
  Descriptions: string[];
}

/**
 * Final request body envelope.
 */
export interface SubmitCowFactorRequest {
  Factor: CowFactorHeader;
  CowFactorDetail: CowFactorDetail;
}

/**
 * The API response shape (note backend typo "massage" instead of "message").
 * We preserve it exactly because we do NOT control the backend.
 */
export interface SubmitCowFactorResponse {
  id: number;        // > 0 on success, 0 on failure
  massage: string;   // human-readable Persian message (success or error)
}

// ---------------------------------------------------------------------
// 2) FORM-FACING TYPES — what the React component passes in.
// These are intentionally simple/plain so the component does not need
// to know about the backend contract.
// ---------------------------------------------------------------------

/** A single row from the livestock repeater in the UI. */
export interface CowFormRow {
  /** Selected cow id (DB primary key). String because <select> values are strings. */
  cowId: string;
  /** Weight in kg (string from <Input type="number">). */
  weight: string;
  /** Unit price (Rial per kg). */
  unitPrice: string;
  /** Pre-computed row total — we use this directly to avoid float drift. */
  rowTotal: number;
  /** Existence status code (UI value mapped to backend numeric id). */
  existenceStatus: string;
  /** Free text description for the row. */
  description: string;
}

/** The high-level invoice (header) data from the form. */
export interface CowFormHeader {
  /** "buy" or "sell" — mapped to FactorTypeId 1 or 2. */
  invoiceType: "buy" | "sell";
  /** Backend ProductTypeId for "دام". Defaults to 5 if not provided. */
  productTypeId?: number;
  /** Persian date string e.g. "1403/02/15". */
  factorDate: string;
  /** User-entered invoice number (free text). We coerce to number. */
  factorNumber: string;
  /** Aggregated totals (already calculated by the form for display). */
  totalPrice: number;
  payablePrice: number;
  vatAmount: number;
  vatPercent: number;     // 0 or 10
  discount: number;
  shipping: number;
  /** Settlement type id (e.g. cash=1, deferred=2 ...). */
  checkoutTypeId: number;
  /** "company" or "person". */
  sellerType: "company" | "person";
  /** When sellerType=company: id of the chosen shopping center. */
  shoppingCenterId?: number;
  /** Optional fields when seller is an "other" / unregistered party. */
  otherCenterName?: string;
  otherCenterPhoneNumber?: string;
  otherCenterAddress?: string;
  otherCenterDescription?: string;
}

// ---------------------------------------------------------------------
// 3) MAPPING TABLES
// ---------------------------------------------------------------------

/**
 * Map UI sale-type values to the backend ExistenceStatus numeric codes.
 * These ids reflect the existing `cows.existancestatus` convention used
 * elsewhere in the SQL Server schema. If the backend disagrees, only
 * this map needs to change.
 *
 *  1 = موجود/فروش (in herd / sold normally)
 *  2 = تلفات (loss / death)
 *  3 = کشتار (slaughter)
 *  4 = سایر (other)
 */
const EXISTENCE_STATUS_MAP: Record<string, number> = {
  sale: 1,
  loss: 2,
  slaughter: 3,
  other: 4,
};

/**
 * Map "buy" / "sell" form value to the backend FactorTypeId.
 */
const FACTOR_TYPE_MAP: Record<"buy" | "sell", number> = {
  buy: 1,
  sell: 2,
};

/**
 * Map seller type to backend SellerBuyerTypes id.
 */
const SELLER_BUYER_TYPE_MAP: Record<"company" | "person", number> = {
  company: 1,
  person: 2,
};

// ---------------------------------------------------------------------
// 4) PAYLOAD MAPPER — UI shape -> backend contract
// ---------------------------------------------------------------------

/**
 * Convert the form's header + rows into the EXACT request body the
 * .NET API expects. Pure function (no side effects) so it's easy to test.
 */
export function buildCowFactorPayload(
  header: CowFormHeader,
  rows: CowFormRow[],
): SubmitCowFactorRequest {
  // Build the four parallel arrays in a single pass so indices line up.
  // We use parseFloat/parseInt to convert string inputs to numbers because
  // the backend expects numeric types and JSON.stringify would otherwise
  // serialize "12" (string) instead of 12 (number).
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
    // Default to 1 ("normal") when the user didn't pick one — but validation
    // below should have already rejected empty values.
    ExistenceStatuses.push(EXISTENCE_STATUS_MAP[r.existenceStatus] ?? 1);
    // The backend expects a string array — empty string for missing values.
    Descriptions.push(r.description || "");
  }

  // Build the header with backend's PascalCase keys.
  const Factor: CowFactorHeader = {
    FactorTypeId: FACTOR_TYPE_MAP[header.invoiceType],
    // Default ProductTypeId for "دام" is 5 in our schema; allow override.
    ProductTypeId: header.productTypeId ?? 5,
    FactorDate: header.factorDate,
    Date: header.factorDate, // duplicate per backend contract
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

  // Only attach conditional fields when defined — keeps payload clean and
  // avoids sending `undefined` (which JSON.stringify drops anyway, but we
  // are explicit for clarity).
  if (header.shoppingCenterId != null) Factor.ShoppingCenterId = header.shoppingCenterId;
  if (header.otherCenterName) Factor.OtherCenterName = header.otherCenterName;
  if (header.otherCenterPhoneNumber) Factor.OtherCenterPhoneNumber = header.otherCenterPhoneNumber;
  if (header.otherCenterAddress) Factor.OtherCenterAddress = header.otherCenterAddress;
  if (header.otherCenterDescription) Factor.OtherCenterDescription = header.otherCenterDescription;

  return {
    Factor,
    CowFactorDetail: {
      CowIds,
      Weights,
      UnitPrices,
      RowPrices,
      ExistenceStatuses,
      Descriptions,
    },
  };
}

// ---------------------------------------------------------------------
// 5) VALIDATION LAYER — runs BEFORE we touch the network.
// ---------------------------------------------------------------------

/** Thrown when client-side business rules fail. Carries a Persian message
 *  that's safe to display directly to the end user. */
export class CowFactorValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CowFactorValidationError";
  }
}

/**
 * Validate the rows + header. Throws CowFactorValidationError on the
 * first violation so the caller can show a single clear message.
 *
 * Rules enforced (per spec):
 *   1. No duplicate CowIds
 *   2. Required fields per row: cowId, weight, unitPrice, existenceStatus
 *   3. Arrays must not be empty
 *   4. Header: factor date and seller type required
 */
export function validateCowFactorInput(
  header: CowFormHeader,
  rows: CowFormRow[],
): void {
  // --- 3) Non-empty array check ---
  if (!rows || rows.length === 0) {
    throw new CowFactorValidationError("حداقل یک ردیف دام باید وارد شود.");
  }

  // --- header sanity (date is critical for the backend) ---
  if (!header.factorDate) {
    throw new CowFactorValidationError("تاریخ فاکتور الزامی است.");
  }
  if (!header.invoiceType) {
    throw new CowFactorValidationError("نوع فاکتور (خرید/فروش) الزامی است.");
  }

  // --- 2) Required field check + numeric sanity ---
  const seenCowIds = new Set<number>();

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const rowLabel = `ردیف ${i + 1}`; // 1-based for human-friendly errors

    if (!r.cowId) {
      throw new CowFactorValidationError(`${rowLabel}: شماره دام انتخاب نشده است.`);
    }
    const cowIdNum = parseInt(r.cowId, 10);
    if (!Number.isFinite(cowIdNum) || cowIdNum <= 0) {
      throw new CowFactorValidationError(`${rowLabel}: شماره دام نامعتبر است.`);
    }

    const weightNum = parseFloat(r.weight);
    if (!r.weight || !Number.isFinite(weightNum) || weightNum <= 0) {
      throw new CowFactorValidationError(`${rowLabel}: وزن باید بزرگ‌تر از صفر باشد.`);
    }

    const priceNum = parseInt(r.unitPrice, 10);
    if (!r.unitPrice || !Number.isFinite(priceNum) || priceNum <= 0) {
      throw new CowFactorValidationError(`${rowLabel}: قیمت واحد باید بزرگ‌تر از صفر باشد.`);
    }

    if (!r.existenceStatus) {
      throw new CowFactorValidationError(`${rowLabel}: نوع (فروش/تلفات/کشتار) انتخاب نشده است.`);
    }
    if (!(r.existenceStatus in EXISTENCE_STATUS_MAP)) {
      throw new CowFactorValidationError(`${rowLabel}: نوع نامعتبر است.`);
    }

    // --- 1) Duplicate CowId check ---
    if (seenCowIds.has(cowIdNum)) {
      throw new CowFactorValidationError(
        `شماره دام «${r.cowId}» در چند ردیف تکراری است. هر دام فقط یک‌بار قابل ثبت است.`,
      );
    }
    seenCowIds.add(cowIdNum);
  }
}

// ---------------------------------------------------------------------
// 6) HTTP CLIENT
// ---------------------------------------------------------------------

/**
 * Resolve the API base URL.
 * - Reads from Vite env (VITE_API_BASE_URL) so the same build can target
 *   different servers (dev / staging / on-prem).
 * - Falls back to "" which results in a same-origin request (works when
 *   the SPA is served from the same host as the API, or behind a proxy).
 */
function getApiBaseUrl(): string {
  // import.meta.env is replaced at build time by Vite — no runtime cost.
  const fromEnv = import.meta.env.VITE_API_BASE_URL as string | undefined;
  // Trim trailing slash so we can safely concatenate with the path.
  return (fromEnv || "").replace(/\/+$/, "");
}

/**
 * Submit the cow factor to the .NET backend.
 *
 * Steps:
 *   1. Run client-side validation (throws on failure → caller catches)
 *   2. Build the EXACT backend payload via the mapper
 *   3. POST it to /api/Cow/AddCowFactorDetail
 *   4. Parse the JSON response and return it as-is
 *
 * We send `credentials: "include"` because the project uses cookie/session
 * auth on the same origin (per user's choice during planning).
 */
export async function submitCowFactor(
  header: CowFormHeader,
  rows: CowFormRow[],
): Promise<SubmitCowFactorResponse> {
  // 1) Validate first — fail fast, no network call on bad input.
  validateCowFactorInput(header, rows);

  // 2) Build the strict backend payload.
  const body = buildCowFactorPayload(header, rows);

  // 3) Fire the POST request.
  const url = `${getApiBaseUrl()}/api/Cow/AddCowFactorDetail`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      // Persian-friendly UTF-8 JSON.
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      // Cookie/session auth — browser will attach the auth cookie automatically.
      credentials: "include",
      body: JSON.stringify(body),
    });
  } catch (networkErr) {
    // fetch() only rejects on network failure (DNS, offline, CORS preflight blocked, etc.)
    // We surface a Persian message that is meaningful to the user.
    const detail = networkErr instanceof Error ? networkErr.message : String(networkErr);
    throw new Error(`خطای شبکه در ارتباط با سرور: ${detail}`);
  }

  // 4) The .NET endpoint returns JSON even on logical errors (id=0 + massage).
  // We still guard against non-2xx responses (e.g. 401 / 500) where the body
  // might not be JSON.
  let json: SubmitCowFactorResponse | null = null;
  try {
    json = (await res.json()) as SubmitCowFactorResponse;
  } catch {
    // Body wasn't JSON — likely a server crash or auth redirect.
    throw new Error(`پاسخ نامعتبر از سرور (وضعیت ${res.status}).`);
  }

  // If HTTP status is bad AND backend didn't give us a usable message,
  // synthesize one so the UI can show something meaningful.
  if (!res.ok && (!json || !json.massage)) {
    throw new Error(`خطای سرور: ${res.status} ${res.statusText}`);
  }

  return json!;
}
