import { useEffect } from 'react';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { CrashFallback } from '../components/CrashFallback';
import { CrashReportingErrorBoundary, initCrashReporting, setCrashReportingUser } from '../lib/crashReporting';
import { useAuthStore } from '../state/auth-store';

SplashScreen.preventAutoHideAsync().catch(() => {});
initCrashReporting();

export default function RootLayout() {
  const initialize = useAuthStore((s) => s.initialize);
  const initializing = useAuthStore((s) => s.initializing);
  const userId = useAuthStore((s) => s.session?.user.id ?? null);

  useEffect(() => {
    initialize();
  }, [initialize]);

  useEffect(() => {
    if (!initializing) SplashScreen.hideAsync().catch(() => {});
  }, [initializing]);

  useEffect(() => {
    setCrashReportingUser(userId);
  }, [userId]);

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
