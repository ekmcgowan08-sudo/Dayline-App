-- Defense-in-depth input validation. `reports.reason` already got a
-- length/non-empty check in 20260831150000_report_hardening.sql; the same
-- treatment was never extended to a few other free-text fields the client
-- caps with a TextField `maxLength` prop. A client-side maxLength is a UX
-- nicety, not a security boundary — anyone calling the REST/RPC endpoints
-- directly (Postman, a modified client, a bug in a future screen) bypasses
-- it entirely. Found while auditing what a raw API caller could still get
-- past, alongside the group-timezone work in
-- 20260831190000_group_timezone.sql. Limits mirror the mobile client's
-- existing `maxLength` values exactly, so no legitimate input this app has
-- ever produced is rejected by adding these now.

alter table profiles
  add constraint profiles_display_name_length check (display_name is null or char_length(display_name) <= 40);

alter table comments
  add constraint comments_body_length check (char_length(trim(body)) > 0 and char_length(body) <= 500);

alter table groups
  add constraint groups_name_length check (char_length(trim(name)) > 0 and char_length(name) <= 40);
