/**
 * Version tags for the acceptance_records audit trail. Bump the relevant
 * version string whenever the corresponding draft in the repo root
 * changes materially, so past acceptances stay tied to the text the user
 * actually saw. These are drafts, not legally finalized documents — see
 * docs/OWNER_ACTIONS_REQUIRED.md.
 */
export const LEGAL_VERSIONS = {
  terms: '2026-08-31',
  privacy: '2026-08-31',
  community_rules: '2026-08-31',
  age_confirmation: '2026-08-31',
} as const;

export const MINIMUM_AGE = 13;
