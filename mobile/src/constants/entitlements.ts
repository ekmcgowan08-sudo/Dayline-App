/**
 * Editable hypotheses, not fixed forever — tune these as real usage data
 * comes in. Centralized here so no screen hardcodes a limit inline.
 */
export const ENTITLEMENT_LIMITS = {
  free: {
    maxActiveGroups: 2,
    memoryArchiveDays: 30,
    daylineEndCardRequired: true,
  },
  plus: {
    maxActiveGroups: 10, // still capped by GROUP_LIMITS.maxActiveMembers per group, this is groups-you're-in
    memoryArchiveDays: 3650,
    daylineEndCardRequired: false,
  },
} as const;

export type EntitlementTier = keyof typeof ENTITLEMENT_LIMITS;

/** Product identifiers — configure real values once App Store Connect /
 * Play Console products exist (see docs/OWNER_ACTIONS_REQUIRED.md).
 * RevenueCat's "plus" entitlement identifier must match what's configured
 * in the RevenueCat dashboard and referenced by revenuecat-webhook. */
export const REVENUECAT_ENTITLEMENT_ID = 'plus';
export const PRODUCT_IDS = {
  plusMonthly: 'dayline_plus_monthly',
  plusAnnual: 'dayline_plus_annual',
} as const;
