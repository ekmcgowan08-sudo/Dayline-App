import { type ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { spacing } from '../../constants/theme';
import { useTheme } from '../../hooks/use-theme';

type Props = {
  children: ReactNode;
  scroll?: boolean;
  padded?: boolean;
  center?: boolean;
};

/** Standard screen chrome: theme background, safe area, optional scroll + keyboard avoidance. */
export function Screen({ children, scroll = false, padded = true, center = false }: Props) {
  const theme = useTheme();
  const Container = scroll ? ScrollView : View;
  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: theme.background }]} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={8}
      >
        <Container
          style={styles.flex}
          contentContainerStyle={[
            padded && styles.padded,
            center && styles.center,
            scroll ? undefined : styles.flex,
          ]}
        >
          {children}
        </Container>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  padded: { padding: spacing.xl },
  center: { flexGrow: 1, justifyContent: 'center' },
});
