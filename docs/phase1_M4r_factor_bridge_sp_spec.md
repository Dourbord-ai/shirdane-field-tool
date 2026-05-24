# Phase 1 — M4r: Factor Bridge SP Spec (SQL Server 2008 compatible)

Status: **DRAFT — do not deploy until review approved.** No execution.
Target DB: `ShirdaneBridge` on Sepidar SQL Server 2008.
Calling pattern: identical to `bridge.CreateBankVoucher` used by
`sepidar-create-payment-voucher` / receive / interbank / party-transfer.

---

## 1. SQL Server 2008 compatibility constraints

The procedure body MUST avoid features added after SQL 2008:

| Forbidden | Use instead |
|---|---|
| `THROW`                  | `RAISERROR(@msg, 16, 1)` |
| `JSON_VALUE` / `OPENJSON`| store JSON as `NVARCHAR(MAX)`; do not parse server-side |
| `FORMAT(...)`            | `CONVERT(NVARCHAR, ...)` |
| `CONCAT(a,b,...)`        | `ISNULL(a,N'') + ISNULL(b,N'')` |
| `DATETIME2`/`DATETIMEOFFSET` for new cols | `DATETIME` |
| `STRING_AGG`, `TRY_CONVERT` (2012+) | manual logic |
| `IIF`, `CHOOSE` (2012+)  | `CASE WHEN ... END` |
| `SEQUENCE`               | `IDENTITY` |

All string columns use `NVARCHAR(MAX)` for safety. Dates are `DATETIME`.

---

## 2. Audit + idempotency tables

Created once (only if not present). Same schema style as existing bridge logs.

```sql
-- Audit log — one row per inbound request (success or failure).
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'FactorPostingLog' AND schema_id = SCHEMA_ID('bridge'))
BEGIN
    CREATE TABLE bridge.FactorPostingLog (
        LogId               INT IDENTITY(1,1) PRIMARY KEY,
        AppFactorId         NVARCHAR(MAX) NULL,
        AppVoucherId        NVARCHAR(MAX) NULL,
        SourceSystem        NVARCHAR(MAX) NULL,
        SourceType          NVARCHAR(MAX) NULL,
        RequestPayload      NVARCHAR(MAX) NULL,   -- raw JsonStatus from Damban
        ResponsePayload     NVARCHAR(MAX) NULL,
        ResultCode          INT NULL,
        ResultMessage       NVARCHAR(MAX) NULL,
        SepidarVoucherId    INT NULL,
        SepidarVoucherNumber NVARCHAR(MAX) NULL,
        CreatedAt           DATETIME NOT NULL DEFAULT GETDATE()
    );
END;

-- Idempotency map — at most ONE successful Sepidar voucher per AppVoucherId.
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'FactorPostingMap' AND schema_id = SCHEMA_ID('bridge'))
BEGIN
    CREATE TABLE bridge.FactorPostingMap (
        AppVoucherId         NVARCHAR(450) NOT NULL PRIMARY KEY,
        AppFactorId          NVARCHAR(MAX) NULL,
        SepidarVoucherId     INT NOT NULL,
        SepidarVoucherNumber NVARCHAR(MAX) NULL,
        CreatedAt            DATETIME NOT NULL DEFAULT GETDATE()
    );
END;
```

---

## 3. Stored procedure: `bridge.CreateFactorVoucher`

### 3.1 Signature (inputs / outputs)

