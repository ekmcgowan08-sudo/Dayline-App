/**
 * Single source of truth for the app's working name and identifiers.
 * "Dayline" is a working name pending trademark/domain clearance — see
 * docs/OWNER_ACTIONS_REQUIRED.md. Change it here, not by grepping the repo.
 */
export const BRAND = {
  name: 'Dayline',
  wordmark: 'Dayline',
  tagline: "Don't perform your life. Remember it.",
  alternateTaglines: [
    'Live it. Watch it back.',
    'The daily movie of your actual life.',
    'Five seconds at a time.',
    'Not a feed. A film.',
  ],
  bundleIdIOS: 'com.dayline.app',
  packageAndroid: 'com.dayline.app',
  scheme: 'dayline',
  supportEmail: 'support@dayline.app',
  legalEntityPlaceholder: '[Owner legal entity name — see OWNER_ACTIONS_REQUIRED.md]',
} as const;

export const CAPTURE = {
  clipSeconds: 5,
} as const;

export const GROUP_LIMITS = {
  maxActiveMembers: 10,
  inviteCodeLength: 6,
} as const;
