import { Redirect } from 'expo-router';
import { useAuthStore } from '../state/auth-store';
import { LoadingState } from '../components/ui/LoadingState';

/**
 * The root route is a pure redirect gate: splash screen stays up (see
 * _layout.tsx) until auth state resolves, then routes to onboarding,
 * auth, or the main app. No screen renders here in the steady state.
 */
export default function Index() {
  const initializing = useAuthStore((s) => s.initializing);
  const session = useAuthStore((s) => s.session);
  const profile = useAuthStore((s) => s.profile);
  const profileLoaded = useAuthStore((s) => s.profileLoaded);

  if (initializing) return <LoadingState />;
  if (!session) return <Redirect href="/(auth)/welcome" />;
  if (!profileLoaded) return <LoadingState />;
  if (!profile?.onboarding_completed_at) return <Redirect href="/(onboarding)/purpose" />;
  return <Redirect href="/(app)/today" />;
}
