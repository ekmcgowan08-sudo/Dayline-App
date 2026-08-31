import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { BRAND } from '../../constants/brand';
import { spacing } from '../../constants/theme';
import { useTheme } from '../../hooks/use-theme';
import { Button } from '../../components/ui/Button';
import { Text } from '../../components/ui/Text';
import { Screen } from '../../components/ui/Screen';

export default function Welcome() {
  const theme = useTheme();
  return (
    <Screen padded={false}>
      <LinearGradient
        colors={theme.mode === 'light' ? [theme.accentCoral, theme.accentLavender] : [theme.surfaceRaised, theme.background]}
        style={styles.hero}
      >
        <Text variant="display" color={theme.textInverse} style={styles.wordmark}>
          {BRAND.wordmark}
        </Text>
        <Text variant="heading" color={theme.textInverse} style={styles.tagline}>
          {BRAND.tagline}
        </Text>
      </LinearGradient>

      <View style={styles.body}>
        <Text variant="body" color={theme.textSecondary} style={styles.explainer}>
          A private space for you and a small group of close friends. A few
          five-second moments a day become one short film of your day —
          no followers, no feed, no public numbers. Just what actually
          happened, kept somewhere warm.
        </Text>

        <View style={styles.actions}>
          <Button label="Create account" onPress={() => router.push('/(auth)/sign-up')} />
          <Button label="I already have an account" variant="secondary" onPress={() => router.push('/(auth)/sign-in')} />
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {
    paddingTop: 96,
    paddingBottom: spacing.xxl,
    paddingHorizontal: spacing.xl,
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
    gap: spacing.sm,
  },
  wordmark: { textAlign: 'left' },
  tagline: { opacity: 0.95 },
  body: { flex: 1, padding: spacing.xl, justifyContent: 'space-between' },
  explainer: { marginTop: spacing.xl },
  actions: { gap: spacing.sm, marginTop: spacing.xl },
});
