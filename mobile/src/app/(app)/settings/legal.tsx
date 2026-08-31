import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { spacing } from '../../../constants/theme';
import { COMMUNITY_RULES_TEXT, PRIVACY_TEXT, TERMS_TEXT } from '../../../constants/legalText';
import { Button } from '../../../components/ui/Button';
import { Screen } from '../../../components/ui/Screen';
import { Text } from '../../../components/ui/Text';
import { useTheme } from '../../../hooks/use-theme';

const DOCS = [
  { key: 'terms', label: 'Terms', text: TERMS_TEXT },
  { key: 'privacy', label: 'Privacy', text: PRIVACY_TEXT },
  { key: 'rules', label: 'Community Rules', text: COMMUNITY_RULES_TEXT },
] as const;

export default function Legal() {
  const theme = useTheme();
  const [active, setActive] = useState<(typeof DOCS)[number]['key']>('terms');
  const doc = DOCS.find((d) => d.key === active)!;

  return (
    <Screen scroll>
      <View style={{ gap: spacing.lg }}>
        <Text variant="title">Legal</Text>
        <View style={{ flexDirection: 'row', gap: spacing.xs }}>
          {DOCS.map((d) => (
            <Pressable
              key={d.key}
              onPress={() => setActive(d.key)}
              style={{
                paddingVertical: spacing.xxs,
                paddingHorizontal: spacing.sm,
                borderRadius: 999,
                borderWidth: 1,
                borderColor: active === d.key ? theme.accentCoral : theme.border,
              }}
            >
              <Text variant="caption" color={active === d.key ? theme.accentCoral : theme.textSecondary}>
                {d.label}
              </Text>
            </Pressable>
          ))}
        </View>
        <Text variant="body">{doc.text}</Text>
        <Button label="Back" variant="ghost" onPress={() => router.back()} />
      </View>
    </Screen>
  );
}
