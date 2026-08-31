import { useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { spacing } from '../../constants/theme';
import { supabase } from '../../lib/supabase';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Screen } from '../../components/ui/Screen';
import { Text } from '../../components/ui/Text';

export default function VerifyEmail() {
  const { email } = useLocalSearchParams<{ email?: string }>();
  const [resent, setResent] = useState(false);
  const [checking, setChecking] = useState(false);
  const [notYetVerified, setNotYetVerified] = useState(false);

  async function resend() {
    if (!email) return;
    await supabase.auth.resend({ type: 'signup', email });
    setResent(true);
  }

  async function checkAndContinue() {
    setChecking(true);
    setNotYetVerified(false);
    // Refreshing the session picks up a confirmed-email state if the user
    // tapped the email link in another tab/app and comes back here.
    const { data } = await supabase.auth.refreshSession();
    setChecking(false);
    if (data.session?.user.email_confirmed_at) {
      router.replace('/');
    } else {
      setNotYetVerified(true);
    }
  }

  return (
    <Screen scroll center>
      <View style={{ gap: spacing.lg }}>
        <Text variant="title">Check your email</Text>
        <Text variant="body">
          We sent a confirmation link to {email ?? 'your email address'}. Tap
          it, then come back here.
        </Text>
        {resent ? <Banner kind="success" message="Confirmation email resent." /> : null}
        {notYetVerified ? <Banner kind="warning" message="Still not confirmed — check your inbox (and spam folder)." /> : null}
        <Button label="I've confirmed my email" onPress={checkAndContinue} loading={checking} />
        <Button label="Resend email" variant="secondary" onPress={resend} />
      </View>
    </Screen>
  );
}
