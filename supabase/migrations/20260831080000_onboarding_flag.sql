-- A single, cheap flag the client checks on every cold start to decide
-- between the onboarding flow and the main app, instead of re-deriving it
-- from acceptance_records + notification_preferences + profile fields on
-- every launch.
alter table profiles add column if not exists onboarding_completed_at timestamptz;