```sql
CREATE PROCEDURE bridge.CreateFactorVoucher
    -- Identity from Damban
    @AppFactorId            NVARCHAR(MAX),
    @AppVoucherId           NVARCHAR(450),   -- idempotency key (finance_vouchers.id)

    -- Counter-party (Sepidar)
    @BankPartyId            INT          = NULL,  -- legacy/optional
    @SepidarPartyId         INT          = NULL,  -- preferred when present
    @BankPartyName          NVARCHAR(MAX) = NULL,

    -- Money
    @Amount                 DECIMAL(18,2),

    -- Direction:  0 = purchase (buy_livestock)  |  1 = sale (sell_livestock)
    @RequestType            INT,

    -- Dates
    @VoucherDate            DATETIME,
    @PersianVoucherDate     NVARCHAR(MAX),

    -- Audit / creator
    @RegisteredUserId       INT          = NULL,
    @RegisteredUserFullName NVARCHAR(MAX) = NULL,

    -- Display
    @FactorName             NVARCHAR(MAX),
    @Description            NVARCHAR(MAX),
    @Description2           NVARCHAR(MAX),

    -- Raw payload (kept verbatim — NOT parsed by SP, 2008-safe)
    @JsonStatus             NVARCHAR(MAX) = NULL,

    -- Provenance
    @SourceSystem           NVARCHAR(MAX) = N'Damban',
    @SourceType             NVARCHAR(MAX) = N'factor',

    -- Outputs
    @SepidarVoucherId       INT          OUTPUT,
    @SepidarVoucherNumber   NVARCHAR(MAX) OUTPUT,
    @ResultCode             INT          OUTPUT,   -- 0 = OK, non-zero = error
    @ResultMessage          NVARCHAR(MAX) OUTPUT
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @existingId   INT = NULL;
    DECLARE @existingNum  NVARCHAR(MAX) = NULL;
    DECLARE @logId        INT = NULL;
    DECLARE @errMsg       NVARCHAR(MAX) = NULL;

    -- ----- 0. Always log the inbound request first -----------------------------
    INSERT INTO bridge.FactorPostingLog
        (AppFactorId, AppVoucherId, SourceSystem, SourceType, RequestPayload)
    VALUES
        (@AppFactorId, @AppVoucherId, @SourceSystem, @SourceType, @JsonStatus);
    SET @logId = SCOPE_IDENTITY();

    -- ----- 1. Idempotency: return prior result if AppVoucherId already posted --
    SELECT TOP 1
        @existingId  = SepidarVoucherId,
        @existingNum = SepidarVoucherNumber
    FROM bridge.FactorPostingMap
    WHERE AppVoucherId = @AppVoucherId;

    IF @existingId IS NOT NULL
    BEGIN
        SET @SepidarVoucherId     = @existingId;
        SET @SepidarVoucherNumber = @existingNum;
        SET @ResultCode           = 0;
        SET @ResultMessage        = N'سند قبلاً در سپیدار ثبت شده است (idempotent).';

        UPDATE bridge.FactorPostingLog
        SET ResultCode = @ResultCode,
            ResultMessage = @ResultMessage,
            SepidarVoucherId = @SepidarVoucherId,
            SepidarVoucherNumber = @SepidarVoucherNumber,
            ResponsePayload = N'{"idempotent":true}'
        WHERE LogId = @logId;

        SELECT @SepidarVoucherId  AS SepidarVoucherId,
               @SepidarVoucherNumber AS SepidarVoucherNumber,
               @ResultCode        AS ResultCode,
               @ResultMessage     AS ResultMessage,
               1                  AS success;
        RETURN 0;
    END;

    -- ----- 2. Basic input validation (2008-safe; RAISERROR, no THROW) ---------
    IF @AppVoucherId IS NULL OR LTRIM(RTRIM(@AppVoucherId)) = N''
    BEGIN
        SET @ResultCode = 50001;
        SET @ResultMessage = N'AppVoucherId الزامی است.';
        GOTO FailExit;
    END;

    IF @Amount IS NULL OR @Amount <= 0
    BEGIN
        SET @ResultCode = 50002;
        SET @ResultMessage = N'مبلغ سند نامعتبر است.';
        GOTO FailExit;
    END;

    IF @RequestType NOT IN (0, 1)
    BEGIN
        SET @ResultCode = 50003;
        SET @ResultMessage = N'RequestType باید 0 (خرید) یا 1 (فروش) باشد.';
        GOTO FailExit;
    END;

    IF (@SepidarPartyId IS NULL AND @BankPartyId IS NULL)
    BEGIN
        SET @ResultCode = 50004;
        SET @ResultMessage = N'شناسه طرف حساب سپیدار مشخص نیست.';
        GOTO FailExit;
    END;

    -- ----- 3. Delegate to internal Sepidar posting helper ---------------------
    -- We DO NOT duplicate Sepidar voucher logic here. We call the same internal
    -- routine used by receive/payment posting. That routine already knows how
    -- to talk to Sepidar tables, allocate the voucher number, and return the
    -- new IDs. It must already exist in ShirdaneBridge (used by
    -- bridge.CreateBankVoucher). Naming below is a placeholder — wire to the
    -- real internal SP/function name during deployment review.
    --
    -- Expected contract of the internal helper:
    --   IN : party id, amount, requesttype, voucherdate, descriptions, creator
    --   OUT: @newVoucherId INT, @newVoucherNumber NVARCHAR(MAX), @ok BIT, @msg NVARCHAR(MAX)

    DECLARE @partyId   INT = ISNULL(@SepidarPartyId, @BankPartyId);
    DECLARE @newId     INT = NULL;
    DECLARE @newNumber NVARCHAR(MAX) = NULL;
    DECLARE @ok        BIT = 0;
    DECLARE @msg       NVARCHAR(MAX) = NULL;

    BEGIN TRY
        EXEC bridge.usp_PostFactorVoucher_Internal
            @PartyId                = @partyId,
            @Amount                 = @Amount,
            @RequestType            = @RequestType,
            @VoucherDate            = @VoucherDate,
            @PersianVoucherDate     = @PersianVoucherDate,
            @FactorName             = @FactorName,
            @Description            = @Description,
            @Description2           = @Description2,
            @RegisteredUserId       = @RegisteredUserId,
            @RegisteredUserFullName = @RegisteredUserFullName,
            @OutVoucherId           = @newId           OUTPUT,
            @OutVoucherNumber       = @newNumber       OUTPUT,
            @OutSuccess             = @ok              OUTPUT,
            @OutMessage             = @msg             OUTPUT;
    END TRY
    BEGIN CATCH
        SET @ok = 0;
        SET @msg = ERROR_MESSAGE();
    END CATCH;

    IF @ok <> 1 OR @newId IS NULL
    BEGIN
        SET @ResultCode    = 50010;
        SET @ResultMessage = ISNULL(@msg, N'ثبت سند فاکتور در سپیدار ناموفق بود.');
        GOTO FailExit;
    END;

    -- ----- 4. Record idempotency map (atomic) ---------------------------------
    BEGIN TRY
        INSERT INTO bridge.FactorPostingMap
            (AppVoucherId, AppFactorId, SepidarVoucherId, SepidarVoucherNumber)
        VALUES
            (@AppVoucherId, @AppFactorId, @newId, @newNumber);
    END TRY
    BEGIN CATCH
        -- Race: another concurrent call won. Reread and return the winner.
        SELECT TOP 1
            @newId     = SepidarVoucherId,
            @newNumber = SepidarVoucherNumber
        FROM bridge.FactorPostingMap
        WHERE AppVoucherId = @AppVoucherId;
    END CATCH;

    SET @SepidarVoucherId     = @newId;
    SET @SepidarVoucherNumber = @newNumber;
    SET @ResultCode           = 0;
    SET @ResultMessage        = N'سند فاکتور با موفقیت در سپیدار ثبت شد.';

    UPDATE bridge.FactorPostingLog
    SET ResultCode = @ResultCode,
        ResultMessage = @ResultMessage,
        SepidarVoucherId = @SepidarVoucherId,
        SepidarVoucherNumber = @SepidarVoucherNumber,
        ResponsePayload = N'{"ok":true}'
    WHERE LogId = @logId;

    SELECT @SepidarVoucherId     AS SepidarVoucherId,
           @SepidarVoucherNumber AS SepidarVoucherNumber,
           @ResultCode           AS ResultCode,
           @ResultMessage        AS ResultMessage,
           1                     AS success;
    RETURN 0;

FailExit:
    UPDATE bridge.FactorPostingLog
    SET ResultCode    = @ResultCode,
        ResultMessage = @ResultMessage,
        ResponsePayload = N'{"ok":false}'
    WHERE LogId = @logId;

    SET @SepidarVoucherId     = NULL;
    SET @SepidarVoucherNumber = NULL;

    SELECT @SepidarVoucherId     AS SepidarVoucherId,
           @SepidarVoucherNumber AS SepidarVoucherNumber,
           @ResultCode           AS ResultCode,
           @ResultMessage        AS ResultMessage,
           0                     AS success;

    -- Surface SP-level error to driver while keeping 2008 syntax.
    RAISERROR(@ResultMessage, 16, 1);
    RETURN @ResultCode;
END;
```

