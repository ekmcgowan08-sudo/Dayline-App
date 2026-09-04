import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { spacing } from '../constants/theme';
import { parseRecoveryTokensFromUrl } from '../lib/passwordResetLink';
import { supabase } from '../lib/supabase';
import { Banner } from '../components/ui/Banner';
import { Button } from '../components/ui/Button';
import { LoadingState } from '../components/ui/LoadingState';
import { Screen } from '../components/ui/Screen';
import { Text } from '../components/ui/Text';
import { TextField } from '../components/ui/TextField';

const MIN_PASSWORD_LENGTH = 8;
// Generous grace period for the 'url' event listener below to catch a
// recovery link on a warm app (already running in the background) in case
// `Linking.getInitialURL()` — the cold-start path, and the common case for
// tapping an email link — comes back empty. After this, treat the link as
// invalid/expired rather than leaving the user on a spinner forever.
const LINK_WAIT_TIMEOUT_MS = 4000;

/**
 * Screen for Supabase's password-recovery deep link
 * (`dayline://reset-password`, registered as this app's top-level route so
 * it isn't gated by `(auth)/_layout.tsx`'s "already signed in? redirect to
 * /" check — establishing the recovery session below intentionally makes
 * `useAuthStore`'s session non-null while the user is still choosing a new
 * password).
 *
 * Before this screen existed, "Forgot password?" was a fully dead end:
 * `requestPasswordReset()` sent a real email, but nothing in the app
 * handled the link it contained, and no code anywhere called
 * `supabase.auth.updateUser({ password })` to actually complete a reset.
 */
export default function ResetPassword() {
  const [ready, setReady] = useState(false);
  const [invalidLink, setInvalidLink] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const processedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function tryUrl(url: string | null) {
      if (cancelled || processedRef.current) return;
      const tokens = parseRecoveryTokensFromUrl(url);
      if (!tokens) return;
      processedRef.current = true;
      const { error: sessionError } = await supabase.auth.setSession({
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
      });
      if (cancelled) return;
      if (sessionError) setInvalidLink(true);
      setReady(true);
    }

    Linking.getInitialURL().then(tryUrl);
    const subscription = Linking.addEventListener('url', (event) => {
      tryUrl(event.url);
    });
    const timeout = setTimeout(() => {
      if (!cancelled && !processedRef.current) {
        setInvalidLink(true);
        setReady(true);
      }
    }, LINK_WAIT_TIMEOUT_MS);

    return () => {
      cancelled = true;
      subscription.remove();
      clearTimeout(timeout);
    };
  }, []);

  async function handleSubmit() {
    setError(null);
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setDone(true);
  }

  if (!ready) return <LoadingState label="Verifying your reset link" />;

  if (invalidLink) {
    return (
      <Screen scroll center>
        <View style={{ gap: spacing.lg }}>
          <Text variant="title">This link isn&apos;t valid</Text>
          <Text variant="body">
            Password reset links expire after a while, or may have already been used. Request a new one from the sign-in screen.
          </Text>
          <Button label="Back to sign in" onPress={() => router.replace('/(auth)/sign-in')} />
        </View>
      </Screen>
    );
  }

  if (done) {
    return (
      <Screen scroll center>
        <View style={{ gap: spacing.lg }}>
          <Text variant="title">Password updated</Text>
          <Text variant="body">You can continue into Dayline now.</Text>
          <Button label="Continue" onPress={() => router.replace('/')} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen scroll center>
      <View style={{ gap: spacing.lg }}>
        <Text variant="title">Set a new password</Text>
        {error ? <Banner kind="error" message={error} /> : null}
        <TextField
          label="New password"
          secureTextEntry
          autoComplete="new-password"
          value={password}
          onChangeText={setPassword}
        />
        <TextField
          label="Confirm new password"
          secureTextEntry
          autoComplete="new-password"
          value={confirm}
          onChangeText={setConfirm}
        />
        <Button label="Update password" onPress={handleSubmit} loading={loading} disabled={!password || !confirm} />
      </View>
    </Screen>
  );
}
