import { View } from 'react-native';
import { router } from 'expo-router';
import { spacing } from '../../../constants/theme';
import { BRAND } from '../../../constants/brand';
import { useAuthStore } from '../../../state/auth-store';
import { Avatar } from '../../../components/ui/Avatar';
import { Button } from '../../../components/ui/Button';
import { Screen } from '../../../components/ui/Screen';
import { SettingsRow } from '../../../components/ui/SettingsRow';
import { Text } from '../../../components/ui/Text';
import { useTheme } from '../../../hooks/use-theme';

export default function SettingsHub() {
  const theme = useTheme();
  const profile = useAuthStore((s) => s.profile);
  const session = useAuthStore((s) => s.session);
  const signOut = useAuthStore((s) => s.signOut);

  return (
    <Screen scroll>
      <View style={{ gap: spacing.xl }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <Avatar name={profile?.display_name ?? session?.user.email ?? '?'} url={profile?.avatar_url} size={56} />
          <View>
            <Text variant="heading">{profile?.display_name ?? 'You'}</Text>
            <Text variant="caption" color={theme.textSecondary}>
              {session?.user.email}
            </Text>
          </View>
        </View>

        <View>
          <SettingsRow label="Profile" sublabel="Name, photo, timezone" onPress={() => router.push('/(app)/settings/profile')} />
          <SettingsRow
            label="Capture schedule"
            sublabel="Active days, reminder times, quiet hours"
            onPress={() => router.push('/(app)/settings/schedule')}
          />
          <SettingsRow
            label="Memories"
            sublabel="On-this-day notifications"
            onPress={() => router.push('/(app)/settings/notifications')}
          />
          <SettingsRow label="Subscription" sublabel="Dayline Plus" onPress={() => router.push('/(app)/settings/subscription')} />
          <SettingsRow label="AI captions" sublabel="Optional, off by default" onPress={() => router.push('/(app)/settings/ai-consent')} />
          <SettingsRow
            label="Privacy & data"
            sublabel="Blocked people, export, delete account"
            onPress={() => router.push('/(app)/settings/privacy')}
          />
          <SettingsRow label="Support" sublabel={`Contact ${BRAND.supportEmail}`} onPress={() => router.push('/(app)/settings/support')} />
        </View>

        <Button label="Sign out" variant="secondary" onPress={signOut} />
      </View>
    </Screen>
  );
}
