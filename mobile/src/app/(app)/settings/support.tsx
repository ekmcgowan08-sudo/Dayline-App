import { Linking, View } from 'react-native';
import { router } from 'expo-router';
import { spacing } from '../../../constants/theme';
import { BRAND } from '../../../constants/brand';
import { Button } from '../../../components/ui/Button';
import { Screen } from '../../../components/ui/Screen';
import { Text } from '../../../components/ui/Text';
import { useTheme } from '../../../hooks/use-theme';

const FAQ = [
  { q: 'Who can see my clips?', a: 'Only you, until you explicitly choose to share one to a group.' },
  { q: 'Can I capture without a reminder?', a: 'Yes — tap "Capture a moment" on Today anytime.' },
  { q: 'What happens if I miss a reminder?', a: "Nothing bad — it's just marked missed, no streaks or shame." },
  { q: 'How do I leave a group?', a: 'Open the group, scroll down, and tap Leave (or Delete if you own it).' },
];

export default function Support() {
  const theme = useTheme();
  return (
    <Screen scroll>
      <View style={{ gap: spacing.xl }}>
        <Text variant="title">Support</Text>
        <Button label={`Email ${BRAND.supportEmail}`} onPress={() => Linking.openURL(`mailto:${BRAND.supportEmail}`)} />
        <View style={{ gap: spacing.md }}>
          {FAQ.map((item) => (
            <View key={item.q}>
              <Text variant="bodyMedium">{item.q}</Text>
              <Text variant="body" color={theme.textSecondary}>
                {item.a}
              </Text>
            </View>
          ))}
        </View>
        <Button label="Back" variant="ghost" onPress={() => router.back()} />
      </View>
    </Screen>
  );
}
