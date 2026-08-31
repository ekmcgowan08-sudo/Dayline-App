-- Supports "individually selected prompt times" (mode = 'custom'):
-- an explicit list of local "HH:mm" wall-clock times, evaluated in the
-- same timezone-aware way as the randomized/hourly modes.
alter table notification_preferences
  add column if not exists custom_times text[] not null default '{}';
