# مدیریت چک‌ها — Check Management Module

افزودن تب جدید «مدیریت چک‌ها» به صفحه `امور مالی` با ۵ زیربخش، مدل داده کامل و منطق حسابداری صحیح (تأثیر طرف حساب در لحظه‌ی دریافت/صدور، تأثیر بانک فقط هنگام پاس شدن).

## ۱) مدل داده (Migration)

پنج جدول جدید در `public`، همگی با `GRANT` و RLS فعال (دسترسی برای `authenticated` و `service_role` — مطابق سایر جداول مالی، فعلاً RLS پرمیسیو `using (true)` تا ماژول auth واقعی فعال شود؛ هم‌راستا با الگوی جداول `finance_*` موجود).

- `finance_checks` — اطلاعات اصلی چک (همان فیلدهایی که خواستید: direction, party_id, amount, check_number, sayad_number, bank_id, bank_account_id, issue_date, receive_date, due_date, status, description, party_effected_at, bank_effected_at, created_by, timestamps). دو enum: `check_direction` و `check_status` (شامل همه‌ی وضعیت‌های دریافتی + پرداختی).
- `finance_check_events` — هر کنش/تغییر وضعیت یک ردیف؛ enum `check_event_type` (received, issued, deposited_to_bank, cleared, bounced, transferred_to_party, voided, marked_lost, party_effect_posted, bank_effect_posted, note).
- `finance_checkbooks` — دسته‌چک‌های خودمان (bank_id, bank_account_id, title, start_serial, end_serial, sheet_count, issued_at, is_active).
- `finance_checkbook_leaves` — برگه‌های دسته‌چک با وضعیت (available/issued/cleared/bounced/voided/lost) + `issued_check_id` با FK به `finance_checks`. ایندکس یکتا روی (checkbook_id, serial_number).
- `finance_check_links` — اتصال چک به موجودیت‌های دیگر (factor / voucher / bank_transaction / payment_request / receive_identification) به صورت polymorphic سبک: `link_type text`, `link_id uuid`.

### توابع/تریگرها

- `fn_finance_checkbook_generate_leaves(checkbook_id)` — هنگام ساخت دسته‌چک، خودکار از `start_serial` تا `end_serial` برگه می‌سازد.
- `fn_finance_check_after_insert` — یک رویداد اولیه (`received` یا `issued`) ثبت می‌کند و `party_effected_at = now()` می‌گذارد (طبق قانون اصلی).
- `fn_finance_check_status_guard` — جلوگیری از انتقال غیرمجاز وضعیت (مثلاً نمی‌توان از `voided` به `cleared` رفت).
- `fn_finance_checkbook_leaf_sync` — همگام‌سازی وضعیت برگه با چک پرداختی متصل.

## ۲) فایل‌های فرانت

```text
src/lib/checks.ts                     ← تایپ‌ها، enumها، نگاشت وضعیت→لیبل فارسی، اکشن‌های مجاز هر status
src/hooks/useChecks.ts                ← react-query: لیست چک‌ها، یک چک با eventها، due-checks
src/hooks/useCheckbooks.ts            ← لیست دسته‌چک‌ها و برگه‌ها
src/components/finance/checks/
   ChecksTab.tsx                      ← کانتینر با sub-tabs (دریافتی / پرداختی / دسته‌چک / سررسید / برگشتی)
   ChecksOverviewCards.tsx            ← کارت‌های KPI بالای ماژول
   ChecksTable.tsx                    ← جدول reusable با فیلتر/جستجو/بج وضعیت
   ChecksFilters.tsx
   StatusBadge.tsx                    ← بج رنگی برای هر وضعیت
   ReceivedChecksSection.tsx
   PayableChecksSection.tsx
   CheckbooksSection.tsx              ← لیست دسته‌چک‌ها + drill-in برگه‌ها
   DueChecksSection.tsx               ← امروز / این هفته / معوق
   BouncedChecksSection.tsx
   NewReceivedCheckDialog.tsx         ← ثبت چک دریافتی
   NewPayableCheckDialog.tsx          ← انتخاب برگه از دسته‌چک
   NewCheckbookDialog.tsx
   CheckDetailDialog.tsx              ← هدر + تایم‌لاین کامل + دکمه‌های اکشن وابسته به وضعیت
   CheckActionButtons.tsx             ← Deposit / Clear / Bounce / Transfer / Void / Mark Lost
   ClearCheckDialog.tsx               ← انتخاب bank_transaction برای اتصال هنگام clear
src/pages/Finance.tsx                 ← افزودن تب «مدیریت چک‌ها»
```

