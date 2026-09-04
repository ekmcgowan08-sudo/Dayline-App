import { parseRecoveryTokensFromUrl } from '../passwordResetLink';

describe('parseRecoveryTokensFromUrl', () => {
  it('extracts tokens from a real Supabase implicit-flow recovery link', () => {
    const url =
      'dayline://reset-password#access_token=abc123&refresh_token=def456&expires_in=3600&token_type=bearer&type=recovery';
    expect(parseRecoveryTokensFromUrl(url)).toEqual({ accessToken: 'abc123', refreshToken: 'def456' });
  });

  it('returns null when there is no fragment at all (a plain cold-start URL)', () => {
    expect(parseRecoveryTokensFromUrl('dayline://reset-password')).toBeNull();
  });

  it('returns null when the fragment type is not "recovery" (e.g. a magic-link sign-in)', () => {
    const url = 'dayline://reset-password#access_token=abc123&refresh_token=def456&type=magiclink';
    expect(parseRecoveryTokensFromUrl(url)).toBeNull();
  });

  it('returns null when a token is missing', () => {
    const url = 'dayline://reset-password#access_token=abc123&type=recovery';
    expect(parseRecoveryTokensFromUrl(url)).toBeNull();
  });

  it('returns null for null/undefined input', () => {
    expect(parseRecoveryTokensFromUrl(null)).toBeNull();
    expect(parseRecoveryTokensFromUrl(undefined)).toBeNull();
  });
});
