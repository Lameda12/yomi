-- What the player was shown before the solve: {model_version, label, value, stuck_cells}.
-- value is ms when label = 'human_time' and solver steps when label = 'solver_effort'.
-- Null for rows logged before predictions existed, or when model.json was missing.
alter table solves add column if not exists prediction jsonb;
