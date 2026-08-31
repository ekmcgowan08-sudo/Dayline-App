# Additional Legal & Disclosure Drafts

Editable drafts, not legal advice — none of this has been reviewed by a
lawyer. See `docs/OWNER_ACTIONS_REQUIRED.md` for what needs real review
before launch. Companion documents: `TERMS.md`, `PRIVACY.md`,
`COMMUNITY_RULES.md`, `docs/PRIVACY_DATA_FLOW.md`.

---

## Copyright / DMCA process (draft)

Dayline is a private app — content is generally not publicly accessible,
which limits typical DMCA takedown scenarios, but the process below
covers a claim about content visible within a shared group.

1. A copyright holder sends a notice to support@dayline.app including:
   the copyrighted work, the specific content/URL or in-app location, a
   statement of good-faith belief the use is unauthorized, a statement of
   accuracy under penalty of perjury, and contact information.
2. On receipt of a complete notice, the identified content is removed or
   disabled within a reasonable time (operationally: via the same
   `moderate_delete_comment`/storage-removal path described in
   `docs/MODERATION_RUNBOOK.md`), and the uploader is notified.
3. The uploader may submit a counter-notice; absent one, content stays
   down.
4. Repeat infringers are subject to account suspension
   (`moderator_suspend_user`).

**Owner action needed:** designate a real DMCA agent and register with
the U.S. Copyright Office (or equivalent) before public launch if
operating in/serving the U.S. — this is a formal legal filing, not
something this repo can complete on its own.

## Data deletion policy (summary)

See `docs/PRIVACY_DATA_FLOW.md` for full technical detail. Summary for a
public-facing policy page:

> You can delete your account at any time from Settings → Privacy & data
> → Delete account. This immediately and permanently removes your video
> clips, montages you own, and profile information. Some non-identifying
> records that a moderation or deletion event occurred may be retained
> for legal/safety/audit purposes, but never your video content or
> personal profile data. You can also request a copy of your data before
> deleting your account.

## Subscription disclosures (draft — Dayline Plus)

Required reading before enabling real purchases: Apple's and Google's
current subscription-disclosure requirements (App Store Review Guideline
3.1.2, Play Console's subscription policies) — verify current text
against their live docs before shipping, this draft is a starting point:

> Dayline Plus is an auto-renewing subscription. Payment is charged to
> your [App Store / Google Play] account at confirmation of purchase.
> Subscriptions automatically renew unless auto-renew is turned off at
> least 24 hours before the end of the current period. Your account will
> be charged for renewal within 24 hours prior to the end of the current
> period, at the then-current price (see Settings → Subscription for
> current pricing). You can manage or cancel your subscription in your
> [App Store / Google Play] account settings after purchase. Any unused
> portion of a free trial, if offered, is forfeited when you purchase a
> subscription.

Pricing itself is intentionally NOT hardcoded anywhere in this repo (see
`mobile/src/constants/entitlements.ts` — only product *identifiers*, no
prices) so it can be configured in App Store Connect/Play Console/
RevenueCat without a code change.

## App Store "nutrition label" privacy disclosure (draft)

Based on the data inventory in `docs/PRIVACY_DATA_FLOW.md`, mapped to
Apple's privacy label categories. **Verify against the current App Store
Connect privacy questionnaire before submission** — categories/wording
occasionally change.

| Category | Collected? | Linked to identity? | Used for tracking? |
|---|---|---|---|
| Contact Info (email) | Yes | Yes | No |
| User Content (photos/videos, audio) | Yes | Yes | No |
| Identifiers (user ID) | Yes | Yes | No |
| Usage Data (product interaction) | Yes | Yes | No |
| Diagnostics | Only if crash reporting is added later (not yet wired — see `docs/OWNER_ACTIONS_REQUIRED.md`) | — | — |
| Location | No | — | — |
| Contacts | No | — | — |
| Financial Info | No (handled entirely by Apple/Google/RevenueCat, never touches Dayline's own servers) | — | — |

No data is used for third-party advertising/tracking (no ad SDKs are
integrated in this build).

## Google Play Data Safety form (draft)

Mirrors the table above in Play Console's format: data types collected
(Personal info: email; Photos and videos; App activity: app interactions),
all marked "Data is encrypted in transit," "You can request data
deletion," collection purpose "App functionality" only (not
"Advertising or marketing," since none exists in this build).

## Minimum age & COPPA analysis (draft)

**This is not legal advice.** Dayline defaults to a **13+ minimum age**
per the product brief's own instruction to default to 13+ absent other
evidence, captured explicitly at signup (`acceptance_records`, document =
`age_confirmation`).

Relevant considerations for a real launch:
- COPPA (US) applies to services "directed to children under 13" or with
  actual knowledge of under-13 users. A 13+ age gate with an honest
  self-attestation is standard industry practice (not a legal guarantee
  no under-13 user ever signs up) — this is the same approach most
  consumer apps take, not a Dayline-specific gap.
- Video/audio content involving real people (especially if any user is a
  minor 13–17) raises additional considerations beyond COPPA — content
  moderation for exactly this reason is covered in
  `docs/MODERATION_RUNBOOK.md` (rule 3: illegal content involving minors
  in a sexual context triggers immediate suspension + legal reporting).
- If Dayline's actual target audience or marketing suggests a younger
  audience than 13+, this entire analysis needs revisiting with real
  counsel — **flagged explicitly for owner/legal confirmation**, per the
  task's own instruction not to just assume 13+ is correct without
  evidence.
