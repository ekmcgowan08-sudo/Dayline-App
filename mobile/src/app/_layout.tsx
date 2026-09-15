import { useEffect } from 'react';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { CrashFallback } from '../components/CrashFallback';
import { CrashReportingErrorBoundary, initCrashReporting, setCrashReportingUser } from '../lib/crashReporting';
import {
  handleColdStartNotification,
  registerNotificationTapHandler,
  registerPushToken,
  registerPushTokenRefreshListener,
} from '../services/notifications';
import { useAuthStore } from '../state/auth-store';

SplashScreen.preventAutoHideAsync().catch(() => {});
initCrashReporting();

export default function RootLayout() {
  const initialize = useAuthStore((s) => s.initialize);
  const initializing = useAuthStore((s) => s.initializing);
  const userId = useAuthStore((s) => s.session?.user.id ?? null);
  const profileLoaded = useAuthStore((s) => s.profileLoaded);
  const onboardingCompleted = useAuthStore((s) => Boolean(s.profile?.onboarding_completed_at));

  useEffect(() => {
    initialize();
  }, [initialize]);

  useEffect(() => {
    if (!initializing) SplashScreen.hideAsync().catch(() => {});
  }, [initializing]);

  useEffect(() => {
    setCrashReportingUser(userId);
  }, [userId]);

  useEffect(() => {
    // Re-registers on every app start for a user who has already
    // completed onboarding once (on any device) — not just once during
    // onboarding itself, which is the ONLY other place this ever ran.
    // Without this, an existing user's push token never gets
    // (re-)registered after a reinstall, a new device, or clearing app
    // data, since onboarding never runs again for an account whose
    // onboarding_completed_at is already set (see
    // docs/IMPLEMENTATION_STATUS.md Phase 52). Gated on onboarding being
    // done (rather than firing for every signed-in user, including one
    // mid-onboarding) so a brand-new user still gets the permission
    // prompt at its intentional, contextual point in the onboarding
    // flow, not immediately at launch. register_push_token() is a
    // cheap, idempotent upsert-by-reassignment, so calling it on every
    // launch thereafter is safe.
    if (!userId || !profileLoaded || !onboardingCompleted) return;
    registerPushToken(userId);
    const subscription = registerPushTokenRefreshListener();
    return () => subscription.remove();
  }, [userId, profileLoaded, onboardingCompleted]);

  useEffect(() => {
    const subscription = registerNotificationTapHandler();
    handleColdStartNotification();
    return () => subscription.remove();
  }, []);

  return (
    <CrashReportingErrorBoundary fallback={({ resetError }) => <CrashFallback resetError={resetError} />}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="capture" options={{ presentation: 'fullScreenModal' }} />
          </Stack>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </CrashReportingErrorBoundary>
  );
}
