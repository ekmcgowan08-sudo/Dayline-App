# Roadmap

## Milestone 1 - Vertical slice (this repo)
Signup, capture schedule, record clip, upload, list today's clips, montage row lifecycle, group create/join. Rendering is stubbed.

## Milestone 2 - Real rendering
Stand up an ffmpeg worker (Fly.io/Render container or queued Node job), wire `render-montage` to actually produce a concatenated, captioned vertical video.

## Milestone 3 - Reveal + memories
"Your Day Is Ready" push notification, Memories screen (Today/Yesterday/Week/Month/Calendar), one-year-ago resurfacing.

## Milestone 4 - Groups at scale
Shared "Our Day" rendering across up to 10 members, reactions, comments, remove/leave flows, tier-based group size limits.

## Milestone 5 - Monetization
RevenueCat integration, Free/Plus/Group entitlement checks gating history length, group count, export quality.

## Milestone 6 - Campus launch
Invite codes/QR/referral attribution already partially supported via `invite_code`; add ambassador tracking and funnel analytics events (see spec section 16).
