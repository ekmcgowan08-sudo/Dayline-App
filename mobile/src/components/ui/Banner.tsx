import { StyleSheet, View } from 'react-native';
import { radius, spacing } from '../../constants/theme';
import { useTheme } from '../../hooks/use-theme';
import { Text } from './Text';

type Kind = 'error' | 'info' | 'success' | 'warning';

export function Banner({ kind = 'info', message }: { kind?: Kind; message: string }) {
  const theme = useTheme();
  const colors: Record<Kind, string> = {
    error: theme.danger,
    info: theme.accentSky,
    success: theme.success,
    warning: theme.warning,
  };
  return (
    <View
      style={[styles.wrap, { backgroundColor: colors[kind] + '22', borderColor: colors[kind] }]}
      accessibilityRole="alert"
    >
      <Text variant="caption" color={theme.textPrimary}>
        {message}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderWidth: 1, borderRadius: radius.md, padding: spacing.sm },
});
