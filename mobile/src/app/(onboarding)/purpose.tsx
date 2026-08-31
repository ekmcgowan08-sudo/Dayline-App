import { View } from 'react-native';
import { router } from 'expo-router';
import { spacing } from '../../constants/theme';
import { BRAND } from '../../constants/brand';
import { Button } from '../../components/ui/Button';
import { Screen } from '../../components/ui/Screen';
import { Text } from '../../components/ui/Text';
import { useTheme } from '../../hooks/use-theme';

const POINTS = [
  { title: 'No followers, no feed', body: 'Nobody sees anything unless you choose to share it with a small group.' },
  { title: 'Five seconds, a few times a day', body: "We'll nudge you at moments through the day — you just point and capture." },
  { title: 'One film of your day', body: 'Your clips become a short, private montage — yours to keep or share.' },
];

export default function Purpose() {
  const theme = useTheme();
  return (
    <Screen scroll>
      <View style={{ gap: spacing.xxl, paddingTop: spacing.xl }}>
        <Text variant="title">What {BRAND.name} is for</Text>
        <View style={{ gap: spacing.xl }}>
          {POINTS.map((p) => (
            <View key={p.title} style={{ gap: spacing.xxs }}>
              <Text variant="heading">{p.title}</Text>
              <Text variant="body" color={theme.textSecondary}>
                {p.body}
              </Text>
            </View>
          ))}
        </View>
        <Button label="Continue" onPress={() => router.push('/(onboarding)/consent')} />
      </View>
    </Screen>
  );
}
