import { useState } from 'react';
import { router } from 'expo-router';
import { spacing } from '../../constants/theme';
import { useAuthStore } from '../../state/auth-store';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Screen } from '../../components/ui/Screen';
import { Text } from '../../components/ui/Text';
import { TextField } from '../../components/ui/TextField';
import { View } from 'react-native';

export default function SignIn() {
  const signIn = useAuthStore((s) => s.signIn);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSignIn() {
    setError(null);
    setLoading(true);
    const { error } = await signIn(email.trim(), password);
    setLoading(false);
    if (error) setError(error);
    // Successful sign-in updates the auth store; the root index route
    // handles redirecting once the profile has loaded.
  }

  return (
    <Screen scroll center>
      <View style={{ gap: spacing.lg }}>
        <Text variant="title">Welcome back</Text>
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
          autoComplete="password"
          value={password}
          onChangeText={setPassword}
        />
        <Button label="Log in" onPress={handleSignIn} loading={loading} disabled={!email || !password} />
        <Button label="Forgot password?" variant="ghost" onPress={() => router.push('/(auth)/forgot-password')} />
      </View>
    </Screen>
  );
}
