/**
 * In-app copies of the legal drafts. These are the SAME text as the
 * root-level TERMS.md / PRIVACY.md / COMMUNITY_RULES.md — written once
 * here and referenced from there, so the app and the documentation can
 * never silently drift apart. Editable drafts, not legal advice — see
 * docs/OWNER_ACTIONS_REQUIRED.md.
 */
import { BRAND } from './brand';
import { MINIMUM_AGE } from './legal';

export const TERMS_TEXT = `Dayline Terms of Service (Draft)
Last updated: 2026-08-31

This is a working draft for a private beta, not a finalized legal document — see docs/OWNER_ACTIONS_REQUIRED.md.

1. What Dayline is. Dayline lets you capture short daily video clips, turn them into a private montage, and optionally share that montage with a small group you choose (up to 10 people). Dayline is not a public social network — content you create is private by default.

2. Eligibility. You must be at least ${MINIMUM_AGE} years old to use Dayline. By creating an account you confirm you meet this requirement.

3. Your content. You own the clips and montages you create. You grant ${BRAND.name} a limited license to store, process, and transmit your content solely to provide the service (e.g., rendering your montage, delivering it to a group you chose to share it with).

4. Groups. Content you explicitly share to a group becomes visible to that group's current members until you remove it, leave, or the group is deleted. Removing a member or leaving a group revokes future access immediately.

5. Acceptable use. No harassment, no illegal content, no impersonation, no attempting to access another user's private content. See the Community Rules for details.

6. Termination. You may delete your account at any time from Settings. We may suspend accounts that violate these terms or the Community Rules.

7. Disclaimers. The service is provided "as is" during this beta. Features, availability, and pricing may change.

8. Contact. ${BRAND.supportEmail}`;

export const PRIVACY_TEXT = `Dayline Privacy Policy (Draft)
Last updated: 2026-08-31

This is a working draft for a private beta, not a finalized legal document — see docs/OWNER_ACTIONS_REQUIRED.md. Full data-flow detail lives in docs/PRIVACY_DATA_FLOW.md.

What we collect: your email, the video/audio clips you record, profile info you provide (display name, optional photo, timezone), device push-notification tokens, and minimal usage analytics (event names and timestamps — never raw video content).

How we use it: to operate the core features you use directly — capture reminders, montage rendering, group sharing you initiate, and basic product analytics to fix bugs and understand what's working.

Who can see it: raw clips are visible only to you. A clip only becomes visible to a group after you explicitly choose to share it there, and then only as part of the finished group montage — group members never get direct access to your raw storage. We (the operators) can access data only as needed to operate, secure, and moderate the service.

AI features: optional, off by default, and never sent to a third-party AI service without your explicit per-use consent. See Settings > AI captions.

Retention & deletion: deleting your account removes your clips, montages you own, profile, and account data — see Settings > Privacy & data > Delete account. Some non-identifying records (e.g., that a moderation action occurred) may be retained for legal/safety reasons.

Your choices: you can export a copy of your data or delete your account at any time from Settings.

Contact: ${BRAND.supportEmail}`;

export const COMMUNITY_RULES_TEXT = `Dayline Community Rules (Draft)
Last updated: 2026-08-31

Dayline is built for small, close groups — the rules are simple:

1. Be honest. Don't impersonate someone else or post content that isn't genuinely yours.
2. Respect the people in your group. No harassment, hate speech, or content meant to humiliate someone.
3. No illegal content. This includes anything involving minors in a sexual context, which will be reported to the relevant authorities in addition to an account ban.
4. No unsolicited explicit content. Your group didn't sign up for it.
5. Report and block freely. If someone in a shared group makes you uncomfortable, block them and report the content — see docs/MODERATION_RUNBOOK.md for how reports are handled.
6. Consequences. Violations can lead to content removal, warnings, or account suspension, at our discretion.`;
