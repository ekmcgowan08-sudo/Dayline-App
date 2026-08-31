import { Redirect, Stack } from 'expo-router';
import { useAuthStore } from '../../state/auth-store';

export default function OnboardingLayout() {
  const session = useAuthStore((s) => s.session);
  if (!session) return <Redirect href="/(auth)/welcome" />;
  return <Stack screenOptions={{ headerShown: false, gestureEnabled: false }} />;
}
