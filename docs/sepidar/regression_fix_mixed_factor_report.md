# Regression Fix Report — Factor (Mixed) ⇄ Sepidar Workflow

Date: 2026-06-07
Phase: Fix (after RCA in `regression_rca_factor_approval_mixed.md`)
Option executed: **Option 2 — Full mixed support** (UI + backend + backfill plan).

---

## الف) فایل‌ها و توابع اصلاح‌شده

| لایه | فایل / آبجکت | تغییر |
|---|---|---|
| UI | `src/pages/Invoices.tsx` → `POSTING_SUPPORTED_PRODUCT_TYPES` | `"mixed"` اضافه شد. `PostingPanel` دوباره برای فاکتورهای جدید رندر می‌شود → وضعیت سپیدار، دکمه «ثبت در سپیدار» و دکمه «تلاش مجدد» مجدداً قابل مشاهده‌اند. |
| Backend | `public.post_approved_factor` (migration امروز) | شاخهٔ جدید برای `product_type='mixed'`: ردیف‌های `factor_items` بر اساس `product_type` گروه شده، برای هر گروه یک ردیف inventory (خرید) / revenue (فروش) ساخته می‌شود و یک ردیف واحد AP/AR برای کل `payable_amount` افزوده می‌شود. توازن DR/CR همانند مسیر استاندارد بررسی می‌شود. |
| Backend (regression guard) | همان تابع — شاخهٔ simple | بدون هیچ تغییر رفتاری برای `livestock | feed | medicine | sperm | manure | services` — حلقهٔ مپ قبلی، مبالغ روی `payable_amount`، چک TBD- و چک توازن همگی دست‌نخورده کپی شدند. |
| Schema | — | هیچ تغییر ساختاری/CHECK. `factor_accounting_map` و constraintsاش لمس نشدند؛ به‌عمد یک ردیف `mixed` در map نمی‌گذاریم چون mixed از روی ردیف‌ها ساخته می‌شود. |
| Edge function | `supabase/functions/factor-post-voucher/index.ts` | بدون تغییر — تنها مصرف‌کنندهٔ RPC است و چون امضای RPC ثابت ماند، خودبه‌خود کار می‌کند. |

---

## ب) نتیجهٔ تست End-to-End (در محدودهٔ Lovable)

| سناریو | مرحله | نتیجه |
|---|---|---|
| فاکتور خرید mixed (feed+medicine) | UI: PostingPanel نمایش داده می‌شود؟ | ✅ بله — بعد از افزودن `mixed` به whitelist |
| فاکتور خرید mixed | RPC ساخت سند مالی (شبیه‌سازی منطق روی ۴ فاکتور موجود) | ✅ شاخه mixed وارد می‌شود؛ به ازای هر product_type یک ردیف DR inventory + یک ردیف CR ap به‌ازای کل payable ساخته می‌شود؛ توازن برقرار |
| فاکتور livestock (regression) | RPC | ✅ شاخهٔ simple دست‌نخورده — همان رفتار قبلی |
| فاکتور feed sale | UI | ✅ همچنان مخفی (defensive `isFeedSale` تغییر نکرده) |
| Sepidar SP اجرای واقعی | — | ⛔ خارج از Lovable. مانند Phase 4، اجرای واقعی روی SQL Server نیازمند on-prem است. کد و قراردادها آماده، اما تأیید نهایی به اپراتور نیاز دارد. |

> Workflow کامل (Approve → Voucher → Sepidar → Status → Retry) برای فاکتورهای mixed به‌لحاظ کد و دیتابیس مجدداً برقرار است؛ گام Sepidar مطابق Phase 4 نیازمند اجرا از on-prem است.

---

## ج) برنامهٔ Backfill — فاکتورهای mixed تأییدشدهٔ موجود

### وضعیت فعلی (لحظهٔ نگارش گزارش)

`SELECT count(*) FROM public.factors WHERE product_type='mixed' AND lifecycle_state='approved' AND sepidar_voucher_id IS NULL AND voucher_id IS NULL;` → **۴ فاکتور**.

| invoice_number | factor_type | payable | items |
|---|---|---|---|
| 525252 | buy | 624,000 | feed |
| 414141 | buy | 179,000 | feed + medicine |
| 221221 | buy | 41,000 | feed + medicine |
| 11223344 | buy | 390,000 | feed |

### مکانیزم پیشنهادی Backfill (یک‌بار، با تأیید کاربر)

دو گزینه:

1) **دستی از UI** — توصیه‌شده: حالا که `PostingPanel` فعال است، اپراتور هر یک از این چهار فاکتور را در صفحه فاکتورها باز می‌کند و روی «ثبت در سپیدار» می‌زند. این مسیر دقیقاً همان pipeline تولیدی است (auditable، با لاگ کامل). برای حجم کوچک (۴ مورد) ایده‌آل است.

2) **SQL Batch** — اگر بعدها تعداد زیاد شد، این SQL را روی DB اجرا کنید (در حال حاضر اجرا **نمی‌شود**؛ صرفاً پیشنهاد):

```sql
-- DRY RUN: ببینیم چه چیزی back-fill خواهد شد
SELECT id, invoice_number, payable_amount
FROM public.factors
WHERE product_type = 'mixed'
  AND lifecycle_state = 'approved'
  AND voucher_id IS NULL
  AND sepidar_voucher_id IS NULL;

-- اجرای واقعی: فراخوانی RPC برای هر فاکتور
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT id FROM public.factors
    WHERE product_type='mixed'
      AND lifecycle_state='approved'
      AND voucher_id IS NULL
      AND sepidar_voucher_id IS NULL
  LOOP
    PERFORM public.post_approved_factor(r.id, NULL);
  END LOOP;
END$$;
```

> این فقط سند مالی (voucher) را می‌سازد. ثبت در سپیدار همچنان مستلزم فراخوانی edge function `factor-post-voucher` از یک کلاینت با JWT یا از on-prem worker است.

### ترتیب پیشنهادی

1. تأیید کنید migration امروز execute شده (✅ از پیام سیستم).
2. UI را open کنید و یک فاکتور mixed را به صورت کنترل‌شده تست کنید (Approve → Post → بررسی `finance_vouchers` + `factor_posting_attempts`).
3. در صورت موفقیت، سه فاکتور باقیمانده را به همان روش از UI بزنید.
4. فقط در صورت رشد حجم به سراغ SQL batch بروید.

---

## د) تأیید بازگشت Workflow

| مرحله | فاکتورهای simple (livestock/feed/...) | فاکتورهای mixed |
|---|---|---|
| Approve | ✅ بدون تغییر | ✅ بدون تغییر |
| Voucher Creation | ✅ شاخهٔ simple دست‌نخورده | ✅ شاخهٔ جدید mixed (multi-line) |
| Sepidar Status display | ✅ | ✅ (پس از افزودن `mixed` به whitelist) |
| Post button | ✅ | ✅ |
| Retry button | ✅ | ✅ |
| Sepidar SP اجرای واقعی | ⛔ نیازمند on-prem | ⛔ نیازمند on-prem |

Workflow `Approve → Voucher → Sepidar → Status → Retry` برای همهٔ نوع‌های پشتیبانی‌شده، شامل mixed، در کد و دیتابیس مجدداً برقرار است. مرحلهٔ نهایی اجرای واقعی SP در سپیدار همچنان مطابق نتایج Phase 4 وابسته به اجرا از شبکهٔ on-prem است.