### 3.2 Notes

- `bridge.usp_PostFactorVoucher_Internal` is the **same Sepidar posting routine**
  used by `bridge.CreateBankVoucher` for receive/payment, wrapped to accept
  factor-shaped inputs. We are not reinventing the Sepidar side — only adapting
  the calling shape. The exact internal name is to be confirmed by the Sepidar
  DBA during review; this spec uses a placeholder.
- All NVARCHAR params declared `NVARCHAR(MAX)` so Persian text and long JSON
  pass through cleanly.
- `JsonStatus` is stored verbatim in `FactorPostingLog.RequestPayload`. The SP
  never parses it — JSON parsing is 2012+.
- Idempotency key = `AppVoucherId` = `finance_vouchers.id` (UUID string).
  Retry with the same id returns the existing Sepidar voucher.

---

## 4. Edge Function parameter mapping

The new edge function (or extension of `factor-post-voucher`) builds inputs
from `factors` + `finance_vouchers` rows and calls the SP with `mssql`:

```ts
// factor row: f   (factors)
// voucher row: v  (finance_vouchers created by post_approved_factor RPC)
// party row:   p  (sepidar party resolved from factor counter-party)
// user row:    u  (auth user that triggered the post)

const factorname =
  f.product_type === "livestock" && f.factor_type_id === 1 ? "خرید دام" :
  f.product_type === "livestock" && f.factor_type_id === 2 ? "فروش دام" :
  "فاکتور";

const requestType = f.factor_type_id === 2 ? 1 : 0;   // 1 = sale, 0 = purchase

const persianDate = v.persian_voucher_date;           // already produced upstream
const description  = `بابت فاکتور کد ${f.code} تاریخ ${persianDate} نوع ${factorname}`;
const description2 = description + (requestType === 1 ? " به " : " از ") + (p.name ?? "");

r.input("AppFactorId",            sql.NVarChar, f.id);
r.input("AppVoucherId",           sql.NVarChar, v.id);                  // idempotency key
r.input("BankPartyId",            sql.Int,      p.legacy_party_id ?? null);
r.input("SepidarPartyId",         sql.Int,      p.sepidar_party_id ?? null);
r.input("BankPartyName",          sql.NVarChar, p.name ?? null);
r.input("Amount",                 sql.Decimal(18,2), Number(v.total_debit));
r.input("RequestType",            sql.Int,      requestType);
r.input("VoucherDate",            sql.DateTime, new Date(v.voucher_date));
r.input("PersianVoucherDate",     sql.NVarChar, persianDate);
r.input("RegisteredUserId",       sql.Int,      u.sepidar_user_id ?? null);
r.input("RegisteredUserFullName", sql.NVarChar, u.full_name ?? null);
r.input("FactorName",             sql.NVarChar, factorname);
r.input("Description",            sql.NVarChar, description);
r.input("Description2",           sql.NVarChar, description2);
r.input("JsonStatus",             sql.NVarChar, JSON.stringify({ factor: f, voucher: v }));
r.input("SourceSystem",           sql.NVarChar, "Damban");
r.input("SourceType",             sql.NVarChar, "factor");

r.output("SepidarVoucherId",      sql.Int);
r.output("SepidarVoucherNumber",  sql.NVarChar);
r.output("ResultCode",            sql.Int);
r.output("ResultMessage",         sql.NVarChar);

const result = await r.execute("bridge.CreateFactorVoucher");
const row    = result.recordset?.[0] ?? {};
const out    = result.output ?? {};
const ok     = Number(row.success ?? 0) === 1 && Number(out.ResultCode ?? row.ResultCode) === 0;
```

On `ok === true`:
- copy `SepidarVoucherId` / `SepidarVoucherNumber` onto `finance_vouchers` and
  mirror onto `factors`; set `lifecycle_state = 'posted'`.

On failure:
- set `lifecycle_state = 'sepidar_failed'`, write `ResultMessage` into
  `factors.last_posting_error`, log a row in `factor_posting_attempts`.

---

## 5. Activation gate

Do NOT deploy `bridge.CreateFactorVoucher` until:

1. Sepidar DBA confirms the internal helper name (`usp_PostFactorVoucher_Internal`
   placeholder) and signature.
2. Real account codes have replaced all `TBD-` rows in `factor_accounting_map`.
3. Dry-run on a single buy_livestock and a single sell_livestock factor passes
   end-to-end on SQL 2008.
4. Edge function `factor-post-voucher` is updated to call this SP directly
   instead of `sepidar-post-voucher` (or `sepidar-post-voucher` is taught to
   dispatch the new `buy_livestock`/`sell_livestock` voucher_types to this SP).
