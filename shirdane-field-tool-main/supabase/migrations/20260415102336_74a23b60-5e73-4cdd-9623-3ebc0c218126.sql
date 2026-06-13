UPDATE factors f
SET company = fsc.name
FROM feedshoppingcenter fsc
WHERE f.product_type = 'feed' AND f.company ~ '^\d+$' AND fsc.id::text = f.company;

UPDATE factors f
SET company = msc.name
FROM medicineshoppingcenter msc
WHERE f.product_type = 'medicine' AND f.company ~ '^\d+$' AND msc.id::text = f.company;