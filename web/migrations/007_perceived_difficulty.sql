-- Optional one-tap answer to "How difficult did that puzzle feel?" after a finished Regular solve.
-- Analysis only: the training pipeline never reads this column (a test checks that). Null = not answered.
alter table solves add column if not exists perceived_difficulty text check (perceived_difficulty in ('easy', 'medium', 'hard'));
