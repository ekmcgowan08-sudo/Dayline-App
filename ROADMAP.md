# Roadmap

## Milestone 1 — Vertical slice ✅ (this build)

Auth, onboarding, capture scheduling, 5-second capture, offline-first
upload, Today timeline, real ffmpeg-rendered personal montages, groups
with atomic invite/cap/rate-limit enforcement, "Our Day" group montages,
reactions/comments/reports/blocks, memories, settings, real account
deletion, subscription entitlement plumbing (mock + live-ready),
consent-gated AI captions, RLS security test suite, CI configuration.
Also since folded into Milestone 1 rather than left for later milestones:
server-side backup push delivery for capture reminders, raw-clip storage
lifecycle (mark-used + scheduled purge), server-enforced (not just
documented) free-tier memory archive limits, an entitlement-gated Dayline
end card, a tasteful on-video contributor-credits card for group
montages, per-group timezone for group-montage day boundaries,
defense-in-depth input length validation, Sentry crash-reporting
scaffolding (off by default, real no-op without a DSN), automated
data-export fulfillment (`fulfill-data-export`/`get-export-url` — no
manual operator step, no email infrastructure needed), a real
"Your Day Is Ready" push the moment a personal montage finishes
rendering (with tap-to-open deep linking and its own opt-out toggle),
and CI actually wired up + running (it existed since early in the build
but had never once triggered — see `docs/DECISIONS.md`), plus three
`workflow_dispatch` GitHub Actions workflows that turn Actions into a
one-click deploy path for Supabase, EAS builds, and Sentry verification
once account credentials exist. Also since added: the same "day is
ready" push extended to group montages (everyone but the requester,
per `docs/DECISIONS.md`), a real calendar/grid view for Memories
(month grid with personal/group indicator dots, tap a day to filter the
list to it) alongside the original chronological list, real
poster-frame thumbnails everywhere a montage is listed — reusing the
on-device pattern `ClipThumbnail` already established rather than the
worker/storage build-out originally sketched for it (see
`docs/DECISIONS.md`) — and, closing out Milestone 4, owner-gated group
admin promotion/demotion plus ownership transfer (which turned out to be
a missing capability, not just a missing UI, and fixed a related dead
end: an owner previously had no way to leave a group with other members
still in it). Also since added: rate limiting on comment and reaction
inserts (the last two user-generated-content paths that had none), via
the same `check_rate_limit()` bucket already used everywhere else in
this schema, added straight into their existing RLS `WITH CHECK`
policies with no client-code change needed, plus the same for group
creation (5/hour per user) once found to be the last unrestricted
group-membership write path. Also since added: `moderator_remove_content()`,
which turned out to fix a real bug — `docs/MODERATION_RUNBOOK.md`'s
prior guidance for a moderator removing a comment via service role was
never actually true (see `docs/DECISIONS.md`), not just a documented gap
for clip/montage removal — and `moderator_resolve_report()`, closing the
same runbook's broken `moderator_dismiss` reference and giving report
resolution the same atomic state-plus-audit-log RPC every other
moderation action already had. Also since added: revoking AI-caption
consent now actually clears existing captions (a trigger on
`transcription_consents`), closing a gap `docs/PRIVACY_DATA_FLOW.md`
had previously documented as accepted rather than fixed; and
`moderator_warn_user()`, closing out the moderation system's last
inconsistency (every other moderator action was already a uniform
RPC); out-of-order-event protection on `revenuecat-webhook` — the
only writer of `subscriptions` had no guard against a redelivered
stale event downgrading an active subscriber; and a fix, verified
empirically against real Postgres, for a device's push token failing
to reassign when a different user logs in on it (a borrowed phone or
shared family device previously registered under someone else's
account) — the old registration stayed live, meaning a push meant for
the previous account could land on that device. Also since added: a
retry cap on the render worker's stale-claim reclaim path — a job that
crashed the worker process itself (not a catchable exception) had no
retry accounting at all and could starve the single-job-at-a-time
render pipeline for every user, indefinitely, if it crashed on every
attempt; and a fix for `send-capture-reminders` marking capture
reminders "sent" even when the Expo push batch never actually went out
(a network hiccup left the slot permanently unretried, contradicting
the function's own documented intent); and a fix on the mobile client's
offline upload queue, which retried a permanently-broken clip upload
(a missing local file) forever with no way for the user to dismiss it
— it now stops after classifying the failure as unrecoverable and adds
the queue's first manual-dismiss action; and a fix for the render
worker inserting `montage_clips` non-idempotently before its final
status update, which could poison retries of a job that actually
rendered successfully into a permanent failure after a worker crash
between those two writes. Also since fixed: a TOCTOU race in
`check_rate_limit()` — the ledger function gating every rate-limited
write in this schema (comments, reactions, reports, group creation,
transcription requests, account deletion, montage requests) read the
event count and inserted a new event as two separate statements with
no lock between them, so two concurrent callers (a double-tap, two
devices on the same account) could both slip past the same limit;
proven against real Postgres before fixing, closed with a per-
`(bucket, subject)` advisory lock. Also since fixed: two related
storage leaks in the `montages` bucket — the render worker uploaded a
retried job under a fresh random filename every attempt instead of
overwriting its own prior attempt, leaking one file per crash-then-
retry; and deleting a group (or the last member leaving one) cascaded
away the database row but never touched that group's rendered video
file in storage, since a database cascade can't call Supabase
Storage's API. Closed with a stable per-job filename for the first,
and a general delete-queues-for-purge trigger plus a new scheduled
`purge-orphaned-montages` function for the second — the trigger fires
on any montage row deletion, not just group deletion, so it also
safety-nets any future deletion path. Also since fixed: the mobile
offline upload queue was device-global with no per-account
namespacing at all — on a shared/borrowed device, a clip queued by
one user that failed to upload could get silently uploaded and
attributed to a different user who later signs in on the same device
(the same "shared device" bug class the push-token fix closed in
Phase 33), and would show up as an "Uploading…" row in that other
user's own Today timeline before that even happened. Closed by
stamping each queued clip with its capturing user's id and filtering
every read/process of the queue to the currently signed-in user's own
items. Also since fixed, and the most consequential finding of this
kind so far: every single `moderator_*` RPC (warn, remove content,
suspend, reinstate, resolve report) revoked access from ordinary users
but never actually granted it back to `service_role` — the role the
moderation runbook instructs a moderator to call these with — so the
private beta's entire manual moderation process (its only moderation
mechanism, since there's deliberately no admin dashboard yet) was
uncallable exactly as documented. The existing tests for three of the
five missed this because they simulated a service-role caller by
running as the database superuser, which bypasses grant checks
entirely; the fix is a straightforward set of grants, proven against
real Postgres with a test that calls each function as the actual
`service_role` role instead. Also since fixed: `acceptance_records`
(the legal-consent audit trail) had no unique constraint, so an
onboarding flow interrupted between the consent screen and the final
onboarding step — which the app's own routing sends all the way back
to the first screen, not wherever the user left off — could
accumulate duplicate acceptance rows on retry; closed with a unique
constraint plus an idempotent upsert that preserves the original
acceptance timestamp. Also since fixed: the montage reveal screen's
poll-fallback safety net — meant to keep working if Supabase Realtime
(explicitly documented elsewhere as best-effort and never verified
end-to-end in this sandbox) ever failed to deliver a status update — never
actually polled at all, because its `setInterval` closed over `montage`
state from the render where the effect first ran, which was always
before that state's first async fetch had resolved; since the effect's
only dependency never changed again for the life of the screen, it never
got a chance to close over a fresher value. A user hitting a dropped
Realtime connection had no way forward off "Your day is coming together"
short of leaving and re-entering the screen. Also since fixed, and the
most user-facing finding of this kind so far: "Forgot password?" was a
complete dead end — it genuinely sent a real recovery email, but nothing
in the app handled the link it contained, and no code anywhere called
`supabase.auth.updateUser({ password })` to actually change it; a user
who forgot their password had no way to get back into their account
through the app at all. Closed with a new top-level `reset-password`
screen that parses the recovery tokens Supabase puts in the link's URL
fragment (this client's default `implicit` auth flow, not query-string
params Expo Router would have surfaced automatically), establishes the
recovery session, and lets the user set a new password — deliberately
placed outside the `(auth)/` route group, since that layout redirects
away the instant a session exists, which establishing the recovery
session itself would otherwise trigger before the user ever saw the
form. Also since fixed: `uploadAvatar()` named every profile-photo
upload with a fresh timestamped storage path, so despite passing
`upsert: true` — meant to overwrite a previous upload at the same path
— every photo change left the previous one orphaned in the `avatars`
bucket forever, the same unbounded-storage-leak class already closed
twice this session for other buckets. Closed with a stable per-user
path (upsert now actually overwrites) plus a cache-busting query
string on the returned URL, so a changed photo still shows immediately
rather than a stale cached one. Also since fixed, on the render worker
side: every eligible clip downloading fine but failing to *normalize*
(corrupt/unreadable video) was a gap the worker never guarded, one step
past the existing "every clip failed to *download*" guard — the render
pipeline itself doesn't treat an all-clips-skipped render as an error
as long as a title card is present, so the worker uploaded that
title-card-only video as the finished montage and marked it `ready`
with zero real clips, complete with a "Your Day Is Ready" push for a
day that has nothing in it. Closed by failing the job in that case
instead, the same as the download-failure path; also the occasion for
this worker's first orchestration-level test (`runJob.test.ts`, using
Node's built-in module-mocking to stub every external dependency),
where previously only the pure rendering pipeline had test coverage.
Also since fixed: the free-tier active-group limit
(`ENTITLEMENT_LIMITS.free.maxActiveGroups = 2`) existed only as a
client-side UI hint — neither database RPC that actually adds someone
to a group (`create_group()`, `join_group_by_code()`) ever checked the
caller's total group count against their entitlement tier, so a free
user willing to call the RPC directly (bypassing the app's disabled
buttons) could create or join unlimited groups, the same
missing-server-enforcement class already closed once for the memory
archive. Reproduced against a real local Postgres instance first (a
fresh free user created 4 groups with no error), then closed by adding
the same tier-based count check, computed from `current_entitlement()`,
to both RPCs. Also since fixed, applying the same "what does the client
enforce that the server never checks?" lens to `CAPTURE.clipSeconds`
instead of the entitlement limits: the app's camera call caps a real
capture at 5 seconds, but that's a client-side argument, not a security
boundary — nothing server-side ever validated an uploaded clip's actual
duration, so a client that bypassed the app's recording flow could
upload an arbitrarily long video and have the entire thing rendered
into everyone's montage. Closed by trimming (not rejecting) any clip
past a generously padded 8-second ceiling during normalization. Also
since fixed, the same lens applied to `notification_preferences`: its
`reminders_per_day`, `wake_hour`/`sleep_hour`, and `custom_times` were
bounded only by the client's own Stepper widgets, with no server-side
check — an out-of-range value sent via a direct API call could have
generated tens of thousands of `capture_slots` rows and a burst of
pushes per day for that account, or crashed the Today screen outright
on a malformed hour. Closed with `CHECK` constraints mirroring the
client's existing bounds exactly. Also since fixed, from a different
angle (does account deletion respect the invariants group management
already enforces?): `groups.created_by`'s `ON DELETE CASCADE` meant
deleting the account that happened to create a group destroyed the
*entire group* — even for a founder who had legitimately transferred
ownership away and left the group entirely, with zero warning to the
group's actual current members. Separately, deleting a group's sole
current owner bypassed `leave_group()`'s own safeguard against exactly
that, leaving the group's other members with no owner/admin and no
path to ever get one back. Closed by making `created_by` purely
historical (`ON DELETE SET NULL` — it was never used for authorization
anyway) and adding a trigger that auto-promotes the longest-tenured
remaining member to owner in the one gap account deletion opens. Also
since fixed, closing the loop on the "Your Day Is Ready" push (Phase
21): the tap handler only ever listened for a notification response
received while the app was already running — the response that
actually *launches* the app from fully killed is never delivered to
that listener at all, so tapping the push in the single most common
real-world case silently opened Today instead of the finished montage.
Closed by adding the missing cold-start half, the same two-path split
(cold start vs. already running) the password-reset deep link already
used. Also since fixed, same lens applied to push *registration*
instead of tap handling: registerPushToken() was called from exactly
one place in the whole app — onboarding — which is gated on a
permanent, once-per-account flag and never runs again on any device.
Any existing user who upgraded phones, reinstalled, or cleared app
data silently stopped receiving server-backed push forever, with no
error and no other path in the app to fix it — likely to eventually
affect every long-term user, not an edge case. Closed by re-registering
on every app start for a user who has already completed onboarding
(gated so a brand-new user still gets the permission prompt at its
intentional point in onboarding, not immediately at launch), plus a
live token-rotation listener Expo's own docs recommend and this app
never had. Also since fixed, same lens turned on the render worker's
own process management: every ffmpeg/ffprobe call ran through
node:child_process's execFile with no timeout, and the worker's poll
loop is deliberately single-job-at-a-time — so one genuinely hung
process (proved real with a named pipe that blocks a real ffmpeg in a
real open() syscall, not a hypothetical) would have silently halted
montage rendering for every user until someone manually restarted the
container. Closed with a timeout — and, after proving a first attempt
using execFile's default SIGTERM insufficient (a real stuck ffmpeg
survives SIGTERM; only SIGKILL reliably kills it in that state), the
actual fix that hard-kills it and lets the job fail and retry normally.
See `docs/IMPLEMENTATION_STATUS.md` for the exact, honest verification
tier on every piece.

