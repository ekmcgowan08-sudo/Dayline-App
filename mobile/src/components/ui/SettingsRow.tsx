import { Pressable, StyleSheet, View } from 'react-native';
import { MIN_TOUCH_TARGET, spacing } from '../../constants/theme';
import { useTheme } from '../../hooks/use-theme';
import { Text } from './Text';

export function SettingsRow({
  label,
  sublabel,
  onPress,
  destructive = false,
}: {
  label: string;
  sublabel?: string;
  onPress: () => void;
  destructive?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.row, { borderColor: theme.border, opacity: pressed ? 0.7 : 1 }]}
    >
      <View style={{ flex: 1 }}>
        <Text variant="body" color={destructive ? theme.danger : theme.textPrimary}>
          {label}
        </Text>
        {sublabel ? (
          <Text variant="caption" color={theme.textSecondary}>
            {sublabel}
          </Text>
        ) : null}
      </View>
      <Text variant="body" color={theme.textSecondary}>
        {'>'}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
  },
});
