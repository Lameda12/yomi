-- Game mode of each solve: 'regular' (default) or 'extreme' (countdown). The ML pipeline trains on 'regular' only.
-- extreme_limit_ms is the clock the player was playing against; win margin = extreme_limit_ms - solve_ms.
alter table solves add column if not exists mode text not null default 'regular';
alter table solves add column if not exists extreme_limit_ms integer;
