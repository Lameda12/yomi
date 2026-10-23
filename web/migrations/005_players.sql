-- Optional leaderboard nickname per anonymous player. No row = the player shows as "Anon xxxx".
-- player_id is the random id the browser made for itself; nothing here is personal.
-- nickname_lower is unique so two players cannot share a name that differs only by case.
create table if not exists players (
  player_id uuid primary key,
  nickname text not null check (char_length(nickname) between 2 and 16),
  nickname_lower text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
