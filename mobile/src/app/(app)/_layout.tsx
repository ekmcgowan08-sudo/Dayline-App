import { Redirect, Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../state/auth-store';
import { useTheme } from '../../hooks/use-theme';

export default function AppLayout() {
  const theme = useTheme();
  const session = useAuthStore((s) => s.session);
  const profile = useAuthStore((s) => s.profile);
  const profileLoaded = useAuthStore((s) => s.profileLoaded);

  if (!session) return <Redirect href="/(auth)/welcome" />;
  if (profileLoaded && !profile?.onboarding_completed_at) return <Redirect href="/(onboarding)/purpose" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.accentCoral,
        tabBarInactiveTintColor: theme.textSecondary,
        tabBarStyle: { backgroundColor: theme.surface, borderTopColor: theme.border },
      }}
    >
      <Tabs.Screen
        name="today"
        options={{ title: 'Today', tabBarIcon: ({ color, size }) => <Ionicons name="sunny-outline" size={size} color={color} /> }}
      />
      <Tabs.Screen
        name="memories"
        options={{ title: 'Memories', tabBarIcon: ({ color, size }) => <Ionicons name="time-outline" size={size} color={color} /> }}
      />
      <Tabs.Screen
        name="groups"
        options={{ title: 'Groups', tabBarIcon: ({ color, size }) => <Ionicons name="people-outline" size={size} color={color} /> }}
      />
      <Tabs.Screen
        name="settings"
        options={{ title: 'Settings', tabBarIcon: ({ color, size }) => <Ionicons name="settings-outline" size={size} color={color} /> }}
      />
      <Tabs.Screen name="montage/[id]" options={{ href: null }} />
    </Tabs>
  );
}
