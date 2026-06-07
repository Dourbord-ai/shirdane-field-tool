# Regression RCA — Factor Approval ⇄ Sepidar Integration after MixedInvoiceForm

Date: 2026-06-07
Author: agent (Lovable build assistant)
Status: **Root cause identified. Awaiting approval before any fix.**

---

## 1. Reproducible symptoms (matches your report)

| # | Symptom | Confirmed in DB / code |
|---|---|---|
| 1 | تأیید فاکتور انجام می‌شود اما سند سپیدار ثبت نمی‌شود | YES — 4 رکورد `product_type='mixed'` با `lifecycle_state='approved'` و `sepidar_voucher_id IS NULL` (هیچ‌کدام به سپیدار نرفته‌اند) |
| 2 | وضعیت سپیدار در UI نمایش داده نمی‌شود | YES — `PostingPanel` برای این فاکتورها `null` رندر می‌کند |
| 3 | دکمه «تلاش مجدد ثبت در سپیدار» حذف شده | YES — دکمه داخل همان `PostingPanel` است و چون پنل رندر نمی‌شود، دکمه هم دیده نمی‌شود |

### اطلاعات دیتابیس

- جمع فاکتورهای `product_type='mixed'`: ۸ (۴ تأییدشده، ۴ پیش‌نویس). همگی `sepidar_voucher_id = NULL`.
- جمع فاکتورهای قدیمی (`legacy_product_*`): بیش از ۲٬۴۰۰ — اینها هم `lifecycle_state` ندارند و وارد pipeline جدید نشده‌اند، ولی این موضوع جدا از regression فعلی است (همیشه همین رفتار را داشته‌اند).

---

## 2. Root Cause — دو لایه

### Layer A — UI Gate (علت مستقیم نمایش‌نشدن دکمه و وضعیت)

`src/pages/Invoices.tsx`، خط ۲۸۱:

```ts
const POSTING_SUPPORTED_PRODUCT_TYPES = new Set<string>([
  "livestock", "feed", "medicine", "sperm", "manure", "services",
]);
```

و خط ۲۹۷:

```ts
function supportsSepidarPosting(f: FactorRow): boolean {
  if (isFeedSale(f)) return false;
  return POSTING_SUPPORTED_PRODUCT_TYPES.has(f.product_type);
}
```

سپس داخل `PostingPanel` (خط ۴۳۵–۴۳۸):

```ts
const supported = supportsSepidarPosting(factor);
const showNothing = !supported || (!isPosted && !canPost);
...
if (showNothing) return null;
```

`MixedInvoiceForm.tsx` خط ۷۲۲ هنگام درج فاکتور صراحتاً می‌نویسد:

```ts
const buildHeader = (number) => ({
  product_type: "mixed",   // <-- این مقدار جدید است
  ...
});
```

چون `"mixed"` در مجموعهٔ پشتیبانی‌شده **نیست**، `supportsSepidarPosting` همیشه `false` برمی‌گرداند، کل `PostingPanel` به‌صورت `null` رندر می‌شود → نه وضعیت سپیدار نمایش داده می‌شود، نه دکمهٔ Post، نه دکمهٔ Retry.

> این، علت مستقیم سه observation کاربر است.

### Layer B — Backend Gate (علت اینکه حتی اگر UI درست شود، Post fail می‌کند)

RPC پشت دکمهٔ Post:

- `supabase/migrations/20260528064557_*.sql` خط ۹۱–۹۹ در `public.post_approved_factor`:

```sql
IF COALESCE(v_factor.product_type, '') <> 'livestock' THEN
  ...
  RAISE EXCEPTION 'product_type پشتیبانی نمی‌شود.';
END IF;
```

یعنی RPC فقط `livestock` را می‌سازد. حتی `feed`، `medicine` و … که در UI لیست شده‌اند هم به این RPC نمی‌رسند (احتمالاً مسیر متفاوتی برایشان وجود داشته). برای `mixed` هیچ مسیر backend وجود ندارد.

تأیید مکمل: `factor_accounting_map` فقط برای `livestock | feed | medicine | sperm | manure | services` ردیف دارد — **`mixed` وجود ندارد**. این یعنی موتور حسابداری اصلاً نمی‌داند برای ردیف‌های mixed چه حساب‌هایی استفاده کند.

> یعنی regression فقط یک "فراموش‌کردن stringاضافه‌کردن" نیست؛ مسیر backend برای فاکتورهای ترکیبی هرگز ساخته نشده.

### چه چیزی واقعاً تغییر کرده (Backward Compatibility Break)

پیش از Refactor، فرم‌های قدیمی factor را با `product_type` از مجموعهٔ پشتیبانی‌شده ایجاد می‌کردند (livestock / feed / medicine / …). بنابراین:

- ApprovalPanel ✓
- PostingPanel ✓ (چون `product_type` در whitelist بود)
- دکمه Post و Retry ✓

پس از Refactor:

- MixedInvoiceForm جایگزین مسیرهای ایجاد فاکتور شده.
- این فرم برای *همه* فاکتورهای جدید مقدار `product_type='mixed'` می‌نویسد.
- نه whitelist به‌روز شده، نه RPC backend، نه `factor_accounting_map`.

