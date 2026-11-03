-- Mark the owner's early test plays (row ids 1 to 8, 2026-10-15) as test rows. No row is deleted.
-- The training code (ml/train_time.py human_records) and the page counts (web/lib/insights.ts isTrainable) skip
-- rows with source = 'test'. Until this is applied in Neon they also skip ids 1 to 8 by number (EXCLUDED_ROW_IDS);
-- once it is applied, that list can go.
-- Not applied automatically: run it by hand with `npm run db:migrate` after looking at those rows.
update solves set source = 'test' where id between 1 and 8;