## ۳) منطق حسابداری (در فرانت v1)

طبق قانون اصلی: تأثیر طرف حساب در لحظه‌ی ثبت (insert)، تأثیر بانک فقط هنگام clear.

- ثبت چک دریافتی → `party_effected_at = now()`، event `received`. (تولید voucher در فاز بعدی به کمک `factor_accounting_map` مشابه فاکتورها انجام می‌شود — در v1 فقط ستون‌های اثر‌گذاری ثبت می‌شود تا UI آماده باشد.)
- Clear → `bank_effected_at = now()`، event `cleared`، امکان اتصال به `finance_bank_transactions` از طریق `finance_check_links`.
- Bounce → event `bounced`؛ اگر قبلاً بانک متأثر شده بود، یک رویداد reversal ثبت می‌شود.
- Void/Lost → فقط روی وضعیت‌های مجاز (`draft`, `issued`, `received`, `in_cashbox`) — guard در DB.
- Issue payable → برگه‌ی دسته‌چک به `issued` تبدیل می‌شود (تریگر).

ساختار به‌گونه‌ای است که در فاز بعدی edge function برای ساخت voucher واقعی و post به سپیدار اضافه شود؛ ستون‌های `party_effected_at` / `bank_effected_at` و جدول `finance_check_links` این مسیر را آماده می‌کنند.

## ۴) UI/UX

- RTL فارسی، توکن‌های موجود (`bg-card`, `text-foreground`, `text-primary`, navy + green).
- زیر‌تب‌ها داخل تب «مدیریت چک‌ها» (مشابه الگوی Finance).
- بج وضعیت با رنگ‌های معنایی (received=blue، cleared=primary، bounced=destructive، voided=muted، due_today=amber).
- صفحه‌ی دیتیل چک به صورت Dialog: هدر اطلاعات + جدول تایم‌لاین رویدادها + دکمه‌های اکشن فعال‌شده بر اساس `ALLOWED_TRANSITIONS[status]`.
- کارت‌های سررسید بالای داشبورد چک: «سررسید امروز / این هفته / معوق».
- موبایل: کارت‌های جمع‌شدنی به جای جدول بزرگ.

## ۵) ترتیب اجرا

1. ابتدا فقط migration را با supabase--migration ارسال می‌کنم و منتظر تأیید شما می‌مانم.
2. بعد از تأیید، types.ts خودکار refresh می‌شود.
3. سپس همه‌ی فایل‌های فرانت + تب جدید Finance را اضافه می‌کنم.
4. v1 شامل: ثبت، نمایش، تغییر وضعیت با guard، تایم‌لاین، دسته‌چک و برگه‌ها، due-checks، bounced. اتصال خودکار به voucher/Sepidar در فاز بعد.

## نکات فنی

- enumهای جدید: `check_direction`, `check_status`, `check_event_type`, `checkbook_leaf_status`.
- ایندکس‌های مهم: `finance_checks(direction, status, due_date)`, `finance_checks(party_id)`, `finance_check_events(check_id, event_date desc)`, unique `finance_checkbook_leaves(checkbook_id, serial_number)`.
- `created_by` در همه جداول `uuid null` (مطابق الگوی فعلی پروژه که session در localStorage است).
- هیچ تغییری در جداول `finance_*` موجود ایجاد نمی‌شود؛ این ماژول صرفاً اضافه‌شونده است.
