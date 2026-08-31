import { forwardRef } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { MIN_TOUCH_TARGET, radius, spacing } from '../../constants/theme';
import { useTheme } from '../../hooks/use-theme';
import { Text } from './Text';

type Props = TextInputProps & {
  label: string;
  error?: string | null;
};

export const TextField = forwardRef<TextInput, Props>(({ label, error, style, ...rest }, ref) => {
  const theme = useTheme();
  return (
    <View style={styles.wrap}>
      <Text variant="caption" color={theme.textSecondary} style={styles.label}>
        {label}
      </Text>
      <TextInput
        ref={ref}
        accessibilityLabel={label}
        placeholderTextColor={theme.textSecondary}
        style={[
          styles.input,
          { color: theme.textPrimary, borderColor: error ? theme.danger : theme.border, backgroundColor: theme.surface },
          style,
        ]}
        {...rest}
      />
      {error ? (
        <Text variant="caption" color={theme.danger} style={styles.error}>
          {error}
        </Text>
      ) : null}
    </View>
  );
});
TextField.displayName = 'TextField';

const styles = StyleSheet.create({
  wrap: { gap: spacing.xxs, width: '100%' },
  label: { marginLeft: spacing.xxs },
  input: {
    minHeight: MIN_TOUCH_TARGET,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    fontSize: 16,
  },
  error: { marginLeft: spacing.xxs },
});
