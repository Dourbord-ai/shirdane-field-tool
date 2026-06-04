
-- ---------------------------------------------------------------------------
-- Task 4 follow-up — Seed geo_locations dictionary.
--
-- 1) Add a safer partial unique index keyed on (lower(name), lower(province),
--    lower(city)) so the same city name in different provinces is allowed,
--    while preventing duplicate active rows.
-- 2) Insert major Iranian metros, Fars province cities, and the default farm
--    destination row. Uses INSERT ... SELECT ... WHERE NOT EXISTS because a
--    partial unique index cannot be used as an ON CONFLICT target.
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS ux_geo_locations_name_province_city_active
  ON public.geo_locations (
    lower(name),
    lower(coalesce(province, '')),
    lower(coalesce(city, ''))
  )
  WHERE is_deleted = false;

WITH seed(name, province, city, kind, notes) AS (
  VALUES
    -- 12 major Iranian metros (kind = 'both')
    ('تهران',     'تهران',           'تهران',     'both', NULL),
    ('مشهد',      'خراسان رضوی',     'مشهد',      'both', NULL),
    ('اصفهان',    'اصفهان',          'اصفهان',    'both', NULL),
    ('شیراز',     'فارس',            'شیراز',     'both', NULL),
    ('تبریز',     'آذربایجان شرقی',  'تبریز',     'both', NULL),
    ('کرج',       'البرز',           'کرج',       'both', NULL),
    ('اهواز',     'خوزستان',         'اهواز',     'both', NULL),
    ('قم',        'قم',              'قم',        'both', NULL),
    ('کرمانشاه',  'کرمانشاه',        'کرمانشاه',  'both', NULL),
    ('ارومیه',    'آذربایجان غربی',  'ارومیه',    'both', NULL),
    ('رشت',       'گیلان',           'رشت',       'both', NULL),
    ('یزد',       'یزد',             'یزد',       'both', NULL),

    -- Fars province counties / cities (kind = 'both')
    ('مرودشت',         'فارس', 'مرودشت',         'both', NULL),
    ('کازرون',         'فارس', 'کازرون',         'both', NULL),
    ('جهرم',           'فارس', 'جهرم',           'both', NULL),
    ('فسا',            'فارس', 'فسا',            'both', NULL),
    ('داراب',          'فارس', 'داراب',          'both', NULL),
    ('لار',            'فارس', 'لار',            'both', NULL),
    ('لارستان',        'فارس', 'لارستان',        'both', NULL),
    ('اقلید',          'فارس', 'اقلید',          'both', NULL),
    ('آباده',          'فارس', 'آباده',          'both', NULL),
    ('استهبان',        'فارس', 'استهبان',        'both', NULL),
    ('نی‌ریز',         'فارس', 'نی‌ریز',         'both', NULL),
    ('فیروزآباد',      'فارس', 'فیروزآباد',      'both', NULL),
    ('فراشبند',        'فارس', 'فراشبند',        'both', NULL),
    ('قیر و کارزین',   'فارس', 'قیر و کارزین',   'both', NULL),
    ('خنج',            'فارس', 'خنج',            'both', NULL),
    ('گراش',           'فارس', 'گراش',           'both', NULL),
    ('لامرد',          'فارس', 'لامرد',          'both', NULL),
    ('مهر',            'فارس', 'مهر',            'both', NULL),
    ('زرین‌دشت',       'فارس', 'زرین‌دشت',       'both', NULL),
    ('بوانات',         'فارس', 'بوانات',         'both', NULL),
    ('پاسارگاد',       'فارس', 'پاسارگاد',       'both', NULL),
    ('خرامه',          'فارس', 'خرامه',          'both', NULL),
    ('خرم‌بید',        'فارس', 'خرم‌بید',        'both', NULL),
    ('رستم',           'فارس', 'رستم',           'both', NULL),
    ('سپیدان',         'فارس', 'سپیدان',         'both', NULL),
    ('سرچهان',         'فارس', 'سرچهان',         'both', NULL),
    ('سروستان',        'فارس', 'سروستان',        'both', NULL),
    ('صدرا',           'فارس', 'صدرا',           'both', NULL),
    ('کوار',           'فارس', 'کوار',           'both', NULL),
    ('نورآباد ممسنی',  'فارس', 'نورآباد',        'both', NULL),
    ('ارسنجان',        'فارس', 'ارسنجان',        'both', NULL),
    ('بختگان',         'فارس', 'بختگان',         'both', NULL),
    ('زرقان',          'فارس', 'زرقان',          'both', NULL),
    ('اوز',            'فارس', 'اوز',            'both', NULL),
    ('اشکنان',         'فارس', 'اشکنان',         'both', NULL),
    ('سعادت‌شهر',      'فارس', 'سعادت‌شهر',      'both', NULL),

    -- Default farm / dairy destination row
    ('دامداری کرم‌آباد', 'فارس', 'سعادت‌شهر', 'destination',
     'مقصد پیش‌فرض دامداری در کرم‌آباد سعادت‌شهر')
)
INSERT INTO public.geo_locations (name, province, city, kind, notes)
SELECT s.name, s.province, s.city, s.kind::text, s.notes
FROM seed s
WHERE NOT EXISTS (
  SELECT 1
  FROM public.geo_locations g
  WHERE g.is_deleted = false
    AND lower(g.name) = lower(s.name)
    AND lower(coalesce(g.province, '')) = lower(coalesce(s.province, ''))
    AND lower(coalesce(g.city, '')) = lower(coalesce(s.city, ''))
);
