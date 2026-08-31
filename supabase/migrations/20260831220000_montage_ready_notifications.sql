-- "Your Day Is Ready" push notification (docs/ROADMAP.md Milestone 3 —
-- the reveal was pull-based only: open the app and see it, no push).
-- Same per-notification-type opt-out pattern as memory_notifications
-- (20260831050000_memories_and_transcription.sql) — a user who wants
-- capture reminders but not this can turn it off independently.

alter table notification_preferences
  add column if not exists montage_ready_notifications boolean not null default true;
