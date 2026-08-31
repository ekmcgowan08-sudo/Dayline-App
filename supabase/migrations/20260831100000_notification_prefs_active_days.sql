-- "User-selected active days" was in the product spec but missing from the
-- recovered schema (which only had wake/sleep hour + frequency). 0=Sunday
-- .. 6=Saturday, matching JS Date#getDay() used throughout the client.
alter table notification_preferences
  add column if not exists active_days int[] not null default '{0,1,2,3,4,5,6}';
