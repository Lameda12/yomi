-- Where a row came from. Null = played on the live site. 'local_import' = real solves played on the owner's
-- machine before launch and copied in later. Filter on this column to leave them out of training or stats.
alter table solves add column if not exists source text;
