import { Redirect, Stack } from 'expo-router';
import { useAuthStore } from '../../state/auth-store';

export default function AuthLayout() {
  const session = useAuthStore((s) => s.session);
  // Already signed in: don't let a stale deep link back into auth screens.
  if (session) return <Redirect href="/" />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
