-- What Yomi predicted before the solve, sent by the client with the solve. Metadata only: training reads
-- solve_ms and the stuck cell, never these columns. Nullable because older rows and no-model visits have none.
alter table solves add column if not exists pred_value double precision;
alter table solves add column if not exists pred_unit text;
alter table solves add column if not exists model_version text;
