/* ============================================================================
   bridge.RollbackSepidarVoucher
   ----------------------------------------------------------------------------
   Purpose:
     Hard-delete a Sepidar voucher (and its dependent RPA / FMK rows) so the
     application can rebuild the voucher cleanly or leave the operation
     reversed. ShirdaneBridge owns no Supabase tables — Supabase state changes
     (audit, balances, lifecycle flags) happen in the Edge Function AFTER this
     procedure returns success.

   Parameters:
     @SepidarVoucherId   INT          - ACC.Voucher.VoucherId to remove.
     @ExtraDataId        INT  = NULL  - Optional FMK.ExtraData PK to drop.
     @DeleteRpaHeaders   BIT  = 1     - Drop RPA.PaymentHeader / ReceiptHeader
                                        rows that reference the voucher.

   Result set (single row):
     success              BIT          1 = OK, 0 = failure
     result_code          INT          0 = deleted, 2 = already deleted / not found
     message              NVARCHAR
     sepidar_voucher_id   INT

   Convention:
     Idempotent. result_code = 2 is treated as success by the caller.
     The caller (Edge Function) is responsible for all Supabase mutations.
   ============================================================================ */

IF OBJECT_ID('bridge.RollbackSepidarVoucher', 'P') IS NOT NULL
    DROP PROCEDURE bridge.RollbackSepidarVoucher;
GO

CREATE PROCEDURE bridge.RollbackSepidarVoucher
    @SepidarVoucherId  INT,
    @ExtraDataId       INT = NULL,
    @DeleteRpaHeaders  BIT = 1
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    -- Validate input — guard against accidental "delete everything" calls.
    IF (@SepidarVoucherId IS NULL OR @SepidarVoucherId <= 0)
    BEGIN
        SELECT
            CAST(0 AS BIT)        AS success,
            1                     AS result_code,
            N'SepidarVoucherId is required.' AS message,
            @SepidarVoucherId     AS sepidar_voucher_id;
        RETURN;
    END

    -- Idempotency: if the voucher does not exist, return success=1, code=2.
    -- This lets the application proceed with its Supabase cleanup without a
    -- second round-trip when retrying a partially-completed rollback.
    IF NOT EXISTS (
        SELECT 1 FROM Sepidar01.ACC.Voucher WITH (NOLOCK)
        WHERE VoucherId = @SepidarVoucherId
    )
    BEGIN
        SELECT
            CAST(1 AS BIT)                              AS success,
            2                                           AS result_code,
            N'Voucher already deleted or not found.'    AS message,
            @SepidarVoucherId                           AS sepidar_voucher_id;
        RETURN;
    END

    BEGIN TRY
        BEGIN TRANSACTION;

        -- 1. Drop RPA headers that reference this voucher (when requested).
        --    These are the "intent" rows created before the ACC.Voucher itself.
        IF (@DeleteRpaHeaders = 1)
        BEGIN
            DELETE FROM Sepidar01.RPA.PaymentHeader
            WHERE VoucherRef = @SepidarVoucherId;

            DELETE FROM Sepidar01.RPA.ReceiptHeader
            WHERE VoucherRef = @SepidarVoucherId;
        END

        -- 2. Drop FMK.ExtraData by explicit id (if caller passed one).
        IF (@ExtraDataId IS NOT NULL AND @ExtraDataId > 0)
        BEGIN
            DELETE FROM Sepidar01.FMK.ExtraData
            WHERE ExtraDataId = @ExtraDataId;
        END

        -- 3. Drop any remaining FMK.ExtraData rows attached to this voucher
        --    by EntityRef / EntityTypeName — covers cases where ExtraDataId
        --    was not tracked by the application.
        DELETE FROM Sepidar01.FMK.ExtraData
        WHERE EntityRef = @SepidarVoucherId
          AND EntityTypeName = N'SG.Accounting.VoucherManagement.Common.DsVoucher';

        -- 4. Drop voucher items first (FK to ACC.Voucher).
        DELETE FROM Sepidar01.ACC.VoucherItem
        WHERE VoucherRef = @SepidarVoucherId;

        -- 5. Finally drop the voucher itself.
        DELETE FROM Sepidar01.ACC.Voucher
        WHERE VoucherId = @SepidarVoucherId;

        COMMIT TRANSACTION;

        SELECT
            CAST(1 AS BIT)                          AS success,
            0                                       AS result_code,
            N'Voucher deleted successfully.'        AS message,
            @SepidarVoucherId                       AS sepidar_voucher_id;
    END TRY
    BEGIN CATCH
        IF (XACT_STATE() <> 0) ROLLBACK TRANSACTION;

        DECLARE @ErrMsg NVARCHAR(4000) = ERROR_MESSAGE();
        SELECT
            CAST(0 AS BIT)            AS success,
            -1                        AS result_code,
            @ErrMsg                   AS message,
            @SepidarVoucherId         AS sepidar_voucher_id;
    END CATCH
END
GO

GRANT EXECUTE ON bridge.RollbackSepidarVoucher TO PUBLIC;
GO