## Milestone 2 — Production hardening

- Run this build's Edge Functions and worker against a real Supabase
  project end-to-end — the one gap this development sandbox genuinely
  couldn't close directly (its egress policy denies supabase.com), now
  covered by `deploy-supabase.yml` (see "The fast path" in
  `docs/OWNER_ACTIONS_REQUIRED.md`) once an owner provides account
  credentials. This includes actually enabling `pg_cron`/`pg_net` and
  scheduling `send-capture-reminders`/`purge-used-clips`/
  `fulfill-data-export` per `docs/DEPLOYMENT.md` — all three functions
  exist and are tested in isolation, but the scheduling itself needs a
  real project (no CLI/API equivalent, has to be a one-time dashboard
  SQL-editor step).
- Replace placeholder icon/splash assets with real Dayline branding (see
  `docs/ASSET_LICENSES.md`).

## Milestone 3 — Reveal & memories polish

- Tune the 7/30/365-day "On This Day" cadence based on real retention data.

## Milestone 4 — Groups at scale ✅

Admin promotion/demotion and ownership transfer, both owner-gated —
closed in full, including a related gap found while building it (an
owner had no way to leave a group with other members still in it short
of deleting it for everyone). See `docs/DECISIONS.md`. No further items
identified for this milestone; add here if real usage surfaces one.

## Milestone 5 — Monetization

- Confirm real product IDs in App Store Connect / Play Console, wire real
  RevenueCat API keys (currently mock-mode by default — see
  `docs/DECISIONS.md`).
- Verify `revenuecat-webhook`'s payload shape against live RevenueCat
  docs/a real sandbox purchase (written from a web-search summary in this
  session, not confirmed live — see `docs/SECURITY.md`).
- A/B test free-tier limits (`ENTITLEMENT_LIMITS` is deliberately
  centralized and easy to tune).

## Milestone 6 — Campus launch

- Execute the trademark/domain clearance checklist in
  `docs/STORE_SUBMISSION.md` before any public-facing launch.
- Ambassador/referral tracking analytics (invite-code infrastructure
  already supports per-group attribution; dedicated funnel events are new
  work).
- Legal review of `TERMS.md`/`PRIVACY.md`/`COMMUNITY_RULES.md`/
  `docs/LEGAL_DRAFTS.md` — all currently editable drafts, not reviewed by
  counsel (see `docs/OWNER_ACTIONS_REQUIRED.md`).
- Content moderation scale-up: automated content scanning if/when open
  signup (vs. invite-only beta) is considered — see
  `docs/MODERATION_RUNBOOK.md`'s explicit note on this.