نتیجه: کل زنجیرهٔ Approval → Voucher Creation → Sepidar Sync برای فاکتورهای جدید عملاً قطع است.

---

## 3. Audit per requested step

| مرحله از زنجیره | وضعیت پس از Refactor |
|---|---|
| Factor Approval (ApprovalPanel) | ✅ کار می‌کند (`lifecycle_state='approved'`, `approved_at` ست می‌شود) |
| Voucher Creation (`post_approved_factor`) | ❌ هرگز فراخوانی نمی‌شود (دکمه‌اش مخفی است). اگر هم فراخوانی می‌شد، با `product_type پشتیبانی نمی‌شود` ری‌جکت می‌شد. |
| Finance Voucher Linking (`finance_vouchers.source_entity_id`) | ❌ به‌تبع بالا انجام نمی‌شود |
| Sepidar Sync (`factor-post-voucher` edge function → `bridge.CreatePaymentRequestVoucher`) | ❌ فراخوانی نمی‌شود |
| Sepidar Status Update (`factors.sepidar_voucher_id`, `lifecycle_state='posted'`) | ❌ ست نمی‌شود |
| UI Status Display (Posted badge + Retry button) | ❌ پنل کلاً `null` رندر می‌شود |

---

## 4. مسیر اصلاح پیشنهادی (فقط برای تأیید — هنوز اجرا نشده)

سه گزینه با ریسک‌های متفاوت:

### Option 1 — حداقل اصلاح (UI-only، بدون پشتیبانی واقعی Sepidar)

فقط `"mixed"` را به `POSTING_SUPPORTED_PRODUCT_TYPES` اضافه کنیم.

- ✅ دکمه و وضعیت دوباره نمایش داده می‌شوند → user می‌بیند فاکتور در چه مرحله‌ای است.
- ❌ کلیک روی دکمه با خطا برخواهد گشت (`product_type پشتیبانی نمی‌شود`) و کاربر "خطای ثبت سند" می‌بیند.
- مناسب اگر می‌خواهید transparency داشته باشید ولی هنوز برای انجام واقعی آماده نیستید.

### Option 2 — مسیر کامل برای mixed (پیشنهاد می‌شود)

1. اضافه‌کردن `"mixed"` به whitelist UI.
2. ارتقاء `post_approved_factor` تا برای `product_type='mixed'` ردیف‌های `factor_items` را تک‌به‌تک خوانده، با کمک `factor_accounting_map`های موجود (livestock/feed/medicine/sperm/manure/services بر اساس `factor_items.product_type` هر ردیف) سند چندخطی بسازد. برای ردیف‌هایی که خریدند: AP در یک سمت، inventory/expense روی سمت دیگر بر اساس نوع ردیف.
3. تصمیم نهایی دربارهٔ نگاشت «نوع کلی فاکتور» در bridge: همان `RequestType=0/1` (خرید/فروش) که از `invoice_type` تعیین می‌شود — `bridge.CreatePaymentRequestVoucher` خودش حساب طرف را انتخاب می‌کند.
4. تست end-to-end با یک فاکتور خرید و یک فاکتور فروش mixed (نیاز به دسترسی سپیدار شما دارد).

### Option 3 — Workaround بدون mixed

اگر می‌خواهید سریع‌تر باشد: در `MixedInvoiceForm` بر اساس ترکیب ردیف‌ها `product_type` را روی فاکتور `livestock` یا `medicine` و … ست کنیم اگر همهٔ ردیف‌ها یک نوع‌اند، و در غیر این صورت بلاک کنیم. این روش regressionرا برای فاکتورهای تک‌نوع برمی‌گرداند ولی فاکتورهای واقعاً ترکیبی همچنان قطع می‌مانند.

---

## 5. فایل‌ها/توابعی که در مرحلهٔ اصلاح لمس می‌شوند

(بسته به Option انتخابی)

- `src/pages/Invoices.tsx` — `POSTING_SUPPORTED_PRODUCT_TYPES`, ممکن است `STATUS_META`.
- `supabase/migrations/<new>.sql` — بازنویسی `public.post_approved_factor` برای `mixed` (Option 2).
- `supabase/functions/factor-post-voucher/index.ts` — احتمالاً تغییری لازم نیست؛ تنها مصرف‌کنندهٔ RPC است.
- داده‌ها: ممکن است نیاز به افزودن ردیف‌های `factor_accounting_map` برای کلید جدید `mixed` باشد، یا تصمیم بگیریم نگاشت per-line انجام شود (پیشنهاد شده).

---

## 6. درخواست تصمیم

لطفاً مشخص کنید کدام مسیر را اجرا کنیم:

- [ ] Option 1 — Quick visibility fix فقط (می‌دانیم دکمه با خطا برمی‌گردد).
- [ ] Option 2 — مسیر کامل با ارتقای RPC برای `mixed` (نیاز به یک round تست شما با سپیدار دارد).
- [ ] Option 3 — Routing بر اساس ترکیب ردیف‌ها (پشتیبانی فاکتور واقعاً ترکیبی فعلاً off).

تا تأیید شما، **هیچ تغییری اعمال نمی‌شود.**
