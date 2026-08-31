import { StyleSheet, View } from 'react-native';
import { spacing } from '../../constants/theme';
import { useTheme } from '../../hooks/use-theme';
import { Button } from './Button';
import { Text } from './Text';

type Props = {
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
};

/** No-shame-language empty/zero states — used for Today, Memories, Groups. */
export function EmptyState({ title, message, actionLabel, onAction }: Props) {
  const theme = useTheme();
  return (
    <View style={styles.wrap}>
      <Text variant="heading" style={styles.center}>
        {title}
      </Text>
      {message ? (
        <Text variant="body" color={theme.textSecondary} style={[styles.center, styles.message]}>
          {message}
        </Text>
      ) : null}
      {actionLabel && onAction ? (
        <View style={styles.action}>
          <Button label={actionLabel} onPress={onAction} variant="secondary" />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.xxxl, gap: spacing.sm },
  center: { textAlign: 'center' },
  message: { maxWidth: 280 },
  action: { marginTop: spacing.md, minWidth: 180 },
});
