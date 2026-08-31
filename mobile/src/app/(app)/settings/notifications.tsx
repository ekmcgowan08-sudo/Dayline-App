import { useEffect, useState } from 'react';
import { Switch, View } from 'react-native';
import { router } from 'expo-router';
import { spacing } from '../../../constants/theme';
import { supabase } from '../../../lib/supabase';
import { useAuthStore } from '../../../state/auth-store';
import { updateMemoryNotifications } from '../../../services/account';
import { Button } from '../../../components/ui/Button';
import { Screen } from '../../../components/ui/Screen';
import { Text } from '../../../components/ui/Text';
import { useTheme } from '../../../hooks/use-theme';

export default function MemoryNotificationSettings() {
  const theme = useTheme();
  const session = useAuthStore((s) => s.session);
  const [enabled, setEnabled] = useState(true);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!session) return;
    supabase
      .from('notification_preferences')
      .select('memory_notifications')
      .eq('user_id', session.user.id)
      .maybeSingle()
      .then(({ data }) => {
        setEnabled(data?.memory_notifications ?? true);
        setLoaded(true);
      });
  }, [session]);

  async function toggle(value: boolean) {
    if (!session) return;
    setEnabled(value);
    await updateMemoryNotifications(session.user.id, value);
  }

  if (!loaded) return null;

  return (
    <Screen scroll>
      <View style={{ gap: spacing.xl }}>
        <Text variant="title">Memories</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flex: 1, marginRight: spacing.md }}>
            <Text variant="body">On-this-day notifications</Text>
            <Text variant="caption" color={theme.textSecondary}>
              A gentle nudge when a montage from a week, a month, or a year ago resurfaces.
            </Text>
          </View>
          <Switch value={enabled} onValueChange={toggle} accessibilityLabel="On-this-day notifications" />
        </View>
        <Button label="Back" variant="ghost" onPress={() => router.back()} />
      </View>
    </Screen>
  );
}
