import { useState } from 'react';
import { View } from 'react-native';
import { spacing } from '../../constants/theme';
import { useAuthStore } from '../../state/auth-store';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Screen } from '../../components/ui/Screen';
import { Text } from '../../components/ui/Text';
import { TextField } from '../../components/ui/TextField';

export default function ForgotPassword() {
  const requestPasswordReset = useAuthStore((s) => s.requestPasswordReset);
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSend() {
    setError(null);
    setLoading(true);
    const { error } = await requestPasswordReset(email.trim());
    setLoading(false);
    if (error) setError(error);
    else setSent(true);
  }

  return (
    <Screen scroll center>
      <View style={{ gap: spacing.lg }}>
        <Text variant="title">Reset your password</Text>
        {sent ? (
          <Banner kind="success" message="If that email has an account, a reset link is on its way." />
        ) : (
          <>
            <Text variant="body">{"We'll email you a link to set a new password."}</Text>
            {error ? <Banner kind="error" message={error} /> : null}
            <TextField
              label="Email"
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
            />
            <Button label="Send reset link" onPress={handleSend} loading={loading} disabled={!email} />
          </>
        )}
      </View>
    </Screen>
  );
}
