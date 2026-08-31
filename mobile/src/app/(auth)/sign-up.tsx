import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { spacing } from '../../constants/theme';
import { useTheme } from '../../hooks/use-theme';
import { useAuthStore } from '../../state/auth-store';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Screen } from '../../components/ui/Screen';
import { Text } from '../../components/ui/Text';
import { TextField } from '../../components/ui/TextField';

const MIN_PASSWORD_LENGTH = 8;

export default function SignUp() {
  const theme = useTheme();
  const signUp = useAuthStore((s) => s.signUp);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const passwordTooShort = password.length > 0 && password.length < MIN_PASSWORD_LENGTH;
  const passwordsMismatch = confirm.length > 0 && confirm !== password;

  async function handleSignUp() {
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
    const { error } = await signUp(email.trim(), password);
    setLoading(false);
    if (error) {
      setError(error);
      return;
    }
    router.replace({ pathname: '/(auth)/verify-email', params: { email: email.trim() } });
  }

  return (
    <Screen scroll center>
      <View style={{ gap: spacing.lg }}>
        <Text variant="title">Create your account</Text>
        <Text variant="body" color={theme.textSecondary}>
          Dayline is private by default — this account is just for you and
          whoever you choose to share a day with.
        </Text>
        {error ? <Banner kind="error" message={error} /> : null}
        <TextField
          label="Email"
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
        />
        <TextField
          label="Password"
          secureTextEntry
          autoComplete="new-password"
          value={password}
          onChangeText={setPassword}
          error={passwordTooShort ? `At least ${MIN_PASSWORD_LENGTH} characters` : null}
        />
        <TextField
          label="Confirm password"
          secureTextEntry
          autoComplete="new-password"
          value={confirm}
          onChangeText={setConfirm}
          error={passwordsMismatch ? 'Passwords do not match' : null}
        />
        <Button
          label="Create account"
          onPress={handleSignUp}
          loading={loading}
          disabled={!email || !password || !confirm}
        />
        <Text variant="tiny" color={theme.textSecondary} style={{ textAlign: 'center' }}>
          {"By continuing you'll be asked to confirm your age and accept our Terms, Privacy Policy, and Community Rules."}
        </Text>
      </View>
    </Screen>
  );
}
