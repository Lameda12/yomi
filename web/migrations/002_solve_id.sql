-- Client-generated id per attempt: a retried POST inserts once (insert ... on conflict (solve_id) do nothing).
-- Older rows keep solve_id null; a unique index allows any number of nulls.
alter table solves add column if not exists solve_id uuid;
create unique index if not exists solves_solve_id_key on solves (solve_id);
