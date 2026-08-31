/**
 * Centralized env/feature-flag access. Every `EXPO_PUBLIC_*` var is read
 * here once so the rest of the app never touches `process.env` directly.
 * Missing required values warn loudly in dev rather than failing silently.
 */
const required = (name: string, value: string | undefined): string => {
  if (!value) {
    console.warn(`[config] Missing ${name}. Copy .env.example to .env and fill it in.`);
    return '';
  }
  return value;
};

export const ENV = {
  supabaseUrl: required('EXPO_PUBLIC_SUPABASE_URL', process.env.EXPO_PUBLIC_SUPABASE_URL),
  supabaseAnonKey: required('EXPO_PUBLIC_SUPABASE_ANON_KEY', process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY),
  revenueCatIosKey: process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY ?? '',
  revenueCatAndroidKey: process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY ?? '',
};

export const FEATURE_FLAGS = {
  /** AI captions/transcription. Off by default; requires explicit per-clip consent even when on. */
  aiCaptions: process.env.EXPO_PUBLIC_FEATURE_AI_CAPTIONS === 'true',
  /** Apple/Google social login. Off until native credentials exist (see OWNER_ACTIONS_REQUIRED). */
  socialLogin: process.env.EXPO_PUBLIC_FEATURE_SOCIAL_LOGIN === 'true',
  /** Real RevenueCat purchases vs. the local mock adapter. */
  liveSubscriptions: Boolean(ENV.revenueCatIosKey || ENV.revenueCatAndroidKey),
};
