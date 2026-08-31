import { ActivityIndicator, Pressable, StyleSheet, type GestureResponderEvent } from 'react-native';
import * as Haptics from 'expo-haptics';
import { MIN_TOUCH_TARGET, radius, spacing } from '../../constants/theme';
import { useTheme } from '../../hooks/use-theme';
import { Text } from './Text';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

type Props = {
  label: string;
  onPress: (e: GestureResponderEvent) => void;
  variant?: Variant;
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  accessibilityHint?: string;
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  fullWidth = true,
  accessibilityHint,
}: Props) {
  const theme = useTheme();
  const isDisabled = disabled || loading;

  const backgrounds: Record<Variant, string> = {
    primary: theme.accentCoral,
    secondary: theme.surfaceRaised,
    ghost: 'transparent',
    danger: theme.danger,
  };
  const textColors: Record<Variant, string> = {
    primary: theme.textInverse,
    secondary: theme.textPrimary,
    ghost: theme.accentCoral,
    danger: theme.textInverse,
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      accessibilityHint={accessibilityHint}
      onPress={(e) => {
        if (isDisabled) return;
        Haptics.selectionAsync().catch(() => {});
        onPress(e);
      }}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        fullWidth && styles.fullWidth,
        { backgroundColor: backgrounds[variant], opacity: isDisabled ? 0.5 : pressed ? 0.85 : 1 },
        variant === 'secondary' && { borderWidth: 1, borderColor: theme.border },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={textColors[variant]} />
      ) : (
        <Text variant="bodyMedium" color={textColors[variant]}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xl,
  },
  fullWidth: { width: '100%' },
});
