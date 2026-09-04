/**
 * Supabase's password-recovery email redirects to this app's
 * `dayline://reset-password` deep link (see
 * `state/auth-store.ts`'s `requestPasswordReset`) with the session tokens
 * in the URL **fragment** — `#access_token=...&refresh_token=...&type=recovery`
 * — because this client uses Supabase's default `implicit` auth flow (see
 * `lib/supabase.ts`, which doesn't override `flowType`), not PKCE's
 * `?code=` query param. Expo Router's route params only surface
 * query-string values, not fragment values, so the reset-password screen
 * has to parse the raw URL itself. Pulled out as a pure function, in the
 * same spirit as `notificationRouting.ts`, so it's unit-testable without
 * pulling in `expo-linking`/`lib/supabase.ts`.
 */
export type RecoveryTokens = { accessToken: string; refreshToken: string };

export function parseRecoveryTokensFromUrl(url: string | null | undefined): RecoveryTokens | null {
  if (!url) return null;
  const fragment = url.split('#')[1];
  if (!fragment) return null;
  const params = new URLSearchParams(fragment);
  const type = params.get('type');
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  if (type !== 'recovery' || !accessToken || !refreshToken) return null;
  return { accessToken, refreshToken };
}
