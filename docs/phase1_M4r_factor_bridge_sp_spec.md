# Phase 1 — M4r: Factor Voucher Bridge Contract (FINAL)

> Lovable does NOT write or deploy the Sepidar SP. This document is the
> frozen Supabase-side contract — the ShirdaneBridge team implements the
> SQL Server 2008 procedure to match exactly.

See the chat message dated 2026-05-24 for the canonical version. Sections:

1. SP name: `bridge.CreateFactorVoucher` (override env `SEPIDAR_POST_FACTOR_VOUCHER_SP`)
2. 24 typed input params (`@AppFactorId` … `@SourceType`)
3. OUTPUT params + final SELECT row (both required)
4. Idempotency on `@AppVoucherId` (= `finance_vouchers.id`)
5. Description / Description2 construction rules
6. Field mapping summary
7. Success mapping → `finance_vouchers` + `factors` + `factor_posting_attempts`
8. Failure mapping → `lifecycle_state='sepidar_failed'` + audit row
9. Out of scope: per-line items, mapping rows, approval state
10. 6-item activation gate before Edge Function branch is enabled

Edge Function branch stays disabled until all six gate items are confirmed.
