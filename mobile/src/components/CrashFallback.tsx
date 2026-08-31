import { View } from 'react-native';
import { spacing } from '../constants/theme';
import { useTheme } from '../hooks/use-theme';
import { Button } from './ui/Button';
import { Text } from './ui/Text';

/**
 * Rendered in place of the whole app if a render-time error escapes every
 * screen-level try/catch. Deliberately doesn't depend on any app state or
 * provider beyond `useTheme` (system color scheme only, no context) —
 * whatever crashed might have been upstream of those providers, and a
 * fallback that itself depends on broken state isn't a fallback.
 */
export function CrashFallback({ resetError }: { resetError: () => void }) {
  const theme = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.md, backgroundColor: theme.background }}>
      <Text variant="title">Something went wrong</Text>
      <Text variant="body" color={theme.textSecondary} style={{ textAlign: 'center' }}>
        {
          "Dayline hit an unexpected error. Any clips you've already captured are safely queued on this device and will keep uploading in the background."
        }
      </Text>
      <Button label="Try again" onPress={resetError} />
    </View>
  );
}
