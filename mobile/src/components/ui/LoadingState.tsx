import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { spacing } from '../../constants/theme';
import { useTheme } from '../../hooks/use-theme';
import { Text } from './Text';

export function LoadingState({ label }: { label?: string }) {
  const theme = useTheme();
  return (
    <View style={styles.wrap} accessibilityRole="progressbar" accessibilityLabel={label ?? 'Loading'}>
      <ActivityIndicator color={theme.accentCoral} size="large" />
      {label ? (
        <Text variant="caption" color={theme.textSecondary}>
          {label}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
});
