-- Yomi Sprint 1: one row per puzzle attempt (solved or skipped).
create table if not exists solves (
  id bigserial primary key,
  created_at timestamptz default now(),
  player_id uuid not null,
  puzzle_id text not null,
  grid_size int not null,
  n_dots int not null,
  device text check (device in ('mouse','touch')),
  started_at_ms bigint,
  ended_at_ms bigint,
  solve_ms int,
  completed boolean not null,
  events jsonb not null,           -- [[ms_since_start, head_row, head_col, path_length], ...]
  backtracks int,
  max_pause_ms int,
  stuck_cell int[],                -- {row, col} of the path head during the longest pause
  played_zip_before boolean
);

create index if not exists solves_player_created_idx on solves (player_id, created_at);
create index if not exists solves_puzzle_idx on solves (puzzle_id);
