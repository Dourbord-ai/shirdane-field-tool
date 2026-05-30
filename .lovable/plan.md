# لیست کامل برای هر عملیات باروری

## وضعیت فعلی

در `src/components/livestock/FertilitySection.tsx` هر تب (فحلی، تلقیح، تست آبستنی، زایش/سقط، خشک کردن، شستشو/کلین تست، همزمان‌سازی، نسخه) از یک کامپوننت مشترک `EventCard` استفاده می‌کند که فقط چند فیلد عمومی (تاریخ، نتیجه، یادداشت، چند enrichment chip) را نشان می‌دهد. تمام فیلدهای خاص هر فرم در ستون JSONB `metadata` ذخیره می‌شوند و در لیست دیده نمی‌شوند.

## هدف

برای هر عملیات یک جدول مستقل بسازیم که **تمام فیلدهای فرم همان عملیات** را به صورت ستون نمایش دهد — بدون مودال، بدون expand row.

## فیلدهای هر فرم (مستخرج از Registration Dialogها)

**فحلی (heat)** — `HeatRegistrationDialog`
- تاریخ، ساعت، نوع فحلی (erotic_type)، شدت، علائم، یادداشت، ثبت‌کننده، وضعیت (لغو شده / فعال)

**تلقیح (insemination)** — `InseminationRegistrationDialog`
- تاریخ، ساعت، نوع تلقیح (طبیعی/اسپرم)، اسپرم/کد گاو نر، تکنسین، تعداد دوز، نوع مصرف (تک/دو اسپرمی)، تلقیح دوم در صورت وجود، یادداشت، ثبت‌کننده

**تست آبستنی (pregnancy_test)** — `PregnancyTestRegistrationDialog`
- تاریخ، شماره تست (اول/دوم/سوم/چهارم)، روش تست، نتیجه، برچسب نتیجه، یادداشت، ثبت‌کننده

**زایش (calving)** — `CalvingRegistrationDialog`
- تاریخ، شماره دوره، تعداد گوساله، جنسیت‌ها، وضعیت تولد (زنده/مرده)، نوع زایش، عوارض، یادداشت، ثبت‌کننده، وضعیت ثبت گوساله‌ها

**سقط (abortion)** — `AbortionRegistrationDialog`
- تاریخ، شماره دوره، سن جنین، علت، یادداشت، ثبت‌کننده

## طراحی فنی

1. ایجاد پوشه‌ی جدید `src/components/livestock/fertility-tabs/lists/`
2. ساخت یک کامپوننت ستونی برای هر نوع:
   - `HeatList.tsx`
   - `InseminationList.tsx`
   - `PregnancyTestList.tsx`
   - `CalvingList.tsx`
   - `AbortionList.tsx`
3. هر کامپوننت:
   - یک `<table>` با ستون‌های مخصوص همان فرم
   - خواندن فیلدها از ستون‌های اصلی + `event.metadata`
   - تاریخ و زمان شمسی، نام ثبت‌کننده از `resolveUserName`
   - ستون آخر: دکمه‌های ویرایش / لغو (و ثبت گوساله برای زایش)
   - حالت خالی همان `EmptyList`
   - responsive: روی موبایل اسکرول افقی با `overflow-x-auto`
4. در `FertilitySection.tsx` در `TabsContent` هر تب، جایگزین `EventList` با لیست اختصاصی همان نوع.
5. تب `calving_abortion` به دو جدول جداگانه (یکی calving، یکی abortion) با عنوان تقسیم می‌شود.
6. تب‌های دیگر (`dry_off`, `prescription`, `rinse_clean`, `sync`, `all`) فعلاً همان `EventList` فعلی را نگه می‌دارند چون کاربر آن‌ها را در درخواست ذکر نکرده.
7. سلول‌های جدول از semantic tokens (`bg-card`, `text-foreground`, `border-border`, `text-muted-foreground`) استفاده می‌کنند — بدون رنگ هاردکد.

## ساختار فایل‌ها

```text
src/components/livestock/fertility-tabs/
  TabInsightHeader.tsx        (موجود)
  lists/
    HeatList.tsx              (جدید)
    InseminationList.tsx      (جدید)
    PregnancyTestList.tsx     (جدید)
    CalvingList.tsx           (جدید)
    AbortionList.tsx          (جدید)
    shared.tsx                (helper: format date/time/result, action cell)
```

## ریسک‌ها

- `metadata` JSONB ساختار رسمی ندارد — برای فیلدهای خاص از key‌های موجود در Registration Dialogها استفاده می‌کنیم؛ اگر رویدادهای قدیمی فیلد نداشتند، سلول خالی می‌شود (—).
- هیچ تغییری در دیتابیس لازم نیست.
- ویرایش/لغو از همان callbackهای فعلی استفاده می‌کند، پس رفتار dialogها دست‌نخورده باقی می‌ماند.
